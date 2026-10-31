import fs from 'node:fs'
import path from 'node:path'

import * as sass from 'sass'
import { getPaths } from './paths.js'
import plugins from './plugins.js'

// Sass treats backslashes as escapes, so @import paths must use forward slashes
function toSassPath(filePath) {
	return filePath.replaceAll('\\', '/')
}

function compileSass(file) {
	const paths = getPaths()
	let inputPath = path.join(paths.sass, file)
	if (file === 'settings.scss') {
		return
	} else if (file === 'application.scss') {
		inputPath = processApplicationSass()
	}

	const sassOptions = {
		style: 'expanded',
		quietDeps: true,
		// sourceMap: true,
		// sourceMapIncludeSources: true,
		loadPaths: [paths.project],
		silenceDeprecations: ['import'],
		// support pkg: URLs in custom sass, as in the kit
		importers: [new sass.NodePackageImporter(paths.project)]
	}

	const result = sass.compile(inputPath, sassOptions)

	const outputFilename = path.basename(inputPath).replace('.scss', '.css')

	const outputPath = path.join(paths.stylesheets, outputFilename)

	// Add the source map comment to the CSS
	// const cssWithSourceMap = `${result.css}\n/*# sourceMappingURL=${outputFilename + '.map'} */`

	fs.writeFileSync(outputPath, result.css)

	// fs.writeFileSync(outputPath + '.map', JSON.stringify(result.sourceMap))
}

function processApplicationSass() {
	// build main application sass from plugins and their own settings.scss and application.scss

	const paths = getPaths()

	const tmpSassPath = path.join(paths.tmp, 'sass')
	fs.mkdirSync(tmpSassPath, { recursive: true })

	const settingsPath = path.join(paths.sass, 'settings.scss')
	const applicationPath = path.join(paths.sass, 'application.scss')

	const sassImports = {
		settings: '',
		plugins: '',
		application: `@import "${toSassPath(applicationPath)}";\n`
	}

	if (fs.existsSync(settingsPath)) {
		sassImports.settings = `@import "${toSassPath(settingsPath)}";\n`
	}

	const pluginSassPaths = plugins.getSassPaths()
	for (const pluginSassPath of pluginSassPaths) {
		sassImports.plugins += `@import "${pluginSassPath}";\n`
	}

	const applicationSass = `
		$govuk-extensions-url-context: "/plugin-assets";
		$govuk-plugins-url-context: "/plugin-assets";
		$govuk-prototype-kit-major-version: 13;
		${sassImports.settings}
		${sassImports.plugins}
		${sassImports.application}`

	// write tmp sass file

	const tmpApplicationSassPath = path.join(paths.tmp, 'sass/application.scss')
	fs.writeFileSync(tmpApplicationSassPath, applicationSass)

	return tmpApplicationSassPath
}

let buildResult

// The result of the last build, so the prototype can be restarted with it
// without passing it around.
function getBuildResult() {
	return buildResult
}

// Stores and returns { state: 'ok' } or { state: 'error', error }
function buildSass() {
	try {
		const paths = getPaths()

		// set up

		fs.rmSync(paths.stylesheets, { recursive: true, force: true })
		fs.mkdirSync(paths.stylesheets, { recursive: true })

		// compile user's sass files

		let sassFiles = fs.readdirSync(paths.sass)
		sassFiles = sassFiles.filter((file) => file.endsWith('.scss') && !file.startsWith('_'))

		for (const file of sassFiles) {
			compileSass(file)
		}

		writeUnbranded()

		buildResult = { state: 'ok' }
	} catch (err) {
		console.error(err)
		buildResult = { state: 'error', error: err }
	}

	return buildResult
}

function writeUnbranded() {
	// compile unbranded version (specific to govuk frontend)

	const paths = getPaths()

	const applicationCSS = fs.readFileSync(path.join(paths.stylesheets, 'application.css'), 'utf-8')

	let unbrandedCSS = applicationCSS.replaceAll(
		'"GDS Transport", arial, sans-serif;',
		'"HelveticaNeue", "Helvetica Neue", "Arial", "Helvetica", sans-serif;'
	)

	unbrandedCSS += ' .govuk-template { background-color: #ffffff; }'

	fs.writeFileSync(path.join(paths.stylesheets, 'unbranded.css'), unbrandedCSS)
}

function writeBaseLayouts() {
	// base layout files with all plugin macro imports
	// write them to tmp, so they get loaded instead of originals

	const paths = getPaths()

	// remove generated layouts from plugins that have been removed or changed
	fs.rmSync(path.join(paths.tmp, 'views'), { recursive: true, force: true })

	const macros = plugins.getMacros()
	const baseLayoutPaths = plugins.getBaseLayoutPaths()

	let imports = ''

	for (const macro of macros) {
		imports += `{% from "${macro.path}" import ${macro.name} %}\n`
	}

	for (const baseLayoutPath of baseLayoutPaths) {
		const baseLayout = fs.readFileSync(baseLayoutPath.source)

		const baseLayoutWithImports = imports + baseLayout

		fs.mkdirSync(path.dirname(baseLayoutPath.destination), { recursive: true })
		fs.writeFileSync(baseLayoutPath.destination, baseLayoutWithImports)
	}
}

// Rebuilds everything the prototype needs, then returns the result. A failed
// step is reported in the build result, so the prototype shows it on its error
// page rather than the change failing with a server error.
function buildPrototype() {
	buildSass()

	try {
		writeBaseLayouts()
	} catch (error) {
		console.error(error)
		buildResult = { state: 'error', error }
	}

	return buildResult
}

export { buildPrototype, buildSass, getBuildResult }
