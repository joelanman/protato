import crossSpawn from 'cross-spawn'

import { isExactVersion } from '../npm-registry.js'
import { getPaths } from '../paths.js'
import { isValidPackageName, protectedPackages } from './list.js'

const npmFlags = ['--no-audit', '--no-fund']

// Only the action, package names and exact install versions are read from the
// plan, so nothing else can become an npm flag, path or URL.
function buildNpmArguments(plan) {
	const { action, changes } = plan

	if (!['install', 'update', 'uninstall'].includes(action)) {
		throw new Error(`Unsupported npm operation: ${action}`)
	}

	if (!Array.isArray(changes) || changes.length === 0) {
		throw new Error('A plugin plan must include at least one package')
	}

	const args = [action === 'uninstall' ? 'uninstall' : 'install', ...npmFlags]

	if (action !== 'uninstall') {
		// without this npm saves the exact version as a range such as ^1.2.3
		args.push('--save-exact')
	}

	const seen = new Set()

	for (const change of changes) {
		const packageName = change.packageName

		if (!isValidPackageName(packageName)) {
			throw new Error(`${packageName} is not a valid package name`)
		}

		if (seen.has(packageName)) {
			throw new Error(`${packageName} appears more than once in the plan`)
		}

		seen.add(packageName)

		if (action === 'uninstall') {
			// defence in depth: the planner also refuses this, but the execution
			// boundary must not remove a protected package even if a plan asks it to
			if (protectedPackages.has(packageName)) {
				throw new Error(`${packageName} is protected and cannot be uninstalled`)
			}

			args.push(packageName)
			continue
		}

		if (!isExactVersion(change.version)) {
			throw new Error(`${packageName} needs an exact version, got: ${change.version}`)
		}

		args.push(`${packageName}@${change.version}`)
	}

	return args
}

function execute(args, projectDir) {
	return new Promise((resolve, reject) => {
		let stdout = ''
		let stderr = ''

		const child = crossSpawn('npm', args, {
			cwd: projectDir,
			shell: false,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		})

		child.stdout?.on('data', (chunk) => {
			stdout += chunk
		})
		child.stderr?.on('data', (chunk) => {
			stderr += chunk
		})

		child.on('error', (error) => {
			reject(new Error(`Could not run npm: ${error.message}`, { cause: error }))
		})

		// npm's final output can arrive after exit, so wait for close
		child.on('close', (code) => {
			resolve({ ok: code === 0, exitCode: code, stdout, stderr })
		})
	})
}

/**
 * Runs the npm install or uninstall for a plan. Only the structured plan is
 * accepted.
 *
 * @param {object} plan
 * @param {'install'|'update'|'uninstall'} plan.action
 * @param {Array<{packageName: string, version?: string}>} plan.changes
 */
async function runPluginPlan(plan) {
	const { project } = getPaths()

	return execute(buildNpmArguments(plan), project)
}

export { runPluginPlan }
