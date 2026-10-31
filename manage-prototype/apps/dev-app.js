// manage prototype - dev app
//
// The manage UI used while developing: home, templates and plugins, mounted at
// /manage-prototype. Served by the dev server (lib/dev/server.js), which is a
// separate process from the prototype so this UI survives prototype restarts.

import express from 'express'
import livereload from '../../lib/dev/livereload.js'
import { csrf } from '../../lib/middleware/csrf.js'
import { errorHandler, pageNotFound } from '../../lib/middleware/errors.js'
import { templatesPath } from '../paths.js'
import pluginRoutes from '../routes/plugins.js'
import templateRoutes from '../routes/templates.js'
import { configureManageApp } from './configure-app.js'

const getDevApp = () => {
	const app = express()

	configureManageApp(app)

	// Requests for pages served by the prototype server are proxied before they
	// reach this app (lib/dev/server.js), so everything here is ours to parse.
	app.use(express.urlencoded({ extended: true }))

	// live reload is a long lived event stream and needs no token
	app.get('/livereload', livereload.route)

	// Every route below is a manage route: pages render the token and posts
	// check it. Everything is protected by default rather than per route.
	app.use(csrf)

	// dev manage UI
	app.get('/', (request, response) => {
		response.render('home')
	})

	app.use(templatesPath, templateRoutes)

	// plugin management changes package.json, so it rebuilds and restarts the
	// prototype after a change.
	app.use('/plugins', pluginRoutes)

	// The manage pages the prototype server serves are proxied before they reach
	// this app (see manage-prototype/index.js), so an unmatched path is a 404. It
	// must not fall through to the proxy with its body already parsed.
	app.use(pageNotFound)

	// errors raised by the manage UI (such as a template that doesn't exist)
	// render our own not found and server error pages.
	app.use(errorHandler)

	return app
}

export { getDevApp }
export default { getDevApp }
