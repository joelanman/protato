import path from 'node:path'

import { getPaths } from '../lib/paths.js'

const getManagePaths = () => {
	const paths = getPaths()

	paths.managePrototype = {}

	paths.managePrototype.views = path.join(paths.package, 'manage-prototype', 'views')
	paths.managePrototype.sass = path.join(paths.package, 'manage-prototype', 'assets', 'sass')
	paths.managePrototype.govukFrontend = path.join(paths.package, 'node_modules', 'govuk-frontend')
	paths.managePrototype.govukFrontendViews = path.join(paths.package, 'node_modules', 'govuk-frontend', 'dist')
	paths.managePrototype.public = path.join(paths.package, 'manage-prototype', 'public')

	return paths
}

export { getManagePaths }
