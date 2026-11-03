import { beforeEach, describe, expect, it, vi } from 'vitest'
import livereload from './livereload.js'

describe('livereload', () => {
	let mockRequest
	let mockResponse

	beforeEach(() => {
		mockRequest = {
			on: vi.fn()
		}

		mockResponse = {
			writeHead: vi.fn(),
			flushHeaders: vi.fn(),
			write: vi.fn()
		}

		// Mock console.log to avoid noise in tests
		vi.spyOn(console, 'log').mockImplementation(() => {})
	})

	describe('route', () => {
		it('removes client from array when request closes', () => {
			const route = livereload.route
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
				flushHeaders: vi.fn(),
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
			const route = livereload.route

			const mockResponse1 = {
				writeHead: vi.fn(),
				flushHeaders: vi.fn(),
				write: vi.fn()
			}
			const mockResponse2 = {
				writeHead: vi.fn(),
				flushHeaders: vi.fn(),
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
	})
})
