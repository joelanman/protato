import { beforeEach, describe, expect, it, vi } from 'vitest'
import livereload from './livereload.js'

function createMockResponse() {
	return {
		writeHead: vi.fn(),
		flushHeaders: vi.fn(),
		write: vi.fn()
	}
}

function createMockRequest() {
	return {
		on: vi.fn()
	}
}

describe('livereload', () => {
	let mockRequest
	let mockResponse

	beforeEach(() => {
		livereload.clearClients()
		mockRequest = createMockRequest()
		mockResponse = createMockResponse()
		vi.spyOn(console, 'log').mockImplementation(() => {})
	})

	describe('route', () => {
		it('removes client from array when request closes', () => {
			let closeHandler
			mockRequest.on.mockImplementation((event, handler) => {
				if (event === 'close') {
					closeHandler = handler
				}
			})

			livereload.route(mockRequest, mockResponse)
			closeHandler()

			const anotherMockResponse = createMockResponse()
			livereload.route(createMockRequest(), anotherMockResponse)
			livereload.reload()

			expect(mockResponse.write).not.toHaveBeenCalled()
			expect(anotherMockResponse.write).toHaveBeenCalledWith('data: reload\n\n')
		})
	})

	describe('reload', () => {
		it('sends reload data to all connected clients', () => {
			const mockResponse1 = createMockResponse()
			const mockResponse2 = createMockResponse()

			livereload.route(createMockRequest(), mockResponse1)
			livereload.route(createMockRequest(), mockResponse2)

			livereload.reload()

			expect(mockResponse1.write).toHaveBeenCalledWith('data: reload\n\n')
			expect(mockResponse2.write).toHaveBeenCalledWith('data: reload\n\n')
		})

		it('handles empty clients array gracefully', () => {
			const mockResponse1 = createMockResponse()
			livereload.route(createMockRequest(), mockResponse1)
			livereload.clearClients()

			expect(() => livereload.reload()).not.toThrow()
			expect(mockResponse1.write).not.toHaveBeenCalled()
		})
	})
})
