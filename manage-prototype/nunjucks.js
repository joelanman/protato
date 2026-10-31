import nunjucks from 'nunjucks'
import { getConfig } from '../lib/config.js'
import { getPaths } from '../lib/paths.js'
import { govukFrontendStaticPath, managePath } from './paths.js'

let nunjucksEnv

function getEnv() {
	if (nunjucksEnv) return nunjucksEnv
	const config = getConfig()
	const paths = getPaths()
	const views = [paths.managePrototype.views, paths.managePrototype.govukFrontendViews]

	const nunjucksConfig = {
		autoescape: true,
		noCache: true,
		watch: false
	}

	if (config.env === 'development') {
		nunjucksConfig.watch = true
	}

	nunjucksEnv = nunjucks.configure(views, nunjucksConfig)

	nunjucksEnv.addGlobal('assetPath', `${managePath(govukFrontendStaticPath)}/dist/govuk/assets`)
	nunjucksEnv.addGlobal('serviceName', config.serviceName)
	nunjucksEnv.addGlobal('isDevelopment', config.env === 'development')

	return nunjucksEnv
}

function configure(app) {
	const env = getEnv()
	app.set('view engine', 'njk')
	env.express(app)
	return env
}

function render(view, context) {
	return getEnv().render(view, context)
}

export default { configure, render }
export { configure, render }
