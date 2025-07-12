import path from 'node:path'

const paths = {
	public: {},
	sass: {},
	views: {}
}

paths.project = process.cwd()
paths.tmp = path.join(paths.project, '.tmp')
paths.app = path.join(paths.project, 'app')

paths.sass.project = path.join(paths.app, 'assets/sass/application.scss')
paths.sass.govukFrontend = path.join(paths.project, 'node_modules/govuk-frontend/dist/govuk-prototype-kit/init.scss')

paths.public.root = path.join(paths.tmp, 'public')
paths.public.stylesheets = path.join(paths.public.root, 'stylesheets')

paths.views.project = path.join(paths.app, 'views')
paths.views.govukPrototypeKit = path.join(import.meta.dirname, '../views')
paths.views.govukFrontend = path.join(paths.project, 'node_modules/govuk-frontend/dist')

export default paths
