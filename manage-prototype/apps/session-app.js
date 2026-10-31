// manage prototype - session app
//
// Pages that need the prototype session (password, clear data) and the manage
// static assets. Mounted by the prototype app and its error app. In development
// the dev server proxies this app's pages to the prototype server (see
// pagePaths) before its own manage app sees them, because the session lives here.

import { getConfig } from '../../lib/config.js'
import { createBaseApp } from './base-app.js'

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

const getSessionApp = () => {
	const app = createBaseApp()

	for (const page of pages) {
		app.get(page.path, page.get)
		app.post(page.path, page.post)
	}

	return app
}

export { getSessionApp, pagePaths }
