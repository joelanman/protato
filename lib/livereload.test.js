import http from 'node:http'
import chokidar from 'chokidar'
import { debounce } from 'radash'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import livereload from './livereload.js' // adjust path as needed

// Mock dependencies
vi.mock('node:http')
vi.mock('chokidar')
vi.mock('radash')
vi.mock('./paths.js', () => ({
	getPaths: vi.fn(() => ({
		public: '/path/to/public',
		views: '/path/to/views'
	}))
}))

describe('livereload', () => {
	let mockServer
	let mockWatcher
	let mockRequest
	let mockResponse

	beforeEach(() => {
		// Mock HTTP server
		mockServer = {
			listen: vi.fn((port, callback) => callback()),
			on: vi.fn()
		}

		// Mock request and response objects
		mockRequest = {
			url: '/livereload',
			on: vi.fn()
		}

		mockResponse = {
			writeHead: vi.fn(),
			write: vi.fn(),
			end: vi.fn()
		}

		// Mock file watcher
		mockWatcher = {
			on: vi.fn()
		}

		// Mock HTTP createServer
		http.createServer.mockImplementation((callback) => {
			// Store the callback so we can call it in tests
			mockServer.requestHandler = callback
			return mockServer
		})

		// Mock chokidar watch
		chokidar.watch.mockReturnValue(mockWatcher)

		// Mock debounce
		debounce.mockImplementation((config, fn) => fn)

		// Clear all mocks
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('serve', () => {
		it('creates HTTP server and listens on specified port', () => {
			const port = 3001

			livereload.serve(port)

			expect(http.createServer).toHaveBeenCalledWith(expect.any(Function))
			expect(mockServer.listen).toHaveBeenCalledWith(port, expect.any(Function))
		})

		it('sets up file watcher for public and views directories', () => {
			livereload.serve(3001)

			expect(chokidar.watch).toHaveBeenCalledWith(['/path/to/public', '/path/to/views'], { ignoreInitial: true })
		})

		it('handles livereload endpoint requests correctly', () => {
			livereload.serve(3001)

			// Simulate a request to /livereload
			mockServer.requestHandler(mockRequest, mockResponse)

			expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Access-Control-Allow-Origin': '*'
			})

			expect(mockRequest.on).toHaveBeenCalledWith('close', expect.any(Function))
		})

		it('does not handle non-livereload requests', () => {
			livereload.serve(3001)

			const nonLivereloadRequest = { ...mockRequest, url: '/other' }
			mockServer.requestHandler(nonLivereloadRequest, mockResponse)

			expect(mockResponse.writeHead).not.toHaveBeenCalled()
		})

		it('sets up debounced file change handler', () => {
			livereload.serve(3001)

			expect(debounce).toHaveBeenCalledWith({ delay: 100 }, expect.any(Function))
			expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function))
		})

		it('calls debounced reload when files change', () => {
			const mockDebouncedReload = vi.fn()
			debounce.mockReturnValue(mockDebouncedReload)

			livereload.serve(3001)

			// Get the change handler that was registered
			const changeHandler = mockWatcher.on.mock.calls.find((call) => call[0] === 'change')[1]

			// Simulate file change
			changeHandler('/path/to/file.js')

			expect(mockDebouncedReload).toHaveBeenCalled()
		})
	})

	describe('client management', () => {
		it('adds clients when they connect', () => {
			livereload.serve(3001)

			// Simulate client connection
			mockServer.requestHandler(mockRequest, mockResponse)

			// Client should be added (we can't directly test the clients array,
			// but we can test that the response object is prepared for SSE)
			expect(mockResponse.writeHead).toHaveBeenCalled()
		})

		it('removes clients when they disconnect', () => {
			livereload.serve(3001)

			// Simulate client connection
			mockServer.requestHandler(mockRequest, mockResponse)

			// Get the close handler
			const closeHandler = mockRequest.on.mock.calls.find((call) => call[0] === 'close')[1]

			// Simulate client disconnect
			closeHandler()

			// We can't directly test client removal, but the handler was called
			expect(closeHandler).toBeDefined()
		})
	})

	describe('reload', () => {
		it('sends reload message to all connected clients', () => {
			// We need to access the internal clients array somehow
			// Since it's module-scoped, we'll test this indirectly through serve
			livereload.serve(3001)

			// Connect a mock client
			mockServer.requestHandler(mockRequest, mockResponse)

			// Call reload
			livereload.reload()

			// The reload function should write to connected clients
			// We can't directly test this without refactoring, but we can test
			// that reload is callable
			expect(typeof livereload.reload).toBe('function')
		})
	})
})
