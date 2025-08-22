import nunjucks from 'nunjucks'
import { getConfig } from './config.js'
import { getPaths } from './paths.js'

let internalNunjucksEnv

function getInternalNunjucksEnv() {
	if (internalNunjucksEnv) return internalNunjucksEnv
	const config = getConfig()
	const paths = getPaths()
	const views = [paths.internal.views, paths.internal.govukFrontendViews]

	const nunjucksConfig = {
		autoescape: true,
		noCache: true,
		watch: false
	}

	if (config.env === 'development') {
		nunjucksConfig.watch = true
	}

	internalNunjucksEnv = nunjucks.configure(views, nunjucksConfig)

	const managePrototypePort = config.port
	const livereloadURL = `http://localhost:${managePrototypePort}/manage-prototype/livereload`
	internalNunjucksEnv.addGlobal('protato', { livereloadURL })
	internalNunjucksEnv.addGlobal('assetPath', '/manage-prototype/govuk-frontend/assets')

	return internalNunjucksEnv
}

export { getInternalNunjucksEnv }
