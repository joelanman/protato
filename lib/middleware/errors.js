import managePrototypeNunjucks from '../../manage-prototype/nunjucks.js'
import { getErrorModel } from '../utils/error-model.js'

// Creates an error that the error handler renders as the "page not found" page.
// 'message' is for logs, 'reason' is what we show the user on the page.
function notFound(message, reason) {
	const err = new Error(message)
	err.status = 404
	err.reason = reason
	return err
}

// Catch 404 and forward to error handler
function pageNotFound(request, response, next) {
	next(notFound(`Page not found: ${decodeURI(request.path)}`))
}

// Renders the page for an error. Expected errors (a 404 or a CSRF failure) are
// never logged; set logError for unexpected ones. Callers that have already
// reported the error, such as the prototype server's build error app, leave it
// off so every request does not log it again.
function renderErrorPage(err, request, response, { logError = false } = {}) {
	if (err.status === 404) {
		response.status(404)
		const html = managePrototypeNunjucks.render('page-not-found.njk', {
			path: request.path,
			reason: err.reason
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

// Display error
// We override the default handler because we want to customise
// how the error appears to users, we want to show a simplified
// message without the stack trace.

function errorHandler(err, request, response, next) {
	if (response.headersSent) {
		return next(err)
	}

	renderErrorPage(err, request, response, { logError: true })
}

export { errorHandler, pageNotFound, renderErrorPage }
