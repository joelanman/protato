import path from 'node:path'

// tests pass the roots, so they can use the real paths instead of a copy
const getPaths = (projectPath = process.cwd(), packagePath = path.join(import.meta.dirname, '..')) => {
	const paths = {}

	paths.package = packagePath

	paths.project = projectPath
	paths.env = path.join(paths.project, '.env')
	paths.packageLockFile = path.join(paths.project, 'package-lock.json')
	paths.app = path.join(paths.project, 'app')
	paths.assets = path.join(paths.app, 'assets')
	paths.config = path.join(paths.app, 'config.json')
	paths.filters = path.join(paths.app, 'filters.js')
	paths.functions = path.join(paths.app, 'functions.js')
	paths.routes = path.join(paths.app, 'routes.js')
	paths.sass = path.join(paths.app, 'assets/sass')
	paths.sessionDataDefaults = path.join(paths.app, 'data', 'session-data-defaults.js')
	paths.views = path.join(paths.app, 'views')

	paths.tmp = path.join(paths.project, '.tmp')
	paths.public = path.join(paths.tmp, 'public')
	paths.stylesheets = path.join(paths.public, 'stylesheets')
	paths.sessions = path.join(paths.tmp, 'sessions')

	paths.managePrototype = {
		views: path.join(paths.package, 'manage-prototype', 'views'),
		sass: path.join(paths.package, 'manage-prototype', 'assets', 'sass'),
		govukFrontend: path.join(paths.package, 'node_modules', 'govuk-frontend'),
		govukFrontendViews: path.join(paths.package, 'node_modules', 'govuk-frontend', 'dist'),
		public: path.join(paths.package, 'manage-prototype', 'public')
	}

	return paths
}

export { getPaths }
