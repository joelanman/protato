import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { getPaths } from '../../lib/paths.js'
import plugins from '../../lib/plugins.js'
import { templateNotFound } from '../template-not-found.js'

const router = express.Router()

const invalidChars = "!$&'()*+,;=:?#[]@.% "

// Returns the problem with the path, or nothing if it's usable
function getPathError(newPagePath) {
	if (!newPagePath.length) {
		return 'Enter a path'
	}

	if (invalidChars.split('').some((c) => newPagePath.includes(c))) {
		return `Path must not include ${invalidChars.trim()} or space`
	}
}

// Previews are rendered by the prototype app (see routes/preview.js), not here,
// so the page looks like a real page

// templates list
router.get('/', (request, response) => {
	response.render('templates/index', {
		pageName: 'Templates',
		templatesByPlugin: plugins.getTemplatesByPlugin()
	})
})

// create page from template - form
router.get('/create', (request, response, next) => {
	const { packageName, templatePath } = request.query
	const templateConfig = plugins.getTemplate(packageName, templatePath)
	if (!templateConfig) {
		return next(templateNotFound(packageName, templatePath))
	}

	response.render('templates/create', {
		pageName: `Create new ${templateConfig.name}`,
		error: request.query.error,
		newPagePath: request.query.newPagePath
	})
})

// create page from template - submit
router.post('/create', (request, response, next) => {
	const { packageName, templatePath } = request.query
	const templateFilePath = plugins.getTemplateFilePath(packageName, templatePath)
	if (!templateFilePath) {
		return next(templateNotFound(packageName, templatePath))
	}

	let newPagePath = (request.body.newPagePath || '')
		.trim()
		.replace(/\/{2,}/g, '/')
		.replace(/\/$/, '')

	const pathError = getPathError(newPagePath)

	if (pathError) {
		const query = new URLSearchParams({
			packageName,
			templatePath,
			newPagePath,
			error: pathError
		})
		return response.redirect(`/manage-prototype/templates/create?${query.toString()}`)
	}

	// the page is linked to by its absolute path, so always start with a slash
	if (!newPagePath.startsWith('/')) {
		newPagePath = `/${newPagePath}`
	}

	const paths = getPaths()
	const filePath = path.join(paths.views, `${newPagePath}.html`)

	if (fs.existsSync(filePath)) {
		const query = new URLSearchParams({
			packageName,
			templatePath,
			newPagePath,
			error: 'Path already exists'
		})
		return response.redirect(`/manage-prototype/templates/create?${query.toString()}`)
	}

	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.copyFileSync(templateFilePath, filePath)

	response.redirect(`/manage-prototype/templates/created?newPagePath=${encodeURIComponent(newPagePath)}`)
})

// template created confirmation
router.get('/created', (request, response) => {
	let newPagePath = (request.query.newPagePath || '')
		.trim()
		.replace(/\/{2,}/g, '/')
		.replace(/\/$/, '')

	const pathError = getPathError(newPagePath)
	if (pathError) {
		return response.status(400).send(pathError)
	}

	// the page is linked to by its absolute path, so always start with a slash
	if (!newPagePath.startsWith('/')) {
		newPagePath = `/${newPagePath}`
	}

	response.render('templates/created', {
		pageName: 'Page created',
		newPagePath,
		filePath: `app/views${newPagePath}.html`
	})
})

export default router
