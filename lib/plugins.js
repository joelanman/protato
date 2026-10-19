import fs from 'node:fs'
import path from 'node:path'

import { capitalize } from 'radash'

import { getPaths } from './paths.js'

const CONFIG_FILE = 'govuk-prototype-kit.config.json'

// config keys that are normalised to an array, even if the config gives a single value
const listKeys = [
	'assets',
	'stylesheets',
	'scripts',
	'nunjucksMacros',
	'sass',
	'nunjucksPaths',
	'importNunjucksMacrosInto',
	'nunjucksFilters',
	'nunjucksFunctions',
	'templates'
]

// config keys whose values are paths relative to the plugin's package
const pathKeys = [
	'assets',
	'stylesheets',
	'sass',
	'nunjucksPaths',
	'importNunjucksMacrosInto',
	'nunjucksFilters',
	'nunjucksFunctions'
]

let paths

let plugins

// protato ships the files that used to live in the govuk-prototype-kit package,
// so they are still served at the kit's historic /plugin-assets URLs
function getAssetServerPath(packageName, filePath) {
	const urlPackageName = packageName === 'protato' ? 'govuk-prototype-kit' : packageName
	return `/plugin-assets/${urlPackageName}${filePath}`
}

// Package name words that organisations write in their own way, rather than
// being capitalised like every other word
const knownWordsToFormat = {
	govuk: 'GOV.UK',
	hmrc: 'HMRC',
	ministryofjustice: 'Ministry of Justice',
	hmcts: 'HMCTS',
	dfe: 'DfE',
	jquery: 'jQuery',
	dwp: 'DWP'
}

function formatPackageNamePart(part) {
	return part
		.split('-')
		.map((word) => {
			const knownWord = knownWordsToFormat[word.toLowerCase()]

			if (knownWord) {
				return knownWord
			}

			return capitalize(word)
		})
		.join(' ')
}

function formatPackageName(packageName) {
	if (!packageName.startsWith('@')) {
		return { name: formatPackageNamePart(packageName) }
	}

	// scoped package names look like @scope/name, where the scope is the publisher
	const [publisher, name] = packageName.slice(1).split('/')

	return {
		name: formatPackageNamePart(name),
		publisher: formatPackageNamePart(publisher)
	}
}

function clearCache() {
	plugins = undefined
}

// config paths are joined onto the package path and used to build URLs, so
// they use / and need a leading /. Normalising them once means URLs never
// contain backslashes and filesystem paths point at the same file everywhere.
function normaliseConfigPath(filePath) {
	const slashPath = filePath.replaceAll('\\', '/')
	return slashPath.startsWith('/') ? slashPath : `/${slashPath}`
}

// scripts support the old string-only api and the newer object api
function normaliseScript(script) {
	const scriptPath = typeof script === 'string' ? script : script.path
	const normalised = { path: normaliseConfigPath(scriptPath) }

	if (typeof script === 'object' && script.type) {
		normalised.type = script.type
	}

	return normalised
}

// read a plugin config once into a predictable shape, so getters never have to
// handle strings, single objects or missing paths
function normaliseConfig(config) {
	const normalised = { ...config }

	for (const key of listKeys) {
		normalised[key] = [].concat(config[key] ?? [])
	}

	for (const key of pathKeys) {
		normalised[key] = normalised[key].map(normaliseConfigPath)
	}

	normalised.scripts = normalised.scripts.map(normaliseScript)

	normalised.templates = normalised.templates.map((template) => {
		if (typeof template?.path !== 'string') {
			return template
		}

		return { ...template, path: normaliseConfigPath(template.path) }
	})

	return normalised
}

function readJsonFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function getPlugins() {
	// return plugins if cached

	paths = getPaths()

	if (Array.isArray(plugins)) {
		return plugins
	}

	plugins = []

	let projectPackage

	try {
		projectPackage = readJsonFile(path.join(paths.project, 'package.json'))
	} catch (error) {
		console.warn(`Protato: could not read package.json: ${error.message}`)
		return plugins
	}

	// D6: protato, then govuk-frontend, then other plugins sorted alphabetically
	const basePlugins = ['protato', 'govuk-frontend']
	const dependencyNames = Object.keys(projectPackage.dependencies ?? {})
	const packageNames = [
		...basePlugins.filter((name) => dependencyNames.includes(name)),
		...dependencyNames.filter((name) => !basePlugins.includes(name)).sort()
	]

	for (const packageName of packageNames) {
		const packageDir = path.join(paths.project, 'node_modules', packageName)
		const configPath = path.join(packageDir, CONFIG_FILE)

		if (!fs.existsSync(configPath)) {
			continue
		}

		let config

		try {
			config = readJsonFile(configPath)
		} catch (error) {
			console.warn(`Plugin ${packageName}: could not read ${CONFIG_FILE}: ${error.message}`)
			continue
		}

		if (typeof config !== 'object' || config === null) {
			console.warn(`Plugin ${packageName}: invalid ${CONFIG_FILE}: expected an object`)
			continue
		}

		try {
			config = normaliseConfig(config)
		} catch (error) {
			console.warn(`Plugin ${packageName}: invalid ${CONFIG_FILE}: ${error.message}`)
			continue
		}

		let pkg

		try {
			pkg = readJsonFile(path.join(packageDir, 'package.json'))
		} catch (error) {
			console.warn(`Plugin ${packageName}: could not read package.json: ${error.message}`)
			continue
		}

		plugins.push({ config, pkg })
	}

	return plugins
}

function getAssetDescriptor(plugin, filePath) {
	const packageName = plugin.pkg.name

	return {
		serverPath: getAssetServerPath(packageName, filePath),
		filePath: path.join(paths.project, 'node_modules', packageName, filePath)
	}
}

function getAssetPaths() {
	const assetPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		for (const assetPath of plugin.config.assets) {
			assetPaths.push(getAssetDescriptor(plugin, assetPath))
		}

		// scripts and stylesheets are served as assets too

		for (const script of plugin.config.scripts) {
			assetPaths.push(getAssetDescriptor(plugin, script.path))
		}

		for (const stylesheet of plugin.config.stylesheets) {
			assetPaths.push(getAssetDescriptor(plugin, stylesheet))
		}
	}
	return assetPaths
}

function getMacros() {
	const macros = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		for (const macro of plugin.config.nunjucksMacros) {
			macros.push({
				path: macro.importFrom,
				name: macro.macroName
			})
		}
	}
	return macros
}

function getSassPaths() {
	const plugins = getPlugins()

	const sassPaths = []

	for (const plugin of plugins) {
		const packageName = plugin.pkg.name
		for (const sassPath of plugin.config.sass) {
			// plugin paths are used in Sass @import strings, so use /
			sassPaths.push(`node_modules/${packageName}${sassPath}`)
		}
	}
	return sassPaths
}

function getStylesheetPaths() {
	const stylesheets = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		const packageName = plugin.pkg.name
		for (const stylesheet of plugin.config.stylesheets) {
			stylesheets.push(getAssetServerPath(packageName, stylesheet))
		}
	}
	return stylesheets
}

function getScriptPaths() {
	const scripts = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		const packageName = plugin.pkg.name
		for (const script of plugin.config.scripts) {
			const scriptConfig = { src: getAssetServerPath(packageName, script.path) }

			if (script.type) {
				scriptConfig.type = script.type
			}

			scripts.push(scriptConfig)
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
		const packageName = plugin.pkg.name
		for (const baseLayoutPath of plugin.config.importNunjucksMacrosInto) {
			baseLayoutPaths.push({
				source: path.join(paths.project, 'node_modules', packageName, baseLayoutPath),
				destination: path.join(paths.tmp, 'views', packageName, baseLayoutPath)
			})
		}
	}
	return baseLayoutPaths
}

// Nunjucks searches views in order and uses the first match, so the order here
// is a precedence list:
// - the project always wins, so lib/app.js puts the project views first (D5)
// - later plugins win over earlier ones, so plugins are reversed (D5, D6)
// - a plugin's shadow layouts (with macros imported, written to tmp) must be
//   searched before that plugin's own views
function getViewPaths() {
	const viewPaths = []
	const plugins = getPlugins()

	for (const plugin of [...plugins].reverse()) {
		const packageName = plugin.pkg.name

		if (plugin.config.importNunjucksMacrosInto.length) {
			for (const viewPath of plugin.config.nunjucksPaths) {
				viewPaths.push(path.join(paths.tmp, 'views', packageName, viewPath))
			}
		}

		for (const viewPath of plugin.config.nunjucksPaths) {
			viewPaths.push(path.join(paths.project, 'node_modules', packageName, viewPath))
		}
	}

	return viewPaths
}

function getFilterPaths() {
	const filterPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		const packageName = plugin.pkg.name
		for (const filterPath of plugin.config.nunjucksFilters) {
			filterPaths.push(path.join(paths.project, 'node_modules', packageName, filterPath))
		}
	}
	return filterPaths
}

function getFunctionPaths() {
	const functionPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		const packageName = plugin.pkg.name
		for (const functionPath of plugin.config.nunjucksFunctions) {
			functionPaths.push(path.join(paths.project, 'node_modules', packageName, functionPath))
		}
	}
	return functionPaths
}

// templates grouped by plugin
function getTemplatesByPlugin() {
	const pluginsWithTemplates = []
	const plugins = getPlugins()

	for (const plugin of plugins) {
		const templates = []
		for (const template of plugin.config.templates) {
			if (template.type !== 'nunjucks') {
				console.warn(
					`Omitting ${template.name} from ${plugin.pkg.name} because the type ${template.type} isn't supported. ` +
						`The only currently supported type is "nunjucks".`
				)
				continue
			}
			templates.push(template)
		}

		if (templates.length) {
			const { name, publisher } = formatPackageName(plugin.pkg.name)

			pluginsWithTemplates.push({
				packageName: plugin.pkg.name,
				name,
				publisher,
				templates
			})
		}
	}

	return pluginsWithTemplates
}

function getTemplate(packageName, templatePath) {
	const plugin = getTemplatesByPlugin().find((plugin) => plugin.packageName === packageName)

	return plugin?.templates.find((template) => template.path === templatePath)
}

function getTemplateFilePath(packageName, templatePath) {
	const template = getTemplate(packageName, templatePath)

	if (!template) {
		return
	}

	const { project } = getPaths()
	const filePath = path.join(project, 'node_modules', packageName, template.path)

	if (!fs.existsSync(filePath)) {
		return
	}

	return filePath
}

export default {
	clearCache,
	formatPackageName,
	getTemplate,
	getTemplateFilePath,
	getTemplatesByPlugin,
	getAssetPaths,
	getFilterPaths,
	getFunctionPaths,
	getMacros,
	getSassPaths,
	getScriptPaths,
	getStylesheetPaths,
	getBaseLayoutPaths,
	getViewPaths
}
