import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import session from 'express-session'

import { getConfig } from '../config.js'
import { getPaths } from '../paths.js'
import FileStore from './session-store.js'

const SESSION_MAX_AGE = 4 * 60 * 60 * 1000

let sessionDataDefaults = {}

async function init(app) {
	const paths = getPaths()
	const config = getConfig()

	// Get session default data from file

	const sessionDataDefaultsFile = path.join(paths.app, 'data', 'session-data-defaults.js')

	if (fs.existsSync(sessionDataDefaultsFile)) {
		try {
			sessionDataDefaults = (await import(pathToFileURL(sessionDataDefaultsFile).href)).default
		} catch (error) {
			console.error('Error loading session data defaults: ' + error.message)
		}
	}

	const store = new FileStore(paths.sessions)

	app.use(
		session({
			secret: 'keyboard cat',
			resave: false,
			saveUninitialized: false,
			store,
			cookie: {
				maxAge: SESSION_MAX_AGE,
				secure: config.env === 'production'
			}
		})
	)
}

// store data from POST body or GET query in session

function storeData(input, data) {
	let hasInput = false

	for (const [name, value] of Object.entries(input)) {
		// any input where the name starts with _ is ignored
		if (name.startsWith('_')) {
			continue
		}

		hasInput = true

		// delete values when users unselect checkboxes
		if (value === '_unchecked') {
			delete data[name]
			continue
		}

		// remove _unchecked from arrays of checkboxes
		if (Array.isArray(value)) {
			data[name] = value.filter((item) => item !== '_unchecked')
			continue
		}

		// store nested objects by recursing into them
		if (typeof value === 'object' && value !== null) {
			// make sure data[name] is an object to merge nested values into
			if (typeof data[name] !== 'object' || data[name] === null) {
				data[name] = {}
			}

			storeData(value, data[name])
			continue
		}

		data[name] = value
	}

	return hasInput
}

// middleware - store any data sent in session, and pass it to all views

// Manage prototype has its own forms and its own data. Its pages are mounted
// before this middleware, but a manage path that falls through must not write
// into the prototype's session data either.
function isManagePrototypeRequest(request) {
	const url = request.originalUrl ?? request.path ?? ''
	return url === '/manage-prototype' || url.startsWith('/manage-prototype/')
}

function autoStoreData(request, response, next) {
	if (isManagePrototypeRequest(request)) {
		next()
		return
	}

	const data = { ...structuredClone(sessionDataDefaults), ...request.session.data }
	const input = { ...request.body, ...request.query }

	// don't create an empty session for requests with no input
	if (storeData(input, data)) {
		request.session.data = data
	}

	// send session data to all views
	response.locals.data = data

	next()
}

// for tests - reset the session data defaults loaded by init
function clearCache() {
	sessionDataDefaults = {}
}

export default {
	init,
	autoStoreData,
	clearCache
}
