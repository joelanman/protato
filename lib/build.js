import fs from 'node:fs'
import path from 'node:path'

import chokidar from 'chokidar'
import * as sass from 'sass'

import { getPaths } from './paths.js'
import plugins from './plugins.js'

function cleanTmp() {
	const paths = getPaths()
	fs.rmSync(paths.tmp, { recursive: true, force: true })
}

function writeCSS() {
	const paths = getPaths()

	// set up

	fs.mkdirSync(paths.stylesheets, { recursive: true })

	const tmpSassPath = path.join(paths.tmp, 'sass')
	fs.mkdirSync(tmpSassPath, { recursive: true })

	const sassOptions = {
		style: 'expanded',
		quietDeps: true,
		// sourceMap: true,
		// sourceMapIncludeSources: true,
		loadPaths: [path.join(paths.project, 'node_modules')],
		silenceDeprecations: ['import']
	}

	function compileSass(inputPath) {
		try {
			const result = sass.compile(inputPath, sassOptions)

			const outputFilename = path.basename(inputPath).replace('.scss', '.css')

			const outputPath = path.join(paths.stylesheets, outputFilename)

			// Add the source map comment to the CSS
			// const cssWithSourceMap = `${result.css}\n/*# sourceMappingURL=${outputFilename + '.map'} */`

			fs.writeFileSync(outputPath, result.css)

			// fs.writeFileSync(outputPath + '.map', JSON.stringify(result.sourceMap))
		} catch (error) {
			console.error('Sass compilation error:', error.message)
		}
	}

	// build main application sass from plugins and their own settings.scss and application.scss

	const sassImports = {
		settings: `@import "${paths.sass.settings}";\n`,
		plugins: '',
		project: `@import "${paths.sass.project}";\n`
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
		${sassImports.project}`

	// compile main application sass

	const applicationSassFile = path.join(paths.tmp, 'sass/application.scss')
	fs.writeFileSync(applicationSassFile, applicationSass)

	compileSass(applicationSassFile)

	// compile unbranded version (specific to govuk frontend)

	const applicationCSS = fs.readFileSync(path.join(paths.stylesheets, 'application.css'), 'utf-8')

	let unbrandedCSS = applicationCSS.replaceAll(
		'"GDS Transport", arial, sans-serif;',
		'"HelveticaNeue", "Helvetica Neue", "Arial", "Helvetica", sans-serif;'
	)

	unbrandedCSS += ' .govuk-template { background-color: #ffffff; }'

	fs.writeFileSync(path.join(paths.stylesheets, 'unbranded.css'), unbrandedCSS)

	// compile user's other sass files

	const otherSassDir = path.join(paths.app, 'assets/sass')

	let otherSass = fs.readdirSync(otherSassDir)
	otherSass = otherSass.filter(
		(file) => file.endsWith('.scss') && !file.startsWith('_') && file !== 'application.scss' && file !== 'settings.scss'
	)

	for (const file of otherSass) {
		const inputPath = path.join(otherSassDir, file)
		compileSass(inputPath)
	}
}

function writeBaseLayouts() {
	// base layout files with all plugin macro imports
	// write them to tmp, so they get loaded instead of originals

	const macros = plugins.getMacros()
	const baseLayoutPaths = plugins.getBaseLayoutPaths()

	let imports = ''

	for (const macro of macros) {
		imports += `{% from "${macro.path}" import ${macro.name} %}\n`
	}

	for (const baseLayoutPath of baseLayoutPaths) {
		const baseLayout = fs.readFileSync(baseLayoutPath.source)

		const baseLayoutWithImports = imports + baseLayout
		const baseLayoutWithImportsDir = path.dirname(baseLayoutPath.destination)

		if (!fs.existsSync(baseLayoutWithImportsDir)) {
			fs.mkdirSync(baseLayoutWithImportsDir, { recursive: true })
		}

		fs.writeFileSync(baseLayoutPath.destination, baseLayoutWithImports)
	}
}

function watchSass() {
	const paths = getPaths()
	const watcher = chokidar.watch(path.join(paths.assets, 'sass'), {
		ignoreInitial: true,
		persistent: true
	})

	watcher.on('all', (event, path) => {
		console.log('watchSass - ' + event + ':' + path)
		writeCSS()
	})

	// todo - delete css when sass is deleted
}

function build() {
	cleanTmp()
	writeCSS()
	writeBaseLayouts()
	watchSass()
}

export default build
