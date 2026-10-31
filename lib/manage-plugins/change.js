import { buildPrototype } from '../build.js'
import supervisor from '../dev/supervisor.js'
import plugins from '../plugins.js'
import { getPluginDependencyNames, isInstalled } from './list.js'
import { runNpm } from './npm.js'
import { planInstall, planUninstall, planUpdate } from './plan.js'
import { clearRegistryCache } from './registry.js'

let changeRunning = false

// Only one change can run at a time. The lock also covers the rebuild and
// restart, so the user gets the result page once the prototype is running the
// new plugins. The dev watcher reads this so it does not rebuild and restart
// on top of a change made from the plugins page.
function isChangeRunning() {
	return changeRunning
}

async function runChange(change) {
	if (changeRunning) {
		return { busy: true }
	}

	changeRunning = true

	try {
		return await change()
	} finally {
		changeRunning = false
	}
}

// A plugin change leaves the plugin cache and the build stale, so clear the
// cache, rebuild and then restart the prototype with the new plugins. The dev
// watcher does the same when the lockfile changes outside the plugins page.
async function rebuildAndRestart() {
	plugins.clearCache()
	buildPrototype()

	await supervisor.restartPrototypeServer()
}

// Install any plugin dependencies the plugin declares that the project does
// not have yet. The plugin must be installed before this runs, because the
// dependencies come from the plugin's config in node_modules.
async function installMissingDependencies(packageName) {
	const dependencyNames = getPluginDependencyNames(packageName)
	const missingDependencies = dependencyNames.filter((name) => !isInstalled(name))

	if (missingDependencies.length) {
		const dependenciesInstalled = await runNpm(['install', ...missingDependencies, '--save-exact'])

		if (!dependenciesInstalled) {
			return { ok: false, error: 'The plugin dependencies could not be installed.' }
		}
	}

	return { ok: true, missingDependencies }
}

// Install the plugin, then install any plugin dependencies it declares and the
// project does not have yet.
async function installPlugin(packageName) {
	return runChange(async () => {
		const plan = planInstall(packageName)

		if (plan.error) {
			return { error: plan.error }
		}

		if (plan.noChange) {
			return { noChange: plan.noChange }
		}

		const installed = await runNpm(['install', packageName, '--save-exact'])

		if (!installed) {
			return { ok: false, error: 'The plugin could not be installed.' }
		}

		const dependenciesResult = await installMissingDependencies(packageName)

		if (!dependenciesResult.ok) {
			return { ok: false, error: dependenciesResult.error }
		}

		await rebuildAndRestart()

		return {
			ok: true,
			packages: [packageName, ...dependenciesResult.missingDependencies]
		}
	})
}

// Uninstall the plugin and the installed plugins that depend on it.
async function uninstallPlugin(packageName) {
	return runChange(async () => {
		const plan = planUninstall(packageName)

		if (plan.error) {
			return { error: plan.error }
		}

		if (plan.noChange) {
			return { noChange: plan.noChange }
		}

		const packageNames = plan.packages.map((plugin) => plugin.packageName)
		const uninstalled = await runNpm(['uninstall', ...packageNames])

		if (!uninstalled) {
			return { ok: false, error: 'The plugins could not be uninstalled.' }
		}

		await rebuildAndRestart()

		return {
			ok: true,
			packages: packageNames
		}
	})
}

// Update the plugin to the latest registry version, then install any plugin
// dependencies the new version declares and the project does not have yet.
async function updatePlugin(packageName) {
	return runChange(async () => {
		const plan = await planUpdate(packageName)

		if (plan.error) {
			return { error: plan.error }
		}

		if (plan.noChange) {
			return { noChange: plan.noChange }
		}

		const updated = await runNpm(['install', `${packageName}@${plan.version}`, '--save-exact'])

		if (!updated) {
			return { ok: false, error: 'The plugin could not be updated.' }
		}

		const dependenciesResult = await installMissingDependencies(packageName)

		if (!dependenciesResult.ok) {
			return { ok: false, error: dependenciesResult.error }
		}

		clearRegistryCache()
		await rebuildAndRestart()

		return {
			ok: true,
			updatedPackage: packageName,
			installedPackages: dependenciesResult.missingDependencies
		}
	})
}

export { installPlugin, isChangeRunning, rebuildAndRestart, uninstallPlugin, updatePlugin }
