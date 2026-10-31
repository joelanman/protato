// manage prototype - session app
//
// Pages that need the prototype session (password, clear data) plus the manage
// static assets. Mounted at /manage-prototype by the prototype app (lib/app.js)
// and by its error app, because both exist in production.
//
// In development the dev server proxies this app's pages to the prototype
// server before its own manage app sees them, because the session lives there.
// It reads the paths from pagePaths, so adding a page here is enough.

import express from 'express'
import { getConfig } from '../../lib/config.js'
import { getPaths } from '../../lib/paths.js'
import managePrototypeNunjucks from '../nunjucks.js'
import { clearDataPagePath, govukFrontendPath, managePath, passwordPagePath, publicAssetsPath } from '../paths.js'

function getSafeReturnURL(returnURL = '/') {
	if (
		typeof returnURL === 'string' &&
		returnURL.startsWith('/') &&
		!returnURL.startsWith(managePath(passwordPagePath)) &&
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
		path: clearDataPagePath,
		get: (request, response) => {
			response.render('clear-data')
		},
		post: (request, response) => {
			request.session.data = {}
			response.render('clear-data-success')
		}
	},
	{
		path: passwordPagePath,
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
				response.redirect(managePath(passwordPagePath) + '?error=wrong-password&returnURL=' + returnURL)
			}
		}
	}
]

// The paths this app serves, relative to /manage-prototype. They must be
// literal, because the dev server mounts them as proxy prefixes.
const pagePaths = pages.map((page) => page.path)

const getSessionApp = () => {
	const app = express()
	const paths = getPaths()

	managePrototypeNunjucks.configure(app)

	// static assets
	app.use(publicAssetsPath, express.static(paths.managePrototype.public))
	app.use(govukFrontendPath, express.static(paths.managePrototype.govukFrontend))

	for (const page of pages) {
		app.get(page.path, page.get)
		app.post(page.path, page.post)
	}

	return app
}

export { getSessionApp, pagePaths }
