import fs from 'node:fs'
import path from 'node:path'

import { capitalize, isObject } from 'radash'

// proxy configs for packages that behave like plugins but ship no plugin config.
// A project can override them with its own app/plugin-proxy.json.
//
// An empty entry is still useful - it makes the plugin appear on the plugins page
import builtInProxyConfigs from '../data/plugin-proxy.json' with { type: 'json' }
import { getPaths } from './paths.js'
import { toArray } from './utils/array.js'
import { readJsonObject } from './utils/json.js'

const CONFIG_FILE = 'govuk-prototype-kit.config.json'
const PROXY_FILE = 'plugin-proxy.json'

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

let plugins

function readProjectProxyConfig() {
	const filePath = path.join(getPaths().app, PROXY_FILE)

	if (!fs.existsSync(filePath)) {
		return
	}

	try {
		return readJsonObject(filePath)
	} catch (error) {
		console.warn(`Protato: could not read ${filePath}: ${error.message}`)
	}
}

// the project's proxy configs come last, so they override protato's built-in
// ones. Spreading nothing is fine, so a project without the file needs no case.
function readProxyConfigs() {
	return { ...builtInProxyConfigs, ...readProjectProxyConfig() }
}

function getPackagePath(packageName, ...segments) {
	return path.join(getPaths().project, 'node_modules', packageName, ...segments)
}

// Installed means npm has put the package in node_modules. A package can be in
// package.json but not installed yet.
function isInstalled(packageName) {
	return fs.existsSync(getPackagePath(packageName, 'package.json'))
}

function readPackageJson(packageName) {
	if (!isInstalled(packageName)) {
		return
	}

	try {
		return readJsonObject(getPackagePath(packageName, 'package.json'))
	} catch (error) {
		console.warn(`Could not read package.json for ${packageName}: ${error.message}`)
	}
}

function readProjectDependencies() {
	try {
		const projectPackage = readJsonObject(path.join(getPaths().project, 'package.json'))

		if (!isObject(projectPackage.dependencies)) {
			return {}
		}

		return projectPackage.dependencies
	} catch (error) {
		console.warn(`Protato: Could not read project package.json: ${error.message}`)
		return {}
	}
}

// existing prototypes use the kit's name in /plugin-assets URLs
function getAssetServerPath(packageName, filePath) {
	let urlPackageName = packageName

	if (packageName === 'protato') {
		urlPackageName = 'govuk-prototype-kit'
	}

	// encode each segment, so #, ? and % stay part of the filename rather than the
	// URL. The package name is already URL-safe, so it is left alone.
	const encodedPath = filePath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')

	return `/plugin-assets/${urlPackageName}${encodedPath}`
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
		return { packageName, name: formatPackageNamePart(packageName) }
	}

	// scoped package names look like @scope/name, where the scope is the publisher
	const [publisher, name] = packageName.slice(1).split('/')

	return {
		packageName,
		name: formatPackageNamePart(name),
		publisher: formatPackageNamePart(publisher)
	}
}

function clearCache() {
	plugins = undefined
}

// config paths are relative to the package and appear in URLs, so they get /
// separators and a leading /. Dropping .. keeps a config inside its package.
function normaliseConfigPath(filePath) {
	const segments = filePath
		.replaceAll('\\', '/')
		.split('/')
		.filter((segment) => segment && segment !== '.' && segment !== '..')

	return `/${segments.join('/')}`
}

// read a plugin config once into a predictable shape, so getters never have to
// handle strings, single objects or missing paths
function normaliseConfig(config) {
	const normalised = { ...config }

	for (const key of listKeys) {
		normalised[key] = toArray(config[key])
	}

	for (const key of pathKeys) {
		normalised[key] = normalised[key].map(normaliseConfigPath)
	}

	// plugins use both the string form and an object with a type, so both are
	// normalised to the same shape
	normalised.scripts = normalised.scripts.map((script) => {
		if (typeof script === 'string') {
			return { path: normaliseConfigPath(script) }
		}

		const normalisedScript = { path: normaliseConfigPath(script.path) }

		if (script.type) {
			normalisedScript.type = script.type
		}

		return normalisedScript
	})

	normalised.templates = normalised.templates.map((template) => {
		if (typeof template?.path !== 'string') {
			return template
		}

		return { ...template, path: normaliseConfigPath(template.path) }
	})

	return normalised
}

function hasPluginConfig(packageName) {
	return fs.existsSync(getPackagePath(packageName, CONFIG_FILE))
}

// A config comes from the package, or from a proxy config for a package that
// ships none (such as jquery). It is returned as written, so a mistake in a key
// the prototype never reads cannot hide the plugin.
function readPluginConfig(packageName, proxyConfigs) {
	if (!hasPluginConfig(packageName)) {
		return proxyConfigs[packageName]
	}

	try {
		return readJsonObject(getPackagePath(packageName, CONFIG_FILE))
	} catch (error) {
		console.warn(`Could not read ${CONFIG_FILE} for ${packageName}: ${error.message}`)
		return
	}
}

// The prototype needs every key in its known shape, so a config that cannot be
// normalised is skipped rather than half applied.
function getNormalisedPluginConfig(packageName, proxyConfigs) {
	const config = readPluginConfig(packageName, proxyConfigs)

	if (!config) {
		return
	}

	try {
		return normaliseConfig(config)
	} catch (error) {
		console.warn(`Could not read the plugin config for ${packageName}: ${error.message}`)
		return
	}
}

// protato, then govuk-frontend, then other plugins sorted alphabetically
function getPluginOrder(dependencies) {
	const names = Object.keys(dependencies).sort()
	const base = ['protato', 'govuk-frontend']

	return [...base.filter((name) => names.includes(name)), ...names.filter((name) => !base.includes(name))]
}

function getPlugins() {
	if (Array.isArray(plugins)) {
		return plugins
	}

	plugins = []

	const dependencies = readProjectDependencies()
	const proxyConfigs = readProxyConfigs()

	for (const packageName of getPluginOrder(dependencies)) {
		const config = getNormalisedPluginConfig(packageName, proxyConfigs)

		if (!config) {
			continue
		}

		if (!isInstalled(packageName)) {
			console.warn(`${packageName} is in package.json but not installed. Run npm install.`)
			continue
		}

		const pkg = readPackageJson(packageName)

		// installed, but its package.json could not be read. readPackageJson warns.
		if (!pkg) {
			continue
		}

		plugins.push({ config, pkg })
	}

	return plugins
}

// whether a declared target is a file or a directory decides how it is served,
// so use the filesystem rather than guessing from the path or its extension
function getAssetType(filePath) {
	const stats = fs.statSync(filePath)
	fs.accessSync(filePath, fs.constants.R_OK)
	return stats.isDirectory() ? 'directory' : 'file'
}

function getAssetDescriptor(plugin, filePath) {
	const packageName = plugin.pkg.name
	const assetFilePath = getPackagePath(packageName, filePath)

	let type

	try {
		type = getAssetType(assetFilePath)
	} catch (error) {
		// warn and carry on, naming the package and config file
		console.warn(`Plugin ${packageName}: could not read ${CONFIG_FILE} asset ${filePath}: ${error.message}`)
		return
	}

	return {
		serverPath: getAssetServerPath(packageName, filePath),
		filePath: assetFilePath,
		type
	}
}

function addAssetDescriptor(assetPaths, plugin, filePath) {
	const descriptor = getAssetDescriptor(plugin, filePath)

	if (descriptor) {
		assetPaths.push(descriptor)
	}
}

function getAssetPaths() {
	const assetPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		for (const assetPath of plugin.config.assets) {
			addAssetDescriptor(assetPaths, plugin, assetPath)
		}

		for (const script of plugin.config.scripts) {
			addAssetDescriptor(assetPaths, plugin, script.path)
		}

		for (const stylesheet of plugin.config.stylesheets) {
			addAssetDescriptor(assetPaths, plugin, stylesheet)
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

// base layouts get all macros imported into them, written to the tmp views
function getBaseLayoutPaths() {
	const baseLayoutPaths = []
	const plugins = getPlugins()
	for (const plugin of plugins) {
		const packageName = plugin.pkg.name
		for (const baseLayoutPath of plugin.config.importNunjucksMacrosInto) {
			baseLayoutPaths.push({
				source: getPackagePath(packageName, baseLayoutPath),
				destination: path.join(getPaths().tmp, 'views', packageName, baseLayoutPath)
			})
		}
	}
	return baseLayoutPaths
}

// Nunjucks uses the first match, so this order is precedence: the project wins
// (prototype/app.js prepends it), later plugins beat earlier ones, and a plugin's
// shadow layouts in tmp come before its own views.
function getViewPaths() {
	const viewPaths = []
	const plugins = getPlugins()

	for (const plugin of [...plugins].reverse()) {
		const packageName = plugin.pkg.name

		if (plugin.config.importNunjucksMacrosInto.length) {
			for (const viewPath of plugin.config.nunjucksPaths) {
				viewPaths.push(path.join(getPaths().tmp, 'views', packageName, viewPath))
			}
		}

		for (const viewPath of plugin.config.nunjucksPaths) {
			viewPaths.push(getPackagePath(packageName, viewPath))
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
			filterPaths.push(getPackagePath(packageName, filterPath))
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
			functionPaths.push(getPackagePath(packageName, functionPath))
		}
	}
	return functionPaths
}

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
			pluginsWithTemplates.push({ ...formatPackageName(plugin.pkg.name), templates })
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

	const filePath = getPackagePath(packageName, template.path)

	if (!fs.existsSync(filePath)) {
		return
	}

	return filePath
}

export {
	CONFIG_FILE,
	formatPackageName,
	hasPluginConfig,
	isInstalled,
	readPackageJson,
	readPluginConfig,
	readProjectDependencies,
	readProxyConfigs
}

export default {
	clearCache,
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
