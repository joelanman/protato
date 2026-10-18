import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '../paths.js'

// Only pages in the project's app/views are auto-rendered. Other view roots
// (plugins, node_modules) are for includes, extends and template previews.
function isAppView(viewPath) {
	const viewsDir = getPaths().views
	const filePath = path.resolve(viewsDir, `${viewPath}.html`)

	return filePath.startsWith(viewsDir + path.sep) && fs.existsSync(filePath)
}

function renderPath(viewPath, response, next) {
	if (!isAppView(viewPath)) {
		if (viewPath.endsWith('/index')) {
			// We got no app view both times
			// call next to trigger the 404 page
			next()
			return
		}

		// Maybe it's a folder - try to render [path]/index
		renderPath(viewPath + '/index', response, next)
		return
	}

	response.render(viewPath, (error, html) => {
		if (error) {
			// Rendering failed - let the error handler deal with it
			next(error)
			return
		}

		// Success - send the response
		response.set({ 'Content-type': 'text/html; charset=utf-8' })
		response.end(html)
	})
}

function autoRenderView(request, response, next) {
	// Decode any encoded chars, and normalise any unicode
	let viewPath = decodeURI(request.path).normalize()

	// Remove the first slash, render won't work with it
	viewPath = viewPath.substring(1)

	// If it's blank, render the root index
	if (viewPath === '') {
		viewPath = 'index'
	}

	renderPath(viewPath, response, next)
}

export default autoRenderView
export { isAppView }
