import { get } from 'radash'

// normally you would import protato, but we are inside protato here
import protato from '../index.js'

const views = protato.views

// DEPRECATED in favour of 'value' param
// Add Nunjucks function called 'checked' to set
// checked status of radios and checkboxes

views.addFunction('checked', function (name, value) {
	// Check data exists
	if (this.ctx.data === undefined) {
		return ''
	}

	// Use string keys or object notation to support:
	// checked("field-name")
	// checked("['field-name']")
	// checked("['parent']['field-name']")

	const storedValue = get(this.ctx.data, name)

	// Check the requested data exists
	if (storedValue === undefined) {
		return ''
	}

	let checked = ''

	// If data is an array, check it exists in the array
	if (Array.isArray(storedValue)) {
		if (storedValue.includes(value)) {
			checked = 'checked'
		}
	} else {
		// The data is just a simple value, check it matches
		if (storedValue === value) {
			checked = 'checked'
		}
	}
	return checked
})
