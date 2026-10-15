import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('node:child_process')
vi.mock('./utils/stop-process.js')

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

	beforeEach(() => {
		vi.clearAllMocks()

		mockChildProcess = createMockChildProcess()
		vi.mocked(fork).mockReturnValue(mockChildProcess)

		vi.mocked(stopProcess).mockResolvedValue(undefined)

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

			expect(fork).toHaveBeenCalledWith(expect.stringContaining('prototype-server.js'), [], { silent: true })
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

		it('serialises a build error before sending it', async () => {
			const error = new Error('Build failed')
			const startPromise = ServerManager.start({ state: 'error', error })

			expect(mockChildProcess.send).toHaveBeenCalledWith({
				type: 'buildResult',
				buildResult: {
					state: 'error',
					error: { message: 'Build failed', stack: error.stack }
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
				mockChildProcess.stderr.emit('data', Buffer.from('Error output'))
				mockChildProcess.emit('exit', 1)
			}, 10)

			await expect(startPromise).rejects.toThrow('Error output')
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
		it('stops running server process', async () => {
			ServerManager.serverProcess = mockChildProcess
			mockChildProcess.exitCode = null

			await ServerManager.stop()

			expect(stopProcess).toHaveBeenCalledWith(mockChildProcess)
		})

		it('does nothing when server already exited', async () => {
			ServerManager.serverProcess = mockChildProcess
			mockChildProcess.exitCode = 0

			await ServerManager.stop()

			expect(stopProcess).not.toHaveBeenCalled()
		})
	})

	describe('restart', () => {
		it('stops current server and starts a new one', async () => {
			ServerManager.serverProcess = mockChildProcess
			mockChildProcess.exitCode = null

			const restartPromise = ServerManager.restart({ state: 'ok' })

			setTimeout(() => {
				mockChildProcess.emit('message', 'ready')
			}, 20)

			await restartPromise

			expect(stopProcess).toHaveBeenCalledOnce()
			expect(fork).toHaveBeenCalledOnce()
		})
	})

	describe('cleanup', () => {
		it('stops server and exits with code 0 on successful cleanup', async () => {
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})

			ServerManager.serverProcess = mockChildProcess
			mockChildProcess.exitCode = null

			await ServerManager.cleanup('SIGINT')

			expect(stopProcess).toHaveBeenCalledOnce()
			expect(exitSpy).toHaveBeenCalledWith(0)

			exitSpy.mockRestore()
		})

		it('exits with code 1 when cleanup fails', async () => {
			const error = new Error('Cleanup failed')
			vi.mocked(stopProcess).mockRejectedValue(error)

			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

			ServerManager.serverProcess = mockChildProcess

			await ServerManager.cleanup('SIGTERM')

			expect(exitSpy).toHaveBeenCalledWith(1)
			expect(consoleSpy).toHaveBeenCalled()

			exitSpy.mockRestore()
			consoleSpy.mockRestore()
		})
	})
})
