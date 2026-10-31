import knownPluginsFile from '../../known-plugins.json' with { type: 'json' }

import {
	formatPackageName,
	hasPluginConfig,
	readPackageJson,
	readPluginConfig,
	readProjectDependencies,
	readProxyConfigs
} from '../plugins.js'
import { fetchLatestVersion, hasNewVersion, isRegistryDependency } from './registry.js'

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

// Only registry plugins can be updated. protato runs the update, so it can
// never update itself.
function isUpdatablePlugin(packageName, dependencyVersion) {
	return packageName !== 'protato' && isRegistryDependency(dependencyVersion)
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

		const config = readPluginConfig(packageName, proxyConfigs)

		plugins.push({
			...formatPackageName(packageName),
			installed: Boolean(pkg),
			version: pkg?.version,
			description: config?.meta?.description ?? pkg?.description,
			protectedPackage: knownPlugins.required.includes(packageName)
		})
	}

	plugins.sort((a, b) => a.packageName.localeCompare(b.packageName))

	return plugins
}

// Adds the latest registry version to installed plugins, so the page can offer
// an update when one is available. Uninstalled plugins and dependencies that
// do not come from the registry are never checked.
async function checkForUpdates(plugins) {
	const dependencies = readProjectDependencies()

	return Promise.all(
		plugins.map(async (plugin) => {
			const dependencyVersion = dependencies[plugin.packageName]
			const shouldCheckForUpdate = plugin.installed && isUpdatablePlugin(plugin.packageName, dependencyVersion)

			if (shouldCheckForUpdate) {
				const latestVersion = await fetchLatestVersion(plugin.packageName)

				if (hasNewVersion(plugin.version, latestVersion)) {
					return { ...plugin, latestVersion, updateAvailable: true }
				}
			}

			return { ...plugin, updateAvailable: false }
		})
	)
}

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

export { checkForUpdates, getPackagesToUninstall, getPluginDependencyNames, listAvailablePlugins, listInstalledPlugins }
