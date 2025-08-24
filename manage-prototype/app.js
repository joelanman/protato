// manage prototype - app

import express from 'express'

import { getInternalNunjucksEnv } from '../lib/internal-renderer.js'
import { getPaths } from '../lib/paths.js'

const getManagePrototypeApp = () => {
	const paths = getPaths()
	const app = express()

	// serve manage prototype assets

	app.use('/public', express.static(paths.internal.public))
	app.use('/govuk-frontend', express.static(paths.internal.govukFrontend))

	// set up Nunjucks

	const internalNunjucksEnv = getInternalNunjucksEnv()

	app.set('view engine', 'njk')
	internalNunjucksEnv.express(app)

	app.get('/manage-prototype', (request, response) => {
		response.render('home')
	})

	return app
}

export { getManagePrototypeApp }
