import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import bodyParser from 'body-parser'
import express from 'express'
import nunjucks from 'nunjucks'

import protato from '../index.js'
import managePrototype from '../manage-prototype/index.js'
import { getConfig } from './config.js'
import { checkAuth } from './middleware/auth.js'
import autoRenderView from './middleware/autoRenderView.js'
import { errorHandler, pageNotFound } from './middleware/errors.js'
import { postRedirectGet } from './middleware/postRedirectGet.js'
import session from './middleware/session.js'
import { getPaths } from './paths.js'
import plugins from './plugins.js'

// user and plugin files register filters/functions/routes as a side effect
async function importFiles(filePaths) {
	for (const filePath of filePaths) {
		await import(pathToFileURL(filePath).href)
	}
}

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
			livereloadURL: paths.managePrototype.livereload,
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
		app.use(checkAuth)
	}

	// manage prototype pages (assets and password)

	app.use('/manage-prototype', managePrototype.getApp())

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

	// add plugin and user filters and functions

	const appFile = (name) => {
		const filePath = path.join(paths.app, name)
		return fs.existsSync(filePath) ? [filePath] : []
	}

	// plugins first so user files can override them
	await importFiles([...plugins.getFilterPaths(), ...appFile('filters.js')])
	await importFiles([...plugins.getFunctionPaths(), ...appFile('functions.js')])

	// mount user's routes

	const routesPath = path.join(paths.app, 'routes.js')

	if (fs.existsSync(routesPath)) {
		await importFiles([routesPath])
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
