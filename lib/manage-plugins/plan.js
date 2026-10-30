import knownPluginsFile from '../../known-plugins.json' with { type: 'json' }

import { getPackagesToUninstall, listInstalledPlugins } from './list.js'
import { isValidPackageName } from './npm.js'

const knownPlugins = knownPluginsFile.plugins

// The checks a change has to pass before it runs: a valid package name, not a
// protected package, not already in the requested state, and the plugins that
// depend on it for an uninstall. They run here, in the code that performs the
// change, so a request cannot bypass them by skipping the UI.

function planInstall(packageName) {
	if (!isValidPackageName(packageName)) {
		return { error: 'Choose a valid npm package name.' }
	}

	const alreadyInstalled = listInstalledPlugins().some((plugin) => {
		return plugin.packageName === packageName && plugin.installed
	})

	if (alreadyInstalled) {
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

	const installedPlugin = listInstalledPlugins().find((plugin) => {
		return plugin.packageName === packageName && plugin.installed
	})

	if (!installedPlugin) {
		return { noChange: `${packageName} is not installed.` }
	}

	return { packages: getPackagesToUninstall(packageName) }
}

export { planInstall, planUninstall }
