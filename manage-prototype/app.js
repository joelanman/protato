// manage prototype - app
//
// Sub-app mounted by the prototype server at /manage-prototype.
// Handles pages that need the session (password, and later clear session)
// plus static assets.

import express from 'express'
import { getConfig } from '../lib/config.js'
import { getPaths } from '../lib/paths.js'
import managePrototypeNunjucks from './nunjucks.js'

function getSafeReturnURL(returnURL = '/') {
	if (
		typeof returnURL === 'string' &&
		returnURL.startsWith('/') &&
		!returnURL.startsWith('/manage-prototype/password') &&
		!returnURL.startsWith('//')
	) {
		return returnURL
	}
	return '/'
}

const getManagePrototypeApp = () => {
	const app = express()
	const paths = getPaths()

	managePrototypeNunjucks.configure(app)

	// static assets
	app.use('/public', express.static(paths.managePrototype.public))
	app.use('/govuk-frontend', express.static(paths.managePrototype.govukFrontend))

	// password
	app.get('/password', (request, response) => {
		response.render('password', {
			error: request.query.error,
			returnURL: request.query.returnURL
		})
	})

	app.post('/password', (request, response) => {
		const password = request.body.password
		if (getConfig().passwords.includes(password)) {
			request.session.password = password
			const returnURL = getSafeReturnURL(request.body.returnURL)
			response.redirect(returnURL)
		} else {
			const returnURL = encodeURIComponent(request.body.returnURL)
			response.redirect('/manage-prototype/password?error=wrong-password&returnURL=' + returnURL)
		}
	})

	return app
}

export { getManagePrototypeApp }
