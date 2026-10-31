// Template preview
//
// Rendered by the prototype app (lib/app.js), not a manage app, so pages render
// with the same views, layouts, macros, filters and locals as a real prototype
// page. index.js adds this path to proxyPaths, which is how the dev server
// knows to proxy it here.

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
