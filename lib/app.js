import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import bodyParser from 'body-parser'
import express from 'express'
import nunjucks from 'nunjucks'

import protato from '../index.js'
import managePrototype from '../manage-prototype/index.js'
import templatePreview, { templatePreviewPath } from '../manage-prototype/routes/template-preview.js'
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

// express.static serves directories; individually declared files use GET
// routes, which also handle HEAD without exposing sibling files.
function servePluginFile(filePath) {
	return (request, response, next) => {
		response.sendFile(filePath, (error) => {
			if (!error) {
				return
			}

			// the file may have been removed since the plugin config was read
			if (error.code === 'ENOENT') {
				return next()
			}

			next(error)
		})
	}
}

const getApp = async () => {
	const config = getConfig()
	const paths = getPaths()
	const app = express()

	// in production, HTTPS is terminated by a proxy, so trust its forwarded headers
	if (config.env === 'production') {
		app.set('trust proxy', 1)
	}

	// set up locals

	const assetPathFragment = config?.plugins?.['govuk-frontend']?.rebrand ? 'assets/rebrand' : 'assets'

	const protatoLocals = {
		isDevelopment: config.env === 'development',
		scripts: plugins.getScriptPaths(),
		stylesheets: plugins.getStylesheetPaths()
	}

	app.locals = {
		govukFrontend: {
			assetPath: '/dist/govuk/' + assetPathFragment
		},
		GOVUKPrototypeKit: protatoLocals,
		protato: protatoLocals,
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

	// template previews are rendered by the prototype app so they get the same
	// views, layouts, macros, filters and locals as a real prototype page. In
	// development the dev server proxies this path here (PROXY_MANAGE_PATHS in
	// lib/dev/server.js).
	if (config.env === 'development') {
		app.get(templatePreviewPath, templatePreview)
	}

	// serve project assets

	app.use('/public', express.static(paths.public))
	app.use('/public', express.static(paths.assets))

	// serve plugin assets

	const pluginAssetPaths = plugins.getAssetPaths()

	for (const plugin of pluginAssetPaths) {
		if (plugin.type === 'directory') {
			app.use(plugin.serverPath, express.static(plugin.filePath))
		} else {
			app.get(plugin.serverPath, servePluginFile(plugin.filePath))
		}
	}

	// set up Nunjucks

	app.set('view engine', 'html')

	// Nunjucks uses the first view that matches, so this is a precedence list:
	// the project always wins over plugins, then plugins are ordered by
	// getViewPaths() so later plugins win, with each plugin's shadow
	// layouts before its own views
	const appViews = [paths.views, ...plugins.getViewPaths()]

	if (config.env === 'development') {
		// template previews render files from node_modules and may use relative includes
		appViews.push(path.join(paths.project, 'node_modules'))
	}

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
