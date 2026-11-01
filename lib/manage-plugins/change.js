import { isInstalled } from '../plugins.js'
import { getPluginDependencyNames } from './list.js'
import { runNpm } from './npm.js'
import { planInstall, planUninstall, planUpdate } from './plan.js'

let changeRunning = false

function isChangeRunning() {
	return changeRunning
}

// Only one change can run at a time. The prototype process runs npm, and it
// refuses to force exit while a change is running, so a restart waits for npm
// to finish rather than killing it part way through.
async function runChange(change) {
	if (changeRunning) {
		return { outcome: 'busy' }
	}

	changeRunning = true

	try {
		return await change()
	} finally {
		changeRunning = false
	}
}

// npm output explains why a change failed, so keep it with the failure and
// show it on the result page.
function npmFailure(message, npmResult) {
	return { outcome: 'failed', message, npmOutput: npmResult.output }
}

// Install any plugin dependencies the plugin declares that the project does
// not have yet. The plugin must be installed before this runs, because the
// dependencies come from the plugin's config in node_modules.
async function installMissingDependencies(packageName) {
	const dependencyNames = getPluginDependencyNames(packageName)
	const missingDependencies = dependencyNames.filter((name) => !isInstalled(name))

	if (missingDependencies.length) {
		const dependenciesInstalled = await runNpm(['install', ...missingDependencies, '--save-exact'])

		if (!dependenciesInstalled.ok) {
			return npmFailure('The plugin dependencies could not be installed.', dependenciesInstalled)
		}
	}

	return { missingDependencies }
}

async function installPlugin(packageName) {
	return runChange(async () => {
		const plan = planInstall(packageName)

		if (plan.outcome !== 'ok') {
			return plan
		}

		const installed = await runNpm(['install', packageName, '--save-exact'])

		if (!installed.ok) {
			return npmFailure('The plugin could not be installed.', installed)
		}

		const dependenciesResult = await installMissingDependencies(packageName)

		if (dependenciesResult.outcome === 'failed') {
			return dependenciesResult
		}

		return {
			outcome: 'installed',
			installedPackages: [packageName, ...dependenciesResult.missingDependencies]
		}
	})
}

// Plugins that depend on it would otherwise be left installed with a missing
// dependency, so they are removed too.
async function uninstallPlugin(packageName) {
	return runChange(async () => {
		const plan = planUninstall(packageName)

		if (plan.outcome !== 'ok') {
			return plan
		}

		const packageNames = plan.packageNames
		const uninstalled = await runNpm(['uninstall', ...packageNames])

		if (!uninstalled.ok) {
			return npmFailure('The plugins could not be uninstalled.', uninstalled)
		}

		return {
			outcome: 'uninstalled',
			removedPackages: packageNames
		}
	})
}

async function updatePlugin(packageName) {
	return runChange(async () => {
		const plan = await planUpdate(packageName)

		if (plan.outcome !== 'ok') {
			return plan
		}

		const updated = await runNpm(['install', `${packageName}@${plan.version}`, '--save-exact'])

		if (!updated.ok) {
			return npmFailure('The plugin could not be updated.', updated)
		}

		const dependenciesResult = await installMissingDependencies(packageName)

		if (dependenciesResult.outcome === 'failed') {
			return dependenciesResult
		}

		return {
			outcome: 'updated',
			packageName,
			installedPackages: dependenciesResult.missingDependencies
		}
	})
}

export { installPlugin, isChangeRunning, uninstallPlugin, updatePlugin }
