import semver from 'semver'

import {
	isExactVersion,
	isStableVersion,
	isValidPackageName,
	normalisePluginDependencies,
	PluginRegistryError
} from './plugin-registry.js'

// a dependency version may be chosen, then a later constraint narrows the
// choice. Resolution runs again with the new constraints. Repeated selections
// mean versions are oscillating rather than narrowing; the pass limit is only
// a safety valve for pathological input, not a dependency-depth limit.
const MAX_PASSES = 100

function createError(code, message, details = {}) {
	return { type: 'error', code, message, ...details }
}

function createPackageError(code, packageName, message, details = {}) {
	return createError(code, `Plugin ${packageName}: ${message}`, { packageName, ...details })
}

function createMissing(data, packageName, version) {
	return { type: 'missing', data, packageName, ...(version === undefined ? {} : { version }) }
}

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

function getConfigKey(packageName, version) {
	return `${packageName}@${version}`
}

function comparePackageNames(left, right) {
	if (left.packageName < right.packageName) {
		return -1
	}

	return left.packageName > right.packageName ? 1 : 0
}

function getInstalledMap(installed) {
	return new Map(installed.map((entry) => [entry.packageName, entry]))
}

// pluginDependencies may be missing, a single string, or a list of strings and
// objects. Normalise once so the rest of the planner has one shape.
function readDependencies(packageName, pluginDependencies) {
	try {
		return { dependencies: normalisePluginDependencies(pluginDependencies) }
	} catch (error) {
		if (error instanceof PluginRegistryError) {
			return { error: createPackageError(error.code, packageName, error.message) }
		}

		throw error
	}
}

function satisfiesAll(version, requirements) {
	return requirements.every(({ dependency }) => {
		if (dependency.minVersion && semver.lt(version, dependency.minVersion)) {
			return false
		}

		return !dependency.maxVersion || semver.lte(version, dependency.maxVersion)
	})
}

function getSources(requirements) {
	return [...new Set(requirements.map(({ source }) => source))]
}

function getRequirementsFor(requirements, packageName) {
	return requirements.filter(({ dependency }) => dependency.packageName === packageName)
}

function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getSelectionKey(selected) {
	const keys = []

	for (const [packageName, version] of selected) {
		keys.push(getConfigKey(packageName, version))
	}

	keys.sort()

	return keys.join('\n')
}

function highestSatisfyingVersion(metadata, requirements) {
	const versions = Array.isArray(metadata?.stableVersions) ? metadata.stableVersions : [metadata?.latestVersion]
	const matching = []

	for (const version of versions) {
		if (!isStableVersion(version)) {
			continue
		}

		if (satisfiesAll(version, requirements)) {
			matching.push(version)
		}
	}

	matching.sort(semver.compare)

	return matching.at(-1)
}

function validateInput(input) {
	if (typeof input !== 'object' || input === null) {
		return [createError('INVALID_REQUEST', 'A plugin plan needs an input object')]
	}

	const messages = []

	if (!['install', 'update', 'uninstall'].includes(input.operation)) {
		messages.push(`Unknown plugin operation: ${input.operation}`)
	}

	if (!isValidPackageName(input.packageName)) {
		messages.push(`Invalid package name: ${input.packageName}`)
	}

	// uninstall ignores any version, so it is not validated
	if (input.operation !== 'uninstall' && !isStableVersion(input.version)) {
		messages.push(`Plugin version must be an exact stable version: ${input.version}`)
	}

	for (const key of ['installed', 'knownPackages', 'readOnlyPackages', 'protectedPackages']) {
		if (!Array.isArray(input[key])) {
			messages.push(`${key} must be an array`)
		}
	}

	if (Array.isArray(input.installed) && !input.installed.every(isObject)) {
		messages.push('installed entries must be objects')
	}

	if (input.operation !== 'uninstall') {
		if (!isObject(input.registry)) {
			messages.push('registry must be an object')
		} else {
			for (const key of ['packages', 'configs']) {
				if (input.registry[key] !== undefined && !isObject(input.registry[key])) {
					messages.push(`registry.${key} must be an object`)
				}
			}
		}
	}

	return messages.map((message) => createError('INVALID_REQUEST', message))
}

// walk the target dependency graph from the requested package, then include
// constraints from other installed plugins when they apply to packages in that
// graph
function collectRequirements(input, installed, selected) {
	const problems = []
	const installedDependencies = new Map()

	for (const entry of input.installed) {
		if (selected.has(entry.packageName)) {
			continue
		}

		if (entry.dependenciesKnown === false) {
			problems.push(
				createPackageError(
					'UNKNOWN_DEPENDENCIES',
					entry.packageName,
					'cannot plan because its pluginDependencies could not be read'
				)
			)
			continue
		}

		const { dependencies, error } = readDependencies(entry.packageName, entry.pluginDependencies)

		if (error) {
			problems.push(error)
			continue
		}

		installedDependencies.set(entry.packageName, dependencies)
	}

	const visited = new Set([input.packageName])
	const queue = [input.packageName]
	const targetRequirements = []

	for (const packageName of queue) {
		let dependencies

		if (selected.has(packageName)) {
			const version = selected.get(packageName)
			const config = input.registry.configs?.[getConfigKey(packageName, version)]

			if (!config) {
				problems.push(createMissing('config', packageName, version))
				continue
			}

			const parsed = readDependencies(packageName, config.pluginDependencies)

			if (parsed.error) {
				problems.push(parsed.error)
				continue
			}

			dependencies = parsed.dependencies
		} else if (installed.has(packageName)) {
			dependencies = installedDependencies.get(packageName) ?? []
		} else {
			continue
		}

		for (const dependency of dependencies) {
			targetRequirements.push({ dependency, source: packageName })

			if (!visited.has(dependency.packageName)) {
				visited.add(dependency.packageName)
				queue.push(dependency.packageName)
			}
		}
	}

	const requirements = []

	for (const [packageName, dependencies] of installedDependencies) {
		if (visited.has(packageName)) {
			continue
		}

		for (const dependency of dependencies) {
			if (visited.has(dependency.packageName)) {
				requirements.push({ dependency, source: packageName })
			}
		}
	}

	requirements.push(...targetRequirements)

	return { requirements, problems }
}

// choose a version for a dependency that is not installed at a suitable
// version, or report why it cannot be chosen
function chooseDependencyVersion(packageName, requirements, { input, installed, known, readOnly }) {
	const installedVersion = installed.get(packageName)?.installedVersion
	const requiredBy = getSources(requirements)

	if (installed.has(packageName)) {
		if (!isExactVersion(installedVersion)) {
			return {
				problem: createPackageError(
					'INVALID_INSTALLED_VERSION',
					packageName,
					`installed version is not an exact version: ${installedVersion}`,
					{ version: installedVersion }
				)
			}
		}

		if (satisfiesAll(installedVersion, requirements)) {
			return { keep: true }
		}
	}

	if (!known.has(packageName)) {
		return {
			problem: createPackageError(
				'UNKNOWN_PACKAGE',
				packageName,
				`required by ${requiredBy.join(', ')} but it is not a known plugin`,
				{ requiredBy }
			)
		}
	}

	if (readOnly.has(packageName)) {
		return {
			problem: createPackageError(
				'READ_ONLY_PACKAGE',
				packageName,
				`required by ${requiredBy.join(', ')} but it is read-only`,
				{ requiredBy }
			)
		}
	}

	const metadata = input.registry.packages?.[packageName]

	if (!metadata) {
		return { problem: createMissing('metadata', packageName) }
	}

	const version = highestSatisfyingVersion(metadata, requirements)

	if (!version) {
		return {
			problem: createPackageError(
				'CONFLICT',
				packageName,
				`no stable version satisfies requirements from ${requiredBy.join(', ')}`,
				{ requiredBy }
			)
		}
	}

	return { version }
}

function resolveSelection({ input, installed, known, readOnly, selected, requirements }) {
	const problems = []
	const nextSelected = new Map([[input.packageName, input.version]])
	const packageNames = [...new Set(requirements.map(({ dependency }) => dependency.packageName))].sort()

	const resolve = (packageName) => {
		const packageRequirements = getRequirementsFor(requirements, packageName)

		if (packageName === input.packageName) {
			if (!satisfiesAll(input.version, packageRequirements)) {
				const requiredBy = getSources(packageRequirements)

				problems.push(
					createPackageError(
						'CONFLICT',
						packageName,
						`version ${input.version} does not satisfy requirements from ${requiredBy.join(', ')}`,
						{ version: input.version, requiredBy }
					)
				)
			}

			return
		}

		const chosen = chooseDependencyVersion(packageName, packageRequirements, {
			input,
			installed,
			known,
			readOnly
		})

		if (chosen.problem) {
			problems.push(chosen.problem)
		} else if (chosen.version) {
			nextSelected.set(packageName, chosen.version)
		}
	}

	// Resolve packages already in the plan first. If one changes version its
	// old config is stale, so re-walk from the new selection before resolving
	// newly discovered dependencies.
	for (const packageName of packageNames) {
		if (selected.has(packageName)) {
			resolve(packageName)
		}
	}

	if (problems.length === 0 && getSelectionKey(selected) !== getSelectionKey(nextSelected)) {
		return { problems, nextSelected }
	}

	for (const packageName of packageNames) {
		if (!selected.has(packageName)) {
			resolve(packageName)
		}
	}

	return { problems, nextSelected }
}

function getChangeAction(installedVersion, version) {
	if (!installedVersion) {
		return 'install'
	}

	return semver.lt(version, installedVersion) ? 'downgrade' : 'update'
}

function getInstallChanges(input, installed, selected, requirements) {
	const changes = []

	for (const [packageName, version] of selected) {
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
			requiredBy: getSources(getRequirementsFor(requirements, packageName))
		})
	}

	changes.sort(comparePackageNames)

	return changes
}

function getTargetProblems(input, installed, known, readOnly) {
	const installedVersion = installed.get(input.packageName)?.installedVersion

	if (installed.has(input.packageName) && !isExactVersion(installedVersion)) {
		return [
			createPackageError(
				'INVALID_INSTALLED_VERSION',
				input.packageName,
				`installed version is not an exact version: ${installedVersion}`,
				{ version: installedVersion }
			)
		]
	}

	if (installedVersion === input.version) {
		return []
	}

	if (!known.has(input.packageName)) {
		return [createPackageError('UNKNOWN_PACKAGE', input.packageName, 'not a known plugin')]
	}

	if (readOnly.has(input.packageName)) {
		return [createPackageError('READ_ONLY_PACKAGE', input.packageName, 'read-only')]
	}

	return []
}

function planInstall(input) {
	const installed = getInstalledMap(input.installed)
	const known = new Set(input.knownPackages)
	const readOnly = new Set(input.readOnlyPackages)
	const targetProblems = getTargetProblems(input, installed, known, readOnly)

	if (targetProblems.length) {
		return createResult(input, { problems: targetProblems })
	}

	let selected = new Map([[input.packageName, input.version]])
	const seen = new Set()

	for (let pass = 0; pass < MAX_PASSES; pass++) {
		const selectionKey = getSelectionKey(selected)

		if (seen.has(selectionKey)) {
			break
		}

		seen.add(selectionKey)

		const collected = collectRequirements(input, installed, selected)

		if (collected.problems.length) {
			return createResult(input, { problems: collected.problems })
		}

		const resolved = resolveSelection({
			input,
			installed,
			known,
			readOnly,
			selected,
			requirements: collected.requirements
		})

		if (resolved.problems.length) {
			return createResult(input, { problems: resolved.problems })
		}

		if (getSelectionKey(resolved.nextSelected) === selectionKey) {
			const changes = getInstallChanges(input, installed, selected, collected.requirements)
			return createResult(input, { changes, noop: changes.length === 0 })
		}

		selected = resolved.nextSelected
	}

	return createResult(input, {
		problems: [createPackageError('UNSTABLE_PLAN', input.packageName, 'dependency versions did not settle')]
	})
}

function getRemovedDependencies(dependencies, removal) {
	const requiredBy = []

	for (const candidate of dependencies) {
		if (removal.has(candidate.packageName) && !requiredBy.includes(candidate.packageName)) {
			requiredBy.push(candidate.packageName)
		}
	}

	return requiredBy
}

function planUninstall(input) {
	const installed = getInstalledMap(input.installed)
	const target = installed.get(input.packageName)

	if (!target) {
		return createResult(input, { noop: true })
	}

	if (!isExactVersion(target.installedVersion)) {
		return createResult(input, {
			problems: [
				createPackageError(
					'INVALID_INSTALLED_VERSION',
					input.packageName,
					`installed version is not an exact version: ${target.installedVersion}`,
					{ version: target.installedVersion }
				)
			]
		})
	}

	const dependenciesByPackage = new Map()
	const unknownDependencies = new Set()

	for (const entry of input.installed) {
		const { dependencies, error } = readDependencies(entry.packageName, entry.pluginDependencies)

		if (entry.dependenciesKnown === false || error) {
			dependenciesByPackage.set(entry.packageName, [])
			unknownDependencies.add(entry.packageName)
			continue
		}

		dependenciesByPackage.set(entry.packageName, dependencies)
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

			if (dependencies.some((candidate) => removal.has(candidate.packageName))) {
				removal.add(packageName)
				added = true
			}
		}
	}

	const problems = []
	const changes = []

	// a plugin whose dependencies are unknown might be a dependent, so block
	// unless it is already being removed anyway
	for (const packageName of unknownDependencies) {
		if (!removal.has(packageName)) {
			problems.push(
				createPackageError(
					'UNKNOWN_DEPENDENCIES',
					packageName,
					'cannot plan because its pluginDependencies could not be read'
				)
			)
		}
	}

	for (const packageName of removal) {
		const isRequested = packageName === input.packageName
		const requiredBy = isRequested ? [] : getRemovedDependencies(dependenciesByPackage.get(packageName) ?? [], removal)
		const problem = (code, message) => problems.push(createPackageError(code, packageName, message, { requiredBy }))

		if (!input.knownPackages.includes(packageName)) {
			problem('UNKNOWN_PACKAGE', 'uninstall would remove a package outside the known list')
		}

		if (input.protectedPackages.includes(packageName)) {
			problem('PROTECTED_PACKAGE', 'protected and cannot be uninstalled')
		}

		if (input.readOnlyPackages.includes(packageName)) {
			problem('READ_ONLY_PACKAGE', 'read-only and cannot be uninstalled')
		}

		changes.push({
			action: 'uninstall',
			packageName,
			installedVersion: installed.get(packageName)?.installedVersion,
			reason: isRequested ? 'requested' : 'dependent',
			requiredBy
		})
	}

	changes.sort(comparePackageNames)

	return createResult(input, { changes, problems })
}

/**
 * An installed plugin, as read by the management app.
 *
 * @typedef {object} InstalledPlugin
 * @property {string} packageName
 * @property {string} [installedVersion] Exact installed version
 * @property {unknown} [pluginDependencies] Raw pluginDependencies from the installed config
 * @property {boolean} [dependenciesKnown] False when the installed config could not be read
 */

/**
 * @typedef {object} RegistryPackage
 * @property {string[]} [stableVersions] Preferred; prereleases are ignored
 * @property {string} [latestVersion] Used when `stableVersions` is absent
 */

/**
 * @typedef {object} PlanInput
 * @property {'install' | 'update' | 'uninstall'} operation
 * @property {string} packageName
 * @property {string} [version] Exact requested version, ignored for uninstall
 * @property {InstalledPlugin[]} installed
 * @property {string[]} knownPackages Packages a plan may install or change
 * @property {string[]} readOnlyPackages Packages a plan must not change or remove
 * @property {string[]} protectedPackages Packages a plan must not remove
 * @property {object} [registry] Required for install and update
 * @property {Record<string, RegistryPackage>} [registry.packages] Metadata by package name
 * @property {Record<string, { pluginDependencies?: unknown }>} [registry.configs] Raw config by `package@version`
 */

/**
 * Plan an install, update or uninstall without side effects.
 *
 * The planner performs no filesystem or network reads, no npm commands and no
 * process control, and does not modify its input. Installed entries come from
 * the management app; registry metadata and exact-version configs come from
 * the plugin registry. The result has exact changes plus a `problems` list.
 * Error problems have `type: 'error'`; missing registry data has `type:
 * 'missing'` and `data: 'metadata' | 'config'`, so the caller can fetch it and
 * plan again.
 *
 * @param {PlanInput} input
 * @returns {object}
 */
function planPluginChanges(input) {
	const inputErrors = validateInput(input)

	if (inputErrors.length) {
		return createResult(input ?? {}, { problems: inputErrors })
	}

	return input.operation === 'uninstall' ? planUninstall(input) : planInstall(input)
}

export { planPluginChanges }
