import fs from 'node:fs'
import path from 'node:path'

import knownPluginsFile from '../../known-plugins.json' with { type: 'json' }

import { getPaths } from '../paths.js'
import { CONFIG_FILE, formatPackageName, readProxyConfigs } from '../plugins.js'
import { isObject, readJsonObject } from '../utils/json.js'

// The known plugins catalogue uses the same shape as the GOV.UK Prototype Kit:
// available packages the UI can suggest, and required packages that cannot be
// removed. protato runs the project, and the prototype's sass and layouts need
// govuk-frontend, so removing either would break the prototype.
const knownPlugins = knownPluginsFile.plugins

function getPackageJsonPath(packageName) {
	return path.join(getPaths().project, 'node_modules', packageName, 'package.json')
}

function getConfigPath(packageName) {
	return path.join(getPaths().project, 'node_modules', packageName, CONFIG_FILE)
}

// Installed means npm has put the package in node_modules. A package can be in
// package.json but not installed yet.
function isInstalled(packageName) {
	return fs.existsSync(getPackageJsonPath(packageName))
}

function readInstalledPackage(packageName) {
	if (!isInstalled(packageName)) {
		return
	}

	return readJsonObject(getPackageJsonPath(packageName))
}

function readProjectDependencies() {
	const projectPackagePath = path.join(getPaths().project, 'package.json')
	const projectPackage = readJsonObject(projectPackagePath)

	if (!isObject(projectPackage.dependencies)) {
		return {}
	}

	return projectPackage.dependencies
}

// A plugin config comes from the package itself, or from a proxy config for a
// package that does not ship one (such as jquery).
function readPluginConfig(packageName) {
	const configPath = getConfigPath(packageName)

	if (fs.existsSync(configPath)) {
		return readJsonObject(configPath)
	}

	const proxyConfigs = readProxyConfigs()
	return proxyConfigs[packageName]
}

// The plugin config is the authoritative source for the description shown in
// the UI. Fall back to package.json for plugins that do not set one.
function getPluginDescription(packageName, pkg) {
	let config

	try {
		config = readPluginConfig(packageName)
	} catch {
		config = undefined
	}

	return config?.meta?.description ?? pkg?.description
}

// pluginDependencies can be a string, an object, or a list of either.
function getPluginDependencyNames(packageName) {
	let config

	try {
		config = readPluginConfig(packageName)
	} catch (error) {
		console.warn(`Could not read the plugin config for ${packageName}: ${error.message}`)
		return []
	}

	if (!config?.pluginDependencies) {
		return []
	}

	let entries = [config.pluginDependencies]

	if (Array.isArray(config.pluginDependencies)) {
		entries = config.pluginDependencies
	}

	const packageNames = []

	for (const entry of entries) {
		const entryPackageName = typeof entry === 'string' ? entry : entry?.packageName

		if (entryPackageName) {
			packageNames.push(entryPackageName)
		}
	}

	return packageNames
}

// The plugins listed on the page: dependencies that have a plugin config or a
// proxy config. A known plugin that npm has not installed yet is still listed,
// as not installed, so the user can install it.
function listInstalledPlugins() {
	const dependencies = readProjectDependencies()
	const proxyConfigs = readProxyConfigs()
	const plugins = []

	for (const packageName of Object.keys(dependencies)) {
		const pkg = readInstalledPackage(packageName)
		const hasPluginConfig = fs.existsSync(getConfigPath(packageName))
		const hasProxyConfig = proxyConfigs[packageName] !== undefined
		const isKnownAndMissing = !pkg && knownPlugins.available.includes(packageName)

		if (!hasPluginConfig && !hasProxyConfig && !isKnownAndMissing) {
			continue
		}

		plugins.push({
			...formatPackageName(packageName),
			installed: Boolean(pkg),
			version: pkg?.version,
			description: getPluginDescription(packageName, pkg),
			protectedPackage: knownPlugins.required.includes(packageName)
		})
	}

	plugins.sort((a, b) => a.packageName.localeCompare(b.packageName))

	return plugins
}

// Known plugins that are not in the project at all.
function listAvailablePlugins(installedPlugins) {
	const installedNames = installedPlugins.map((plugin) => plugin.packageName)

	return knownPlugins.available
		.filter((packageName) => !installedNames.includes(packageName))
		.map((packageName) => ({
			...formatPackageName(packageName),
			installed: false
		}))
}

// Removing a plugin also removes the installed plugins that depend on it.
function getPackagesToUninstall(packageName) {
	const installedPlugins = listInstalledPlugins().filter((plugin) => plugin.installed)
	const packages = []

	const requestedPlugin = installedPlugins.find((plugin) => plugin.packageName === packageName)

	if (requestedPlugin) {
		packages.push({ ...requestedPlugin, requested: true })
	}

	for (const plugin of installedPlugins) {
		if (plugin.packageName === packageName) {
			continue
		}

		const dependencyNames = getPluginDependencyNames(plugin.packageName)

		if (dependencyNames.includes(packageName)) {
			packages.push({ ...plugin, requested: false })
		}
	}

	return packages
}

export { getPackagesToUninstall, getPluginDependencyNames, isInstalled, listAvailablePlugins, listInstalledPlugins }
