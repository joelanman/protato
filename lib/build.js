import fs from 'node:fs'
import path from 'node:path'

import * as sass from 'sass'

import getPaths from './paths.js'
import plugins from './plugins.js'

function build() {
	const paths = getPaths()

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
		${sassImports.legacyPatterns}
		${sassImports.project}`

	if (!fs.existsSync(paths.public.stylesheets)) {
		fs.mkdirSync(paths.public.stylesheets, { recursive: true })
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

		const outputPath = path.join(paths.public.stylesheets, 'application.css')

		// Write the compiled CSS to file
		fs.writeFileSync(outputPath, result.css)

		// Optionally write the source map
		if (result.sourceMap) {
			fs.writeFileSync(outputPath + '.map', JSON.stringify(result.sourceMap))
		}
	} catch (error) {
		console.error('Sass compilation error:', error.message)
	}

	// write a layout file with all the plugin macros imports

	const baseLayout = fs.readFileSync(path.join(paths.package, 'views/layouts/govuk-branded.njk'))

	const macros = plugins.getMacros()

	let imports = ''

	for (const macro of macros) {
		imports += `{% from "${macro.path}" import ${macro.name} %}\n`
	}

	const layoutWithImports = imports + baseLayout
	const layoutWithImportsDir = path.join(paths.tmp, 'views/govuk-prototype-kit/layouts')

	if (!fs.existsSync(layoutWithImportsDir)) {
		fs.mkdirSync(layoutWithImportsDir, { recursive: true })
	}

	fs.writeFileSync(path.join(layoutWithImportsDir, 'govuk-branded.njk'), layoutWithImports)
}

export default build
