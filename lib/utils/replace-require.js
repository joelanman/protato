import Module from 'node:module'
import path from 'node:path'

import { getPaths } from '../paths.js'

// change requires from govuk-prototype-kit to protato
// this means existing govuk-prototype-kit plugins work
// for example filters or functions that call the api

function replaceRequire() {
	const paths = getPaths()
	const originalRequire = Module.prototype.require
	Module.prototype.require = function (modulePath) {
		if (modulePath === 'govuk-prototype-kit') {
			console.log("Replaced require('govuk-prototype-kit')")
			console.log('in ' + this.filename)
			console.log()
			return originalRequire.call(this, path.join(paths.package, 'index.js')).default
		}
		// Node resolves both spellings to the same lib/config.js in the kit
		if (modulePath === 'govuk-prototype-kit/lib/config' || modulePath === 'govuk-prototype-kit/lib/config.js') {
			console.log(`Replaced require('${modulePath}')`)
			console.log('in ' + this.filename)
			console.log()
			return originalRequire.call(this, path.join(paths.package, 'lib/config.js'))
		}
		return originalRequire.call(this, modulePath)
	}
}

export default replaceRequire
