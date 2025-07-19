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
	app.locals.govukFrontend = {
		assetPath: '/dist/govuk/' + assetPathFragment
	}

	app.locals.protato = {
		scripts: plugins.getScriptPaths()
	}

	// serve static assets

	app.use('/public', express.static(paths.public.root))

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

	// Set up Nunjucks

	app.set('view engine', 'html')

	var appViews = [paths.views.project, paths.views.package, paths.views.govukFrontend]

	var nunjucksConfig = {
		autoescape: true,
		noCache: true,
		watch: false
	}

	if (env === 'development') {
		nunjucksConfig.watch = true
	}

	nunjucksConfig.express = app

	const nunjucksAppEnv = nunjucks.configure(appViews, nunjucksConfig)

	// add 'checked' function to nunjucks - legacy

	session.addCheckedFunction(nunjucksAppEnv)

	// initialise api

	protato.init(app)

	// mount user's routes

	const routesPath = path.join(paths.app, 'routes.js')

	if (fs.existsSync(routesPath)) {
		await import(routesPath)
	}

	// Auto render views

	app.get(/^[^.]+$/, autoRenderView)

	return app
}

export default getApp
