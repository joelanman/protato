import fs from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getErrorModel } from './error-model.js'

vi.mock('node:fs', () => ({
	default: {
		readFileSync: vi.fn()
	}
}))

describe('getErrorModel', () => {
	const MOCK_CWD_LINUX = '/Users/example.user/my-prototype'
	const MOCK_CWD_WINDOWS = 'X:\\Users\\example.user\\my-prototype'
	const defaultError = { error: { message: 'An unknown error occurred.' } }

	beforeEach(() => {
		vi.clearAllMocks()

		// Use the Linux path as the default for most tests
		vi.spyOn(process, 'cwd').mockImplementation(() => MOCK_CWD_LINUX)

		// Default mock returns simple source code
		fs.readFileSync.mockReturnValue('line1\nline2\nproblematic line here\nline4\nline5')
	})

	it("returns default error when the error isn't processable", () => {
		expect(getErrorModel({})).toEqual(defaultError)
	})

	it('processes a standard Node error with line and column', () => {
		const result = getErrorModel({
			message: 'Example error',
			stack: `Error: Example error
    at Object.<anonymous> (${MOCK_CWD_LINUX}/playground.js:5:9)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1308:10)
    at Module.load (node:internal/modules/cjs/loader:1117:32)
    at Module._load (node:internal/modules/cjs/loader:958:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:81:12)
    at node:internal/main/run_main_module:23:47`
		})

		expect(result.error.message).toBe('Example error')
		expect(result.error.filePath).toBe('playground.js')
		expect(result.error.line).toBe(5)
		expect(result.error.sourceCode).toBeTruthy()
		expect(result.error.stack).toContain('Error: Example error')
	})

	it('processes a Node reference error', () => {
		const result = getErrorModel({
			message: 'lksdf is not defined',
			stack: `ReferenceError: lksdf is not defined
    at Object.<anonymous> (${MOCK_CWD_LINUX}/app/routes.js:11:1)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1308:10)
    at Module.load (node:internal/modules/cjs/loader:1117:32)
    at Module._load (node:internal/modules/cjs/loader:958:12)
    at Module.require (node:internal/modules/cjs/loader:1141:19)
    at require (node:internal/modules/cjs/helpers:110:18)
    at Object.addRouters (${MOCK_CWD_LINUX}/lib/utils/index.js:76:5)
    at Object.<anonymous> (${MOCK_CWD_LINUX}/server.js:137:7)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)`
		})

		expect(result.error.message).toBe('lksdf is not defined')
		expect(result.error.filePath).toBe('app/routes.js')
		expect(result.error.line).toBe(11)
		expect(result.error.sourceCode).toBeTruthy()
		expect(result.error.stack).toContain('ReferenceError: lksdf is not defined')
	})

	it('processes a Node syntax error (unexpected end of input)', () => {
		const result = getErrorModel({
			message: 'Unexpected end of input',
			stack: `${MOCK_CWD_LINUX}/index.js:11

SyntaxError: Unexpected end of input
    at internalCompileFunction (node:internal/vm:73:18)
    at wrapSafe (node:internal/modules/cjs/loader:1176:20)
    at Module._compile (node:internal/modules/cjs/loader:1218:27)
    at Module._extensions..js (node:internal/modules/cjs/loader:1308:10)
    at Module.load (node:internal/modules/cjs/loader:1117:32)
    at Module._load (node:internal/modules/cjs/loader:958:12)
    at Module.require (node:internal/modules/cjs/loader:1141:19)
    at require (node:internal/modules/cjs/helpers:110:18)
    at Object.<anonymous> (${MOCK_CWD_LINUX}/lib/filters/core-filters.js:3:34)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)`
		})

		expect(result.error.message).toBe('Unexpected end of input')
		expect(result.error.filePath).toBe('index.js')
		expect(result.error.line).toBe(11)
		expect(result.error.sourceCode).toBeTruthy()
		expect(result.error.stack).toContain('SyntaxError: Unexpected end of input')
	})

	it('processes a nunjucks template error with line and column', () => {
		const result = getErrorModel({
			message: `(${MOCK_CWD_LINUX}/app/views/index.njk) [Line 13, Column 22]
  expected variable end`,
			stack: `Template render error: (${MOCK_CWD_LINUX}/app/views/index.njk) [Line 13, Column 22]
  expected variable end
    at Object._prettifyError (${MOCK_CWD_LINUX}/node_modules/nunjucks/src/lib.js:36:11)
    at Template.render (${MOCK_CWD_LINUX}/node_modules/nunjucks/src/environment.js:538:21)`
		})

		expect(result.error.message).toBe('expected variable end')
		expect(result.error.filePath).toBe('app/views/index.njk')
		expect(result.error.line).toBe(13)
		expect(result.error.sourceCode).toBeTruthy()
		expect(result.error.stack).toContain('Template render error')
	})

	it('processes a nunjucks template not found error', () => {
		const result = getErrorModel({
			message: `(${MOCK_CWD_LINUX}/app/views/index.njk)
  Error: template not found: layouts/main2.html`,
			stack: `Template render error: (${MOCK_CWD_LINUX}/app/views/index.njk)
  Error: template not found: layouts/main2.html
    at Object._prettifyError (${MOCK_CWD_LINUX}/node_modules/nunjucks/src/lib.js:36:11)
    at ${MOCK_CWD_LINUX}/node_modules/nunjucks/src/environment.js:563:19`
		})

		expect(result.error.message).toBe('template not found: layouts/main2.html')
		expect(result.error.filePath).toBe('app/views/index.njk')
		expect(result.error.line).toBeUndefined() // No line number for template not found errors
		expect(result.error.sourceCode).toBeUndefined() // No source code since there's no line number
		expect(result.error.stack).toContain('Template render error')
	})

	it('processes a nunjucks error using a variable as a function', () => {
		const result = getErrorModel({
			message: `(${MOCK_CWD_LINUX}/app/views/index.njk) [Line 8, Column 17]
  Error: Unable to call \`serviceName\`, which is not a function`,
			stack: `Template render error: (${MOCK_CWD_LINUX}/app/views/index.njk)
  Template render error: (${MOCK_CWD_LINUX}/node_modules/govuk-prototype-kit/lib/nunjucks/govuk-prototype-kit/includes/homepage-top.njk)
  Error: Unable to call \`serviceName\`, which is not a function
    at Object._prettifyError (${MOCK_CWD_LINUX}/node_modules/nunjucks/src/lib.js:36:11)
    at ${MOCK_CWD_LINUX}/node_modules/nunjucks/src/environment.js:563:19`
		})

		expect(result.error.message).toBe('Unable to call `serviceName`, which is not a function')
		expect(result.error.filePath).toBe('app/views/index.njk')
		expect(result.error.line).toBe(8)
		expect(result.error.sourceCode).toBeTruthy()
		expect(result.error.stack).toContain('Template render error')
	})

	it('processes a sass syntax error', () => {
		const result = getErrorModel({
			message: `expected "{".
  ╷
1 │ sdfsf
  │      ^
  ╵
  app/assets/sass/cheese.scss 1:6  root stylesheet`,
			stack: `Error: expected "{".
  ╷
1 │ sdfsf
  │      ^
  ╵
  app/assets/sass/cheese.scss 1:6  root stylesheet
    at Object.wrapException (${MOCK_CWD_LINUX}/node_modules/sass/sass.dart.js:1247:17)
    at SpanScanner.error$3$length$position (${MOCK_CWD_LINUX}/node_modules/sass/sass.dart.js:67896:15)`
		})

		expect(result.error.message).toBe('expected "{".')
		expect(result.error.filePath).toBe('app/assets/sass/cheese.scss')
		expect(result.error.line).toBe(1)
		expect(result.error.sourceCode).toBeTruthy()
		expect(result.error.stack).toContain('Error: expected "{"')
	})

	it('processes Windows path errors correctly', () => {
		vi.spyOn(process, 'cwd').mockImplementation(() => MOCK_CWD_WINDOWS)
		vi.spyOn(path, 'relative').mockImplementation(path.win32.relative)

		const result = getErrorModel({
			message: 'lksdf is not defined',
			stack: `ReferenceError: lksdf is not defined
    at Object.<anonymous> (${MOCK_CWD_WINDOWS}\\app\\routes.js:11:1)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)`
		})

		expect(result.error.message).toBe('lksdf is not defined')
		expect(result.error.filePath).toBe('app\\routes.js')
		expect(result.error.line).toBe(11)
		expect(result.error.sourceCode).toBeTruthy()
		expect(result.error.stack).toContain('ReferenceError: lksdf is not defined')
	})

	it('handles file read errors gracefully', () => {
		fs.readFileSync.mockImplementation(() => {
			throw new Error('File not found')
		})

		const result = getErrorModel({
			message: 'Example error',
			stack: `Error: Example error
    at Object.<anonymous> (${MOCK_CWD_LINUX}/playground.js:5:9)`
		})

		expect(result.error.message).toBe('Example error')
		expect(result.error.filePath).toBe('playground.js')
		expect(result.error.line).toBe(5)
		expect(result.error.sourceCode).toBeUndefined() // Should be null when file can't be read
		expect(result.error.stack).toContain('Error: Example error')
	})

	it('returns fallback error for unparseable errors', () => {
		const result = getErrorModel({
			message: 'Some generic error message',
			stack: 'Some generic stack trace without file paths'
		})

		expect(result.error.message).toBe('Some generic error message')
		expect(result.error.filePath).toBeUndefined()
		expect(result.error.line).toBeUndefined()
		expect(result.error.sourceCode).toBeUndefined()
		expect(result.error.stack).toContain('Some generic stack trace')
	})

	it('returns default error when no message is available', () => {
		const result = getErrorModel({
			stack: 'Some stack trace'
		})

		expect(result).toEqual(defaultError)
	})

	// Comprehensive test for source code extraction functionality
	describe('source code extraction', () => {
		it('properly extracts and formats source code with line numbers', () => {
			const realFileContent = `const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  console.log('Before error')
  const result = someUndefinedVariable
  console.log('After error')
})

module.exports = router`

			fs.readFileSync.mockReturnValue(realFileContent)

			const result = getErrorModel({
				message: 'someUndefinedVariable is not defined',
				stack: `ReferenceError: someUndefinedVariable is not defined
    at Object.<anonymous> (${MOCK_CWD_LINUX}/routes.js:6:17)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)`
			})

			expect(result.error.sourceCode.before).toContain("1  const express = require('express')")
			expect(result.error.sourceCode.before).toContain("5    console.log('Before error')")
			expect(result.error.sourceCode.error).toBe('   6    const result = someUndefinedVariable')
			expect(result.error.sourceCode.after).toContain("7    console.log('After error')")
			expect(result.error.sourceCode.after).toContain('10  module.exports = router')
		})
	})
})
