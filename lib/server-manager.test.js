import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('node:child_process')
vi.mock('../manage-prototype/app.js')
vi.mock('./build.js')
vi.mock('./livereload.js')
vi.mock('./utils/stop-process.js')

// Import mocked modules
import { getManagePrototypeApp } from '../manage-prototype/app.js'
import { getBuildState } from './build.js'
import livereload from './livereload.js'
// Import the module under test
import ServerManager from './server-manager.js'
import { stopProcess } from './utils/stop-process.js'

// Create a mock child process
const createMockChildProcess = () => {
	const mockProcess = new EventEmitter()
	mockProcess.stdout = new EventEmitter()
	mockProcess.stderr = new EventEmitter()
	mockProcess.stdout.pipe = vi.fn()
	mockProcess.stderr.pipe = vi.fn()
	mockProcess.send = vi.fn()
	mockProcess.exitCode = null
	return mockProcess
}

describe('ServerManager', () => {
	let mockChildProcess
	let mockManageApp

	beforeEach(() => {
		vi.clearAllMocks()

		mockChildProcess = createMockChildProcess()
		vi.mocked(fork).mockReturnValue(mockChildProcess)

		mockManageApp = { listen: vi.fn() }
		vi.mocked(getManagePrototypeApp).mockReturnValue(mockManageApp)

		vi.mocked(getBuildState).mockReturnValue({ state: 'success' })
		vi.mocked(livereload.reload).mockResolvedValue(undefined)
		vi.mocked(stopProcess).mockResolvedValue(undefined)

		// Reset the singleton instance
		ServerManager.serverProcess = null
		ServerManager.serverState = null
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('startManagePrototype', () => {
		it('starts manage prototype app on configured port', () => {
			process.env.MANAGE_PROTOTYPE_PORT = '3001'

			ServerManager.startManagePrototype()

			expect(getManagePrototypeApp).toHaveBeenCalledOnce()
			expect(mockManageApp.listen).toHaveBeenCalledWith('3001')
		})
	})

	describe('startPrototype', () => {
		it('starts prototype server when build state is successful', async () => {
			vi.mocked(getBuildState).mockReturnValue({ state: 'success' })

			const startPromise = ServerManager.startPrototype()

			// Simulate server startup with process.send('ready')
			setTimeout(() => {
				mockChildProcess.emit('message', 'ready')
			}, 10)

			await startPromise

			expect(fork).toHaveBeenCalledWith(expect.stringContaining('prototype-server.js'), [], { silent: true })
			expect(ServerManager.getState()).toBe('prototype')
		})

		it('starts error server when build state has error', async () => {
			const buildError = new Error('Build failed')
			vi.mocked(getBuildState).mockReturnValue({
				state: 'error',
				error: buildError
			})

			const startPromise = ServerManager.startPrototype()

			// Simulate error server startup with process.send('ready')
			setTimeout(() => {
				mockChildProcess.emit('message', 'ready')
			}, 10)

			await startPromise

			expect(fork).toHaveBeenCalledWith(expect.stringContaining('error-server.js'), [buildError], { silent: true })
			expect(ServerManager.getState()).toBe('error')
			expect(livereload.reload).toHaveBeenCalledOnce()
		})

		it('starts error server when prototype server fails', async () => {
			vi.mocked(getBuildState).mockReturnValue({ state: 'success' })

			// Create separate mock processes for prototype and error server
			const mockErrorProcess = createMockChildProcess()
			vi.mocked(fork)
				.mockReturnValueOnce(mockChildProcess) // First call for prototype server
				.mockReturnValueOnce(mockErrorProcess) // Second call for error server

			const startPromise = ServerManager.startPrototype()

			// Simulate prototype server error, then error server success
			setTimeout(() => {
				mockChildProcess.emit('error', new Error('Server startup failed'))
			}, 10)

			setTimeout(() => {
				mockErrorProcess.emit('message', 'ready')
			}, 20)

			await startPromise

			// Should attempt prototype first, then error server
			expect(fork).toHaveBeenCalledTimes(2)
			expect(ServerManager.getState()).toBe('error')
		})
	})

	describe('startErrorServer', () => {
		it('starts error server with provided error', async () => {
			const error = new Error('Test error')

			const startPromise = ServerManager.startErrorServer(error)

			setTimeout(() => {
				mockChildProcess.emit('message', 'ready')
			}, 10)

			await startPromise

			expect(fork).toHaveBeenCalledWith(expect.stringContaining('error-server.js'), [error], { silent: true })
			expect(ServerManager.getState()).toBe('error')
			expect(livereload.reload).toHaveBeenCalledOnce()
		})
	})

	describe('start', () => {
		it('starts server process and resolves when ready', async () => {
			const startPromise = ServerManager.start('test-server.js', ['arg1'])

			setTimeout(() => {
				mockChildProcess.emit('message', 'ready')
			}, 10)

			await startPromise

			expect(fork).toHaveBeenCalledWith(expect.stringContaining('test-server.js'), ['arg1'], { silent: true })
			expect(mockChildProcess.stdout.pipe).toHaveBeenCalledWith(process.stdout)
			expect(mockChildProcess.stderr.pipe).toHaveBeenCalledWith(process.stderr)
		})

		it('rejects when server process emits error', async () => {
			const error = new Error('Process error')

			const startPromise = ServerManager.start('test-server.js')

			setTimeout(() => {
				mockChildProcess.emit('error', error)
			}, 10)

			await expect(startPromise).rejects.toThrow('Process error')
		})

		it('rejects when server exits with non-zero code', async () => {
			const startPromise = ServerManager.start('test-server.js')

			setTimeout(() => {
				mockChildProcess.stderr.emit('data', Buffer.from('Error output'))
				mockChildProcess.emit('exit', 1)
			}, 10)

			await expect(startPromise).rejects.toThrow('Error output')
		})

		it('resolves normally when server exits with code 0', async () => {
			const startPromise = ServerManager.start('test-server.js')

			setTimeout(() => {
				mockChildProcess.emit('message', 'ready')
			}, 10)

			await expect(startPromise).resolves.toBeUndefined()
		})
	})

	describe('stop', () => {
		it('stops running server process', async () => {
			ServerManager.serverProcess = mockChildProcess
			mockChildProcess.exitCode = null

			await ServerManager.stop()

			expect(stopProcess).toHaveBeenCalledWith(mockChildProcess)
			expect(ServerManager.getState()).toBeNull()
		})

		it('does nothing when server already exited', async () => {
			ServerManager.serverProcess = mockChildProcess
			mockChildProcess.exitCode = 0

			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

			await ServerManager.stop()

			expect(stopProcess).not.toHaveBeenCalled()
			expect(consoleSpy).toHaveBeenCalledWith('server manager - server process already exited')

			consoleSpy.mockRestore()
		})
	})

	describe('restart', () => {
		it('stops current server and starts prototype', async () => {
			vi.mocked(getBuildState).mockReturnValue({ state: 'success' })
			ServerManager.serverProcess = mockChildProcess
			mockChildProcess.exitCode = null

			const restartPromise = ServerManager.restart()

			setTimeout(() => {
				mockChildProcess.emit('message', 'ready')
			}, 20)

			await restartPromise

			expect(stopProcess).toHaveBeenCalledOnce()
			expect(fork).toHaveBeenCalledOnce()
			expect(livereload.reload).toHaveBeenCalledOnce()
		})
	})

	describe('getState', () => {
		it('returns current server state', () => {
			ServerManager.serverState = 'prototype'

			expect(ServerManager.getState()).toBe('prototype')
		})

		it('returns null when no state set', () => {
			ServerManager.serverState = null

			expect(ServerManager.getState()).toBeNull()
		})
	})

	describe('cleanup', () => {
		it('stops server and exits with code 0 on successful cleanup', async () => {
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

			ServerManager.serverProcess = mockChildProcess
			mockChildProcess.exitCode = null

			await ServerManager.cleanup('SIGINT')

			expect(stopProcess).toHaveBeenCalledOnce()
			expect(consoleSpy).toHaveBeenCalledWith('server manager - Received SIGINT - cleaning up...')
			expect(consoleSpy).toHaveBeenCalledWith('server manager - Cleanup completed')
			expect(exitSpy).toHaveBeenCalledWith(0)

			exitSpy.mockRestore()
			consoleSpy.mockRestore()
		})

		it('exits with code 1 when cleanup fails', async () => {
			const error = new Error('Cleanup failed')
			vi.mocked(stopProcess).mockRejectedValue(error)

			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

			ServerManager.serverProcess = mockChildProcess

			await ServerManager.cleanup('SIGTERM')

			expect(consoleErrorSpy).toHaveBeenCalledWith('server manager - Error during cleanup:', error)
			expect(exitSpy).toHaveBeenCalledWith(1)

			exitSpy.mockRestore()
			consoleErrorSpy.mockRestore()
		})
	})
})
