// Sets up the parts every manage app shares: the manage Nunjucks views and the
// static assets. Keeping them together stops the two apps drifting apart.

import express from 'express'
import { getPaths } from '../lib/paths.js'
import managePrototypeNunjucks from './nunjucks.js'
import { govukFrontendStaticPath, publicStaticPath } from './paths.js'

function configureManageApp(app) {
	const paths = getPaths()

	managePrototypeNunjucks.configure(app)

	app.use(publicStaticPath, express.static(paths.managePrototype.public))
	app.use(govukFrontendStaticPath, express.static(paths.managePrototype.govukFrontend))
}

export { configureManageApp }
