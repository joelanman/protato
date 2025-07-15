import fs from 'node:fs'
import path from 'node:path'

import express from 'express'

import getPaths from './paths.js'

const paths = getPaths()

function getPlugins() {
	const plugins = {}

	const packagePath = path.join(paths.project, 'package.json')
	const projectPackage = JSON.parse(fs.readFileSync(packagePath))
	const dependencies = Object.keys(projectPackage.dependencies)

	dependencies.forEach((dependency) => {
		const configPath = path.join(paths.project, 'node_modules', dependency, 'govuk-prototype-kit.config.json')
		if (!fs.existsSync(configPath)) {
			return
		}
		plugins[dependency] = JSON.parse(fs.readFileSync(configPath))
	})

	return plugins
}

function serveAssets(app) {
	const plugins = getPlugins()
	for (const plugin in plugins) {
		const config = plugins[plugin]
		if (config.assets) {
			config.assets.forEach((assetPath) => {
				const assetServerPath = `/plugin-assets/${plugin}${assetPath}`
				const assetFilePath = path.join(paths.project, 'node_modules', plugin, assetPath)
				app.use(assetServerPath, express.static(assetFilePath))
			})
		}
	}
}

export default {
	serveAssets
}
