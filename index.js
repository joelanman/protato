const express = require('express')

let app = null

const init = (appInstance) => {
	app = appInstance
}

const requests = {
	setupRouter: (path = '/') => {
		const router = express.Router()
		app.use(path, router)
		return router
	}
}

module.exports = {
	init,
	requests
}
