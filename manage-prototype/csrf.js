// CSRF protection for the manage prototype forms.
//
// Uses csrf-csrf (the double submit cookie pattern, as the GOV.UK Prototype Kit
// does). The token is put in a cookie and in a hidden field in each form, and a
// POST is only accepted when they match. No server side state, so it works in
// the dev manage app, which has no session.

import cookieParser from 'cookie-parser'
import { doubleCsrf } from 'csrf-csrf'
import { getConfig } from '../lib/config.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// A fixed fallback means tokens survive restarts. Set CSRF_SECRET when the
// manage UI is reachable by anyone other than you, so token signatures cannot
// be forged using a secret that is in this repository.
const DEVELOPMENT_SECRET = 'protato-development-csrf-secret'

let utilities

function getUtilities() {
	if (utilities) {
		return utilities
	}

	const config = getConfig()

	utilities = doubleCsrf({
		getSecret: () => config.csrfSecret ?? DEVELOPMENT_SECRET,
		// The dev manage app has no session to identify the browser with. A
		// constant also means a token stays valid across a restart of either
		// server, and would let both servers share the one cookie if this is
		// ever mounted in the prototype app too.
		getSessionIdentifier: () => '',
		cookieName: 'protato.csrf',
		cookieOptions: {
			sameSite: 'lax',
			path: '/manage-prototype',
			secure: config.env === 'production',
			httpOnly: true
		},
		// forms are rendered by the server, so the token comes back in the body
		getCsrfTokenFromRequest: (request) => request.body?._csrf
	})

	return utilities
}

// Generates the token that views put in their form, and checks the token on
// submit. Mount it on both the form page and the page the form posts to.
function csrfProtection(request, response, next) {
	const { generateCsrfToken, doubleCsrfProtection } = getUtilities()

	if (SAFE_METHODS.has(request.method)) {
		response.locals.csrfToken = generateCsrfToken(request, response)
		return next()
	}

	doubleCsrfProtection(request, response, next)
}

// cookie-parser has to run before csrf-csrf, which reads request.cookies
const csrf = [cookieParser(), csrfProtection]

// for tests
function clearCache() {
	utilities = undefined
}

export { clearCache, csrf }
