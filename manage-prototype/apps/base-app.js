// The base of every manage app: Express, the manage Nunjucks views and the
// static assets. Keeping it in one place stops the apps drifting apart.

import express from 'express'
import { getPaths } from '../../lib/paths.js'
import managePrototypeNunjucks from '../nunjucks.js'

function createBaseApp() {
	const app = express()
	const paths = getPaths()

	managePrototypeNunjucks.configure(app)

	app.use('/public', express.static(paths.managePrototype.public))
	app.use('/govuk-frontend', express.static(paths.managePrototype.govukFrontend))

	return app
}

export { createBaseApp }
