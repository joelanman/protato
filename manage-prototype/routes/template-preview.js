// Template previews are mounted by the prototype app (lib/app.js), not the
// manage prototype app, so pages render with the same views, layouts, macros,
// filters and locals as a real prototype page.

import { notFound } from '../../lib/middleware/errors.js'
import plugins from '../../lib/plugins.js'

// The dev server proxies this path to the prototype app
const templatePreviewPath = '/manage-prototype/templates/view'

function templatePreview(request, response, next) {
	const { packageName, templatePath } = request.query
	const filePath = plugins.getTemplateFilePath(packageName, templatePath)

	if (!filePath) {
		const reason = templatePath ? `There is no template at ${templatePath}.` : 'That template could not be found.'

		return next(notFound(`Template not found: ${packageName} ${templatePath}`, reason))
	}

	response.render(`${packageName}${templatePath}`)
}

export { templatePreviewPath }
export default templatePreview
