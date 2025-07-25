// build manage prototype

import fs from 'node:fs'
import path from 'node:path'

import * as sass from 'sass'

import { getPaths } from '../lib/paths.js'

function build() {
	const paths = getPaths()

	// sass

	const managePrototypeSassPath = path.join(paths.managePrototype.sass, 'manage-prototype.scss')

	const managePrototypeSass = fs.readFileSync(managePrototypeSassPath, 'utf-8')

	try {
		const result = sass.compileString(managePrototypeSass, {
			style: 'compressed', // Options: 'expanded', 'compressed'
			quietDeps: true,
			sourceMap: true,
			loadPaths: [paths.managePrototype.govukFrontend],
			silenceDeprecations: ['import']
		})

		const outputPath = path.join(paths.managePrototype.public, 'stylesheets', 'manage-prototype.css')

		if (!fs.existsSync(path.dirname(outputPath))) {
			fs.mkdirSync(path.dirname(outputPath), { recursive: true })
		}

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
