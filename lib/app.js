import fs from 'node:fs'
import path from 'node:path'

import express from 'express'
import nunjucks from 'nunjucks'
import protato from '../index.js'
import getPaths from './paths.js'

const env = (process.env.NODE_ENV || 'development').toLowerCase()

const getApp = async () => {
	const paths = getPaths()
	const app = express()

	// serve static assets

	app.use('/public', express.static(paths.public.root))

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

	return app
}

export default getApp
