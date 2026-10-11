// manage prototype - app

import express from 'express'
import { getInternalNunjucksEnv } from '../lib/internal-renderer.js'
import livereload from '../lib/livereload.js'
import { getPaths } from '../lib/paths.js'
import { createProxyMiddleware } from './proxy.js'

const getManagePrototypeApp = () => {
	const app = express()
	const paths = getPaths()

	// Reverse proxy to prototype server
	const prototypePort = process.env.PROTOTYPE_PORT
	const prototypeProxy = createProxyMiddleware({
		target: `http://localhost:${prototypePort}`
	})

	// serve internal assets

	app.use('/manage-prototype/public', express.static(paths.internal.public))
	app.use('/manage-prototype/govuk-frontend', express.static(paths.internal.govukFrontend))

	// nunjucks setup

	const internalNunjucksEnv = getInternalNunjucksEnv()

	app.set('view engine', 'njk')
	internalNunjucksEnv.express(app)

	app.get('/manage-prototype', (request, response) => {
		response.render('home')
	})

	// live reload

	app.get('/manage-prototype/livereload', livereload.getRoute())

	// Proxy all remaining routes to prototype server

	app.use(prototypeProxy)

	return app
}

export { getManagePrototypeApp }
