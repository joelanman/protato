import path from 'node:path'
import session from 'express-session'
import { get } from 'radash'

import getPaths from './paths.js'

let sessionDataDefaults

async function init(app) {
	const paths = getPaths()

	// Get session default data from file

	const sessionDataDefaultsFile = path.join(paths.app, 'data', 'session-data-defaults.js')

	try {
		// revisit this - dynamic requires are much harder in es modules
		sessionDataDefaults = (await import(sessionDataDefaultsFile)).default
	} catch (err) {
		console.error(err)
		sessionDataDefaults = {}
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

// Store data from POST body or GET query in session
function storeData(input, data) {
	for (const name in input) {
		// any input where the name starts with _ is ignored
		if (name.startsWith('_')) {
			continue
		}

		let value = input[name]

		// Delete values when users unselect checkboxes
		if (value === '_unchecked') {
			delete data[name]
			continue
		}

		// Remove _unchecked from arrays of checkboxes
		if (Array.isArray(value)) {
			value = value.filter((item) => item !== '_unchecked')
		} else if (typeof value === 'object') {
			// Store nested objects that aren't arrays
			if (typeof data[name] !== 'object') {
				data[name] = {}
			}

			// Add nested values
			storeData(value, data[name])
			continue
		}

		data[name] = value
	}
}

// Middleware - store any data sent in session, and pass it to all views

function autoStoreData(request, response, next) {
	if (!request.session.data) {
		request.session.data = {}
	}
	response.locals.data = {}

	request.session.data = Object.assign({}, sessionDataDefaults, request.session.data)

	storeData(request.body, request.session.data)
	storeData(request.query, request.session.data)

	// Send session data to all views

	for (const name in request.session.data) {
		response.locals.data[name] = request.session.data[name]
	}

	next()
}

// Add Nunjucks function called 'checked' to populate radios and checkboxes
function addCheckedFunction(env) {
	env.addGlobal('checked', function (name, value) {
		// Check data exists
		if (this.ctx.data === undefined) {
			return ''
		}

		// Use string keys or object notation to support:
		// checked("field-name")
		// checked("['field-name']")
		// checked("['parent']['field-name']")

		const storedValue = get(this.ctx.data, name)

		// Check the requested data exists
		if (storedValue === undefined) {
			return ''
		}

		let checked = ''

		// If data is an array, check it exists in the array
		if (Array.isArray(storedValue)) {
			if (storedValue.includes(value)) {
				checked = 'checked'
			}
		} else {
			// The data is just a simple value, check it matches
			if (storedValue === value) {
				checked = 'checked'
			}
		}
		return checked
	})
}

export default {
	init,
	autoStoreData,
	addCheckedFunction
}
