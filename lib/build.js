const fs = require('node:fs')
const path = require('node:path')

const sass = require('sass')

const paths = require('./paths')

const projectSass = fs.readFileSync(paths.sass.project)

const govukFrontendSass = fs.readFileSync(paths.sass.govukFrontend)

const concatenatedSass = `${govukFrontendSass}\n\n${projectSass}`

function build() {
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
			loadPaths: [
				// Add any additional load paths for @import resolution
				path.dirname(paths.sass.govukFrontend)
			],
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

module.exports = build
