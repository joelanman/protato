// The manage pages that need the prototype's session. Mounted by
// manage-prototype/index.js in production and development.

import express from 'express'

import { getConfig } from '../../lib/config.js'

const router = express.Router()

function getSafeReturnURL(returnURL = '/') {
	if (
		typeof returnURL === 'string' &&
		returnURL.startsWith('/') &&
		!returnURL.startsWith('/manage-prototype/password') &&
		!returnURL.startsWith('//')
	) {
		return returnURL
	}
	return '/'
}

router.get('/clear-data', (request, response) => {
	response.render('clear-data')
})

router.post('/clear-data', (request, response) => {
	request.session.data = {}
	response.render('clear-data-success')
})

router.get('/password', (request, response) => {
	response.render('password', {
		error: request.query.error,
		returnURL: request.query.returnURL
	})
})

router.post('/password', (request, response) => {
	const password = request.body.password

	if (getConfig().passwords.includes(password)) {
		request.session.password = password
		response.redirect(getSafeReturnURL(request.body.returnURL))
	} else {
		const returnURL = encodeURIComponent(request.body.returnURL)
		response.redirect('/manage-prototype/password?error=wrong-password&returnURL=' + returnURL)
	}
})

export default router
