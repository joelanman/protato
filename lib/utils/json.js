import fs from 'node:fs'

import { isObject } from 'radash'

// the bare message lets each caller wrap it in the context it can explain
function readJsonObject(filePath) {
	const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))

	if (!isObject(value)) {
		throw new Error('expected an object')
	}

	return value
}

export { readJsonObject }
