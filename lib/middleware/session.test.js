import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import session from './session.js'

const sessionDataDefaultsPath = path.join('/mock/app/path', 'data', 'session-data-defaults.js')

// Mock the paths module
vi.mock('../paths.js', () => ({
	getPaths: vi.fn(() => ({
		app: '/mock/app/path',
		sessions: '/mock/sessions'
	}))
}))

vi.mock('../config.js', () => ({
	getConfig: vi.fn(() => ({ env: 'development' }))
}))

vi.mock('./session-store.js', async () => {
	const { Store } = await import('express-session')

	return {
		default: class FakeStore extends Store {}
	}
})

vi.mock('node:fs')

vi.mock('node:url', () => ({
	pathToFileURL: (p) => ({ href: p })
}))

describe('Session', () => {
	afterEach(() => {
		session.clearCache()
		vi.restoreAllMocks()
	})

	describe('init', () => {
		let mockApp

		beforeEach(() => {
			mockApp = {
				use: vi.fn()
			}
			vi.clearAllMocks()
			session.clearCache()
		})

		it('loads session data defaults when file exists', async () => {
			const mockDefaults = { defaultValue: 'test' }

			// Mock successful import
			fs.existsSync.mockReturnValue(true)
			vi.doMock(sessionDataDefaultsPath, () => ({
				default: mockDefaults
			}))

			await session.init(mockApp)

			const response = { locals: {} }
			session.autoStoreData({ session: {} }, response, vi.fn())

			expect(mockApp.use).toHaveBeenCalled()
			expect(response.locals.data).toEqual(mockDefaults)
		})

		it('handles error loading session data defaults file', async () => {
			fs.existsSync.mockReturnValue(true)
			vi.doMock(sessionDataDefaultsPath, () => {
				throw new Error('Syntax error')
			})

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

			await session.init(mockApp)

			expect(mockApp.use).toHaveBeenCalledWith(
				expect.any(Function) // session middleware
			)
			expect(consoleSpy).toHaveBeenCalled()
			consoleSpy.mockRestore()
		})
	})

	describe('autoStoreData', () => {
		let request, response, next

		beforeEach(() => {
			request = {
				session: {},
				body: {},
				query: {}
			}
			response = {
				locals: {}
			}
			next = vi.fn()
		})

		it('does not create session data when there is no input', () => {
			session.autoStoreData(request, response, next)

			expect(request.session.data).toBeUndefined()
			expect(response.locals.data).toEqual({})
			expect(next).toHaveBeenCalled()
		})

		it('does not store manage prototype form data', () => {
			request.originalUrl = '/manage-prototype/plugins/install'
			request.body = { packageName: 'some-plugin' }

			session.autoStoreData(request, response, next)

			expect(request.session.data).toBeUndefined()
			expect(next).toHaveBeenCalled()
		})

		it('does not create session data when input only has _-prefixed fields', () => {
			request.body = { _csrf: 'token123' }
			request.query = { _ignored: 'value' }

			session.autoStoreData(request, response, next)

			expect(request.session.data).toBeUndefined()
			expect(response.locals.data).toEqual({})
			expect(next).toHaveBeenCalled()
		})

		it('handles a request without a body', () => {
			request.body = undefined

			session.autoStoreData(request, response, next)

			expect(request.session.data).toBeUndefined()
			expect(next).toHaveBeenCalled()
		})

		it('preserves existing session data', () => {
			request.session.data = {
				existingData: 'existing value'
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.existingData).toBe('existing value')
			expect(response.locals.data.existingData).toBe('existing value')
		})

		it('handles "_unchecked" value by deleting the property', () => {
			request.session.data = {
				checkboxField: 'previous value'
			}
			request.body = {
				checkboxField: '_unchecked'
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data).not.toHaveProperty('checkboxField')
			expect(response.locals.data).not.toHaveProperty('checkboxField')
		})

		it('stores nested objects correctly', () => {
			request.body = {
				nested: {
					level1: {
						level2: 'deep value'
					},
					simple: 'simple value'
				}
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.nested.level1.level2).toBe('deep value')
			expect(request.session.data.nested.simple).toBe('simple value')
			expect(response.locals.data.nested.level1.level2).toBe('deep value')
		})

		it('merges nested objects with existing data', () => {
			request.session.data = {
				nested: {
					existing: 'existing value'
				}
			}
			request.body = {
				nested: {
					new: 'new value'
				}
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.nested.existing).toBe('existing value')
			expect(request.session.data.nested.new).toBe('new value')
		})

		it('initialises nested object if it does not exist', () => {
			request.body = {
				newNested: {
					value: 'test'
				}
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.newNested.value).toBe('test')
		})

		it('processes both body and query parameters', () => {
			request.body = {
				bodyParam: 'body value'
			}
			request.query = {
				queryParam: 'query value'
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.bodyParam).toBe('body value')
			expect(request.session.data.queryParam).toBe('query value')
			expect(response.locals.data.bodyParam).toBe('body value')
			expect(response.locals.data.queryParam).toBe('query value')
		})

		it('gives query parameters precedence over body parameters', () => {
			request.body = {
				sameName: 'body value'
			}
			request.query = {
				sameName: 'query value'
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.sameName).toBe('query value')
			expect(response.locals.data.sameName).toBe('query value')
		})

		it('handles empty arrays after filtering "_unchecked"', () => {
			request.body = {
				emptyAfterFilter: ['_unchecked', '_unchecked']
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.emptyAfterFilter).toEqual([])
		})

		it('handles mixed arrays with some "_unchecked" values', () => {
			request.body = {
				mixedArray: ['value1', '_unchecked', 'value2', '_unchecked', 'value3']
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.mixedArray).toEqual(['value1', 'value2', 'value3'])
		})

		it('handles complex nested structures with arrays and objects', () => {
			request.body = {
				complex: {
					_ignored: 'should be ignored',
					array: ['item1', '_unchecked', 'item2'],
					nested: {
						deep: 'deep value',
						unchecked: '_unchecked'
					}
				}
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.complex).not.toHaveProperty('_ignored')
			expect(request.session.data.complex.array).toEqual(['item1', 'item2'])
			expect(request.session.data.complex.nested.deep).toBe('deep value')
			expect(request.session.data.complex.nested).not.toHaveProperty('unchecked')
		})

		it('handles null and undefined values', () => {
			request.body = {
				nullValue: null,
				undefinedValue: undefined,
				emptyString: ''
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.nullValue).toBe(null)
			expect(request.session.data.undefinedValue).toBe(undefined)
			expect(request.session.data.emptyString).toBe('')
		})

		it('handles boolean and number values', () => {
			request.body = {
				booleanTrue: true,
				booleanFalse: false,
				numberZero: 0,
				numberPositive: 42,
				numberNegative: -10
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.booleanTrue).toBe(true)
			expect(request.session.data.booleanFalse).toBe(false)
			expect(request.session.data.numberZero).toBe(0)
			expect(request.session.data.numberPositive).toBe(42)
			expect(request.session.data.numberNegative).toBe(-10)
		})

		it('copies all session data to response locals', () => {
			request.session.data = {
				field1: 'value1',
				field2: 'value2',
				nested: {
					field3: 'value3'
				}
			}

			session.autoStoreData(request, response, next)

			expect(response.locals.data).toEqual(request.session.data)
		})

		it('handles edge case where nested object overwrites primitive value', () => {
			request.session.data = {
				field: 'primitive value'
			}
			request.body = {
				field: {
					nested: 'object value'
				}
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data.field).toEqual({
				nested: 'object value'
			})
		})
	})

	describe('sessionDataDefaults isolation', () => {
		let request, response, next

		beforeEach(() => {
			request = { session: {}, body: {}, query: {} }
			response = { locals: {} }
			next = vi.fn()
		})

		it('does not mutate sessionDataDefaults when user submits nested data', async () => {
			const mockDefaults = { address: { line1: 'default street' } }

			fs.existsSync.mockReturnValue(true)
			vi.doMock(sessionDataDefaultsPath, () => ({
				default: mockDefaults
			}))

			const mockApp = { use: vi.fn() }
			await session.init(mockApp)

			request.body = { address: { line1: 'user street' } }
			session.autoStoreData(request, response, next)

			expect(mockDefaults.address.line1).toBe('default street')
		})
	})

	describe('storeData function (indirect testing through autoStoreData)', () => {
		let request, response, next

		beforeEach(() => {
			request = {
				session: { data: {} },
				body: {},
				query: {}
			}
			response = { locals: {} }
			next = vi.fn()
		})

		it('ignores fields starting with underscore at any nesting level', () => {
			request.body = {
				_topLevel: 'ignored',
				keep: 'kept',
				nested: {
					_nestedIgnore: 'ignored',
					nestedKeep: 'kept',
					deeper: {
						_deepIgnore: 'ignored',
						deepKeep: 'kept'
					}
				}
			}

			session.autoStoreData(request, response, next)

			expect(request.session.data).not.toHaveProperty('_topLevel')
			expect(request.session.data.keep).toBe('kept')
			expect(request.session.data.nested).not.toHaveProperty('_nestedIgnore')
			expect(request.session.data.nested.nestedKeep).toBe('kept')
			expect(request.session.data.nested.deeper).not.toHaveProperty('_deepIgnore')
			expect(request.session.data.nested.deeper.deepKeep).toBe('kept')
		})
	})
})
