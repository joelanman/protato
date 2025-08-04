import { getConfig } from './config.js'

let config

function isPublicPath(requestPath) {
	return (
		requestPath === '/manage-prototype/password' ||
		requestPath.startsWith('/manage-prototype/public') ||
		requestPath.startsWith('/manage-prototype/govuk-frontend')
	)
}

function auth(request, response, next) {
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

function getAuth() {
	config = getConfig()
	return auth
}

export { getAuth }
