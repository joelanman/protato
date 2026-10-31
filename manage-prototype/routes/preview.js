// Template preview
//
// Rendered by the prototype app (lib/app.js), not a manage app, so pages render
// with the same views, layouts, macros, filters and locals as a real prototype
// page. Listed in manage-prototype/index.js as a prototype route, which is how
// the dev server knows to proxy it.

import plugins from '../../lib/plugins.js'
import { templateNotFound } from './template-not-found.js'

function templatePreview(request, response, next) {
	const { packageName, templatePath } = request.query
	const filePath = plugins.getTemplateFilePath(packageName, templatePath)

	if (!filePath) {
		return next(templateNotFound(packageName, templatePath))
	}

	response.render(`${packageName}${templatePath}`)
}

export default templatePreview
