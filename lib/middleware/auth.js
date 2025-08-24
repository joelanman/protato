import { getConfig } from '../config.js'
import { getInternalNunjucksEnv } from '../internal-renderer.js'

let config, internalNunjucksEnv

function getAuth() {
	config = getConfig()
	internalNunjucksEnv = getInternalNunjucksEnv()

	function isPublicPath(requestPath) {
		return (
			requestPath === '/manage-prototype/password' ||
			requestPath.startsWith('/manage-prototype/public') ||
			requestPath.startsWith('/manage-prototype/govuk-frontend')
		)
	}

	function checkAuth(request, response, next) {
		if (config.passwords.length === 0) {
			console.error('Error: password is not set')
			response.status(500).send('Error: password is not set')
		} else if (isPublicPath(request.path)) {
			next()
		} else if (config.passwords.includes(request.session.password)) {
			next()
		} else {
			const returnURL = encodeURIComponent(request.originalUrl)
			response.redirect('/manage-prototype/password?returnURL=' + returnURL)
		}
	}

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

	const password = {
		get: (request, response) => {
			const viewModel = {
				error: request.query.error,
				returnURL: request.query.returnURL
			}
			const html = internalNunjucksEnv.render('password.njk', viewModel)
			response.send(html)
		},
		post: (request, response) => {
			const password = request.body.password
			if (config.passwords.includes(password)) {
				request.session.password = password
				const returnURL = getSafeReturnURL(request.body.returnURL)
				response.redirect(returnURL)
			} else {
				const returnURL = encodeURIComponent(request.body.returnURL)
				response.redirect('/manage-prototype/password?error=wrong-password&returnURL=' + returnURL)
			}
		}
	}
	return {
		checkAuth,
		password
	}
}

export { getAuth }
