import fs from 'node:fs'
import path from 'node:path'

import bodyParser from 'body-parser'
import express from 'express'
import nunjucks from 'nunjucks'

import protato from '../index.js'
import getManagePrototypeApp from '../manage-prototype/app.js'
import { getAuth } from './auth.js'
import { getConfig } from './config.js'
import { autoRenderView, postRedirectGet } from './middleware.js'
import { getPaths } from './paths.js'
import plugins from './plugins.js'
import session from './session.js'

const getApp = async () => {
	const config = getConfig()
	const paths = getPaths()
	const app = express()

	// set up locals

	const assetPathFragment = config?.plugins?.['govuk-frontend']?.rebrand ? 'assets/rebrand' : 'assets'
	app.locals = {
		govukFrontend: {
			assetPath: '/dist/govuk/' + assetPathFragment
		},
		protato: {
			scripts: plugins.getScriptPaths()
		},
		serviceName: config.serviceName
	}

	// Support for parsing data in POSTs

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
		app.use(getAuth())
	}

	// serve project assets

	app.use('/public', express.static(paths.public))

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
		paths.views.project,
		...tmpPluginViews, // so layout with macro imports has priority
		...pluginViews
	]

	const nunjucksConfig = {
		autoescape: true,
		noCache: true,
		watch: false
	}

	if (config.env === 'development') {
		nunjucksConfig.watch = true
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

	// mount user's routes

	const routesPath = path.join(paths.app, 'routes.js')

	if (fs.existsSync(routesPath)) {
		await import(routesPath)
	}

	// auto render views

	app.get(/^[^.]+$/, autoRenderView)

	// mount manage prototype app

	const managePrototypeApp = getManagePrototypeApp()

	app.use('/manage-prototype', managePrototypeApp)

	// auto redirect POST to GET

	app.post('/{*splat}', postRedirectGet)

	return app
}

export default getApp
