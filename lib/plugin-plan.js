import semver from 'semver'

import { isExactVersion, isStableVersion, normalisePluginDependencies, PluginRegistryError } from './plugin-registry.js'

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

function getInstalledMap(installed) {
	return new Map(installed.map((entry) => [entry.packageName, entry]))
}

// pluginDependencies may be missing, a single string, or a list of strings and
// objects. A malformed list is a blocking problem; a config that could not be
// read is already reported by the management page and means no dependencies.
function readDependencies(packageName, pluginDependencies) {
	try {
		return { dependencies: normalisePluginDependencies(pluginDependencies) }
	} catch (error) {
		if (error instanceof PluginRegistryError) {
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

// returns { version, dependencies, selected } or { problem }. selected means the
// package needs a change, so the caller records it in the plan.
async function resolvePackage(packageName, context) {
	const { requested, version, requirements, installed, known, readOnly, getConfig, getMetadata } = context
	const entry = installed.get(packageName)

	if (!requested && entry && !isExactVersion(entry.installedVersion)) {
		return { problem: `${packageName} has an installed version that is not exact: ${entry.installedVersion}` }
	}

	if (!requested && entry && satisfies(entry.installedVersion, requirements)) {
		const parsed = readDependencies(packageName, entry.pluginDependencies)

		if (parsed.error) {
			return { problem: parsed.error }
		}

		return { version: entry.installedVersion, dependencies: parsed.dependencies, selected: false }
	}

	if (!requested) {
		if (!known.has(packageName)) {
			return { problem: getRequiredByProblem(packageName, requirements, 'is not a known plugin') }
		}

		if (readOnly.has(packageName)) {
			return { problem: getRequiredByProblem(packageName, requirements, 'is read-only') }
		}
	}

	let configVersion = version

	if (!requested) {
		const metadata = await getMetadata(packageName)
		configVersion = highestSatisfyingVersion(metadata, requirements)

		if (!configVersion) {
			return {
				problem: `No stable version of ${packageName} satisfies requirements from ${getSources(requirements).join(', ')}.`
			}
		}
	}

	const config = await getConfig(packageName, configVersion)
	const parsed = readDependencies(packageName, config.pluginDependencies)

	if (parsed.error) {
		return { problem: parsed.error }
	}

	return { version: configVersion, dependencies: parsed.dependencies, selected: !requested }
}

function getTargetProblems(input, installed, known, readOnly) {
	const problems = []
	const target = installed.get(input.packageName)

	if (target && !isExactVersion(target.installedVersion)) {
		problems.push(`${input.packageName} has an installed version that is not exact: ${target.installedVersion}`)
	}

	if (!known.has(input.packageName)) {
		problems.push(`${input.packageName} is not a known plugin.`)
	}

	if (readOnly.has(input.packageName)) {
		problems.push(`${input.packageName} is read-only.`)
	}

	return problems
}

function addRequirement(requirements, decided, problems, dependency, source) {
	const existing = requirements.get(dependency.packageName) ?? []
	existing.push({ dependency, source })
	requirements.set(dependency.packageName, existing)

	const decidedVersion = decided.get(dependency.packageName)

	if (decidedVersion && !satisfies(decidedVersion, [{ dependency, source }])) {
		problems.push(
			`${dependency.packageName} ${decidedVersion} does not satisfy requirements from ${getSources(existing).join(', ')}.`
		)
	}
}

// constraints from installed plugins that are not the package being changed
function getInitialRequirements(input, decided) {
	const requirements = new Map()
	const problems = []

	for (const entry of input.installed) {
		if (entry.packageName === input.packageName) {
			continue
		}

		const parsed = readDependencies(entry.packageName, entry.pluginDependencies)

		if (parsed.error) {
			problems.push(parsed.error)
			continue
		}

		for (const dependency of parsed.dependencies) {
			addRequirement(requirements, decided, problems, dependency, entry.packageName)
		}
	}

	return { requirements, problems }
}

// one pass is enough for the real one-level plugin dependencies. If a
// requirement discovered late conflicts with a version already chosen, that is
// reported as a problem rather than re-chosen.
async function resolvePackages(context) {
	const { packageName, version, requirements, decided, installed, known, readOnly, getConfig, getMetadata, problems } =
		context
	const selected = new Map()
	const visited = new Set([packageName])
	const queue = [{ packageName, version, requested: true }]

	while (queue.length) {
		const current = queue.shift()
		const resolved = await resolvePackage(current.packageName, {
			requested: current.requested,
			version: current.version,
			requirements: requirements.get(current.packageName) ?? [],
			installed,
			known,
			readOnly,
			getConfig,
			getMetadata
		})

		if (resolved.problem) {
			problems.push(resolved.problem)
			break
		}

		decided.set(current.packageName, resolved.version)

		if (resolved.selected) {
			selected.set(current.packageName, resolved.version)
		}

		for (const dependency of resolved.dependencies) {
			addRequirement(requirements, decided, problems, dependency, current.packageName)

			if (!visited.has(dependency.packageName)) {
				visited.add(dependency.packageName)
				queue.push({ packageName: dependency.packageName })
			}
		}
	}

	return selected
}

async function planInstall(input, { getConfig, getMetadata }) {
	const installed = getInstalledMap(input.installed)
	const known = new Set(input.knownPackages)
	const readOnly = new Set(input.readOnlyPackages)
	const decided = new Map([[input.packageName, input.version]])
	const problems = getTargetProblems(input, installed, known, readOnly)

	if (problems.length) {
		return createResult(input, { problems })
	}

	const initial = getInitialRequirements(input, decided)
	const requirements = initial.requirements
	problems.push(...initial.problems)

	const targetRequirements = requirements.get(input.packageName) ?? []

	if (!satisfies(input.version, targetRequirements)) {
		problems.push(
			`${input.packageName} ${input.version} does not satisfy requirements from ${getSources(targetRequirements).join(', ')}.`
		)
	}

	if (problems.length) {
		return createResult(input, { problems })
	}

	const selected = await resolvePackages({
		packageName: input.packageName,
		version: input.version,
		requirements,
		decided,
		installed,
		known,
		readOnly,
		getConfig,
		getMetadata,
		problems
	})

	if (problems.length) {
		return createResult(input, { problems })
	}

	const changes = []

	for (const packageName of [input.packageName, ...selected.keys()].sort()) {
		const version = packageName === input.packageName ? input.version : selected.get(packageName)
		const installedVersion = installed.get(packageName)?.installedVersion

		if (packageName === input.packageName && installedVersion === version) {
			continue
		}

		changes.push({
			action: getChangeAction(installedVersion, version),
			packageName,
			version,
			installedVersion,
			reason: packageName === input.packageName ? 'requested' : 'dependency',
			requiredBy: packageName === input.packageName ? [] : getSources(requirements.get(packageName) ?? [])
		})
	}

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
	const installed = getInstalledMap(input.installed)
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

	for (const entry of input.installed) {
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

	const known = new Set(input.knownPackages)
	const readOnly = new Set(input.readOnlyPackages)
	const protectedPackages = new Set(input.protectedPackages)
	const changes = []

	for (const packageName of removal) {
		const isRequested = packageName === input.packageName
		const requiredBy = isRequested ? [] : getRemovedDependencies(dependenciesByPackage.get(packageName) ?? [], removal)

		if (!known.has(packageName)) {
			problems.push(`${packageName} is not a known plugin, so it cannot be uninstalled.`)
		}

		if (protectedPackages.has(packageName)) {
			problems.push(`${packageName} is protected and cannot be uninstalled.`)
		}

		if (readOnly.has(packageName)) {
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
 * @param {Array<{packageName: string, installedVersion?: string, pluginDependencies?: unknown}>} input.installed
 * @param {string[]} input.knownPackages
 * @param {string[]} input.readOnlyPackages
 * @param {string[]} input.protectedPackages
 * @param {{ getConfig: Function, getMetadata: Function }} registry
 * @returns {Promise<object>}
 */
async function planPluginChanges(input, registry) {
	return input.operation === 'uninstall' ? planUninstall(input) : planInstall(input, registry)
}

export { planPluginChanges }
