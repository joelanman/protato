import { getErrorModel } from './error-model.js'
import managePrototypeNunjucks from './nunjucks.js'

// request.path is relative to the mount point, so add baseUrl back to get the
// path the user actually asked for.
function requestedPath(request) {
	const baseUrl = request.baseUrl || ''
	return baseUrl + request.path
}

// Catch 404 and forward to error handler
function pageNotFound(request, response, next) {
	const err = new Error(`Page not found: ${decodeURI(requestedPath(request))}`)
	err.status = 404
	next(err)
}

// Renders the page for an error. A 404 or a CSRF failure is expected, so never
// logged; logError covers everything else. A caller that already reported the
// error leaves it off, so every request does not log it again.
//
// Rendered through the Nunjucks environment, not response.render: the prototype
// app installs this too, and its view roots are not these.
function renderErrorPage(err, request, response, { logError = false } = {}) {
	if (err.status === 404) {
		response.status(404)
		const html = managePrototypeNunjucks.render('page-not-found.njk', {
			path: requestedPath(request)
		})
		response.send(html)
	} else if (err.code === 'EBADCSRFTOKEN') {
		// CSRF failures land here, from manage-prototype/csrf.js
		response.status(403)
		const html = managePrototypeNunjucks.render('form-expired.njk')
		response.send(html)
	} else {
		if (logError) {
			console.error(err.message)
		}
		response.status(500)
		const html = managePrototypeNunjucks.render('server-error.njk', getErrorModel(err))
		response.send(html)
	}
}

// Overrides express's default handler, which sends a stack trace.
function errorHandler(err, request, response, next) {
	if (response.headersSent) {
		return next(err)
	}

	renderErrorPage(err, request, response, { logError: true })
}

export { errorHandler, pageNotFound, renderErrorPage }
