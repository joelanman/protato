// manage prototype
//
// /manage-prototype is a reserved namespace, so kit pages cannot collide with
// the pages in app/views. It is one app, mounted in whichever process should
// serve it:
//
//   development   the dev server, so manage survives prototype restarts
//   production    the prototype process, alongside the session it needs
//
// The session pages work in both places because the session is a file store
// shared by both processes (lib/middleware/session-store.js), not process
// memory. The dev server also mounts the session middleware before this app.
//
// Production gets only the pages that need the prototype's session (password,
// clear data). Development also gets the pages that help while developing:
// home, templates and plugins. The dev routes are imported only in development,
// so production never loads the plugin manager.
//
// Template previews are not here: they render with the prototype's own views,
// layouts, macros and filters, so lib/app.js registers that route and the dev
// server proxies its one path to the prototype process.

import express from 'express'

import { getConfig } from '../lib/config.js'
import { getPaths } from '../lib/paths.js'
import { csrf } from './csrf.js'
import managePrototypeNunjucks from './nunjucks.js'
import sessionRoutes from './routes/session.js'

async function getManagePrototypeApp() {
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
		// imported here so production does not load the plugin manager
		const { default: templateRoutes } = await import('./routes/templates.js')
		const { default: pluginRoutes } = await import('./routes/plugins.js')

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
