// Redirect all POSTs to GETs - this allows users to use POST for autoStoreData

function postRedirectGet(request, response) {
	response.redirect(request.originalUrl)
}

export { postRedirectGet }
