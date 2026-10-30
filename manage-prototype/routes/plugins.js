import express from 'express'

import { installPlugin, uninstallPlugin } from '../../lib/manage-plugins/change.js'
import { listAvailablePlugins, listInstalledPlugins } from '../../lib/manage-plugins/list.js'

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
router.get('/', (request, response) => {
	const installedPlugins = listInstalledPlugins()

	response.render('plugins', {
		pageName: 'Plugins',
		installedPlugins,
		availablePlugins: listAvailablePlugins(installedPlugins)
	})
})

// Install and uninstall run straight from the list. The checks a change has to
// pass (valid name, protected package, already in the requested state,
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

export default router
