import express from 'express'
import { csrf } from '../../manage-prototype/csrf.js'
import { errorHandler, pageNotFound } from '../../manage-prototype/errors.js'
import managePrototypeNunjucks from '../../manage-prototype/nunjucks.js'

// The parts of manage-prototype/app.js that route tests need: the real Nunjucks
// views, the CSRF middleware and the error pages, with the routes under test
// mounted where app.js mounts them.
function createManagePrototypeApp(routes, { mountPath = '/manage-prototype', middleware = [] } = {}) {
	const app = express()

	app.use(express.urlencoded({ extended: true }))
	managePrototypeNunjucks.configure(app)

	if (middleware.length) {
		app.use(middleware)
	}

	app.use(csrf)
	app.use(mountPath, routes)
	app.use(pageNotFound)
	app.use(errorHandler)

	return app
}

// Reads the token and cookie from a rendered form, the way a browser would
function readCsrf(response) {
	const token = /name="_csrf" value="([^"]+)"/.exec(response.text)?.[1]
	const cookie = response.headers['set-cookie'][0].split(';')[0]

	return { token, cookie }
}

const errorFromRedirect = (response) => new URL(response.headers.location, 'http://localhost').searchParams.get('error')

export { createManagePrototypeApp, errorFromRedirect, readCsrf }
