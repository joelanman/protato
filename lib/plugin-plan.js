import semver from 'semver'

import {
	isExactVersion,
	isStableVersion,
	normalisePluginDependencies,
	PluginDependencyError
} from './plugin-dependencies.js'

function createResult(input, { changes = [], problems = [], noop = false } = {}) {
	return {
		operation: input.operation,
		requested: { packageName: input.packageName, version: input.version },
		ok: problems.length === 0,
		noop,
		changes,
		problems
	}
}

function getInstalledMap(plugins) {
	return new Map(plugins.filter((plugin) => plugin.installedVersion).map((plugin) => [plugin.packageName, plugin]))
}

// pluginDependencies may be missing, a single string, or a list of strings and
// objects. A malformed list is a blocking problem; a config that could not be
// read is already reported by the management page and means no dependencies.
function readDependencies(packageName, pluginDependencies) {
	try {
		return { dependencies: normalisePluginDependencies(pluginDependencies) }
	} catch (error) {
		if (error instanceof PluginDependencyError) {
			return { error: `Plugin ${packageName}: ${error.message}` }
		}

		throw error
	}
}

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

function getRequiredByProblem(packageName, requirements, reason) {
	return `${packageName} is required by ${getSources(requirements).join(', ')} but ${reason}.`
}

function getInstalledVersionProblem(packageName, installedVersion) {
	if (!isExactVersion(installedVersion)) {
		return `${packageName} has an installed version that is not exact: ${installedVersion}`
	}
}

function getDoesNotSatisfyProblem(packageName, version, requirements) {
	return `${packageName} ${version} does not satisfy requirements from ${getSources(requirements).join(', ')}.`
}

function getTargetProblems(input, target) {
	const problems = []
	const installedVersionProblem =
		target.installed && getInstalledVersionProblem(input.packageName, target.installedVersion)

	if (installedVersionProblem) {
		problems.push(installedVersionProblem)
	}

	if (target.readOnly) {
		problems.push(`${input.packageName} is read-only.`)
	}

	return problems
}

function getPackageRecord(state, packageName) {
	let record = state.packages.get(packageName)

	if (!record) {
		record = {
			packageName,
			installed: false,
			installedVersion: undefined,
			pluginDependencies: undefined,
			requirements: [],
			version: undefined,
			changed: false,
			queued: false,
			readOnly: false,
			protectedPackage: false
		}
		state.packages.set(packageName, record)
	}

	return record
}

function createInstallState(input) {
	const packages = new Map()

	for (const entry of input.plugins) {
		packages.set(entry.packageName, {
			packageName: entry.packageName,
			installed: Boolean(entry.installedVersion),
			installedVersion: entry.installedVersion,
			pluginDependencies: entry.pluginDependencies,
			requirements: [],
			version: undefined,
			changed: false,
			queued: false,
			readOnly: Boolean(entry.readOnly),
			protectedPackage: Boolean(entry.protectedPackage)
		})
	}

	const state = {
		packages,
		queue: [],
		problems: []
	}

	const target = getPackageRecord(state, input.packageName)
	target.version = input.version
	target.queued = true
	state.problems = getTargetProblems(input, target)

	return state
}

function addRequirement(state, dependency, source) {
	const record = getPackageRecord(state, dependency.packageName)
	record.requirements.push({ dependency, source })

	if (record.version && !satisfies(record.version, [record.requirements.at(-1)])) {
		state.problems.push(getDoesNotSatisfyProblem(dependency.packageName, record.version, record.requirements))
	}
}

function parseOrProblem(state, packageName, pluginDependencies) {
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

// returns the package's plugin dependencies, or undefined when a problem was
// recorded. An empty list means the package has no dependencies.
async function resolveDependency(state, packageName, { getConfig, getMetadata }) {
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
		state.problems.push(getRequiredByProblem(packageName, record.requirements, 'is read-only'))
		return
	}

	const metadata = await getMetadata(packageName)
	const version = highestSatisfyingVersion(metadata, record.requirements)

	if (!version) {
		state.problems.push(
			`No stable version of ${packageName} satisfies requirements from ${getSources(record.requirements).join(', ')}.`
		)
		return
	}

	const config = await getConfig(packageName, version)
	record.version = version
	record.changed = true
	return config.pluginDependencies ?? []
}

function getInstallChanges(input, state) {
	const changes = []
	const packageNames = [
		input.packageName,
		...[...state.packages.values()].filter((record) => record.changed).map((record) => record.packageName)
	].sort()

	for (const packageName of packageNames) {
		const record = state.packages.get(packageName)
		const version = packageName === input.packageName ? input.version : record.version
		const installedVersion = record.installedVersion

		if (packageName === input.packageName && installedVersion === version) {
			continue
		}

		changes.push({
			action: getChangeAction(installedVersion, version),
			packageName,
			version,
			installedVersion,
			reason: packageName === input.packageName ? 'requested' : 'dependency',
			requiredBy: packageName === input.packageName ? [] : getSources(record.requirements)
		})
	}

	return changes
}

async function planInstall(input, { getConfig, getMetadata }) {
	const state = createInstallState(input)

	if (state.problems.length) {
		return createResult(input, { problems: state.problems })
	}

	// constraints from installed plugins that are not the package being changed
	for (const entry of input.plugins) {
		if (!entry.installedVersion || entry.packageName === input.packageName) {
			continue
		}

		const dependencies = parseOrProblem(state, entry.packageName, entry.pluginDependencies)

		if (!dependencies) {
			continue
		}

		for (const dependency of dependencies) {
			addRequirement(state, dependency, entry.packageName)
		}
	}

	const target = getPackageRecord(state, input.packageName)

	if (!satisfies(input.version, target.requirements)) {
		state.problems.push(getDoesNotSatisfyProblem(input.packageName, input.version, target.requirements))
	}

	if (state.problems.length) {
		return createResult(input, { problems: state.problems })
	}

	const targetConfig = await getConfig(input.packageName, input.version)
	const targetDependencies = parseOrProblem(state, input.packageName, targetConfig.pluginDependencies)

	if (!targetDependencies) {
		return createResult(input, { problems: state.problems })
	}

	queueDependencies(state, input.packageName, targetDependencies)

	// one pass is enough for the real one-level plugin dependencies. If a
	// requirement discovered late conflicts with a version already chosen, that
	// is reported as a problem rather than re-chosen.
	while (state.queue.length) {
		const packageName = state.queue.shift()
		const pluginDependencies = await resolveDependency(state, packageName, { getConfig, getMetadata })

		if (pluginDependencies === undefined) {
			break
		}

		const dependencies = parseOrProblem(state, packageName, pluginDependencies)

		if (!dependencies) {
			break
		}

		queueDependencies(state, packageName, dependencies)
	}

	if (state.problems.length) {
		return createResult(input, { problems: state.problems })
	}

	const changes = getInstallChanges(input, state)

	return createResult(input, { changes, noop: changes.length === 0 })
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

function planUninstall(input) {
	const installed = getInstalledMap(input.plugins)
	const target = installed.get(input.packageName)

	if (!target) {
		return createResult(input, { noop: true })
	}

	const problems = []

	if (!isExactVersion(target.installedVersion)) {
		problems.push(`${input.packageName} has an installed version that is not exact: ${target.installedVersion}`)
		return createResult(input, { problems })
	}

	const dependenciesByPackage = new Map()

	for (const entry of input.plugins) {
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
		return createResult(input, { problems })
	}

	// removing a plugin also removes installed plugins that depend on it
	const removal = new Set([input.packageName])
	let added = true

	while (added) {
		added = false

		for (const [packageName, dependencies] of dependenciesByPackage) {
			if (removal.has(packageName)) {
				continue
			}

			if (dependencies.some((dependency) => removal.has(dependency.packageName))) {
				removal.add(packageName)
				added = true
			}
		}
	}

	const pluginsByPackage = new Map(input.plugins.map((plugin) => [plugin.packageName, plugin]))
	const changes = []

	for (const packageName of removal) {
		const isRequested = packageName === input.packageName
		const requiredBy = isRequested ? [] : getRemovedDependencies(dependenciesByPackage.get(packageName) ?? [], removal)
		const plugin = pluginsByPackage.get(packageName)

		if (plugin?.protectedPackage) {
			problems.push(`${packageName} is protected and cannot be uninstalled.`)
		}

		if (plugin?.readOnly) {
			problems.push(`${packageName} is read-only and cannot be uninstalled.`)
		}

		changes.push({
			action: 'uninstall',
			packageName,
			installedVersion: installed.get(packageName)?.installedVersion,
			reason: isRequested ? 'requested' : 'dependent',
			requiredBy
		})
	}

	changes.sort((left, right) =>
		left.packageName < right.packageName ? -1 : left.packageName > right.packageName ? 1 : 0
	)

	return createResult(input, { changes, problems })
}

/**
 * Plan an install, update or uninstall without side effects. Registry reads are
 * injected so the planner itself does no network or filesystem work.
 *
 * @param {object} input
 * @param {'install' | 'update' | 'uninstall'} input.operation
 * @param {string} input.packageName
 * @param {string} [input.version]
 * @param {Array<{packageName: string, installedVersion?: string, pluginDependencies?: unknown, readOnly?: boolean, protectedPackage?: boolean}>} input.plugins
 * @param {{ getConfig: Function, getMetadata: Function }} registry
 * @returns {Promise<object>}
 */
async function planPluginChanges(input, registry) {
	return input.operation === 'uninstall' ? planUninstall(input) : planInstall(input, registry)
}

export { planPluginChanges }
