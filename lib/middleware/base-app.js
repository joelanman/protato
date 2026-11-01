// The middleware both the prototype app and its error app need before any
// request reaches manage prototype: body parsing, the session, auth in
// production, and the manage app itself.

import bodyParser from 'body-parser'

import managePrototype from '../../manage-prototype/index.js'
import { getConfig } from '../config.js'
import { checkAuth } from './auth.js'
import session from './session.js'

async function addBaseAppMiddleware(app) {
	const config = getConfig()

	// in production, HTTPS is terminated by a proxy, so trust its forwarded headers
	if (config.env === 'production') {
		app.set('trust proxy', 1)
	}

	app.use(bodyParser.json())
	app.use(
		bodyParser.urlencoded({
			extended: true
		})
	)

	await session.init(app)

	if (config.env === 'production') {
		app.use(checkAuth)
	}

	app.use('/manage-prototype', managePrototype.getManagePrototypeApp())
}

export { addBaseAppMiddleware }
