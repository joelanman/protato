import { randomBytes } from 'node:crypto'

import express from 'express'

import devServer from '../../lib/dev-server.js'
import { addUpdateState, buildActionPlan, buildNpmPlan, readPlugins } from '../../lib/plugin-management.js'

const router = express.Router()
const formToken = randomBytes(16).toString('hex')
const MAX_OUTPUT_CHARS = 64 * 1024

function formatOutput(stdout, stderr) {
	const raw = [stdout, stderr].filter(Boolean).join('\n').trim()

	return {
		output: raw.length > MAX_OUTPUT_CHARS ? raw.slice(-MAX_OUTPUT_CHARS) : raw,
		outputTruncated: raw.length > MAX_OUTPUT_CHARS
	}
}

function isCrossOrigin(request) {
	const origin = request.get('origin')

	if (!origin) {
		return false
	}

	try {
		return new URL(origin).host !== request.get('host')
	} catch {
		return true
	}
}

function renderConfirmError(response, status, heading, error, extra = {}) {
	response.status(status).render('plugin-confirm', {
		pageName: 'Confirm plugin changes',
		heading,
		error,
		problems: [],
		...extra
	})
}

router.get('/', async (request, response, next) => {
	try {
		const { pagePlugins, diagnostics } = readPlugins()

		await addUpdateState(pagePlugins)

		response.render('plugins', {
			pageName: 'Plugins',
			plugins: pagePlugins,
			diagnostics,
			updated: request.query.updated === '1'
		})
	} catch (error) {
		next(error)
	}
})

router.get('/confirm', async (request, response) => {
	const state = readPlugins()
	const { action, packageName } = request.query
	const result = await buildActionPlan(action, packageName, state)

	if (result.error) {
		renderConfirmError(response, result.status, 'Plugin changes could not be started', result.error)
		return
	}

	response.render('plugin-confirm', {
		pageName: 'Confirm plugin changes',
		action,
		packageName,
		pluginName: result.plugin.name,
		publisher: result.plugin.publisher,
		version: result.version,
		noop: result.plan.noop,
		changes: result.changes,
		problems: result.problems,
		token: formToken,
		expectedChanges: result.expectedChanges
	})
})

router.post('/confirm', async (request, response) => {
	const body = request.body ?? {}

	if (isCrossOrigin(request)) {
		renderConfirmError(response, 403, 'Plugin changes were not allowed', 'The request came from another site.')
		return
	}

	if (body.token !== formToken) {
		renderConfirmError(
			response,
			403,
			'Plugin changes were not allowed',
			'The form has expired. Go back to the plugins page and try again.'
		)
		return
	}

	const state = readPlugins()
	const { action, packageName, expectedChanges } = body
	const result = await buildActionPlan(action, packageName, state)

	if (result.error) {
		renderConfirmError(response, result.status, 'Plugin changes could not be made', result.error)
		return
	}

	if (!result.plan.ok) {
		renderConfirmError(response, 409, 'The plugin changes could not be made', 'The plan has blocking problems.', {
			problems: result.problems
		})
		return
	}

	if (result.plan.noop) {
		response.redirect(303, '/manage-prototype/plugins')
		return
	}

	if (expectedChanges !== result.expectedChanges) {
		renderConfirmError(
			response,
			409,
			'The plugin list changed',
			'Review the latest plugin plan and confirm the changes again.'
		)
		return
	}

	try {
		const npmResult = await devServer.updatePlugins(buildNpmPlan(result.plan))

		if (!npmResult?.ok) {
			renderConfirmError(
				response,
				500,
				'npm could not update the plugins',
				'The project was rebuilt and the prototype restarted. Check the npm output below.',
				formatOutput(npmResult?.stdout, npmResult?.stderr)
			)
			return
		}

		response.redirect(303, '/manage-prototype/plugins?updated=1')
	} catch (error) {
		const status = error.code === 'BUSY' ? 409 : 500

		renderConfirmError(
			response,
			status,
			'The plugin update failed',
			error.message,
			formatOutput(error.result?.stdout, error.result?.stderr)
		)
	}
})

export default router
