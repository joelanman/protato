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

// Display error
// We override the default handler because we want to customise
// how the error appears to users, we want to show a simplified
// message without the stack trace.

function errorHandler(err, request, response, next) {
	if (response.headersSent) {
		return next(err)
	}

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
		console.error(err.message)
		const html = managePrototypeNunjucks.render('server-error.njk', getErrorModel(err))
		response.send(html)
	}
}

export { errorHandler, notFound, pageNotFound }
