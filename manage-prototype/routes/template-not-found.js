import { notFound } from '../../lib/middleware/errors.js'

// The 404 shown by both the template preview and the create page when the
// template named in the query string cannot be found.
function templateNotFound(packageName, templatePath) {
	const reason = templatePath ? `There is no template at ${templatePath}.` : 'That template could not be found.'

	return notFound(`Template not found: ${packageName} ${templatePath}`, reason)
}

export { templateNotFound }
