import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { autoRenderView } from './middleware.js'

describe('Auto render view', () => {
	let request
	let response
	let next

	beforeEach(() => {
		request = {}

		response = {
			render: vi.fn(),
			set: vi.fn(),
			end: vi.fn()
		}

		next = vi.fn()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('Render index for /', () => {
		request = { path: '/' }
		autoRenderView(request, response, next)

		expect(response.render).toHaveBeenCalledWith('index', expect.any(Function))
	})

	test('Template not found - retries with /index and succeeds', () => {
		request = { path: '/about' }

		// Mock render to fail first time, succeed second time
		response.render
			.mockImplementationOnce((path, callback) => {
				// First call fails with template not found
				callback(new Error('template not found: about'))
			})
			.mockImplementationOnce((path, callback) => {
				// Second call succeeds
				callback(null, '<html>About Index</html>')
			})

		autoRenderView(request, response, next)

		expect(response.render).toHaveBeenNthCalledWith(1, 'about', expect.any(Function))
		expect(response.render).toHaveBeenNthCalledWith(2, 'about/index', expect.any(Function))

		// Should set headers and send response
		expect(response.set).toHaveBeenCalledWith({ 'Content-type': 'text/html; charset=utf-8' })
		expect(response.end).toHaveBeenCalledWith('<html>About Index</html>')
		expect(next).not.toHaveBeenCalled()
	})

	test('Template not found - retries with /index and fails both times', () => {
		request = { path: '/nonexistent' }

		// Mock render to fail both times
		response.render
			.mockImplementationOnce((path, callback) => {
				// First call fails
				callback(new Error('template not found: nonexistent'))
			})
			.mockImplementationOnce((path, callback) => {
				// Second call also fails
				callback(new Error('template not found: nonexistent/index'))
			})

		autoRenderView(request, response, next)

		expect(response.render).toHaveBeenCalledTimes(2)
		expect(response.render).toHaveBeenNthCalledWith(1, 'nonexistent', expect.any(Function))
		expect(response.render).toHaveBeenNthCalledWith(2, 'nonexistent/index', expect.any(Function))

		// Should call next() to trigger 404
		expect(next).toHaveBeenCalledWith()
		expect(response.set).not.toHaveBeenCalled()
		expect(response.end).not.toHaveBeenCalled()
	})

	test('Template not found - path already ends with /index', () => {
		request = { path: '/folder/index' }

		// Mock render to fail
		response.render.mockImplementationOnce((path, callback) => {
			callback(new Error('template not found: folder/index'))
		})

		autoRenderView(request, response, next)

		expect(response.render).toHaveBeenCalledWith('folder/index', expect.any(Function))

		// Should call next() immediately since path already ends with /index
		expect(next).toHaveBeenCalledWith()
		expect(response.set).not.toHaveBeenCalled()
		expect(response.end).not.toHaveBeenCalled()
	})

	test('Other error types are passed to next()', () => {
		request = { path: '/about' }

		const customError = new Error('Some other rendering error')
		response.render.mockImplementationOnce((path, callback) => {
			callback(customError)
		})

		autoRenderView(request, response, next)

		expect(response.render).toHaveBeenCalled()
		expect(next).toHaveBeenCalledWith(customError)
		expect(response.set).not.toHaveBeenCalled()
		expect(response.end).not.toHaveBeenCalled()
	})

	test('Successful render sets headers and sends response', () => {
		request = { path: '/contact' }

		response.render.mockImplementationOnce((path, callback) => {
			callback(null, '<html>Contact Page</html>')
		})

		autoRenderView(request, response, next)

		expect(response.render).toHaveBeenCalledWith('contact', expect.any(Function))
		expect(response.set).toHaveBeenCalledWith({ 'Content-type': 'text/html; charset=utf-8' })
		expect(response.end).toHaveBeenCalledWith('<html>Contact Page</html>')
		expect(next).not.toHaveBeenCalled()
	})
})
