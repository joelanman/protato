import { getConfig } from '../config.js'

// The password page and the assets it needs must load before anyone signs in.
// The production end-to-end tests exercise these paths, so a renamed route or
// static mount fails there rather than silently locking people out.
function isPublicPath(requestPath) {
	return (
		requestPath === '/manage-prototype/password' ||
		requestPath.startsWith('/manage-prototype/public') ||
		requestPath.startsWith('/manage-prototype/govuk-frontend')
	)
}

function checkAuth(request, response, next) {
	const config = getConfig()

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

export { checkAuth }
