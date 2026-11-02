// a config value can be missing, a single value, or a list of values
function toArray(value) {
	if (value === undefined || value === null) {
		return []
	}

	if (Array.isArray(value)) {
		return value
	}

	return [value]
}

export { toArray }
