// manage prototype
//
// Everything under /manage-prototype is served by the prototype process, from
// this one app. lib/app.js mounts it, and so does the error app the prototype
// server shows when a build or startup fails, so these pages keep working then.
//
// Production gets only the pages that need the prototype's session (password,
// clear data). Development also gets the pages that help while developing:
// home, templates and plugins.
//
// Template previews are not here: they render with the prototype's own views,
// layouts, macros and filters, so lib/app.js registers that route.

import express from 'express'

import { getConfig } from '../lib/config.js'
import { getPaths } from '../lib/paths.js'
import { csrf } from './csrf.js'
import managePrototypeNunjucks from './nunjucks.js'
import pluginRoutes from './routes/plugins.js'
import sessionRoutes from './routes/session.js'
import templateRoutes from './routes/templates.js'

function getManagePrototypeApp() {
	const config = getConfig()
	const paths = getPaths()
	const app = express()

	managePrototypeNunjucks.configure(app)

	app.use('/public', express.static(paths.managePrototype.public))
	app.use('/govuk-frontend', express.static(paths.managePrototype.govukFrontend))

	// Every form below renders a token and every POST checks it, so pages are
	// protected by default rather than one route at a time.
	app.use(csrf)

	app.use(sessionRoutes)

	if (config.env === 'development') {
		app.get('/', (request, response) => {
			response.render('home')
		})

		app.use('/templates', templateRoutes)
		app.use('/plugins', pluginRoutes)
	}

	return app
}

export { getManagePrototypeApp }
export default { getManagePrototypeApp }
