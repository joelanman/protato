import nunjucks from 'nunjucks'
import { getConfig } from '../lib/config.js'
import { getPaths } from '../lib/paths.js'

let nunjucksEnv

function getEnv() {
	if (nunjucksEnv) return nunjucksEnv
	const config = getConfig()
	const paths = getPaths()
	const views = [paths.managePrototype.views, paths.managePrototype.govukFrontendViews]

	// The manage views ship inside the Protato package, so a project gets them
	// cached: they only change with a new release. PROTATO_DEV comes from the
	// package's own .env, which only exists while Protato itself is being worked
	// on, so there the views are read from disk on every render. nunjucks' own
	// watcher (`watch`) stays off: re-rendering from disk is enough while
	// developing, and a watcher would be wrong in production.
	const nunjucksConfig = {
		autoescape: true,
		noCache: process.env.PROTATO_DEV === 'true',
		watch: false
	}

	nunjucksEnv = nunjucks.configure(views, nunjucksConfig)

	nunjucksEnv.addGlobal('assetPath', '/manage-prototype/govuk-frontend/dist/govuk/assets')
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
