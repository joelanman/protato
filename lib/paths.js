import path from 'node:path'

const getPaths = () => {
	const paths = {
		sass: {},
		views: {}
	}

	paths.package = path.join(import.meta.dirname, '..')

	paths.project = process.cwd()
	paths.tmp = path.join(paths.project, '.tmp')
	paths.app = path.join(paths.project, 'app')
	paths.assets = path.join(paths.app, 'assets')
	paths.config = path.join(paths.app, 'config.json')

	paths.sass.project = path.join(paths.app, 'assets/sass/application.scss')
	paths.sass.settings = path.join(paths.app, 'assets/sass/settings.scss')

	paths.public = path.join(paths.tmp, 'public')
	paths.stylesheets = path.join(paths.public, 'stylesheets')

	paths.views.tmp = path.join(paths.tmp, 'views')
	paths.views.project = path.join(paths.app, 'views')

	return paths
}

export { getPaths }
