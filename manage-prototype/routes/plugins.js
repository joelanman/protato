import express from 'express'

import { installPlugin, uninstallPlugin, updatePlugin } from '../../lib/manage-plugins/change.js'
import * as registry from '../../lib/manage-plugins/registry.js'

const router = express.Router()

// What the page can offer for a plugin, as the names of the change routes. The
// template turns each name into a button, and capitalises it for the label. The
// rules are the same the change code checks before it runs, so the page cannot
// offer something that would be refused.
function getPluginActions(plugin) {
	if (!plugin.installed) {
		return ['install']
	}

	const actions = []

	if (plugin.updateAvailable) {
		actions.push('update')
	}

	if (!plugin.protectedPackage) {
		actions.push('uninstall')
	}

	return actions
}

// The page renders the same list for installed and available plugins, so both
// get their buttons worked out here rather than in the template.
function withPluginActions(plugins) {
	return plugins.map((plugin) => ({ ...plugin, actions: getPluginActions(plugin) }))
}

router.get('/', (request, response) => {
	const { installedPlugins, availablePlugins } = registry.getPluginLists()
	const availableUpdatesCount = installedPlugins.filter((plugin) => plugin.updateAvailable).length

	response.render('plugins', {
		pageName: 'Plugins',
		installedPlugins: withPluginActions(installedPlugins),
		availablePlugins: withPluginActions(availablePlugins),
		availableUpdatesCount
	})
})

// Asks the registry for fresh plugin data and waits, then goes back to the
// list, which reads the refreshed cache. A POST because it changes what the
// page will show and should not be repeated by a reload or a link prefetch.
router.post('/check-for-updates', async (request, response) => {
	await registry.fetchAllPluginData()

	response.redirect(request.baseUrl)
})

// Outcomes that changed the installed plugins, so the prototype has to restart
// to pick them up. A refusal or a change that did nothing leaves it running.
const restartOutcomes = ['installed', 'uninstalled', 'updated']

const resultPath = '/manage-prototype/plugins/result'

// The supervisor restarts the prototype as soon as it sees this response, so the
// session has to be on disk before that: the new process reads it to render the
// result page.
function saveSession(request) {
	return new Promise((resolve, reject) => {
		request.session.save((error) => {
			if (error) {
				reject(error)
			} else {
				resolve()
			}
		})
	})
}

// The result is shown on a page of its own, so a reload or the back button does
// not run the change again. The result goes in the session, which survives the
// restart, and the header tells the supervisor to restart before the browser
// follows the redirect, so the new process renders the result page.
async function redirectToResult(request, response, result) {
	request.session.pluginResult = result

	await saveSession(request)

	if (restartOutcomes.includes(result.outcome)) {
		response.set('x-protato-restart', '1')
	}

	response.redirect(303, resultPath)
}

// Changes report their outcome on the result page instead of an HTTP status,
// and check their own preconditions so a direct POST cannot bypass the UI.
router.post('/install', async (request, response) => {
	const result = await installPlugin(request.body.packageName)

	await redirectToResult(request, response, result)
})

router.post('/uninstall', async (request, response) => {
	const result = await uninstallPlugin(request.body.packageName)

	await redirectToResult(request, response, result)
})

router.post('/update', async (request, response) => {
	const result = await updatePlugin(request.body.packageName)

	await redirectToResult(request, response, result)
})

router.get('/result', (request, response) => {
	const result = request.session.pluginResult

	// read once, so going back to this page does not show a stale result
	delete request.session.pluginResult

	if (!result) {
		response.redirect(303, '/manage-prototype/plugins')
		return
	}

	response.render('plugin-result', {
		pageName: 'Plugins',
		outcome: result.outcome,
		message: result.message,
		npmOutput: result.npmOutput,
		installedPackages: result.installedPackages,
		removedPackages: result.removedPackages,
		updatedPackage: result.packageName
	})
})

export default router
