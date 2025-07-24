import fs from 'node:fs'
import path from 'node:path'

import * as sass from 'sass'

import { getPaths } from './paths.js'
import plugins from './plugins.js'

function build() {
	const paths = getPaths()

	// delete tmp

	fs.rmSync(paths.tmp, { recursive: true })

	// sass

	const sassImports = {
		settings: `@import "${paths.sass.settings}";\n`,
		legacyPatterns: `@import "${paths.sass.legacyPatterns}";\n`,
		plugins: '',
		project: `@import "${paths.sass.project}";\n`
	}

	const pluginSassPaths = plugins.getSassPaths()

	for (const pluginSassPath of pluginSassPaths) {
		sassImports.plugins += `@import "${pluginSassPath}";\n`
	}

	const concatenatedSass = `
		$govuk-extensions-url-context: "/plugin-assets";
		$govuk-plugins-url-context: "/plugin-assets";
		$govuk-prototype-kit-major-version: 13;
		${sassImports.settings}
		${sassImports.plugins}
		${sassImports.project}`

	if (!fs.existsSync(paths.stylesheets)) {
		fs.mkdirSync(paths.stylesheets, { recursive: true })
	}

	try {
		// Compile the concatenated Sass to CSS
		const result = sass.compileString(concatenatedSass, {
			style: 'compressed', // Options: 'expanded', 'compressed'
			quietDeps: true,
			sourceMap: true,
			loadPaths: [paths.project],
			silenceDeprecations: ['import']
		})

		const outputPath = path.join(paths.stylesheets, 'application.css')

		// Write the compiled CSS to file
		fs.writeFileSync(outputPath, result.css)

		// Optionally write the source map
		if (result.sourceMap) {
			fs.writeFileSync(outputPath + '.map', JSON.stringify(result.sourceMap))
		}
	} catch (error) {
		console.error('Sass compilation error:', error.message)
	}

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

export default build
