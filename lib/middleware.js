function renderPath(path, response, next) {
	// Try to render the path
	response.render(path, (error, html) => {
		if (!error) {
			// Success - send the response
			response.set({ 'Content-type': 'text/html; charset=utf-8' })
			response.end(html)
			return
		}
		if (error.message.startsWith('template not found')) {
			if (!path.endsWith('/index')) {
				// Maybe it's a folder - try to render [path]/index
				renderPath(path + '/index', response, next)
				return
			} else {
				// We got template not found both times
				// call next to trigger the 404 page
				next()
				return
			}
		}
		// We got an error other than template not found
		// call next with the error
		next(error)
	})
}

function autoRenderView(request, response, next) {
	// Decode any encoded chars, and normalise any unicode
	let path = decodeURI(request.path).normalize()

	// Remove the first slash, render won't work with it
	path = path.substring(1)

	// If it's blank, render the root index
	if (path === '') {
		path = 'index'
	}

	renderPath(path, response, next)
}

// Redirect all POSTs to GETs - this allows users to use POST for autoStoreData
function postRedirectGet(request, response) {
	try {
		// Redirect the user to the original URL with the same query parameters
		response.redirect(request.originalUrl)
	} catch (error) {
		// Handle any errors that occur during redirection
		console.error('Error during redirect:', error)
		response.status(500).send('Internal Server Error')
	}
}

export {
	autoRenderView,
	postRedirectGet
}
