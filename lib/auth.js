import { getConfig } from './config.js'

let config

function auth(request, response, next) {
	if (!config.password) {
		console.error('password is not set')
		response.send('Error: password is not set')
	} else if (
		request.path === '/manage-prototype/password' ||
		request.path.startsWith('/manage-prototype/public') ||
		request.path.startsWith('/manage-prototype/govuk-frontend')
	) {
		next()
	} else if (request.session.password === config.password) {
		next()
	} else {
		response.redirect('/manage-prototype/password')
	}
}

function getAuth() {
	config = getConfig()
	return auth
}

export { getAuth }
