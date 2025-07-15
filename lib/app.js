import fs from 'node:fs'
import path from 'node:path'

import express from 'express'
import nunjucks from 'nunjucks'
import protato from '../index.js'
import middleware from './middleware.js'
import getPaths from './paths.js'
import plugins from './plugins.js'

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

	// serve static assets

	app.use('/public', express.static(paths.public.root))

	// serve plugin assets

	plugins.serveAssets(app)

	// Set up Nunjucks

	app.set('view engine', 'html')

	var appViews = [paths.views.project, paths.views.govukPrototypeKit, paths.views.govukFrontend]

	var nunjucksConfig = { autoescape: true, noCache: true, watch: false }

	if (env === 'development') {
		nunjucksConfig.watch = true
	}

	nunjucksConfig.express = app

	// var nunjucksAppEnv = nunjucks.configure(appViews, nunjucksConfig)

	nunjucks.configure(appViews, nunjucksConfig)

	// initialise api

	protato.init(app)

	// mount user's routes

	const routesPath = path.join(paths.app, 'routes.js')

	if (fs.existsSync(routesPath)) {
		await import(routesPath)
	}

	// Auto render views

	app.get(/^[^.]+$/, middleware.autoRenderView)

	return app
}

export default getApp
