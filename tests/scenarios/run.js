// Runs the scenarios in scenarios.js against the real npm registry and real npm.
// It needs network access and takes about a minute, so it is not part of
// `npm test`. Run it with `npm run test:scenarios`, or pass part of a scenario
// name to run a subset: `npm run test:scenarios -- hmrc`.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { makePluginPlan } from '../../lib/manage-plugins/make-plan.js'
import { runPluginPlan } from '../../lib/manage-plugins/run-plan.js'
import { clearRegistryCache } from '../../lib/npm-registry.js'
import { startFakeRegistry } from './fake-registry.js'
import fixtureScenarios from './fixture-scenarios.js'
import scenarios from './scenarios.js'

const allScenarios = [...scenarios, ...fixtureScenarios]

const REAL_REGISTRY_URL = 'https://registry.npmjs.org'

// plugins can have install scripts, and none of the scenarios need them
process.env.npm_config_ignore_scripts = 'true'
process.env.npm_config_update_notifier = 'false'

// npm must not block this process, because the fake registry runs in it
const execFileAsync = promisify(execFile)

function npm(args, cwd) {
	return execFileAsync('npm', args, { cwd, encoding: 'utf8' })
}

function readDependencies(dir) {
	return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies ?? {}
}

async function setUpProject({ setup, start, exact = true }) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-scenario-'))

	fs.writeFileSync(
		path.join(dir, 'package.json'),
		JSON.stringify({ name: 'scenario', version: '1.0.0', private: true })
	)
	setup?.(dir)

	if (start.length) {
		const saveFlag = exact ? '--save-exact' : '--save-prefix=^'
		await npm(['install', saveFlag, '--no-audit', '--no-fund', '--legacy-peer-deps', ...start], dir)
	}

	return dir
}

function describeChanges(plan) {
	return plan.changes.map((change) => `${change.action} ${change.packageName}`)
}

function sameItems(left, right) {
	return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function checkPlan(plan, expect) {
	if (expect.refused) {
		return Boolean(plan.error) && expect.refused.test(plan.error)
	}

	if (expect.blocked) {
		return !plan.error && plan.problems.some((problem) => expect.blocked.test(problem))
	}

	return !plan.error && plan.problems.length === 0 && sameItems(describeChanges(plan), expect.changes)
}

function checkDependencies(dir, expect, notes) {
	const dependencies = readDependencies(dir)

	notes.push(`dependencies after: ${JSON.stringify(dependencies)}`)

	return Object.entries(expect.deps ?? {}).every(([name, version]) => dependencies[name] === version)
}

async function runInProject(scenario, notes) {
	const { action, pkg, expect } = scenario
	const dir = await setUpProject(scenario)

	process.chdir(dir)

	try {
		let plan = scenario.plan

		if (!plan) {
			plan = await makePluginPlan(action, pkg)
			notes.push(
				`plan: ${plan.error ? `refused (${plan.status}) ${plan.error}` : describeChanges(plan).join(', ')}${plan.problems?.length ? ` [problems: ${plan.problems.join('; ')}]` : ''}`
			)

			if (!checkPlan(plan, expect)) {
				return false
			}
		}

		if (!scenario.run && !expect.runFails) {
			return true
		}

		const before = JSON.stringify(readDependencies(dir))
		const result = await runPluginPlan(plan)

		if (expect.runFails) {
			notes.push(`run: ok=${result.ok}`)

			return !result.ok && JSON.stringify(readDependencies(dir)) === before
		}

		if (!result.ok) {
			notes.push(`run failed: ${result.stderr.split('\n').slice(0, 3).join(' | ')}`)
			return false
		}

		if (!checkDependencies(dir, expect, notes)) {
			return false
		}

		// the project should now be settled: asking for the same thing again has nothing left to offer
		if (action !== 'uninstall') {
			const again = await makePluginPlan('update', pkg)

			if (!again.error && again.changes.length > 0) {
				notes.push(`a follow-up plan still has changes: ${describeChanges(again).join(', ')}`)
				return false
			}
		}

		return true
	} finally {
		process.chdir(os.tmpdir())
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

// scenarios with a `registry` fixture use a local fake registry for both
// protato's own registry requests and npm. Other scenarios use the real one.
async function runScenario(scenario, notes) {
	if (!scenario.registry) {
		return runInProject(scenario, notes)
	}

	const registry = await startFakeRegistry(scenario.registry)
	const realFetch = globalThis.fetch
	const realRegistry = process.env.npm_config_registry

	process.env.npm_config_registry = registry.url
	globalThis.fetch = (url, options) => realFetch(String(url).replace(REAL_REGISTRY_URL, registry.url), options)
	clearRegistryCache()

	try {
		return await runInProject(scenario, notes)
	} finally {
		globalThis.fetch = realFetch
		clearRegistryCache()

		if (realRegistry === undefined) {
			delete process.env.npm_config_registry
		} else {
			process.env.npm_config_registry = realRegistry
		}

		await registry.close()
	}
}

const filter = process.argv[2]
let failed = 0

for (const scenario of allScenarios.filter((scenario) => !filter || scenario.name.includes(filter))) {
	const notes = []
	let passed

	try {
		passed = await runScenario(scenario, notes)
	} catch (error) {
		notes.push(`threw: ${error.message.split('\n')[0]}`)
		passed = false
	}

	if (!passed) {
		failed++
	}

	console.log(`${passed ? 'PASS' : 'FAIL'}  ${scenario.name}`)

	if (!passed) {
		for (const note of notes) {
			console.log(`        ${note}`)
		}
	}
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
