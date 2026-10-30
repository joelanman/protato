// manage prototype - app
//
// Sub-app mounted by the prototype server at /manage-prototype.
// Handles pages that need the session (password, clear data)
// plus static assets.
//
// In development the dev server proxies these pages here before its own manage
// app sees them, because they need this app's session. It reads the paths from
// pagePaths, so adding a page here is enough.

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

// Pages that need the session. Each entry carries its path, so the routes and
// pagePaths are both read from this list.
const pages = [
	{
		path: '/clear-data',
		get: (request, response) => {
			response.render('clear-data')
		},
		post: (request, response) => {
			request.session.data = {}
			response.render('clear-data-success')
		}
	},
	{
		path: '/password',
		get: (request, response) => {
			response.render('password', {
				error: request.query.error,
				returnURL: request.query.returnURL
			})
		},
		post: (request, response) => {
			const password = request.body.password

			if (getConfig().passwords.includes(password)) {
				request.session.password = password
				response.redirect(getSafeReturnURL(request.body.returnURL))
			} else {
				const returnURL = encodeURIComponent(request.body.returnURL)
				response.redirect('/manage-prototype/password?error=wrong-password&returnURL=' + returnURL)
			}
		}
	}
]

// The paths this app serves, relative to /manage-prototype. They must be
// literal, because the dev server mounts them as proxy prefixes.
const pagePaths = pages.map((page) => page.path)

const getApp = () => {
	const app = express()
	const paths = getPaths()

	managePrototypeNunjucks.configure(app)

	// static assets
	app.use('/public', express.static(paths.managePrototype.public))
	app.use('/govuk-frontend', express.static(paths.managePrototype.govukFrontend))

	for (const page of pages) {
		app.get(page.path, page.get)
		app.post(page.path, page.post)
	}

	return app
}

export { getApp, pagePaths }
