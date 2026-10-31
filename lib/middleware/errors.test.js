import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import managePrototypeNunjucks from '../../manage-prototype/nunjucks.js'
import { errorHandler, renderErrorPage } from './errors.js'

vi.mock('../../manage-prototype/nunjucks.js', () => ({
	default: {
		render: vi.fn((view) => `rendered ${view}`)
	}
}))

vi.mock('../utils/error-model.js', () => ({
	getErrorModel: vi.fn((error) => ({ error: { message: error.message } }))
}))

const createResponse = () => ({
	status: vi.fn(),
	send: vi.fn(),
	headersSent: false
})

describe('errors', () => {
	let consoleError

	beforeEach(() => {
		vi.clearAllMocks()
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		consoleError.mockRestore()
	})

	it('renders the page not found page without logging', () => {
		const response = createResponse()
		const error = Object.assign(new Error('Page not found: /missing'), {
			status: 404,
			reason: 'Nothing here'
		})

		errorHandler(error, { path: '/missing' }, response, vi.fn())

		expect(response.status).toHaveBeenCalledWith(404)
		expect(response.send).toHaveBeenCalledWith('rendered page-not-found.njk')
		expect(managePrototypeNunjucks.render).toHaveBeenCalledWith('page-not-found.njk', {
			path: '/missing',
			reason: 'Nothing here'
		})
		expect(consoleError).not.toHaveBeenCalled()
	})

	it('renders the form expired page without logging', () => {
		const response = createResponse()
		const error = Object.assign(new Error('invalid csrf token'), { code: 'EBADCSRFTOKEN' })

		errorHandler(error, { path: '/form' }, response, vi.fn())

		expect(response.status).toHaveBeenCalledWith(403)
		expect(response.send).toHaveBeenCalledWith('rendered form-expired.njk')
		expect(consoleError).not.toHaveBeenCalled()
	})

	it('logs and renders the server error page for an unexpected error', () => {
		const response = createResponse()

		errorHandler(new Error('boom'), { path: '/page' }, response, vi.fn())

		expect(response.status).toHaveBeenCalledWith(500)
		expect(response.send).toHaveBeenCalledWith('rendered server-error.njk')
		expect(consoleError).toHaveBeenCalledWith('boom')
	})

	it('passes the error on when the headers have already been sent', () => {
		const next = vi.fn()
		const response = { ...createResponse(), headersSent: true }
		const error = new Error('too late')

		errorHandler(error, { path: '/page' }, response, next)

		expect(next).toHaveBeenCalledWith(error)
		expect(managePrototypeNunjucks.render).not.toHaveBeenCalled()
	})

	it('renders an error page without logging, for errors already reported', () => {
		const response = createResponse()

		renderErrorPage(new Error('build failed'), { path: '/' }, response)

		expect(response.status).toHaveBeenCalledWith(500)
		expect(response.send).toHaveBeenCalledWith('rendered server-error.njk')
		expect(consoleError).not.toHaveBeenCalled()
	})

	it('logs a server error when asked to', () => {
		const response = createResponse()

		renderErrorPage(new Error('boom'), { path: '/' }, response, { logError: true })

		expect(response.status).toHaveBeenCalledWith(500)
		expect(consoleError).toHaveBeenCalledWith('boom')
	})
})
