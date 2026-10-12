import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import session from 'express-session'

import { getPaths } from '../paths.js'

let sessionDataDefaults = {}

async function init(app) {
	const paths = getPaths()

	// Get session default data from file

	const sessionDataDefaultsFile = path.join(paths.app, 'data', 'session-data-defaults.js')

	if (fs.existsSync(sessionDataDefaultsFile)) {
		try {
			sessionDataDefaults = (await import(pathToFileURL(sessionDataDefaultsFile).href)).default
		} catch (error) {
			console.error('Error loading session data defaults: ' + error.message)
		}
	}

	app.use(
		session({
			secret: 'keyboard cat',
			resave: false,
			saveUninitialized: true,
			cookie: {
				secure: false // update this in production
			}
		})
	)
}

// store data from POST body or GET query in session

function storeData(input, data) {
	for (const name in input) {
		// any input where the name starts with _ is ignored

		if (name.startsWith('_')) {
			continue
		}

		let value = input[name]

		// delete values when users unselect checkboxes

		if (value === '_unchecked') {
			delete data[name]
			continue
		}

		// remove _unchecked from arrays of checkboxes

		if (Array.isArray(value)) {
			value = value.filter((item) => item !== '_unchecked')
		} else if (typeof value === 'object' && value !== null) {
			// store nested objects that aren't arrays

			if (typeof data[name] !== 'object' || data[name] === null) {
				data[name] = {}
			}

			// add nested values

			storeData(value, data[name])
			continue
		}

		data[name] = value
	}
}

// middleware - store any data sent in session, and pass it to all views

function autoStoreData(request, response, next) {
	if (!request.session.data) {
		request.session.data = {}
	}
	response.locals.data = {}

	request.session.data = Object.assign({}, sessionDataDefaults, request.session.data)

	storeData(request.body, request.session.data)
	storeData(request.query, request.session.data)

	// send session data to all views

	for (const name in request.session.data) {
		response.locals.data[name] = request.session.data[name]
	}

	next()
}

function clearCache() {
	sessionDataDefaults = {}
}

export default {
	init,
	autoStoreData,
	clearCache
}
