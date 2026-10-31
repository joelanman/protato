import path from 'node:path'

const getPaths = () => {
	const paths = {}

	paths.package = path.join(import.meta.dirname, '..')

	paths.project = process.cwd()
	paths.env = path.join(paths.project, '.env')
	paths.packageLockFile = path.join(paths.project, 'package-lock.json')
	paths.app = path.join(paths.project, 'app')
	paths.assets = path.join(paths.app, 'assets')
	paths.config = path.join(paths.app, 'config.json')
	paths.sass = path.join(paths.app, 'assets/sass')
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
