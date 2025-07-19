import fs from 'node:fs'
import path from 'node:path'

import getPaths from './paths.js'

const paths = getPaths()

function getPlugins() {
	// to do cache this
	const plugins = []

	const packagePath = path.join(paths.project, 'package.json')
	const projectPackage = JSON.parse(fs.readFileSync(packagePath))
	const dependencies = Object.keys(projectPackage.dependencies)

	for (const dependency of dependencies) {
		const configPath = path.join(paths.project, 'node_modules', dependency, 'govuk-prototype-kit.config.json')
		if (!fs.existsSync(configPath)) {
			continue
		}
		const config = JSON.parse(fs.readFileSync(configPath))
		const packagePath = path.join(paths.project, 'node_modules', dependency, 'package.json')
		const pkg = JSON.parse(fs.readFileSync(packagePath))
		plugins.push({
			config,
			pkg
		})
	}

	return plugins
}

function getAssetPaths() {
	const assetPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		const pluginName = plugin.pkg.name
		if (plugin.config.assets) {
			for (const assetPath of plugin.config.assets) {
				const assetServerPath = `/plugin-assets/${pluginName}${assetPath}`
				const assetFilePath = path.join(paths.project, 'node_modules', pluginName, assetPath)
				assetPaths.push({
					serverPath: assetServerPath,
					filePath: assetFilePath
				})
			}
		}

		if (plugin.config.scripts) {
			for (const script of plugin.config.scripts) {
				// support old script api - strings only
				const scriptPath = script.path ? script.path : script
				const assetServerPath = `/plugin-assets/${pluginName}${scriptPath}`
				const assetFilePath = path.join(paths.project, 'node_modules', pluginName, scriptPath)
				assetPaths.push({
					serverPath: assetServerPath,
					filePath: assetFilePath
				})
			}
		}
	}
	return assetPaths
}

function getSassPaths() {
	const plugins = getPlugins()
	// GOVUK Frontend needs to come first
	const index = plugins.findIndex((plugin) => plugin.pkg.name === 'govuk-frontend')
	if (index > 0) {
		const govukFrontend = plugins[index]
		plugins.splice(index, 1)
		plugins.unshift(govukFrontend)
	}

	const sassPaths = []

	for (const plugin of plugins) {
		if (plugin.config.sass) {
			const pluginName = plugin.pkg.name
			for (const sassPath of plugin.config.sass) {
				const sassFilePath = path.join(paths.project, 'node_modules', pluginName, sassPath)
				sassPaths.push(sassFilePath)
			}
		}
	}
	return sassPaths
}

function getScripts() {
	const scripts = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		if (plugin.config.scripts) {
			const pluginName = plugin.pkg.name
			for (const script of plugin.config.scripts) {
				// support old script api - strings only
				if (script.type) {
					scripts.push({
						src: `/plugin-assets/${pluginName}${script.path}`,
						type: script.type
					})
				} else {
					scripts.push({
						src: `/plugin-assets/${pluginName}${script}`
					})
				}
			}
		}
	}
	return scripts
}

export default {
	getAssetPaths,
	getSassPaths,
	getScripts
}
