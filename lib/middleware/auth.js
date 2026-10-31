import { managePath, passwordPagePath, publicPathPrefixes, publicPaths } from '../../manage-prototype/paths.js'
import { getConfig } from '../config.js'

// The password page and the assets it needs render before anyone is signed in.
// The paths come from manage-prototype/paths.js, so they cannot drift from the
// ones the manage apps serve.
function isPublicPath(requestPath) {
	return publicPaths.includes(requestPath) || publicPathPrefixes.some((prefix) => requestPath.startsWith(prefix))
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
		response.redirect(managePath(passwordPagePath) + '?returnURL=' + returnURL)
	}
}

export { checkAuth }
