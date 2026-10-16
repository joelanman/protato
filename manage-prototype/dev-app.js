// manage prototype - dev app
//
// Sub-app mounted by the dev server at /manage-prototype.

import express from 'express'
import livereload from '../lib/livereload.js'
import { getPaths } from '../lib/paths.js'
import managePrototypeNunjucks from './nunjucks.js'

const getManagePrototypeDevApp = () => {
	const app = express()
	const paths = getPaths()

	managePrototypeNunjucks.configure(app)

	// static assets
	app.use('/public', express.static(paths.managePrototype.public))
	app.use('/govuk-frontend', express.static(paths.managePrototype.govukFrontend))

	// dev manage UI
	app.get('/', (request, response) => {
		response.render('home')
	})

	// live reload
	app.get('/livereload', livereload.getRoute())

	return app
}

export { getManagePrototypeDevApp }
