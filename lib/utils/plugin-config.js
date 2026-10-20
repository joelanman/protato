const CONFIG_FILE = 'govuk-prototype-kit.config.json'

function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export { CONFIG_FILE, isObject }
