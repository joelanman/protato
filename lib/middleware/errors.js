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

// Renders the page for an error, without logging it. Callers that have already
// reported the error, such as the prototype server's build error app, can use
// this directly.
function renderErrorPage(err, request, response) {
	if (err.status === 404) {
		response.status(404)
		const html = managePrototypeNunjucks.render('page-not-found.njk', {
			path: request.path,
			reason: err.reason
		})
		response.send(html)
	} else if (err.code === 'EBADCSRFTOKEN') {
		// CSRF failures land here, from lib/middleware/csrf.js
		response.status(403)
		const html = managePrototypeNunjucks.render('form-expired.njk')
		response.send(html)
	} else {
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

	// 404s and CSRF failures are expected, so only unexpected errors are logged
	const isExpectedError = err.status === 404 || err.code === 'EBADCSRFTOKEN'
	if (!isExpectedError) {
		console.error(err.message)
	}

	renderErrorPage(err, request, response)
}

export { errorHandler, notFound, pageNotFound, renderErrorPage }
