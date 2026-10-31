import knownPluginsFile from '../../known-plugins.json' with { type: 'json' }

import {
	formatPackageName,
	hasPluginConfig,
	readPackageJson,
	readPluginConfig,
	readProjectDependencies,
	readProxyConfigs
} from '../plugins.js'

// The known plugins catalogue uses the same shape as the GOV.UK Prototype Kit:
// available packages the UI can suggest, and required packages that cannot be
// removed. protato runs the project, and the prototype's sass and layouts need
// govuk-frontend, so removing either would break the prototype.
const knownPlugins = knownPluginsFile.plugins

// pluginDependencies can be a string, an object, or a list of either.
function getPluginDependencyNames(packageName, proxyConfigs = readProxyConfigs()) {
	const config = readPluginConfig(packageName, proxyConfigs)

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
		const pkg = readPackageJson(packageName)
		const hasProxyConfig = proxyConfigs[packageName] !== undefined
		const isKnownAndMissing = !pkg && knownPlugins.available.includes(packageName)

		// A plugin is listed when it ships a config, when a proxy config stands in
		// for one, or when it is a known plugin the user can install. A config file
		// that cannot be read still counts, so the plugin can be removed.
		const isListed = hasPluginConfig(packageName) || hasProxyConfig || isKnownAndMissing

		if (!isListed) {
			continue
		}

		// The description and homepage come from the installed package.json, and
		// from the registry when the plugin is not installed, so the row reads the
		// same before and after it is installed.
		plugins.push({
			...formatPackageName(packageName),
			installed: Boolean(pkg),
			version: pkg?.version,
			description: pkg?.description,
			homepage: pkg?.homepage,
			protectedPackage: knownPlugins.required.includes(packageName)
		})
	}

	plugins.sort((a, b) => a.packageName.localeCompare(b.packageName))

	return plugins
}

function listAvailablePlugins(installedPlugins) {
	const installedNames = installedPlugins.map((plugin) => plugin.packageName)
	const proxyConfigs = readProxyConfigs()

	return knownPlugins.available
		.filter((packageName) => !installedNames.includes(packageName))
		.map((packageName) => ({
			...formatPackageName(packageName),
			installed: false,
			description: proxyConfigs[packageName]?.meta?.description
		}))
}

// Every plugin the plugins page can show: the installed list, including known
// plugins that are not installed yet, plus the known plugins missing from it.
function listAllPlugins() {
	const installedPlugins = listInstalledPlugins()

	return [...installedPlugins, ...listAvailablePlugins(installedPlugins)]
}

// Removing a plugin also removes the installed plugins that depend on it.
function getPackagesToUninstall(packageName) {
	const proxyConfigs = readProxyConfigs()
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

		const dependencyNames = getPluginDependencyNames(plugin.packageName, proxyConfigs)

		if (dependencyNames.includes(packageName)) {
			packages.push({ ...plugin, requested: false })
		}
	}

	return packages
}

export { getPackagesToUninstall, getPluginDependencyNames, listAllPlugins, listAvailablePlugins, listInstalledPlugins }
