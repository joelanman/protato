import fs from 'node:fs'
import path from 'node:path'

import bodyParser from 'body-parser'
import express from 'express'
import nunjucks from 'nunjucks'

import protato from '../index.js'
import { getConfig } from './config.js'
import { getAuth } from './middleware/auth.js'
import autoRenderView from './middleware/autoRenderView.js'
import { errorHandler, pageNotFound } from './middleware/errors.js'
import { postRedirectGet } from './middleware/postRedirectGet.js'
import session from './middleware/session.js'
import { getPaths } from './paths.js'
import plugins from './plugins.js'

const getApp = async () => {
	const config = getConfig()
	const paths = getPaths()
	const app = express()
	const auth = getAuth()

	// set up locals

	const assetPathFragment = config?.plugins?.['govuk-frontend']?.rebrand ? 'assets/rebrand' : 'assets'

	const managePrototypePort = config.port

	app.locals = {
		govukFrontend: {
			assetPath: '/dist/govuk/' + assetPathFragment
		},
		protato: {
			livereloadURL: `http://localhost:${managePrototypePort}/manage-prototype/livereload`,
			scripts: plugins.getScriptPaths()
		},
		serviceName: config.serviceName
	}

	// support for parsing data in POSTs

	app.use(bodyParser.json())
	app.use(
		bodyParser.urlencoded({
			extended: true
		})
	)

	// session

	await session.init(app)
	app.use(session.autoStoreData)

	// auth

	if (config.env === 'production') {
		app.use(auth.checkAuth)
	}

	// serve internal assets

	app.use('/manage-prototype/public', express.static(paths.internal.public))
	app.use('/manage-prototype/govuk-frontend', express.static(paths.internal.govukFrontend))

	// serve project assets

	app.use('/public', express.static(paths.public))
	app.use('/public', express.static(paths.assets))

	// serve plugin assets

	const pluginAssetPaths = plugins.getAssetPaths()

	for (const plugin of pluginAssetPaths) {
		app.use(plugin.serverPath, express.static(plugin.filePath))
	}

	// set up Nunjucks

	app.set('view engine', 'html')

	const tmpPluginViews = plugins.getTmpViewPaths()
	const pluginViews = plugins.getViewPaths()

	const appViews = [
		paths.views,
		...tmpPluginViews, // so layout with macro imports has priority
		...pluginViews
	]

	const nunjucksConfig = {
		autoescape: true,
		noCache: true,
		watch: false
	}

	nunjucksConfig.express = app

	const nunjucksAppEnv = nunjucks.configure(appViews, nunjucksConfig)

	// initialise api

	protato.init(app, nunjucksAppEnv)

	// add plugin filters and functions

	const pluginFilters = plugins.getFilterPaths()

	for (const pluginFilter of pluginFilters) {
		await import(pluginFilter)
	}

	const pluginFunctions = plugins.getFunctionPaths()

	for (const pluginFunction of pluginFunctions) {
		await import(pluginFunction)
	}

	// password routes

	app.get('/manage-prototype/password', auth.password.get)
	app.post('/manage-prototype/password', auth.password.post)

	// mount user's routes

	const routesPath = path.join(paths.app, 'routes.js')

	if (fs.existsSync(routesPath)) {
		await import(routesPath)
	}

	// auto render views

	app.get(/^[^.]+$/, autoRenderView)

	// auto redirect POST to GET
	// so users can POST data to the next page
	// this needs to come after all other POST handlers
	// and before the 404 handler

	app.post('/{*splat}', postRedirectGet)

	// Catch 404 and forward to error handler

	app.use(pageNotFound)

	// Display error
	// We override the default handler because we want to customise
	// how the error appears to users, we want to show a simplified
	// message without the stack trace.

	app.use(errorHandler)

	return app
}

export default getApp
