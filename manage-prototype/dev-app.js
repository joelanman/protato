// manage prototype - dev app
//
// Development only. Holds the main port so the manage pages stay up if the
// prototype server crashes or restarts, and proxies everything else to it.

import express from 'express'
import livereload from '../lib/livereload.js'
import { getPaths } from '../lib/paths.js'
import managePrototypeNunjucks from './nunjucks.js'
import { createProxyMiddleware } from './proxy.js'

const getManagePrototypeDevApp = () => {
	const app = express()
	const paths = getPaths()

	managePrototypeNunjucks.configure(app)

	const managePrototype = express.Router()

	// static assets
	managePrototype.use('/public', express.static(paths.managePrototype.public))
	managePrototype.use('/govuk-frontend', express.static(paths.managePrototype.govukFrontend))

	// dev manage UI
	managePrototype.get('/', (request, response) => {
		response.render('home')
	})

	// live reload
	managePrototype.get('/livereload', livereload.getRoute())

	app.use('/manage-prototype', managePrototype)

	// Proxy all remaining routes to prototype server
	app.use(
		createProxyMiddleware({
			target: `http://localhost:${process.env.PROTOTYPE_PORT}`
		})
	)

	return app
}

export { getManagePrototypeDevApp }
