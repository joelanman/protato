import fs from 'node:fs'
import path from 'node:path'

import crossSpawn from 'cross-spawn'
import semver from 'semver'

import knownPlugins from '../known-plugins.json' with { type: 'json' }
import { fetchPackageMetadata, fetchPluginConfig, isExactVersion, isStableVersion } from './npm-registry.js'
import { getPaths } from './paths.js'
import { formatPackageName, isObject, readInstalledPackage, readProxyConfigs } from './plugins.js'

const npmFlags = ['--no-audit', '--no-fund']
const protectedPackages = new Set(knownPlugins.protected)
const knownPackageNames = new Set([...knownPlugins.protected, ...knownPlugins.available])

function readJsonFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function isValidPackageName(packageName) {
	if (typeof packageName !== 'string' || packageName.length === 0 || packageName.length > 214) {
		return false
	}

	const parts = packageName.startsWith('@') ? packageName.slice(1).split('/') : [packageName]

	if (packageName.startsWith('@') && parts.length !== 2) {
		return false
	}

	return parts.every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._~-]*$/.test(part))
}

function normaliseDependency(entry, index) {
	const position = `pluginDependencies[${index}]`
	const raw = typeof entry === 'string' ? { packageName: entry } : entry

	if (!isObject(raw) || !isValidPackageName(raw.packageName)) {
		throw new Error(`${position} had an invalid package name: ${raw?.packageName ?? entry}`)
	}

	const dependency = { packageName: raw.packageName }

	for (const key of ['minVersion', 'maxVersion']) {
		if (raw[key] === undefined) {
			continue
		}

		if (!isExactVersion(raw[key])) {
			throw new Error(`${position} had an invalid ${key}: ${raw[key]}`)
		}

		dependency[key] = raw[key]
	}

	if (dependency.minVersion && dependency.maxVersion && semver.gt(dependency.minVersion, dependency.maxVersion)) {
		throw new Error(
			`${position} had a minVersion greater than its maxVersion: ${dependency.minVersion} > ${dependency.maxVersion}`
		)
	}

	return dependency
}

// pluginDependencies may be missing, a single string, or a list of strings and
// objects. A malformed list is reported as a problem by the caller.
function readDependencies(packageName, pluginDependencies) {
	try {
		return { dependencies: [].concat(pluginDependencies ?? []).map(normaliseDependency) }
	} catch (error) {
		return { error: `Plugin ${packageName}: ${error.message}` }
	}
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function readProjectDependencies(paths, diagnostics) {
	try {
		const projectPackage = readJsonFile(path.join(paths.project, 'package.json'))

		if (!isObject(projectPackage)) {
			throw new Error('expected an object')
		}

		return isObject(projectPackage.dependencies) ? projectPackage.dependencies : {}
	} catch (error) {
		diagnostics.push(`Could not read project package.json: ${error.message}`)
		return {}
	}
}

function getInstallSource(declaration) {
	if (declaration === undefined) {
		return
	}

	if (typeof declaration !== 'string' || declaration.trim().length === 0) {
		return 'invalid'
	}

	return semver.validRange(declaration) ? 'registry' : 'other'
}

function buildPluginEntry(packageName, declaration, installed) {
	const diagnostics = [...installed.diagnostics]
	const installSource = getInstallSource(declaration)

	if (installSource === 'invalid') {
		diagnostics.push(`Invalid dependency declaration for ${packageName}: expected a non-empty string`)
	}

	if (installed.installedVersion && !isExactVersion(installed.installedVersion)) {
		diagnostics.push(`Installed version of ${packageName} is not exact: ${installed.installedVersion}`)
	}

	// protato is the tool running the project, so it cannot update or uninstall
	// itself. Anything not installed from the registry is left alone rather
	// than being replaced by a registry version.
	return {
		packageName,
		...formatPackageName(packageName),
		installedVersion: installed.installedVersion,
		protectedPackage: protectedPackages.has(packageName),
		readOnly: packageName === 'protato' || (installSource !== undefined && installSource !== 'registry'),
		pluginDependencies: installed.pluginDependencies,
		configSource: installed.configSource,
		latestVersion: undefined,
		diagnostics
	}
}

// known plugins first (protected, then available), in their defined order, then
// any other project dependencies that behave as plugins. Read from disk on
// every call so edits and npm installs are visible immediately.
function readPluginEntries() {
	const paths = getPaths()
	const diagnostics = []
	const dependencies = readProjectDependencies(paths, diagnostics)
	const proxyConfigs = readProxyConfigs()
	const entries = []

	for (const packageName of knownPackageNames) {
		const installed = readInstalledPackage(paths.project, packageName, proxyConfigs)
		entries.push(buildPluginEntry(packageName, dependencies[packageName], installed))
	}

	for (const packageName of Object.keys(dependencies).sort()) {
		if (knownPackageNames.has(packageName)) {
			continue
		}

		const installed = readInstalledPackage(paths.project, packageName, proxyConfigs)

		if (installed.hasPluginConfig) {
			entries.push(buildPluginEntry(packageName, dependencies[packageName], installed))
		}
	}

	return { plugins: entries, diagnostics, proxyConfigs }
}

// installedVersion and latestVersion are both exact versions, so comparing them
// cannot throw; anything else is not an update the page can offer
function hasUpdate(installedVersion, latestVersion) {
	return isExactVersion(installedVersion) && isExactVersion(latestVersion) && semver.gt(latestVersion, installedVersion)
}

// the page only offers actions the planner will accept, and both read the same
// fields, so the flags are derived in one place
function getActions(plugin) {
	const installed = Boolean(plugin.installedVersion)
	const writable = !plugin.readOnly

	return {
		install: writable && !installed && Boolean(plugin.latestVersion),
		update: writable && installed && hasUpdate(plugin.installedVersion, plugin.latestVersion),
		uninstall: writable && !plugin.protectedPackage && installed
	}
}

// the registry stage: each entry gets the latest version the registry has, or a
// diagnostic if the lookup failed. A failed lookup never fails the page.
async function getLatestVersions(entries) {
	return Promise.all(
		entries.map(async (plugin) => {
			if (plugin.readOnly) {
				return { ...plugin }
			}

			try {
				const metadata = await fetchPackageMetadata(plugin.packageName)
				return { ...plugin, latestVersion: metadata.latestVersion }
			} catch (error) {
				return {
					...plugin,
					diagnostics: [
						...plugin.diagnostics,
						`Could not check for updates for ${plugin.packageName}: ${error.message}`
					]
				}
			}
		})
	)
}

async function listPlugins() {
	const { plugins: entries, diagnostics } = readPluginEntries()
	const withVersions = await getLatestVersions(entries)

	return {
		plugins: withVersions.map((plugin) => ({ ...plugin, actions: getActions(plugin) })),
		diagnostics
	}
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function satisfies(version, requirements) {
	return requirements.every(({ dependency }) => {
		if (dependency.minVersion && semver.lt(version, dependency.minVersion)) {
			return false
		}

		return !dependency.maxVersion || semver.lte(version, dependency.maxVersion)
	})
}

function getSources(requirements) {
	return [...new Set(requirements.map(({ source }) => source))].sort()
}

function highestSatisfyingVersion(metadata, requirements) {
	const versions =
		Array.isArray(metadata?.stableVersions) && metadata.stableVersions.length
			? metadata.stableVersions
			: [metadata?.latestVersion]

	return versions
		.filter((version) => isStableVersion(version) && satisfies(version, requirements))
		.sort(semver.compare)
		.at(-1)
}

function getChangeAction(installedVersion, version) {
	if (!installedVersion) {
		return 'install'
	}

	return semver.lt(version, installedVersion) ? 'downgrade' : 'update'
}

function getInstalledVersionProblem(packageName, installedVersion) {
	if (!isExactVersion(installedVersion)) {
		return `${packageName} has an installed version that is not exact: ${installedVersion}`
	}
}

function getDoesNotSatisfyProblem(packageName, version, requirements) {
	return `${packageName} ${version} does not satisfy requirements from ${getSources(requirements).join(', ')}.`
}

function createPackageRecord(packageName, entry) {
	return {
		packageName,
		installed: Boolean(entry?.installedVersion),
		installedVersion: entry?.installedVersion,
		pluginDependencies: entry?.pluginDependencies,
		requirements: [],
		version: undefined,
		changed: false,
		queued: false,
		readOnly: Boolean(entry?.readOnly)
	}
}

function getPackageRecord(state, packageName) {
	let record = state.records.get(packageName)

	if (!record) {
		record = createPackageRecord(packageName)
		state.records.set(packageName, record)
	}

	return record
}

function createInstallState(packageName, version, installedPlugins) {
	const records = new Map()

	for (const entry of installedPlugins) {
		records.set(entry.packageName, createPackageRecord(entry.packageName, entry))
	}

	const state = { records, queue: [], problems: [] }
	const target = getPackageRecord(state, packageName)

	target.version = version
	target.queued = true

	return state
}

function addRequirement(state, dependency, source) {
	const record = getPackageRecord(state, dependency.packageName)
	record.requirements.push({ dependency, source })

	if (record.version && !satisfies(record.version, [record.requirements.at(-1)])) {
		state.problems.push(getDoesNotSatisfyProblem(dependency.packageName, record.version, record.requirements))
	}
}

function readStateDependencies(state, packageName, pluginDependencies) {
	const parsed = readDependencies(packageName, pluginDependencies)

	if (parsed.error) {
		state.problems.push(parsed.error)
		return
	}

	return parsed.dependencies
}

function queueDependencies(state, packageName, dependencies) {
	for (const dependency of dependencies) {
		addRequirement(state, dependency, packageName)

		const record = getPackageRecord(state, dependency.packageName)

		if (!record.queued) {
			record.queued = true
			state.queue.push(dependency.packageName)
		}
	}
}

// a package's own config wins over a proxy config. Proxy configs are the only
// source for packages that behave as plugins without shipping a kit config,
// such as jquery or a package configured in the project's plugin-proxy.json.
async function readVersionDependencies(packageName, version, { installedPlugins, proxyConfigs }) {
	const entry = installedPlugins.find((plugin) => plugin.packageName === packageName)

	if (entry?.configSource !== 'file' && Object.hasOwn(proxyConfigs, packageName)) {
		return proxyConfigs[packageName]?.pluginDependencies
	}

	const { pluginDependencies } = await fetchPluginConfig(packageName, version)

	return pluginDependencies
}

// returns the package's plugin dependencies, or undefined when a problem was
// recorded. An empty list means the package has no dependencies.
async function resolveDependency(state, packageName, context) {
	const record = getPackageRecord(state, packageName)

	if (record.installed) {
		const installedVersionProblem = getInstalledVersionProblem(packageName, record.installedVersion)

		if (installedVersionProblem) {
			state.problems.push(installedVersionProblem)
			return
		}
	}

	if (record.installed && satisfies(record.installedVersion, record.requirements)) {
		record.version = record.installedVersion
		return record.pluginDependencies ?? []
	}

	if (record.readOnly) {
		state.problems.push(`${packageName} is required by ${getSources(record.requirements).join(', ')} but is read-only.`)
		return
	}

	const metadata = await fetchPackageMetadata(packageName)
	const version = highestSatisfyingVersion(metadata, record.requirements)

	if (!version) {
		state.problems.push(
			`No stable version of ${packageName} satisfies requirements from ${getSources(record.requirements).join(', ')}.`
		)
		return
	}

	const pluginDependencies = await readVersionDependencies(packageName, version, context)

	record.version = version
	record.changed = true

	return pluginDependencies ?? []
}

function getInstallChanges(packageName, version, state) {
	const changes = []
	const packageNames = [
		packageName,
		...[...state.records.values()].filter((record) => record.changed).map((record) => record.packageName)
	].sort()

	for (const name of packageNames) {
		const record = state.records.get(name)
		const changeVersion = name === packageName ? version : record.version
		const installedVersion = record.installedVersion

		if (name === packageName && installedVersion === changeVersion) {
			continue
		}

		changes.push({
			action: getChangeAction(installedVersion, changeVersion),
			packageName: name,
			version: changeVersion,
			installedVersion,
			reason: name === packageName ? 'requested' : 'dependency',
			requiredBy: name === packageName ? [] : getSources(record.requirements)
		})
	}

	return changes
}

async function planInstall(packageName, version, { installedPlugins, proxyConfigs }) {
	const state = createInstallState(packageName, version, installedPlugins)

	if (state.problems.length) {
		return { changes: [], problems: state.problems }
	}

	// constraints from installed plugins that are not the package being changed
	for (const entry of installedPlugins) {
		if (!entry.installedVersion || entry.packageName === packageName) {
			continue
		}

		const dependencies = readStateDependencies(state, entry.packageName, entry.pluginDependencies)

		if (!dependencies) {
			continue
		}

		for (const dependency of dependencies) {
			addRequirement(state, dependency, entry.packageName)
		}
	}

	const target = getPackageRecord(state, packageName)

	if (!satisfies(version, target.requirements)) {
		state.problems.push(getDoesNotSatisfyProblem(packageName, version, target.requirements))
	}

	if (state.problems.length) {
		return { changes: [], problems: state.problems }
	}

	const targetDependencies = readStateDependencies(
		state,
		packageName,
		await readVersionDependencies(packageName, version, { installedPlugins, proxyConfigs })
	)

	if (!targetDependencies) {
		return { changes: [], problems: state.problems }
	}

	queueDependencies(state, packageName, targetDependencies)

	// one pass is enough for the real one-level plugin dependencies. If a
	// requirement discovered late conflicts with a version already chosen, that
	// is reported as a problem rather than re-chosen.
	while (state.queue.length) {
		const queuedName = state.queue.shift()
		const pluginDependencies = await resolveDependency(state, queuedName, { installedPlugins, proxyConfigs })

		if (pluginDependencies === undefined) {
			break
		}

		const dependencies = readStateDependencies(state, queuedName, pluginDependencies)

		if (!dependencies) {
			break
		}

		queueDependencies(state, queuedName, dependencies)
	}

	if (state.problems.length) {
		return { changes: [], problems: state.problems }
	}

	return { changes: getInstallChanges(packageName, version, state), problems: [] }
}

function getRemovedDependencies(dependencies, removal) {
	return [
		...new Set(
			dependencies
				.filter((dependency) => removal.has(dependency.packageName))
				.map((dependency) => dependency.packageName)
		)
	]
}

function planUninstall(packageName, installedPlugins) {
	const installed = new Map(
		installedPlugins.filter((plugin) => plugin.installedVersion).map((plugin) => [plugin.packageName, plugin])
	)
	const dependenciesByPackage = new Map()
	const problems = []

	for (const entry of installedPlugins) {
		if (!entry.installedVersion) {
			continue
		}

		const parsed = readDependencies(entry.packageName, entry.pluginDependencies)

		if (parsed.error) {
			problems.push(parsed.error)
			continue
		}

		dependenciesByPackage.set(entry.packageName, parsed.dependencies)
	}

	if (problems.length) {
		return { changes: [], problems }
	}

	// removing a plugin also removes installed plugins that depend on it
	const removal = new Set([packageName])
	let added = true

	while (added) {
		added = false

		for (const [name, dependencies] of dependenciesByPackage) {
			if (removal.has(name)) {
				continue
			}

			if (dependencies.some((dependency) => removal.has(dependency.packageName))) {
				removal.add(name)
				added = true
			}
		}
	}

	const pluginsByPackage = new Map(installedPlugins.map((plugin) => [plugin.packageName, plugin]))
	const changes = []

	for (const name of removal) {
		const isRequested = name === packageName
		const requiredBy = isRequested ? [] : getRemovedDependencies(dependenciesByPackage.get(name) ?? [], removal)
		const plugin = pluginsByPackage.get(name)

		if (plugin?.protectedPackage) {
			problems.push(`${name} is protected and cannot be uninstalled.`)
		}

		if (plugin?.readOnly) {
			problems.push(`${name} is read-only and cannot be uninstalled.`)
		}

		changes.push({
			action: 'uninstall',
			packageName: name,
			installedVersion: installed.get(name)?.installedVersion,
			reason: isRequested ? 'requested' : 'dependent',
			requiredBy
		})
	}

	changes.sort((left, right) =>
		left.packageName < right.packageName ? -1 : left.packageName > right.packageName ? 1 : 0
	)

	return { changes, problems }
}

// returns { version } or { error, status }, preserving the order of the checks
async function getTargetVersion(action, packageName, target) {
	if (action === 'uninstall') {
		if (!target?.installedVersion) {
			return { error: `${packageName} is not installed.`, status: 400 }
		}

		if (target.protectedPackage) {
			return { error: `${packageName} is protected, so it cannot be uninstalled.`, status: 400 }
		}

		if (target.readOnly) {
			return { error: `${packageName} is read-only, so it cannot be uninstalled.`, status: 400 }
		}

		if (!isExactVersion(target.installedVersion)) {
			return {
				error: `${packageName} has an installed version that is not exact: ${target.installedVersion}`,
				status: 400
			}
		}

		return {}
	}

	if (target?.readOnly) {
		return { error: `${packageName} is read-only.`, status: 400 }
	}

	let metadata

	try {
		metadata = await fetchPackageMetadata(packageName)
	} catch (error) {
		return { error: error.message, status: 503 }
	}

	const version = metadata.latestVersion

	if (!isExactVersion(version)) {
		return { error: `The registry did not provide a stable version for ${packageName}.`, status: 400 }
	}

	if (action === 'install' && target?.installedVersion) {
		return { error: `${packageName} is already installed.`, status: 400 }
	}

	if (action === 'update') {
		if (!target?.installedVersion) {
			return { error: `${packageName} is not installed.`, status: 400 }
		}

		if (!isExactVersion(target.installedVersion) || !semver.gt(version, target.installedVersion)) {
			return { error: `There is no newer version of ${packageName}.`, status: 400 }
		}
	}

	return { version }
}

/**
 * Plan an install, update or uninstall from the project on disk, without
 * changing anything. Returns the plan used by both the confirm page and the
 * runner, or { error, status } when the action is not allowed.
 */
async function planPluginAction(action, packageName) {
	if (!['install', 'update', 'uninstall'].includes(action)) {
		return { error: 'Choose install, update or uninstall.', status: 400 }
	}

	if (!isValidPackageName(packageName)) {
		return { error: 'Choose a valid plugin package name.', status: 400 }
	}

	const { plugins: installedPlugins, proxyConfigs } = readPluginEntries()
	const target = installedPlugins.find((plugin) => plugin.packageName === packageName)
	const prepared = await getTargetVersion(action, packageName, target)

	if (prepared.error) {
		return prepared
	}

	let result

	try {
		result =
			action === 'uninstall'
				? planUninstall(packageName, installedPlugins)
				: await planInstall(packageName, prepared.version, { installedPlugins, proxyConfigs })
	} catch (error) {
		return { error: error.message, status: 503 }
	}

	const changes = result.changes.map((change) => ({
		...change,
		...formatPackageName(change.packageName),
		requiredByNames: change.requiredBy.map((requiredBy) => ({
			packageName: requiredBy,
			...formatPackageName(requiredBy)
		}))
	}))
	const formatted = formatPackageName(packageName)

	return {
		action,
		packageName,
		pluginName: target?.name ?? formatted.name,
		publisher: target?.publisher ?? formatted.publisher,
		version: prepared.version,
		ok: result.problems.length === 0,
		noop: result.problems.length === 0 && changes.length === 0,
		changes,
		problems: result.problems
	}
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

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
async function runPluginAction(plan) {
	const { project } = getPaths()

	return execute(buildNpmArguments(plan), project)
}

export { listPlugins, planPluginAction, runPluginAction }
