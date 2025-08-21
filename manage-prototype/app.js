// manage prototype - app

import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { getInternalNunjucksEnv } from '../lib/internal-renderer.js'
import livereload from '../lib/livereload.js'
import { getErrorModel } from '../lib/utils/error-model.js'

const processes = {
	build: {
		state: 'ok'
	},
	app: {
		state: 'ok'
	}
}

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

	// handle app server start errors

	app.get('/{*splat}', (request, response, next) => {
		// ignore asset requests
		if (
			request.path.startsWith('/public/') ||
			request.path.startsWith('/plugin-assets/') ||
			request.path.startsWith('/manage-prototype/')
		) {
			next()
			return
		}
		console.log('manage-prototype - ' + request.path)
		let error
		if (processes.build.state === 'error') {
			error = processes.build.error
		}
		if (processes.app.state === 'error') {
			error = processes.build.error
		}
		if (error) {
			console.log('manage-prototype - error')
			response.render('server-error.njk', getErrorModel(error))
		} else {
			console.log('manage-prototype - ok')
			next()
		}
	})

	// Proxy all remaining routes to prototype server

	app.use(prototypeProxy)

	return app
}

const sendState = (message) => {
	console.log('GUI App - Received message:')
	console.log(JSON.stringify(message, null, 2))
	processes[message.source].state = message.state
	processes[message.source].error = message.error
	if (message.state === 'error') {
		livereload.reload()
	}
}

export { getManagePrototypeApp, sendState }
