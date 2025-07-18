import fs from 'node:fs'
import path from 'node:path'

import * as sass from 'sass'

import getPaths from './paths.js'
import plugins from './plugins.js'

function build() {
	const paths = getPaths()
	const sassContent = {
		settings: fs.readFileSync(paths.sass.settings),
		plugins: plugins.getSass(),
		legacyPatterns: fs.readFileSync(paths.sass.legacyPatterns),
		project: fs.readFileSync(paths.sass.project)
	}

	const concatenatedSass = `
		$govuk-extensions-url-context: "/plugin-assets";
		$govuk-plugins-url-context: "/plugin-assets";
		$govuk-prototype-kit-major-version: 13;
		${sassContent.settings}
		${sassContent.plugins}
		${sassContent.legacyPatterns}
		${sassContent.project}`

	console.log(concatenatedSass)

	// create .tmp if needed

	if (!fs.existsSync(paths.tmp)) {
		fs.mkdirSync(paths.tmp)
	}

	if (!fs.existsSync(paths.public.root)) {
		fs.mkdirSync(paths.public.root)
	}

	if (!fs.existsSync(paths.public.stylesheets)) {
		fs.mkdirSync(paths.public.stylesheets)
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
}

export default build
