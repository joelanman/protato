import { alphabetical, tryit, unique } from 'radash'
import semver from 'semver'

import { fetchPackageMetadata, fetchPluginConfig, isExactVersion, isStableVersion } from '../npm-registry.js'
import { formatPackageName } from '../plugins.js'
import { isObject } from '../utils/json.js'
import { readInstalledPlugins } from './list.js'

// Two result shapes are used for failure:
//   { error, status }  the request was refused or could not be planned, and
//                      the person sees an error page
//   { problems }       the request was valid but the plan cannot go ahead, and
//                      the person sees the problems instead of a plan
//
// Throughout, `requestedName` is the package the person asked to change and
// `packageName` is any package being looked at.

// ---------------------------------------------------------------------------
// Reading and normalising dependency declarations
// ---------------------------------------------------------------------------

function isValidPackageName(packageName) {
	if (typeof packageName !== 'string' || packageName.length === 0 || packageName.length > 214) {
		return false
	}

	const scoped = packageName.startsWith('@')
	const parts = scoped ? packageName.slice(1).split('/') : [packageName]
	if (scoped && parts.length !== 2) return false

	return parts.every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._~-]*$/.test(part))
}

function getRange({ minVersion, maxVersion }) {
	if (minVersion && maxVersion) return `>=${minVersion} <=${maxVersion}`
	if (minVersion) return `>=${minVersion}`
	if (maxVersion) return `<=${maxVersion}`
	return '*'
}

function normaliseDependency(entry, index) {
	const position = `pluginDependencies[${index}]`
	const raw = typeof entry === 'string' ? { packageName: entry } : entry

	if (!isObject(raw) || !isValidPackageName(raw.packageName)) {
		throw new Error(`${position} had an invalid package name: ${raw?.packageName ?? entry}`)
	}

	const dependency = { packageName: raw.packageName }
	for (const key of ['minVersion', 'maxVersion']) {
		if (raw[key] === undefined) continue
		if (!isExactVersion(raw[key])) throw new Error(`${position} had an invalid ${key}: ${raw[key]}`)
		dependency[key] = raw[key]
	}

	if (dependency.minVersion && dependency.maxVersion && semver.gt(dependency.minVersion, dependency.maxVersion)) {
		throw new Error(
			`${position} had a minVersion greater than its maxVersion: ${dependency.minVersion} > ${dependency.maxVersion}`
		)
	}

	dependency.range = getRange(dependency)
	return dependency
}

// a peer dependency only constrains the plan when the peer is itself a plugin:
// govuk-frontend, something already installed, or something proxied in the project
function isPluginPeer(packageName, { installedByName, proxyConfigs }) {
	if (packageName === 'govuk-frontend') return true

	if (installedByName.has(packageName)) return true

	return Boolean(proxyConfigs[packageName])
}

// known gap: peerDependenciesMeta.optional is ignored, so an optional peer
// constrains the plan like a required one. No published plugin uses it yet.
function normalisePeerDependencies(peerDependencies, projectPlugins) {
	if (!isObject(peerDependencies)) return []

	const dependencies = []
	for (const [packageName, range] of Object.entries(peerDependencies)) {
		// an arbitrary package's peer declarations are advisory: an invalid name
		// or range is ignored rather than blocking the plan. pluginDependencies
		// come from this project's plugins, so those problems are reported.
		// semver treats an empty or x range as a wildcard, so `range` is checked
		// too: a blank peer declaration is ignored rather than unconstrained
		if (!isValidPackageName(packageName) || !range || !semver.validRange(range)) continue
		if (!isPluginPeer(packageName, projectPlugins)) continue

		dependencies.push({ packageName, range })
	}
	return dependencies
}

function toArray(value) {
	if (value === undefined || value === null) return []
	return Array.isArray(value) ? value : [value]
}

// `declarations` is anything with pluginDependencies and peerDependencies: an
// installed plugin or a plugin config. Returns { dependencies } or { problems },
// and never throws for a bad declaration.
function readDependencies(packageName, declarations, projectPlugins) {
	try {
		const pluginDependencies = toArray(declarations.pluginDependencies).map(normaliseDependency)
		const peerDependencies = normalisePeerDependencies(declarations.peerDependencies, projectPlugins)
		return { dependencies: [...pluginDependencies, ...peerDependencies] }
	} catch (error) {
		return { problems: [`Plugin ${packageName}: ${error.message}`] }
	}
}

// ---------------------------------------------------------------------------
// Requirements and version choice
//
// The install plan is two maps and one rule:
//   requirements:   package -> what must hold for it  ({ range, source }[])
//   chosenVersions: package -> the version we decided on
//   rule:           every chosen version satisfies every requirement for it
// ---------------------------------------------------------------------------

function createRequirements() {
	const byPackage = new Map()

	return {
		add(dependencies, source) {
			for (const { packageName, range } of dependencies) {
				if (!byPackage.has(packageName)) byPackage.set(packageName, [])
				byPackage.get(packageName).push({ range, source })
			}
		},
		get(packageName) {
			return byPackage.get(packageName) ?? []
		}
	}
}

function satisfies(version, requirements) {
	return requirements.every(({ range }) => semver.satisfies(version, range))
}

function getSources(requirements) {
	return unique(requirements.map(({ source }) => source)).sort()
}

function getDoesNotSatisfyProblem(packageName, version, requirements) {
	return `${packageName} ${version} does not satisfy requirements from ${getSources(requirements).join(', ')}.`
}

// checks the rule above. A requirement can arrive after its dependency has
// been chosen, so every choice is checked rather than silently kept.
function findConflicts(chosenVersions, requirements) {
	const problems = []

	for (const [packageName, version] of chosenVersions) {
		const packageRequirements = requirements.get(packageName)
		if (!satisfies(version, packageRequirements)) {
			problems.push(getDoesNotSatisfyProblem(packageName, version, packageRequirements))
		}
	}

	return problems
}

function highestSatisfyingVersion(metadata, requirements) {
	const stableVersions = metadata?.stableVersions ?? []
	const versions = stableVersions.length > 0 ? stableVersions : [metadata?.latestVersion]

	return versions
		.filter((version) => isStableVersion(version) && satisfies(version, requirements))
		.sort(semver.compare)
		.at(-1)
}

// ---------------------------------------------------------------------------
// Install and update planning
// ---------------------------------------------------------------------------

// Returns the refusal, or nothing if the action can go ahead. Install and
// update only need local state here, so a refusal never waits for the registry.
function checkInstall(action, packageName, installed) {
	if (installed?.readOnly) return { error: `${packageName} is read-only.`, status: 400 }

	if (action === 'update') {
		if (!installed?.installedVersion) return { error: `${packageName} is not installed.`, status: 400 }
		if (!isExactVersion(installed.installedVersion)) {
			return {
				error: `${packageName} has an installed version that is not exact: ${installed.installedVersion}`,
				status: 400
			}
		}
	} else if (installed?.installedVersion) {
		return { error: `${packageName} is already installed.`, status: 400 }
	}
}

// the registry's latest version, as long as it is one we can install. When
// installedVersion is given (an update) it must also be newer than that.
async function getLatestVersion(packageName, installedVersion) {
	const [error, metadata] = await tryit(fetchPackageMetadata)(packageName)
	if (error) return { error: error.message, status: 503 }

	const version = metadata.latestVersion
	if (!isExactVersion(version)) {
		return { error: `The registry did not provide a stable version for ${packageName}.`, status: 400 }
	}
	if (installedVersion && !semver.gt(version, installedVersion)) {
		return { error: `There is no newer version of ${packageName}.`, status: 400 }
	}
	return { version }
}

// the dependency declarations of a package at a version
async function getVersionConfig(packageName, version, { installedByName, proxyConfigs }) {
	const entry = installedByName.get(packageName)
	const proxyConfig = Object.hasOwn(proxyConfigs, packageName) ? proxyConfigs[packageName] : undefined

	// a config shipped in the package wins over a user proxy override
	if (proxyConfig && entry?.configSource !== 'file') return proxyConfig

	return fetchPluginConfig(packageName, version)
}

// picks the version for one dependency and the declarations that go with it.
// Returning problems keeps the queue loop free of the decision making.
async function resolveDependency(packageName, requirements, projectPlugins) {
	const entry = projectPlugins.installedByName.get(packageName)

	if (entry?.installedVersion && !isExactVersion(entry.installedVersion)) {
		return { problems: [`${packageName} has an installed version that is not exact: ${entry.installedVersion}`] }
	}

	if (entry?.installedVersion && satisfies(entry.installedVersion, requirements)) {
		return { version: entry.installedVersion, declarations: entry }
	}

	if (entry?.readOnly) {
		return { problems: [`${packageName} is required by ${getSources(requirements).join(', ')} but is read-only.`] }
	}

	const metadata = await fetchPackageMetadata(packageName)
	const version = highestSatisfyingVersion(metadata, requirements)
	if (!version) {
		return {
			problems: [
				`No stable version of ${packageName} satisfies requirements from ${getSources(requirements).join(', ')}.`
			]
		}
	}

	const declarations = await getVersionConfig(packageName, version, projectPlugins)
	return { version, declarations }
}

// records what every installed plugin demands, except the requested package
// (it is being replaced). Returns the declarations that could not be read; the
// caller decides whether they stop the plan.
function collectInstalledRequirements(requestedName, requirements, projectPlugins) {
	const problems = []

	for (const plugin of projectPlugins.installedByName.values()) {
		if (!plugin.installedVersion || plugin.packageName === requestedName) continue

		const parsed = readDependencies(plugin.packageName, plugin, projectPlugins)
		if (parsed.problems) problems.push(...parsed.problems)
		else requirements.add(parsed.dependencies, plugin.packageName)
	}

	return problems
}

function getChangeAction(installedVersion, version) {
	if (!installedVersion) return 'install'
	return semver.lt(version, installedVersion) ? 'downgrade' : 'update'
}

function toChanges(chosenVersions, requirements, installedByName, requestedName) {
	const changes = []

	for (const [packageName, version] of chosenVersions) {
		const installedVersion = installedByName.get(packageName)?.installedVersion
		if (installedVersion === version) continue

		const requested = packageName === requestedName
		changes.push({
			...formatPackageName(packageName),
			action: getChangeAction(installedVersion, version),
			version,
			installedVersion,
			reason: requested ? 'requested' : 'dependency',
			requiredBy: requested ? [] : getSources(requirements.get(packageName)).map(formatPackageName)
		})
	}

	return alphabetical(changes, (change) => change.packageName)
}

function blocked(problems) {
	return { changes: [], problems }
}

// chooses a version for the requested package's dependencies, and their
// dependencies in turn, and returns the resulting { changes, problems }
async function resolveDependencies(requestedName, version, projectPlugins) {
	const { installedByName } = projectPlugins
	const requirements = createRequirements()
	const chosenVersions = new Map([[requestedName, version]])
	const queue = []

	// records what a chosen package needs, queues those packages to be chosen,
	// and returns any problems that creates
	function addDependencies(packageName, declarations) {
		const parsed = readDependencies(packageName, declarations, projectPlugins)
		if (parsed.problems) return parsed.problems

		requirements.add(parsed.dependencies, packageName)
		queue.push(...parsed.dependencies.map((dependency) => dependency.packageName))
		return findConflicts(chosenVersions, requirements)
	}

	// 1. what the installed plugins already demand, and whether the requested version fits
	const installedProblems = collectInstalledRequirements(requestedName, requirements, projectPlugins)
	const problems = [...installedProblems, ...findConflicts(chosenVersions, requirements)]
	if (problems.length) return blocked(problems)

	// 2. what the requested package demands
	const requestedDeclarations = await getVersionConfig(requestedName, version, projectPlugins)
	const requestedProblems = addDependencies(requestedName, requestedDeclarations)
	if (requestedProblems.length) return blocked(requestedProblems)

	// 3. choose a version for each dependency, recording what that one needs
	while (queue.length) {
		const packageName = queue.shift()
		if (chosenVersions.has(packageName)) continue

		const resolution = await resolveDependency(packageName, requirements.get(packageName), projectPlugins)
		if (resolution.problems) return blocked(resolution.problems)

		chosenVersions.set(packageName, resolution.version)

		const dependencyProblems = addDependencies(packageName, resolution.declarations)
		if (dependencyProblems.length) return blocked(dependencyProblems)
	}

	return {
		changes: toChanges(chosenVersions, requirements, installedByName, requestedName),
		problems: []
	}
}

// returns { error, status } or { version, changes, problems }. A registry
// failure, whether fetching the latest version or walking dependencies, is a 503.
async function planInstall(requestedName, installed, projectPlugins) {
	const latest = await getLatestVersion(requestedName, installed?.installedVersion)
	if (latest.error) return latest

	const [error, result] = await tryit(resolveDependencies)(requestedName, latest.version, projectPlugins)
	if (error) return { error: error.message, status: 503 }

	return { ...result, version: latest.version }
}

// ---------------------------------------------------------------------------
// Uninstall planning
// ---------------------------------------------------------------------------

// Returns the refusal, or nothing if the package can be uninstalled. Uninstall
// only needs local state, so a refusal never waits for the registry.
function checkUninstall(packageName, installed) {
	if (!installed) return { error: `${packageName} is not installed.`, status: 400 }
	if (installed.protectedPackage) {
		return { error: `${packageName} is protected, so it cannot be uninstalled.`, status: 400 }
	}
	if (installed.readOnly) return { error: `${packageName} is read-only, so it cannot be uninstalled.`, status: 400 }
}

// uninstall only needs the names: whether one plugin pulls in another does not
// depend on its versions being valid, so a malformed declaration must not stop
// a plugin being removed
function readDependencyNames(declarations, projectPlugins) {
	const names = []

	for (const entry of toArray(declarations.pluginDependencies)) {
		const packageName = typeof entry === 'string' ? entry : entry?.packageName
		if (isValidPackageName(packageName)) names.push(packageName)
	}

	if (isObject(declarations.peerDependencies)) {
		for (const packageName of Object.keys(declarations.peerDependencies)) {
			if (isValidPackageName(packageName) && isPluginPeer(packageName, projectPlugins)) names.push(packageName)
		}
	}

	return unique(names)
}

// installed package -> names of the plugins it depends on (lenient, names only)
function indexInstalledDependencyNames(projectPlugins) {
	const dependenciesByPackage = new Map()

	for (const plugin of projectPlugins.installedByName.values()) {
		// names from package.json become npm arguments, so only index valid ones
		if (!plugin.installedVersion || !isValidPackageName(plugin.packageName)) continue
		dependenciesByPackage.set(plugin.packageName, readDependencyNames(plugin, projectPlugins))
	}

	return dependenciesByPackage
}

// every installed plugin that has to go when the requested one goes: the
// requested package itself, then whatever depended on anything already being removed
function findRemovals(requestedName, dependenciesByPackage) {
	const removal = new Set([requestedName])
	const queue = [requestedName]

	while (queue.length) {
		const removed = queue.pop()

		for (const [packageName, dependencies] of dependenciesByPackage) {
			if (removal.has(packageName) || !dependencies.includes(removed)) continue

			removal.add(packageName)
			queue.push(packageName)
		}
	}

	return removal
}

// removing a plugin also removes the installed plugins that depend on it. A
// dependent that cannot be removed stops the plan instead.
function planUninstall(requestedName, projectPlugins) {
	const { installedByName } = projectPlugins
	const dependenciesByPackage = indexInstalledDependencyNames(projectPlugins)
	const removal = findRemovals(requestedName, dependenciesByPackage)

	const changes = []
	const problems = []

	for (const packageName of [...removal].sort()) {
		const plugin = installedByName.get(packageName)
		const requested = packageName === requestedName

		// the requested package is checked by checkUninstall
		if (!requested) {
			if (plugin?.protectedPackage) {
				problems.push(`${packageName} is protected and cannot be uninstalled, so ${requestedName} cannot be removed.`)
			}
			if (plugin?.readOnly) {
				problems.push(`${packageName} is read-only and cannot be uninstalled, so ${requestedName} cannot be removed.`)
			}
		}

		// the removed dependencies that force this package to be removed with them
		const requiredBy = requested
			? []
			: dependenciesByPackage.get(packageName).filter((dependency) => removal.has(dependency))

		changes.push({
			...formatPackageName(packageName),
			action: 'uninstall',
			installedVersion: plugin?.installedVersion,
			reason: requested ? 'requested' : 'dependent',
			requiredBy: requiredBy.map(formatPackageName)
		})
	}

	return { changes: alphabetical(changes, (change) => change.packageName), problems }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function toPlanResponse(action, packageName, outcome) {
	return {
		action,
		plugin: formatPackageName(packageName),
		version: outcome.version,
		changes: outcome.changes,
		problems: outcome.problems
	}
}

async function makePluginPlan(action, packageName) {
	if (!['install', 'update', 'uninstall'].includes(action)) {
		return { error: 'Choose install, update or uninstall.', status: 400 }
	}
	if (!isValidPackageName(packageName)) {
		return { error: 'Choose a valid plugin package name.', status: 400 }
	}

	const { plugins: installedPlugins, proxyConfigs, diagnostics } = readInstalledPlugins()
	if (diagnostics.length) return { error: diagnostics.join(' '), status: 500 }

	const installedByName = new Map(installedPlugins.map((plugin) => [plugin.packageName, plugin]))
	const installed = installedByName.get(packageName)
	const projectPlugins = { installedByName, proxyConfigs }

	if (action === 'uninstall') {
		const refusal = checkUninstall(packageName, installed)
		if (refusal) return refusal

		return toPlanResponse(action, packageName, planUninstall(packageName, projectPlugins))
	}

	// install and update
	const refusal = checkInstall(action, packageName, installed)
	if (refusal) return refusal

	const outcome = await planInstall(packageName, installed, projectPlugins)
	if (outcome.error) return outcome

	return toPlanResponse(action, packageName, outcome)
}

export { makePluginPlan }
