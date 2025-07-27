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
		response.locals.error = request.query.error
		response.locals.returnURL = request.query.returnURL
		response.render('password')
	})

	function getSafeReturnURL(returnURL = '/') {
		if (
			typeof returnURL === 'string' &&
			returnURL.startsWith('/') &&
			!returnURL.startsWith('/manage-prototype/password') &&
			!returnURL.startsWith('//')
		) {
			return returnURL
		} else {
			return '/'
		}
	}

	app.post('/password', (request, response) => {
		if (request.body.password === config.password) {
			request.session.password = config.password
			const returnURL = getSafeReturnURL(request.body.returnURL)
			response.redirect(returnURL)
		} else {
			const returnURL = encodeURIComponent(request.body.returnURL)
			response.redirect('/manage-prototype/password?error=wrong-password&returnURL=' + returnURL)
		}
	})

	return app
}

export default getApp
