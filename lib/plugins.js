import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from './paths.js'

let paths

let plugins

// protato ships the files that used to live in the govuk-prototype-kit package,
// so they are still served at the kit's historic /plugin-assets URLs
function getAssetServerPath(pluginName, filePath) {
	const packageName = pluginName === 'protato' ? 'govuk-prototype-kit' : pluginName
	return `/plugin-assets/${packageName}${filePath}`
}

function clearCache() {
	plugins = undefined
}

function getPlugins() {
	// return plugins if cached

	paths = getPaths()

	if (Array.isArray(plugins)) {
		return plugins
	}

	plugins = []

	const packagePath = path.join(paths.project, 'package.json')
	const projectPackage = JSON.parse(fs.readFileSync(packagePath))

	for (const dependency in projectPackage.dependencies) {
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

	// govuk-frontend first so other plugins can depend on it (e.g. Sass)
	const govukIndex = plugins.findIndex((p) => p.pkg.name === 'govuk-frontend')
	if (govukIndex > 0) {
		const govuk = plugins[govukIndex]
		plugins.splice(govukIndex, 1)
		plugins.unshift(govuk)
	}

	return plugins
}

function getAssetPaths() {
	const assetPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		const pluginName = plugin.pkg.name

		// assets

		if (plugin.config.assets) {
			for (const assetPath of plugin.config.assets) {
				const assetServerPath = getAssetServerPath(pluginName, assetPath)
				const assetFilePath = path.join(paths.project, 'node_modules', pluginName, assetPath)
				assetPaths.push({
					serverPath: assetServerPath,
					filePath: assetFilePath
				})
			}
		}

		// scripts also need to be served

		if (plugin.config.scripts) {
			for (const script of plugin.config.scripts) {
				// support old script api - strings only
				const scriptPath = script.path ? script.path : script
				const assetServerPath = getAssetServerPath(pluginName, scriptPath)
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

function getMacros() {
	const macros = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		if (plugin.config.nunjucksMacros) {
			for (const macro of plugin.config.nunjucksMacros) {
				macros.push({
					path: macro.importFrom,
					name: macro.macroName
				})
			}
		}
	}
	return macros
}

function getSassPaths() {
	const plugins = getPlugins()

	const sassPaths = []

	for (const plugin of plugins) {
		if (plugin.config.sass) {
			const pluginName = plugin.pkg.name
			for (const sassPath of plugin.config.sass) {
				const sassFilePath = path.join('node_modules', pluginName, sassPath)
				sassPaths.push(sassFilePath)
			}
		}
	}
	return sassPaths
}

function getScriptPaths() {
	const scripts = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		if (plugin.config.scripts) {
			const pluginName = plugin.pkg.name
			for (const script of plugin.config.scripts) {
				// support old script api - strings only

				if (script.type) {
					scripts.push({
						src: getAssetServerPath(pluginName, script.path),
						type: script.type
					})
				} else {
					scripts.push({
						src: getAssetServerPath(pluginName, script)
					})
				}
			}
		}
	}
	return scripts
}

// base layouts get all macros imported into them
// and writen to the tmp views directory

function getBaseLayoutPaths() {
	const baseLayoutPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		if (plugin.config.importNunjucksMacrosInto) {
			const pluginName = plugin.pkg.name
			for (const baseLayoutPath of plugin.config.importNunjucksMacrosInto) {
				baseLayoutPaths.push({
					source: path.join(paths.project, 'node_modules', pluginName, baseLayoutPath),
					destination: path.join(paths.tmp, 'views', pluginName, baseLayoutPath)
				})
			}
		}
	}
	return baseLayoutPaths
}

// we write base layouts with all macros imported to tmp
// so only return tmp view paths for plugins with base layouts

function getTmpViewPaths() {
	const tmpViewPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		if (plugin.config.importNunjucksMacrosInto) {
			const pluginName = plugin.pkg.name
			for (const viewPath of plugin.config.nunjucksPaths) {
				tmpViewPaths.push(path.join(paths.tmp, 'views', pluginName, viewPath))
			}
		}
	}
	return tmpViewPaths
}

function getViewPaths() {
	const viewPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		if (plugin.config.nunjucksPaths) {
			const pluginName = plugin.pkg.name
			for (const viewPath of plugin.config.nunjucksPaths) {
				viewPaths.push(path.join(paths.project, 'node_modules', pluginName, viewPath))
			}
		}
	}
	return viewPaths
}

function getFilterPaths() {
	const filterPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		if (plugin.config.nunjucksFilters) {
			const pluginName = plugin.pkg.name
			for (const filterPath of plugin.config.nunjucksFilters) {
				filterPaths.push(path.join(paths.project, 'node_modules', pluginName, filterPath))
			}
		}
	}
	return filterPaths
}

function getFunctionPaths() {
	const functionPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		if (plugin.config.nunjucksFunctions) {
			const pluginName = plugin.pkg.name
			for (const functionPath of plugin.config.nunjucksFunctions) {
				functionPaths.push(path.join(paths.project, 'node_modules', pluginName, functionPath))
			}
		}
	}
	return functionPaths
}

export default {
	clearCache,
	getAssetPaths,
	getFilterPaths,
	getFunctionPaths,
	getMacros,
	getSassPaths,
	getScriptPaths,
	getBaseLayoutPaths,
	getViewPaths,
	getTmpViewPaths
}
