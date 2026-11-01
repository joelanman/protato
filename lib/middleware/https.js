import { getConfig } from '../config.js'

// 302 temporary, because turning HTTPS off is supported
function forceHttps(request, response, next) {
	if (request.protocol === 'https') {
		return next()
	}

	console.log('Redirecting request to https')
	response.redirect(302, 'https://' + request.get('Host') + request.originalUrl)
}

// In production HTTPS is terminated by a proxy, so trust its forwarded headers
// before reading the protocol. Without a proxy there is nothing to trust, and
// using this with USE_HTTPS=false would still mark every request as secure.
function addHttpsMiddleware(app) {
	const config = getConfig()

	if (!config.isSecure) {
		return
	}

	app.set('trust proxy', 1)
	app.use(forceHttps)
}

export { addHttpsMiddleware, forceHttps }
