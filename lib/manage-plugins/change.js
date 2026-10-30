import { buildPrototype } from '../build.js'
import supervisor from '../dev/supervisor.js'
import plugins from '../plugins.js'
import { getPluginDependencyNames, isInstalled } from './list.js'
import { runNpm } from './npm.js'
import { planInstall, planUninstall } from './plan.js'

let changeRunning = false

// Only one change can run at a time. The lock also covers the rebuild and
// restart, so the user gets the result page once the prototype is running the
// new plugins.
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
// cache, rebuild and then restart the prototype with the new plugins.
async function restartWithRebuild() {
	plugins.clearCache()
	buildPrototype()

	await supervisor.restartPrototypeServer()
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

		// npm has installed the plugin, so its config can now be read for the
		// plugins it needs.
		const dependencyNames = getPluginDependencyNames(packageName)
		const missingDependencies = dependencyNames.filter((name) => !isInstalled(name))

		if (missingDependencies.length) {
			const dependenciesInstalled = await runNpm(['install', ...missingDependencies, '--save-exact'])

			if (!dependenciesInstalled) {
				return { ok: false, error: 'The plugin dependencies could not be installed.' }
			}
		}

		await restartWithRebuild()

		return {
			ok: true,
			packages: [packageName, ...missingDependencies]
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

		await restartWithRebuild()

		return {
			ok: true,
			packages: packageNames
		}
	})
}

export { installPlugin, uninstallPlugin }
