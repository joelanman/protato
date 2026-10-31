import express from 'express'

import { installPlugin, uninstallPlugin, updatePlugin } from '../../lib/manage-plugins/change.js'
import { checkForUpdates, listAvailablePlugins, listInstalledPlugins } from '../../lib/manage-plugins/list.js'

const router = express.Router()

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

// Changes report their outcome on the result page instead of an HTTP status,
// and check their own preconditions so a direct POST cannot bypass the UI.
router.post('/install', async (request, response) => {
	const result = await installPlugin(request.body.packageName)

	response.render('plugin-result', {
		pageName: 'Plugins',
		outcome: result.outcome,
		message: result.message,
		npmOutput: result.npmOutput,
		installedPackages: result.installedPackages
	})
})

router.post('/uninstall', async (request, response) => {
	const result = await uninstallPlugin(request.body.packageName)

	response.render('plugin-result', {
		pageName: 'Plugins',
		outcome: result.outcome,
		message: result.message,
		npmOutput: result.npmOutput,
		removedPackages: result.removedPackages
	})
})

router.post('/update', async (request, response) => {
	const result = await updatePlugin(request.body.packageName)

	response.render('plugin-result', {
		pageName: 'Plugins',
		outcome: result.outcome,
		message: result.message,
		npmOutput: result.npmOutput,
		updatedPackage: result.packageName,
		installedPackages: result.installedPackages
	})
})

export default router
