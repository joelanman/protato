import fs from 'node:fs'
import path from 'node:path'

import semver from 'semver'

import { available, knownPackageNames, protectedPackages } from './known-plugins.js'
import { getPaths } from './paths.js'
import { planPluginChanges } from './plugin-plan.js'
import { readProxyConfigs } from './plugin-proxy.js'
import {
	createPluginRegistry,
	isExactVersion,
	isValidPackageName,
	normalisePluginDependencies
} from './plugin-registry.js'
import plugins from './plugins.js'
import { isObject } from './utils/plugin-config.js'

const defaultRegistry = createPluginRegistry()

function readJsonFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

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

// a declaration does not prove a package is installed, so read the installed
// metadata separately and keep any problems with it as diagnostics
function readInstalledPackage(projectDir, packageName, proxyConfigs) {
	const packageDir = path.join(projectDir, 'node_modules', packageName)
	const diagnostics = []

	if (!fs.existsSync(packageDir)) {
		return { diagnostics, usesProxy: Boolean(proxyConfigs[packageName]) }
	}

	let installedVersion

	try {
		const installedPackage = readJsonFile(path.join(packageDir, 'package.json'))

		if (!isObject(installedPackage)) {
			throw new Error('expected an object')
		}

		if (typeof installedPackage.version === 'string') {
			installedVersion = installedPackage.version
		}
	} catch (error) {
		diagnostics.push(`Could not read package.json for ${packageName}: ${error.message}`)
	}

	const { config, error: configError, usesProxy } = plugins.readPluginConfig(packageDir, packageName, proxyConfigs)

	if (configError) {
		diagnostics.push(configError)
	}

	return { installedVersion, config, configError, usesProxy, diagnostics }
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

function readPlugins() {
	const paths = getPaths()
	const diagnostics = []
	const dependencies = readProjectDependencies(paths, diagnostics)
	const proxyConfigs = readProxyConfigs()
	const installedByPackage = new Map()

	for (const packageName of Object.keys(dependencies).sort()) {
		installedByPackage.set(packageName, readInstalledPackage(paths.project, packageName, proxyConfigs))
	}

	// protected packages first, then the known list order, then installed
	// plugins that are not known (read only, shown so they can be diagnosed).
	// A config that exists but cannot be read still counts as a plugin.
	const packageNames = new Set([...protectedPackages, ...available])

	for (const [packageName, installed] of installedByPackage) {
		if (installed.config || installed.configError) {
			packageNames.add(packageName)
		}
	}

	const pagePlugins = []

	for (const packageName of packageNames) {
		const declaration = dependencies[packageName]
		const installed = installedByPackage.get(packageName) ?? {
			diagnostics: [],
			usesProxy: Boolean(proxyConfigs[packageName])
		}
		const pluginDiagnostics = [...installed.diagnostics]

		const installSource = getInstallSource(declaration)

		if (installSource === 'invalid') {
			pluginDiagnostics.push(`Invalid dependency declaration for ${packageName}: expected a non-empty string`)
		}

		// protato is the tool running the project, so it cannot update or uninstall
		// itself. Anything not installed from the registry is left alone rather
		// than being replaced by a registry version.
		pagePlugins.push({
			packageName,
			...plugins.formatPackageName(packageName),
			declaration,
			installedVersion: installed.installedVersion,
			installSource,
			known: knownPackageNames.has(packageName),
			protectedPackage: protectedPackages.includes(packageName),
			readOnly:
				!knownPackageNames.has(packageName) ||
				packageName === 'protato' ||
				(installSource !== undefined && installSource !== 'registry'),
			pluginDependencies: installed.config?.pluginDependencies,
			usesProxyConfig: Boolean(installed.usesProxy),
			latestVersion: undefined,
			updateAvailable: false,
			actions: { install: false, update: false, uninstall: false },
			diagnostics: pluginDiagnostics
		})
	}

	return { pagePlugins, protectedPackages, diagnostics }
}

// the plugins page shows what the registry has, but a registry problem must not
// stop the page from listing what is already installed
async function addUpdateState(pagePlugins, { registry = defaultRegistry } = {}) {
	await Promise.all(
		pagePlugins.map(async (plugin) => {
			if (plugin.known && !plugin.readOnly) {
				try {
					if (plugin.installedVersion && !isExactVersion(plugin.installedVersion)) {
						throw new Error(`installed version is not exact: ${plugin.installedVersion}`)
					}

					const metadata = await registry.getPackageMetadata(plugin.packageName)
					plugin.latestVersion = metadata.latestVersion
					plugin.updateAvailable =
						Boolean(plugin.installedVersion) && semver.gt(metadata.latestVersion, plugin.installedVersion)
				} catch (error) {
					plugin.diagnostics.push(`Could not check for updates for ${plugin.packageName}: ${error.message}`)
				}
			}

			plugin.actions = {
				install: plugin.known && !plugin.readOnly && !plugin.installedVersion && Boolean(plugin.latestVersion),
				update: plugin.known && !plugin.readOnly && Boolean(plugin.installedVersion) && plugin.updateAvailable,
				uninstall: Boolean(plugin.installedVersion) && plugin.known && !plugin.protectedPackage && !plugin.readOnly
			}
		})
	)
}

function formatPlanSummary(plan) {
	return plan.changes
		.map((change) => `${change.action}:${change.packageName}:${change.installedVersion ?? ''}:${change.version ?? ''}`)
		.join(',')
}

function buildNpmPlan(plan) {
	if (plan.operation === 'uninstall') {
		return {
			operation: 'uninstall',
			packages: plan.changes.map((change) => ({ packageName: change.packageName }))
		}
	}

	return {
		operation: 'install',
		packages: plan.changes.map((change) => ({
			packageName: change.packageName,
			version: change.version
		}))
	}
}

// a proxy config applies only when the package ships no config of its own
function createConfigLoader(pagePlugins, proxyConfigs, registry) {
	const pluginsByPackage = new Map(pagePlugins.map((plugin) => [plugin.packageName, plugin]))

	return async (packageName, version) => {
		const plugin = pluginsByPackage.get(packageName)
		const proxyConfig = plugin?.usesProxyConfig ? proxyConfigs[packageName] : undefined

		if (proxyConfig) {
			return { pluginDependencies: normalisePluginDependencies(proxyConfig.pluginDependencies) }
		}

		return registry.getConfig(packageName, version)
	}
}

async function buildActionPlan(action, packageName, state, { registry = defaultRegistry } = {}) {
	if (!['install', 'update', 'uninstall'].includes(action)) {
		return { error: 'Choose install, update or uninstall.', status: 400 }
	}

	if (!isValidPackageName(packageName)) {
		return { error: 'Choose a valid plugin package name.', status: 400 }
	}

	const plugin = state.pagePlugins.find((candidate) => candidate.packageName === packageName)

	if (!plugin?.known) {
		return { error: `${packageName} is not in Protato's known plugin list.`, status: 400 }
	}

	let version

	if (action === 'uninstall') {
		if (!plugin.installedVersion) {
			return { error: `${packageName} is not installed.`, status: 400 }
		}

		if (plugin.protectedPackage) {
			return { error: `${packageName} is protected, so it cannot be uninstalled.`, status: 400 }
		}

		if (plugin.readOnly) {
			return { error: `${packageName} is read-only, so it cannot be uninstalled.`, status: 400 }
		}
	} else {
		if (plugin.readOnly) {
			return { error: `${packageName} is read-only.`, status: 400 }
		}

		let metadata
		try {
			metadata = await registry.getPackageMetadata(packageName)
		} catch (error) {
			return { error: error.message, status: 503 }
		}

		version = metadata.latestVersion

		if (!isExactVersion(version)) {
			return { error: `The registry did not provide a stable version for ${packageName}.`, status: 400 }
		}

		if (action === 'install' && plugin.installedVersion) {
			return { error: `${packageName} is already installed.`, status: 400 }
		}

		if (action === 'update') {
			if (!plugin.installedVersion) {
				return { error: `${packageName} is not installed.`, status: 400 }
			}

			if (!isExactVersion(plugin.installedVersion) || !semver.gt(version, plugin.installedVersion)) {
				return { error: `There is no newer version of ${packageName}.`, status: 400 }
			}
		}
	}

	const installed = state.pagePlugins
		.filter((item) => item.installedVersion)
		.map((item) => ({
			packageName: item.packageName,
			installedVersion: item.installedVersion,
			pluginDependencies: item.pluginDependencies
		}))

	const input = {
		operation: action,
		packageName,
		version,
		installed,
		knownPackages: state.pagePlugins.filter((candidate) => candidate.known).map((candidate) => candidate.packageName),
		readOnlyPackages: state.pagePlugins
			.filter((candidate) => candidate.readOnly)
			.map((candidate) => candidate.packageName),
		protectedPackages: state.protectedPackages
	}

	let plan

	try {
		plan = await planPluginChanges(input, {
			getConfig: createConfigLoader(state.pagePlugins, readProxyConfigs(), registry),
			getMetadata: (name) => registry.getPackageMetadata(name)
		})
	} catch (error) {
		return { error: error.message, status: 503 }
	}

	const changes = plan.changes.map((change) => ({
		...change,
		...plugins.formatPackageName(change.packageName),
		requiredByNames: change.requiredBy.map((reqName) => ({
			packageName: reqName,
			...plugins.formatPackageName(reqName)
		}))
	}))

	return {
		plugin,
		version,
		plan,
		changes,
		problems: plan.problems,
		expectedChanges: formatPlanSummary(plan)
	}
}

export { addUpdateState, buildActionPlan, buildNpmPlan, readPlugins }
