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
	addFilter(name, func, config = {}) {
		if (config.renderAsHtml) {
			const safe = nunjucksEnv.getFilter('safe')
			const originalFunc = func
			func = (...args) => safe(originalFunc(...args))
		}
		nunjucksEnv.addFilter(name, func)
	},
	getFilter: (name) => {
		return nunjucksEnv.getFilter(name)
	},
	addFunction: (name, func) => {
		nunjucksEnv.addGlobal(name, func)
	},
	getFunction: (name) => {
		return nunjucksEnv.getGlobal(name)
	}
}

export default {
	init,
	requests,
	views
}
