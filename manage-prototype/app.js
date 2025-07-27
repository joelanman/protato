// manage prototype - app

import express from 'express'
import nunjucks from 'nunjucks'

import { getConfig } from '../lib/config.js'
import { getPaths } from '../lib/paths.js'

const getApp = () => {
	const config = getConfig()
	const paths = getPaths()
	const app = express()

	// set up locals

	app.locals.assetPath = '/manage-prototype/govuk-frontend'

	// serve manage prototype assets

	app.use('/public', express.static(paths.managePrototype.public))
	app.use('/govuk-frontend', express.static(paths.managePrototype.govukFrontendAssets))

	// set up Nunjucks

	app.set('view engine', 'njk')

	const appViews = [paths.managePrototype.views, paths.managePrototype.govukFrontend]

	const nunjucksConfig = {
		autoescape: true,
		noCache: true,
		watch: false
	}

	if (config.env === 'development') {
		nunjucksConfig.watch = true
	}

	nunjucksConfig.express = app

	nunjucks.configure(appViews, nunjucksConfig)

	app.get('/password', (request, response) => {
		response.render('password')
	})

	app.post('/password', (request, response) => {
		if (request.body.password === config.password) {
			request.session.password = config.password
			response.redirect('/')
		} else {
			response.redirect('/manage-prototype/password?error=wrong-password')
		}
	})

	return app
}

export default getApp
