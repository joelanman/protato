import path from 'node:path'

const getPaths = () => {
	const paths = {
		public: {},
		sass: {},
		views: {}
	}

	paths.package = path.join(import.meta.dirname, '..')

	paths.project = process.cwd()
	paths.tmp = path.join(paths.project, '.tmp')
	paths.app = path.join(paths.project, 'app')
	paths.config = path.join(paths.app, 'config.json')

	paths.sass.project = path.join(paths.app, 'assets/sass/application.scss')
	paths.sass.settings = path.join(paths.app, 'assets/sass/settings.scss')
	paths.sass.legacyPatterns = path.join(paths.package, 'assets/sass/legacy-patterns.scss')

	paths.public.root = path.join(paths.tmp, 'public')
	paths.public.stylesheets = path.join(paths.public.root, 'stylesheets')

	paths.views.tmp = path.join(paths.tmp, 'views')
	paths.views.project = path.join(paths.app, 'views')
	return paths
}

export default getPaths
