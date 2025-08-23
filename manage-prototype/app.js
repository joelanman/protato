// manage prototype - app

import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { getInternalNunjucksEnv } from '../lib/internal-renderer.js'
import livereload from './livereload.js'

const getManagePrototypeApp = () => {
	const app = express()

	// Reverse proxy to prototype server
	const prototypePort = process.env.PROTOTYPE_PORT
	const prototypeProxy = createProxyMiddleware({
		target: `http://localhost:${prototypePort}`
	})

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
