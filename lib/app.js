import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import express from 'express'
import nunjucks from 'nunjucks'

import protato from '../index.js'
import { getManagePrototypeApp } from '../manage-prototype/app.js'
import templatePreview, { templatePreviewPath } from '../manage-prototype/routes/preview.js'
import { getConfig } from './config.js'
import { checkAuth } from './middleware/auth.js'
import autoRenderView from './middleware/auto-render-view.js'
import { errorHandler, pageNotFound } from './middleware/errors.js'
import { addHttpsMiddleware } from './middleware/https.js'
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

	addHttpsMiddleware(app)

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

	// body parsing and the session
	await session.addSessionMiddleware(app)

	if (config.env === 'production' && config.useAuth) {
		app.use(checkAuth)
	}

	// In development the dev server serves manage prototype, because it
	// survives prototype restarts. In production there is only this process.
	// Manage is mounted before autoStoreData so manage forms are not stored in
	// the prototype's session data.
	if (config.env !== 'development') {
		app.use('/manage-prototype', await getManagePrototypeApp({ env: config.env }))
	}

	app.use(session.autoStoreData)

	// rendered by the prototype app rather than the manage app, so it gets the
	// same views, layouts, macros, filters and locals as a real prototype page.
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

	// Development re-reads templates on every render so an edit shows up on the
	// next request. Production caches them: nothing changes the files while that
	// process runs. nunjucks' own watcher (`watch`) stays off in both.
	const nunjucksConfig = {
		autoescape: true,
		noCache: config.env === 'development',
		watch: false
	}

	nunjucksConfig.express = app

	const nunjucksAppEnv = nunjucks.configure(appViews, nunjucksConfig)

	// Give the public protato API the app and Nunjucks env that user and plugin
	// files will use when they are imported below.
	protato.init(app, nunjucksAppEnv)

	// add plugin and user filters and functions
	// plugins first so user files can override them
	const filterPaths = plugins.getFilterPaths()

	if (fs.existsSync(paths.filters)) {
		filterPaths.push(paths.filters)
	}

	await importFiles(filterPaths)

	const functionPaths = plugins.getFunctionPaths()

	if (fs.existsSync(paths.functions)) {
		functionPaths.push(paths.functions)
	}

	await importFiles(functionPaths)

	// mount user's routes

	if (fs.existsSync(paths.routes)) {
		await importFiles([paths.routes])
	}

	// auto render views

	app.get(/^[^.]+$/, autoRenderView)

	// Redirect all POSTs to GETs - this allows users to use POST for autoStoreData
	// This needs to come after all other POST handlers and before the 404 handler
	app.post('/{*splat}', (request, response) => {
		response.redirect(request.originalUrl)
	})

	app.use(pageNotFound)

	app.use(errorHandler)

	return app
}

export default getApp
