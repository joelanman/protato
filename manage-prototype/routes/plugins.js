import express from 'express'

import { installPlugin, uninstallPlugin, updatePlugin } from '../../lib/manage-plugins/change.js'
import { checkForUpdates, listAvailablePlugins, listInstalledPlugins } from '../../lib/manage-plugins/list.js'

const router = express.Router()

// The result page reports the outcome, so no HTTP status is set: the request
// was handled and the page tells the user what happened.
function getOutcome(result, outcome) {
	if (result.busy) {
		return 'busy'
	}

	if (result.ok === false || result.error) {
		return 'failed'
	}

	if (result.noChange) {
		return 'noChange'
	}

	return outcome
}

// plugins list
router.get('/', async (request, response) => {
	const installedPlugins = await checkForUpdates(listInstalledPlugins())
	const availableUpdatesCount = installedPlugins.filter((plugin) => plugin.updateAvailable).length

	response.render('plugins', {
		pageName: 'Plugins',
		installedPlugins,
		availablePlugins: listAvailablePlugins(installedPlugins),
		availableUpdatesCount
	})
})

// Install, update and uninstall run straight from the list. The checks a change
// has to pass (valid name, protected package, already in the requested state,
// dependents) happen inside the change itself, so posting the form directly
// cannot bypass them.
router.post('/install', async (request, response) => {
	const result = await installPlugin(request.body.packageName)

	response.render('plugin-result', {
		pageName: 'Plugins',
		outcome: getOutcome(result, 'installed'),
		message: result.error ?? result.noChange,
		installedPackages: result.packages
	})
})

router.post('/uninstall', async (request, response) => {
	const result = await uninstallPlugin(request.body.packageName)

	response.render('plugin-result', {
		pageName: 'Plugins',
		outcome: getOutcome(result, 'uninstalled'),
		message: result.error ?? result.noChange,
		removedPackages: result.packages
	})
})

router.post('/update', async (request, response) => {
	const result = await updatePlugin(request.body.packageName)

	response.render('plugin-result', {
		pageName: 'Plugins',
		outcome: getOutcome(result, 'updated'),
		message: result.error ?? result.noChange,
		updatedPackage: result.updatedPackage,
		installedPackages: result.installedPackages
	})
})

export default router
