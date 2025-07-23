// npm dependencies
import { beforeEach, describe, expect, it } from 'vitest'

// local dependencies
import session from './session.js'

describe('autoStoreData', () => {
	const request = {
		session: {}
	}
	const response = {}

	beforeEach(() => {
		request.body = {}
		request.query = {}
		request.originalUrl = '/'
		request.session.data = {
			existingData: 'existing data'
		}
		response.locals = {}
	})

	it('strips all properties where the name is prefixed with an underscore when saving the request query to the session and locals data', () => {
		request.query = {
			_omitMe: 'omit me',
			doIncludeMe: 'include me'
		}
		const expectedData = {
			doIncludeMe: 'include me',
			existingData: 'existing data'
		}
		session.autoStoreData(request, response, () => {
			expect(response.locals.data).toEqual(expectedData)
			expect(request.session.data).toEqual(expectedData)
		})
	})

	it('removes all occurrences of the value "_unchecked" in checkboxes when saving the request body to the session and locals data', () => {
		request.body = {
			checkBoxes1: ['_unchecked', 'cb1-1', '_unchecked', '_unchecked', 'cb1-2', '_unchecked'],
			checkBoxes2: ['_unchecked', '_unchecked'],
			checkBoxes3: ['cb3-1', 'cb3-2'],
			existingData: 'existing data'
		}
		const expectedData = {
			checkBoxes1: ['cb1-1', 'cb1-2'],
			checkBoxes2: [],
			checkBoxes3: ['cb3-1', 'cb3-2'],
			existingData: 'existing data'
		}
		session.autoStoreData(request, response, () => {
			expect(response.locals.data).toEqual(expectedData)
			expect(request.session.data).toEqual(expectedData)
		})
	})
})
