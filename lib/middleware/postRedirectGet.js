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

export { postRedirectGet }
