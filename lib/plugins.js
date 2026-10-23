import fs from 'node:fs'
import path from 'node:path'

import { capitalize } from 'radash'

import { getPaths } from './paths.js'
import { isObject, readJsonObject } from './utils/json.js'

const CONFIG_FILE = 'govuk-prototype-kit.config.json'
const PROXY_FILE = 'plugin-proxy.json'

// packages that behave like plugins but do not ship a plugin config
const BUILT_IN_CONFIGS = {
	jquery: {
		scripts: ['/dist/jquery.js'],
		assets: ['/dist'],
		meta: {
			description:
				'jQuery is a fast, small, and feature-rich JavaScript library. It makes things like HTML document traversal and manipulation, event handling, animation, and Ajax much simpler with an easy-to-use API that works across a multitude of browsers.'
		}
	},
	'notifications-node-client': {
		meta: {
			description:
				'GOV.UK Notify makes it easy for public sector service teams to send emails, text messages and letters.'
		}
	}
}

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

let warnedAboutInvalidProxyFile = false

function readUserProxyConfig(appDir) {
	if (!appDir) {
		return
	}

	const filePath = path.join(appDir, PROXY_FILE)

	if (!fs.existsSync(filePath)) {
		return
	}

	try {
		const config = readJsonObject(filePath)

		warnedAboutInvalidProxyFile = false
		return config
	} catch (error) {
		if (!warnedAboutInvalidProxyFile) {
			console.warn(`Protato: could not read ${filePath}: ${error.message}`)
			warnedAboutInvalidProxyFile = true
		}
	}
}

// built-in proxy configs come first, so a user config can override them
function readProxyConfigs() {
	const userConfig = readUserProxyConfig(getPaths().app)

	return userConfig ? { ...BUILT_IN_CONFIGS, ...userConfig } : BUILT_IN_CONFIGS
}

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
	const slashPath = filePath.replaceAll('\\', '/').replace(/\/+$/, '')

	if (!slashPath) {
		return '/'
	}

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

// read the project's declared dependencies for both the runtime and the
// management UI. A malformed package.json becomes an error for the caller to
// report in its own way.
function readProjectDependencies(projectDir) {
	try {
		const projectPackage = readJsonObject(path.join(projectDir, 'package.json'))

		return { dependencies: isObject(projectPackage.dependencies) ? projectPackage.dependencies : {} }
	} catch (error) {
		return { dependencies: {}, error: `Could not read project package.json: ${error.message}` }
	}
}

// read and normalise a package's plugin config. Only packages on disk are read:
// a declared dependency that npm has not installed has no config, not even one
// from a proxy config. Packages without a config file may still have a proxy
// config. An unreadable config returns an error for the caller to report.
function readPluginConfig(packageDir, packageName, proxyConfigs) {
	if (!fs.existsSync(packageDir)) {
		return {}
	}

	const configPath = path.join(packageDir, CONFIG_FILE)

	if (!fs.existsSync(configPath)) {
		const proxyConfig = proxyConfigs[packageName]

		if (!proxyConfig) {
			return {}
		}

		try {
			return { config: normaliseConfig(proxyConfig), configSource: 'proxy' }
		} catch (error) {
			return { error: `Could not read proxy config for ${packageName}: ${error.message}`, configSource: 'proxy' }
		}
	}

	try {
		const config = readJsonObject(configPath)

		return { config: normaliseConfig(config), configSource: 'file' }
	} catch (error) {
		return { error: `Could not read ${CONFIG_FILE} for ${packageName}: ${error.message}`, configSource: 'file' }
	}
}

// read an installed package once for both the runtime and the management UI.
// A declaration does not prove a package is installed, so everything that can
// be missing stays undefined and problems are returned as diagnostics.
function readInstalledPackage(projectDir, packageName, proxyConfigs = readProxyConfigs()) {
	const packageDir = path.join(projectDir, 'node_modules', packageName)
	const diagnostics = []
	const { config, error: configError, configSource } = readPluginConfig(packageDir, packageName, proxyConfigs)

	if (configError) {
		diagnostics.push(configError)
	}

	const installed = {
		packageName,
		pkg: undefined,
		installedVersion: undefined,
		config,
		configSource,
		pluginDependencies: config?.pluginDependencies,
		hasPluginConfig: Boolean(config || configError),
		diagnostics
	}

	// only packages that behave as plugins need their package.json read, so
	// ordinary dependencies are left alone
	if (!installed.hasPluginConfig) {
		return installed
	}

	try {
		installed.pkg = readJsonObject(path.join(packageDir, 'package.json'))

		if (typeof installed.pkg.version === 'string') {
			installed.installedVersion = installed.pkg.version
		}
	} catch (error) {
		installed.pkg = undefined
		diagnostics.push(`Could not read package.json for ${packageName}: ${error.message}`)
	}

	return installed
}

// D6: protato, then govuk-frontend, then other plugins sorted alphabetically
function getPluginOrder(dependencies) {
	const names = Object.keys(dependencies).sort()
	const base = ['protato', 'govuk-frontend']

	return [...base.filter((name) => names.includes(name)), ...names.filter((name) => !base.includes(name))]
}

// every declared dependency, in load order, with its plugin read. The runtime
// and the management pages both start here.
function readProjectPlugins(projectDir = getPaths().project) {
	const { dependencies, error } = readProjectDependencies(projectDir)
	const proxyConfigs = readProxyConfigs()
	const plugins = getPluginOrder(dependencies).map((packageName) => ({
		declaration: dependencies[packageName],
		...readInstalledPackage(projectDir, packageName, proxyConfigs)
	}))

	return { plugins, error, proxyConfigs }
}

function getPlugins() {
	// return plugins if cached

	paths = getPaths()

	if (Array.isArray(plugins)) {
		return plugins
	}

	plugins = []

	const { plugins: installed, error } = readProjectPlugins(paths.project)

	if (error) {
		console.warn(`Protato: ${error}`)
		return plugins
	}

	for (const plugin of installed) {
		for (const diagnostic of plugin.diagnostics) {
			console.warn(diagnostic)
		}

		if (plugin.config && plugin.pkg) {
			plugins.push({ config: plugin.config, pkg: plugin.pkg })
		}
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
	const assetFilePath = path.join(paths.project, 'node_modules', packageName, filePath)

	let type

	try {
		type = getAssetType(assetFilePath)
	} catch (error) {
		// D7: warn and carry on, naming the package and config file
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

		// scripts and stylesheets are served as assets too

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

export {
	CONFIG_FILE,
	formatPackageName,
	readInstalledPackage,
	readProjectDependencies,
	readProjectPlugins,
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
