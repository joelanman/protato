import fs from 'node:fs'

function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// the bare message lets each caller wrap it in the context it can explain
function readJsonObject(filePath) {
	const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))

	if (!isObject(value)) {
		throw new Error('expected an object')
	}

	return value
}

export { isObject, readJsonObject }
