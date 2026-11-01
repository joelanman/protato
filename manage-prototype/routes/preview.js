// Template preview
//
// Rendered by the prototype app (lib/app.js), not the manage app, so pages
// render with the same views, layouts, macros, filters and locals as a real
// prototype page. This is the one manage path the dev server proxies to the
// prototype process.

import plugins from '../../lib/plugins.js'

const templatePreviewPath = '/manage-prototype/templates/view'

function templatePreview(request, response, next) {
	const { packageName, templatePath } = request.query
	const filePath = plugins.getTemplateFilePath(packageName, templatePath)

	if (!filePath) {
		return next()
	}

	response.render(`${packageName}${templatePath}`)
}

export { templatePreviewPath }
export default templatePreview
