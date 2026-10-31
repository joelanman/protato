import knownPluginsFile from '../../known-plugins.json' with { type: 'json' }
import { readProjectDependencies } from '../plugins.js'
import { getPackagesToUninstall, listInstalledPlugins } from './list.js'
import { isValidPackageName } from './npm.js'
import { fetchLatestVersion, hasNewVersion, isRegistryDependency } from './registry.js'

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
		return { error: 'Choose a valid npm package name.' }
	}

	if (findInstalledPlugin(packageName)) {
		return { noChange: `${packageName} is already installed.` }
	}

	return { packageName }
}

function planUninstall(packageName) {
	if (!isValidPackageName(packageName)) {
		return { error: 'Choose a valid npm package name.' }
	}

	if (knownPlugins.required.includes(packageName)) {
		return { error: `${packageName} cannot be uninstalled.` }
	}

	const installedPlugin = findInstalledPlugin(packageName)

	if (!installedPlugin) {
		return { noChange: `${packageName} is not installed.` }
	}

	return { packages: getPackagesToUninstall(packageName) }
}

async function planUpdate(packageName) {
	if (!isValidPackageName(packageName)) {
		return { error: 'Choose a valid npm package name.' }
	}

	if (packageName === 'protato') {
		return { error: 'protato cannot be updated.' }
	}

	const dependencies = readProjectDependencies()
	const dependencyVersion = dependencies[packageName]
	const installedPlugin = findInstalledPlugin(packageName)

	if (!installedPlugin) {
		return { noChange: `${packageName} is not installed.` }
	}

	if (!isRegistryDependency(dependencyVersion)) {
		return { error: `${packageName} cannot be updated.` }
	}

	const latestVersion = await fetchLatestVersion(packageName)

	if (!latestVersion) {
		return { error: 'The plugin could not be updated.' }
	}

	if (!hasNewVersion(installedPlugin.version, latestVersion)) {
		return { noChange: `${packageName} is already up to date.` }
	}

	return { packageName, version: latestVersion }
}

export { planInstall, planUninstall, planUpdate }
