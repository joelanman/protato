import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('node:child_process')

// Import the module under test
import ServerManager from './server-manager.js'

// Create a mock child process
const createMockChildProcess = () => {
	const mockProcess = new EventEmitter()
	mockProcess.stdout = new EventEmitter()
	mockProcess.stderr = new EventEmitter()
	mockProcess.stdout.pipe = vi.fn()
	mockProcess.stderr.pipe = vi.fn()
	mockProcess.send = vi.fn()
	mockProcess.kill = vi.fn()
	mockProcess.exitCode = null
	mockProcess.signalCode = null
	return mockProcess
}

describe('ServerManager', () => {
	let mockChildProcess

	beforeEach(() => {
		vi.clearAllMocks()

		mockChildProcess = createMockChildProcess()
		vi.mocked(fork).mockReturnValue(mockChildProcess)

		// Reset the singleton instance
		ServerManager.serverProcess = null
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('start', () => {
		it('forks the prototype server and resolves when ready', async () => {
			const startPromise = ServerManager.start({ state: 'ok' })

			setTimeout(() => {
				mockChildProcess.emit('message', 'ready')
			}, 10)

			await startPromise

			expect(fork).toHaveBeenCalledWith(expect.stringContaining('prototype-server.js'), [], {
				silent: true,
				serialization: 'advanced'
			})
			expect(mockChildProcess.stdout.pipe).toHaveBeenCalledWith(process.stdout)
			expect(mockChildProcess.stderr.pipe).toHaveBeenCalledWith(process.stderr)
		})

		it('sends the build result to the server', async () => {
			const startPromise = ServerManager.start({ state: 'ok' })

			expect(mockChildProcess.send).toHaveBeenCalledWith({
				type: 'buildResult',
				buildResult: expect.objectContaining({ state: 'ok' })
			})

			mockChildProcess.emit('message', 'ready')
			await startPromise
		})

		it('sends the build result with error to the server', async () => {
			const error = new Error('Build failed')
			const startPromise = ServerManager.start({ state: 'error', error })

			expect(mockChildProcess.send).toHaveBeenCalledWith({
				type: 'buildResult',
				buildResult: {
					state: 'error',
					error
				}
			})

			mockChildProcess.emit('message', 'ready')
			await startPromise
		})

		it('rejects when server process emits error', async () => {
			const error = new Error('Process error')

			const startPromise = ServerManager.start({ state: 'ok' })

			setTimeout(() => {
				mockChildProcess.emit('error', error)
			}, 10)

			await expect(startPromise).rejects.toThrow('Process error')
		})

		it('rejects when server exits with non-zero code', async () => {
			const startPromise = ServerManager.start({ state: 'ok' })

			setTimeout(() => {
				mockChildProcess.emit('exit', 1)
			}, 10)

			await expect(startPromise).rejects.toThrow('Server exited with code 1')
		})

		it('resolves normally when server exits with code 0', async () => {
			const startPromise = ServerManager.start({ state: 'ok' })

			setTimeout(() => {
				mockChildProcess.emit('exit', 0)
			}, 10)

			await expect(startPromise).resolves.toBeUndefined()
		})
	})

	describe('stop', () => {
		it('stops running server process with SIGTERM', async () => {
			ServerManager.serverProcess = mockChildProcess

			const stopPromise = ServerManager.stop()
			mockChildProcess.emit('exit', null, 'SIGTERM')
			await stopPromise

			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')
		})

		it('does nothing when server already exited', async () => {
			ServerManager.serverProcess = mockChildProcess

			// Already exited by exitCode
			mockChildProcess.exitCode = 0
			await ServerManager.stop()

			// Already exited by signal
			mockChildProcess.exitCode = null
			mockChildProcess.signalCode = 'SIGTERM'
			await ServerManager.stop()

			expect(mockChildProcess.kill).not.toHaveBeenCalled()
		})

		it('escalates to SIGKILL if graceful stop times out', async () => {
			vi.useFakeTimers()
			ServerManager.serverProcess = mockChildProcess

			const stopPromise = ServerManager.stop()
			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')

			vi.advanceTimersByTime(2000)
			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL')

			mockChildProcess.emit('exit', null, 'SIGKILL')
			await stopPromise

			vi.useRealTimers()
		})
	})

	describe('restart', () => {
		it('stops current server and starts a new one', async () => {
			const oldProcess = createMockChildProcess()
			const newProcess = createMockChildProcess()
			vi.mocked(fork).mockReturnValue(newProcess)

			ServerManager.serverProcess = oldProcess
			oldProcess.exitCode = null
			oldProcess.signalCode = null

			const restartPromise = ServerManager.restart({ state: 'ok' })

			setTimeout(() => {
				oldProcess.emit('exit', null, 'SIGTERM')
			}, 10)

			setTimeout(() => {
				newProcess.emit('message', 'ready')
			}, 20)

			await restartPromise

			expect(oldProcess.kill).toHaveBeenCalledWith('SIGTERM')
			expect(fork).toHaveBeenCalledOnce()
		})
	})
})
