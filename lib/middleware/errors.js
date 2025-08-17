import { getInternalRenderer } from '../../manage-prototype/app.js'
import { getErrorModel } from '../utils/error-model.js'

let internalRenderer

// Catch 404 and forward to error handler
function pageNotFound(request, response, next) {
	const err = new Error(`Page not found: ${decodeURI(request.path)}`)
	err.status = 404
	next(err)
}

// Display error
// We override the default handler because we want to customise
// how the error appears to users, we want to show a simplified
// message without the stack trace.

function errorHandler(err, request, response, next) {
	if (!internalRenderer) {
		internalRenderer = getInternalRenderer()
	}

	if (response.headersSent) {
		return next(err)
	}

	if (err.status === 404) {
		const path = request.path
		response.status(404)
		const html = internalRenderer.render('page-not-found.njk', { path })
		response.send(html)
	} else {
		response.status(500)
		console.error(err.message)
		const html = internalRenderer.render('server-error.njk', getErrorModel(err))
		response.send(html)
	}
}

export { pageNotFound, errorHandler }
