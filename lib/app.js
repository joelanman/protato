import fs from 'node:fs'
import path from 'node:path'

import bodyParser from 'body-parser'
import express from 'express'
import nunjucks from 'nunjucks'

import protato from '../index.js'
import autoRenderView from './autoRenderView.js'
import getPaths from './paths.js'
import plugins from './plugins.js'
import session from './session.js'

const env = (process.env.NODE_ENV || 'development').toLowerCase()

const getApp = async () => {
	const paths = getPaths()
	const app = express()
	const config = JSON.parse(fs.readFileSync(paths.config))

	// set up locals

	const assetPathFragment = config?.plugins?.['govuk-frontend']?.rebrand ? 'assets/rebrand' : 'assets'
	app.locals = {
		govukFrontend: {
			assetPath: '/dist/govuk/' + assetPathFragment
		},
		protato: {
			scripts: plugins.getScriptPaths()
		}
	}

	// serve project assets

	app.use('/public', express.static(paths.public))

	// serve plugin assets

	const pluginAssetPaths = plugins.getAssetPaths()

	for (const plugin of pluginAssetPaths) {
		app.use(plugin.serverPath, express.static(plugin.filePath))
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

	if (env === 'development') {
		nunjucksConfig.watch = true
	}

	nunjucksConfig.express = app

	const nunjucksAppEnv = nunjucks.configure(appViews, nunjucksConfig)

	// initialise api

	protato.init(app, nunjucksAppEnv)

	// add 'checked' function to nunjucks - legacy

	session.addCheckedFunction(nunjucksAppEnv)

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

	return app
}

export default getApp
