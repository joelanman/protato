// manage prototype - dev app
//
// Sub-app mounted by the dev server at /manage-prototype.

import express from 'express'
import livereload from '../lib/dev/livereload.js'
import { errorHandler } from '../lib/middleware/errors.js'
import { getPaths } from '../lib/paths.js'
import managePrototypeNunjucks from './nunjucks.js'
import pluginRoutes from './routes/plugins.js'
import templateRoutes from './routes/templates.js'

const getDevApp = () => {
	const app = express()
	const paths = getPaths()

	managePrototypeNunjucks.configure(app)

	app.use(express.urlencoded({ extended: true }))

	// static assets
	app.use('/public', express.static(paths.managePrototype.public))
	app.use('/govuk-frontend', express.static(paths.managePrototype.govukFrontend))

	// dev manage UI
	app.get('/', (request, response) => {
		response.render('home')
	})

	// /templates/view is mounted by the prototype app (lib/app.js) because
	// previews need prototype views and locals. Unmatched requests fall through
	// to the prototype server via the dev server's proxy.
	app.use('/templates', templateRoutes)

	// plugin management changes package.json, so it rebuilds and restarts the
	// prototype after a change.
	app.use('/plugins', pluginRoutes)

	// live reload
	app.get('/livereload', livereload.getRoute())

	// errors raised by the manage UI (such as a template that doesn't exist)
	// render our own not found and server error pages. Unmatched requests are
	// left alone so they still fall through to the prototype server's proxy.
	app.use(errorHandler)

	return app
}

export { getDevApp }
export default { getDevApp }
