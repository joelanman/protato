import { beforeEach, describe, expect, it, vi } from 'vitest'
import livereload from './livereload.js' // adjust path as needed

describe('livereload', () => {
	let mockRequest
	let mockResponse

	beforeEach(() => {
		mockRequest = {
			on: vi.fn()
		}

		mockResponse = {
			writeHead: vi.fn(),
			write: vi.fn()
		}

		// Mock console.log to avoid noise in tests
		vi.spyOn(console, 'log').mockImplementation(() => {})
	})

	describe('getRoute', () => {
		it('returns a route function', () => {
			const route = livereload.getRoute()
			expect(typeof route).toBe('function')
		})

		it('sets correct response headers when route is called', () => {
			const route = livereload.getRoute()

			route(mockRequest, mockResponse)

			expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'Access-Control-Allow-Origin': '*'
			})
		})

		it('sets up close event listener on request', () => {
			const route = livereload.getRoute()

			route(mockRequest, mockResponse)

			expect(mockRequest.on).toHaveBeenCalledWith('close', expect.any(Function))
		})

		it('removes client from array when request closes', () => {
			const route = livereload.getRoute()
			let closeHandler

			mockRequest.on.mockImplementation((event, handler) => {
				if (event === 'close') {
					closeHandler = handler
				}
			})

			route(mockRequest, mockResponse)

			// Simulate the close event
			closeHandler()

			// Test that client is removed by checking reload doesn't send to this client
			const anotherMockResponse = {
				writeHead: vi.fn(),
				write: vi.fn()
			}
			const anotherMockRequest = { on: vi.fn() }

			route(anotherMockRequest, anotherMockResponse)
			livereload.reload()

			// Original response should not receive the reload message
			expect(mockResponse.write).not.toHaveBeenCalled()
			// But the new response should
			expect(anotherMockResponse.write).toHaveBeenCalledWith('data: reload\n\n')
		})
	})

	describe('reload', () => {
		it('sends reload data to all connected clients', () => {
			const route = livereload.getRoute()

			const mockResponse1 = {
				writeHead: vi.fn(),
				write: vi.fn()
			}
			const mockResponse2 = {
				writeHead: vi.fn(),
				write: vi.fn()
			}
			const mockRequest1 = { on: vi.fn() }
			const mockRequest2 = { on: vi.fn() }

			// Connect two clients
			route(mockRequest1, mockResponse1)
			route(mockRequest2, mockResponse2)

			livereload.reload()

			expect(mockResponse1.write).toHaveBeenCalledWith('data: reload\n\n')
			expect(mockResponse2.write).toHaveBeenCalledWith('data: reload\n\n')
		})

		it('handles empty clients array gracefully', () => {
			// Don't add any clients

			expect(() => livereload.reload()).not.toThrow()
		})
	})
})
