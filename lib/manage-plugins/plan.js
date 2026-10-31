import knownPluginsFile from '../../known-plugins.json' with { type: 'json' }
import { readProjectDependencies } from '../plugins.js'
import { getPackagesToUninstall, listInstalledPlugins } from './list.js'
import { isValidPackageName } from './npm.js'
import * as registry from './registry.js'

const knownPlugins = knownPluginsFile.plugins

// The checks a change has to pass before it runs: a valid package name, not a
// protected package, not already in the requested state, and the plugins that
// depend on it for an uninstall. They run here, in the code that performs the
// change, so a request cannot bypass them by skipping the UI.

function findInstalledPlugin(packageName) {
	return listInstalledPlugins().find((plugin) => {
		return plugin.packageName === packageName && plugin.installed
	})
}

function planInstall(packageName) {
	if (!isValidPackageName(packageName)) {
		return { outcome: 'failed', message: 'Choose a valid npm package name.' }
	}

	if (findInstalledPlugin(packageName)) {
		return { outcome: 'noChange', message: `${packageName} is already installed.` }
	}

	return { outcome: 'ok', packageName }
}

function planUninstall(packageName) {
	if (!isValidPackageName(packageName)) {
		return { outcome: 'failed', message: 'Choose a valid npm package name.' }
	}

	if (knownPlugins.required.includes(packageName)) {
		return { outcome: 'failed', message: `${packageName} cannot be uninstalled.` }
	}

	const installedPlugin = findInstalledPlugin(packageName)

	if (!installedPlugin) {
		return { outcome: 'noChange', message: `${packageName} is not installed.` }
	}

	const packagesToUninstall = getPackagesToUninstall(packageName)

	return { outcome: 'ok', packageNames: packagesToUninstall.map((plugin) => plugin.packageName) }
}

async function planUpdate(packageName) {
	if (!isValidPackageName(packageName)) {
		return { outcome: 'failed', message: 'Choose a valid npm package name.' }
	}

	const dependencies = readProjectDependencies()
	const dependencyVersion = dependencies[packageName]
	const installedPlugin = findInstalledPlugin(packageName)

	if (!installedPlugin) {
		return { outcome: 'noChange', message: `${packageName} is not installed.` }
	}

	// The same rule the plugins page uses to decide whether to offer an update,
	// so the page cannot offer something this refuses, or the other way round.
	if (!registry.isUpdatablePlugin(packageName, dependencyVersion)) {
		return { outcome: 'failed', message: `${packageName} cannot be updated.` }
	}

	const pluginData = await registry.fetchPluginData(packageName)
	const latestVersion = pluginData?.latestVersion

	if (!latestVersion) {
		return { outcome: 'failed', message: 'The plugin could not be updated.' }
	}

	if (!registry.hasNewVersion(installedPlugin.version, latestVersion)) {
		return { outcome: 'noChange', message: `${packageName} is already up to date.` }
	}

	return { outcome: 'ok', packageName, version: latestVersion }
}

export { planInstall, planUninstall, planUpdate }
