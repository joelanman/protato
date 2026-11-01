import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ fork: vi.fn() }))
vi.mock('../build.js', () => ({ getBuildResult: vi.fn() }))

const createMockChildProcess = () => {
	const mockProcess = new EventEmitter()
	mockProcess.stdout = { pipe: vi.fn() }
	mockProcess.stderr = { pipe: vi.fn() }
	mockProcess.send = vi.fn()
	mockProcess.kill = vi.fn()
	mockProcess.exitCode = null
	mockProcess.signalCode = null
	return mockProcess
}

// The state lives in module-level variables, so each test gets a fresh module.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('prototype supervisor', () => {
	let fork
	let getBuildResult
	let supervisor
	let mockChildProcess

	async function startAndWait(port, buildResult = { state: 'ok' }) {
		getBuildResult.mockReturnValue(buildResult)

		const startPromise = supervisor.startPrototypeServer(port)
		mockChildProcess.emit('message', 'ready')
		await startPromise
	}

	beforeEach(async () => {
		vi.resetModules()
		vi.clearAllMocks()

		mockChildProcess = createMockChildProcess()

		fork = (await import('node:child_process')).fork
		fork.mockReturnValue(mockChildProcess)

		getBuildResult = (await import('../build.js')).getBuildResult
		getBuildResult.mockReturnValue({ state: 'ok' })
		supervisor = (await import('./supervisor.js')).default
	})

	describe('ready state', () => {
		it('becomes ready when the prototype server says it is listening', async () => {
			const listener = vi.fn()
			supervisor.onReadyChange(listener)

			await startAndWait(3010)

			expect(supervisor.getReady()).toBe(true)
			expect(listener).toHaveBeenCalledWith(true)
		})

		it('is not ready while the prototype server is restarting', async () => {
			await startAndWait(3010)

			const listener = vi.fn()
			supervisor.onReadyChange(listener)

			const oldProcess = mockChildProcess
			const newProcess = createMockChildProcess()
			oldProcess.kill.mockImplementation(() => queueMicrotask(() => oldProcess.emit('exit', null, 'SIGTERM')))
			newProcess.send.mockImplementation(() => newProcess.emit('message', 'ready'))
			fork.mockReturnValue(newProcess)

			await supervisor.restartPrototypeServer()

			expect(listener).toHaveBeenCalledWith(false)
			expect(listener).toHaveBeenLastCalledWith(true)
		})

		it('is not ready when the prototype server crashes', async () => {
			await startAndWait(3010)

			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			mockChildProcess.emit('exit', 1)

			expect(supervisor.getReady()).toBe(false)
			expect(errorSpy).toHaveBeenCalledWith('supervisor - The prototype stopped unexpectedly')

			errorSpy.mockRestore()
		})
	})

	describe('startPrototypeServer', () => {
		it('forks the prototype server with the port and build result', async () => {
			const buildResult = { state: 'ok' }

			await startAndWait(3010, buildResult)

			expect(fork).toHaveBeenCalledWith(expect.stringContaining('prototype-server.js'), [], {
				silent: true,
				serialization: 'advanced'
			})
			expect(mockChildProcess.stdout.pipe).toHaveBeenCalledWith(process.stdout)
			expect(mockChildProcess.stderr.pipe).toHaveBeenCalledWith(process.stderr)
			expect(mockChildProcess.send).toHaveBeenCalledWith({
				action: 'start',
				port: 3010,
				buildResult
			})
		})

		it('refuses to start before the prototype has been built', async () => {
			getBuildResult.mockReturnValue(undefined)

			await expect(supervisor.startPrototypeServer(3010)).rejects.toThrow('Build the prototype before starting it')
			expect(fork).not.toHaveBeenCalled()
		})

		it('rejects when the server exits with a non-zero code', async () => {
			const startPromise = supervisor.startPrototypeServer(3010)
			mockChildProcess.emit('exit', 1)

			await expect(startPromise).rejects.toThrow('Server exited with code 1')
		})
	})

	describe('stopPrototypeServer', () => {
		it('stops the running server process with SIGTERM', async () => {
			await startAndWait(3010)

			const stopPromise = supervisor.stopPrototypeServer()
			mockChildProcess.emit('exit', null, 'SIGTERM')
			await stopPromise

			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')
		})

		it('does nothing when the server has already exited', async () => {
			await startAndWait(3010)

			mockChildProcess.exitCode = 0
			await supervisor.stopPrototypeServer()

			mockChildProcess.exitCode = null
			mockChildProcess.signalCode = 'SIGTERM'
			await supervisor.stopPrototypeServer()

			expect(mockChildProcess.kill).not.toHaveBeenCalled()
		})

		it('escalates to SIGKILL if the graceful stop times out', async () => {
			vi.useFakeTimers()
			await startAndWait(3010)

			const stopPromise = supervisor.stopPrototypeServer()
			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')

			vi.advanceTimersByTime(2000)
			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL')

			mockChildProcess.emit('exit', null, 'SIGKILL')
			await stopPromise

			vi.useRealTimers()
		})
	})

	describe('restartPrototypeServer', () => {
		it('stops the current server and starts a new one on the same port', async () => {
			const buildResult = { state: 'ok' }
			await startAndWait(3010, buildResult)

			const oldProcess = mockChildProcess
			const newProcess = createMockChildProcess()
			oldProcess.kill.mockImplementation(() => queueMicrotask(() => oldProcess.emit('exit', null, 'SIGTERM')))
			newProcess.send.mockImplementation(() => newProcess.emit('message', 'ready'))
			fork.mockReturnValue(newProcess)

			await supervisor.restartPrototypeServer()

			expect(oldProcess.kill).toHaveBeenCalledWith('SIGTERM')
			expect(fork).toHaveBeenCalledTimes(2)
			expect(newProcess.send).toHaveBeenCalledWith({
				action: 'start',
				port: 3010,
				buildResult
			})
		})

		it('restarts with the latest build result', async () => {
			const firstResult = { state: 'ok' }
			await startAndWait(3010, firstResult)

			const oldProcess = mockChildProcess
			const newProcess = createMockChildProcess()
			const newBuildResult = { state: 'error', error: new Error('broken') }
			getBuildResult.mockReturnValue(newBuildResult)
			oldProcess.kill.mockImplementation(() => queueMicrotask(() => oldProcess.emit('exit', null, 'SIGTERM')))
			newProcess.send.mockImplementation(() => newProcess.emit('message', 'ready'))
			fork.mockReturnValue(newProcess)

			await supervisor.restartPrototypeServer()

			expect(newProcess.send).toHaveBeenCalledWith({
				action: 'start',
				port: 3010,
				buildResult: newBuildResult
			})
		})

		it('coalesces restarts requested while one is running into one more restart', async () => {
			await startAndWait(3010)

			const oldProcess = mockChildProcess
			let firstNewProcess

			oldProcess.kill.mockImplementation(() => queueMicrotask(() => oldProcess.emit('exit', null, 'SIGTERM')))
			fork.mockImplementation(() => {
				const child = createMockChildProcess()
				child.kill.mockImplementation(() => queueMicrotask(() => child.emit('exit', null, 'SIGTERM')))

				// the first restart is held open, so the second request arrives while it runs
				if (!firstNewProcess) {
					firstNewProcess = child
				} else {
					child.send.mockImplementation(() => child.emit('message', 'ready'))
				}

				return child
			})

			const firstRestart = supervisor.restartPrototypeServer()
			const secondRestart = supervisor.restartPrototypeServer()

			expect(secondRestart).toBe(firstRestart)

			await settle()
			firstNewProcess.emit('message', 'ready')
			await firstRestart

			// the held restart started, plus one more for the coalesced request
			expect(fork).toHaveBeenCalledTimes(3)
		})
	})
})
