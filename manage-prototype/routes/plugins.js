import { randomBytes } from 'node:crypto'

import express from 'express'

import devServer from '../../lib/dev-server.js'
import { listPlugins } from '../../lib/manage-plugins/list.js'
import { makePluginPlan } from '../../lib/manage-plugins/make-plan.js'

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
		const { installed, available, diagnostics } = await listPlugins()

		response.render('plugins', {
			pageName: 'Plugins',
			installed,
			available,
			diagnostics,
			updated: request.query.updated === '1'
		})
	} catch (error) {
		next(error)
	}
})

router.get('/confirm', async (request, response) => {
	const { action, packageName } = request.query
	const plan = await makePluginPlan(action, packageName)

	if (plan.error) {
		renderConfirmError(response, plan.status, 'Plugin changes could not be started', plan.error)
		return
	}

	response.render('plugin-confirm', {
		pageName: 'Confirm plugin changes',
		...plan,
		token: formToken
	})
})

router.post('/confirm', async (request, response) => {
	const { token, action, packageName } = request.body ?? {}

	if (token !== formToken) {
		renderConfirmError(
			response,
			403,
			'Plugin changes were not allowed',
			'The form has expired. Go back to the plugins page and try again.'
		)
		return
	}

	const plan = await makePluginPlan(action, packageName)

	if (plan.error) {
		renderConfirmError(response, plan.status, 'Plugin changes could not be made', plan.error)
		return
	}

	if (!plan.ok) {
		renderConfirmError(response, 409, 'The plugin changes could not be made', 'The plan has blocking problems.', {
			problems: plan.problems
		})
		return
	}

	if (plan.noop) {
		response.redirect(303, '/manage-prototype/plugins')
		return
	}

	try {
		const npmResult = await devServer.updatePlugins(plan)

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

		renderConfirmError(response, status, 'The plugin update failed', error.message)
	}
})

export default router
