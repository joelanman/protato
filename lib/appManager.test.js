import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import chokidar from 'chokidar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all external dependencies
vi.mock('node:child_process')
vi.mock('chokidar')
vi.mock('./livereload.js', () => ({
	default: { reload: vi.fn() }
}))
vi.mock('./paths.js', () => ({
	getPaths: vi.fn(() => ({ app: '/mock/app/path' }))
}))
vi.mock('./utils/stop-process.js', () => ({
	stopProcess: vi.fn()
}))
vi.mock('radash', () => ({
	debounce: vi.fn((config, fn) => fn) // Return the function directly for easier testing
}))

// Import after mocking
import { startApp, watchApp } from './appManager.js'

describe('appManager', () => {
	let mockChildProcess
	let mockWatcher
	let originalConsoleLog
	let originalConsoleError

	beforeEach(() => {
		// Create mock child process with EventEmitter capabilities
		mockChildProcess = new EventEmitter()
		mockChildProcess.stdout = new EventEmitter()
		mockChildProcess.stderr = new EventEmitter()
		mockChildProcess.exitCode = null
		mockChildProcess.stdout.pipe = vi.fn()
		mockChildProcess.stderr.pipe = vi.fn()
		mockChildProcess.stdout.off = vi.fn()

		// Create mock watcher
		mockWatcher = new EventEmitter()
		mockWatcher.watch = vi.fn()

		// Setup mocks
		vi.mocked(spawn).mockReturnValue(mockChildProcess)
		vi.mocked(chokidar.watch).mockReturnValue(mockWatcher)

		// Mock console methods to avoid cluttering test output
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(console, 'log').mockImplementation(() => {})

		// Clear all mocks
		vi.clearAllMocks()
	})

	afterEach(() => {
        vi.restoreAllMocks()
		// Clean up any remaining listeners
		mockChildProcess.removeAllListeners()
		mockWatcher.removeAllListeners()
	})

	describe('startApp', () => {
		it('spawns a child process with correct arguments', () => {
			startApp()

			expect(spawn).toHaveBeenCalledWith('node', [expect.stringContaining('server.js')], {
				stdio: 'pipe'
			})
		})

		it('pipes stdout and stderr to process streams', () => {
			startApp()

			expect(mockChildProcess.stdout.pipe).toHaveBeenCalledWith(process.stdout)
			expect(mockChildProcess.stderr.pipe).toHaveBeenCalledWith(process.stderr)
		})

		it('calls doneFunc when server outputs "Running"', () => {
			const mockDoneFunc = vi.fn()

			startApp(mockDoneFunc)

			// Simulate server startup message
			mockChildProcess.stdout.emit('data', Buffer.from('Server is Running on port 3000'))

			expect(mockDoneFunc).toHaveBeenCalled()
			expect(mockChildProcess.stdout.off).toHaveBeenCalled()
		})

		it('does not call doneFunc when server outputs other messages', () => {
			const mockDoneFunc = vi.fn()

			startApp(mockDoneFunc)

			// Simulate other server messages (without "Running")
			mockChildProcess.stdout.emit('data', Buffer.from('Starting server...'))
			mockChildProcess.stdout.emit('data', Buffer.from('Loading modules...'))
			expect(mockDoneFunc).not.toHaveBeenCalled()
			expect(mockChildProcess.stdout.off).not.toHaveBeenCalled()
		})

		it('handles process errors', () => {
			startApp()

			const error = new Error('Process failed')
			mockChildProcess.emit('error', error)

			expect(console.error).toHaveBeenCalled()
		})

		it('handles clean process exit', () => {
			startApp()

			mockChildProcess.emit('exit', 0, null)

			expect(console.log).toHaveBeenCalled()
			expect(console.error).not.toHaveBeenCalled()
		})

		it('handles process exit with error code', () => {
			startApp()

			mockChildProcess.emit('exit', 1, null)

			expect(console.log).toHaveBeenCalled()
			expect(console.error).not.toHaveBeenCalled()
		})
	})

	describe('watchApp', () => {
		it('creates a watcher with correct configuration', () => {
			watchApp()

			expect(chokidar.watch).toHaveBeenCalledWith('/mock/app/path', {
				ignored: expect.any(Function),
				ignoreInitial: true,
				persistent: true
			})
		})
		describe('ignored files logic', () => {
			let ignoreFunc
			let path
			let stats = { isFile: () => true }

			beforeEach(() => {
				watchApp()
				// Get the mock function for chokidar.watch
				const watchMock = vi.mocked(chokidar.watch)

				// Get the first time it was called
				const firstCall = watchMock.mock.calls[0]

				// The second argument contains the options
				const chokidarOptions = firstCall[1]

				// Extract the function we want to test
				ignoreFunc = chokidarOptions.ignored
			})

			it('watches .js files', () => {
				path = 'path/to/some/file.js'
				expect(ignoreFunc(path, stats)).toBe(false)
			})

			it('watches .json files', () => {
				path = 'path/to/some/config.json'
				expect(ignoreFunc(path, stats)).toBe(false)
			})

			it('ignores other file types (e.g., .txt)', () => {
				path = 'path/to/some/notes.txt'
				expect(ignoreFunc(path, stats)).toBe(true)
			})

			it('does NOT ignore directories', () => {
				path = 'path/to/some/directory'
				stats = { isFile: () => false }
				expect(ignoreFunc(path, stats)).toBe(false)
			})
		})
	})
})
