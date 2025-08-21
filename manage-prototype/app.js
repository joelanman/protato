// manage prototype - app

import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import nunjucks from 'nunjucks'
import { getConfig } from '../lib/config.js'
import livereload from '../lib/livereload.js'
import { getErrorModel } from '../lib/utils/error-model.js'
import { getManagePaths } from './paths.js'

// used by error pages in prototype app

function getNunjucksConfig() {
	const config = getConfig()
	const paths = getManagePaths()
	const views = [paths.managePrototype.views, paths.managePrototype.govukFrontendViews]

	const nunjucksConfig = {
		autoescape: true,
		noCache: true,
		watch: false
	}

	if (config.env === 'development') {
		nunjucksConfig.watch = true
	}
	return { views, nunjucksConfig }
}

const processes = {
	build: {
		state: 'ok'
	},
	app: {
		state: 'ok'
	}
}

const getManagePrototypeApp = () => {
	const config = getConfig()
	const paths = getManagePaths()
	const app = express()

	// Reverse proxy to prototype server
	const prototypePort = process.env.PROTOTYPE_PORT
	const prototypeProxy = createProxyMiddleware({
		target: `http://localhost:${prototypePort}`
	})

	// set up locals

	const liveReloadPort = process.env.LIVE_RELOAD_PORT

	app.locals = {
		assetPath: '/manage-prototype/govuk-frontend/assets',
		protato: {
			livereloadURL: `http://localhost:${liveReloadPort}/livereload`
		}
	}

	// serve manage prototype assets

	app.use('/manage-prototype/public', express.static(paths.managePrototype.public))
	app.use('/manage-prototype/govuk-frontend', express.static(paths.managePrototype.govukFrontend))

	// nunjucks setup

	const { views, nunjucksConfig } = getNunjucksConfig()

	app.set('view engine', 'njk')
	nunjucksConfig.express = app

	nunjucks.configure(views, nunjucksConfig)

	app.get('/manage-prototype/password', (request, response) => {
		response.locals.error = request.query.error
		response.locals.returnURL = request.query.returnURL
		response.render('password')
	})

	function getSafeReturnURL(returnURL = '/') {
		if (
			typeof returnURL === 'string' &&
			returnURL.startsWith('/') &&
			!returnURL.startsWith('/manage-prototype/password') &&
			!returnURL.startsWith('//')
		) {
			return returnURL
		} else {
			return '/'
		}
	}

	app.post('/manage-prototype/password', (request, response) => {
		const password = request.body.password
		if (config.passwords.includes(password)) {
			request.session.password = password
			const returnURL = getSafeReturnURL(request.body.returnURL)
			response.redirect(returnURL)
		} else {
			const returnURL = encodeURIComponent(request.body.returnURL)
			response.redirect('/manage-prototype/password?error=wrong-password&returnURL=' + returnURL)
		}
	})

	// handle app server start errors

	app.get('/{*splat}', (request, response, next) => {
		// ignore asset requests
		if (request.path.startsWith('/public/') || request.path.startsWith('/plugin-assets/')) {
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

export { getManagePrototypeApp, getNunjucksConfig, sendState }
