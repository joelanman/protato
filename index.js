import express from 'express'

let app = null
let nunjucksEnv = null

const init = (appInstance, nunjucksEnvInstance) => {
	app = appInstance
	nunjucksEnv = nunjucksEnvInstance
}

const requests = {
	setupRouter: (path = '/') => {
		const router = express.Router()
		app.use(path, router)
		return router
	}
}

const views = {
	addFilter: (name, filter) => {
		nunjucksEnv.addFilter(name, filter)
	},
	getFilter: (name) => {
		return nunjucksEnv.getFilter(name)
	}
}

export default {
	init,
	requests,
	views
}
