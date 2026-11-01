import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ fork: vi.fn() }))

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
	let buildPrototype
	let fork
	let getBuildResult
	let supervisor
	let mockChildProcess

	async function startAndWait(port) {
		const startPromise = supervisor.startPrototypeServer(port)
		mockChildProcess.emit('message', 'ready')
		await startPromise
	}

	// Stops the current child and returns a new one that says it is ready as
	// soon as the supervisor has attached its listeners.
	function replaceProcess() {
		const oldProcess = mockChildProcess
		const newProcess = createMockChildProcess()

		oldProcess.kill.mockImplementation(() => queueMicrotask(() => oldProcess.emit('exit', null, 'SIGTERM')))

		fork.mockImplementation(() => {
			queueMicrotask(() => newProcess.emit('message', 'ready'))
			return newProcess
		})

		return newProcess
	}

	beforeEach(async () => {
		vi.resetModules()
		vi.clearAllMocks()

		mockChildProcess = createMockChildProcess()

		fork = (await import('node:child_process')).fork
		fork.mockReturnValue(mockChildProcess)

		buildPrototype = vi.fn(() => ({ state: 'ok' }))
		getBuildResult = vi.fn(() => ({ state: 'ok' }))

		supervisor = (await import('./supervisor.js')).default
		supervisor.setBuild({ buildPrototype, getBuildResult })
	})

	describe('startPrototypeServer', () => {
		it('forks the prototype server with the port and the build result', async () => {
			const buildResult = { state: 'ok' }
			getBuildResult.mockReturnValue(buildResult)

			await startAndWait(3010)

			expect(supervisor.isReady()).toBe(true)

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

		it('does not build, so a restart uses the build result the parent already has', async () => {
			await startAndWait(3010)

			expect(buildPrototype).not.toHaveBeenCalled()
		})

		it('refuses to start before the prototype has been built', async () => {
			getBuildResult.mockReturnValue(undefined)

			await expect(supervisor.startPrototypeServer(3010)).rejects.toThrow('Build the prototype before starting it')
			expect(fork).not.toHaveBeenCalled()
		})

		it('rejects when the server exits with a non-zero code', async () => {
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

			const startPromise = supervisor.startPrototypeServer(3010)
			mockChildProcess.emit('exit', 1)

			await expect(startPromise).rejects.toThrow('Server exited with code 1')

			errorSpy.mockRestore()
		})
	})

	describe('stopPrototypeServer', () => {
		it('stops the running server process with SIGTERM', async () => {
			await startAndWait(3010)

			const stopPromise = supervisor.stopPrototypeServer()
			mockChildProcess.emit('exit', null, 'SIGTERM')
			await stopPromise

			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')
			expect(supervisor.isReady()).toBe(false)
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
	})

	describe('unexpected exit', () => {
		it('knows the prototype stopped unexpectedly', async () => {
			await startAndWait(3010)

			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			mockChildProcess.emit('exit', 1)

			expect(supervisor.isDown()).toBe(true)
			expect(supervisor.isReady()).toBe(false)
			expect(errorSpy).toHaveBeenCalledWith('supervisor - The prototype stopped unexpectedly')

			errorSpy.mockRestore()
		})

		it('is not down after a restart', async () => {
			await startAndWait(3010)
			replaceProcess()

			await supervisor.restartPrototypeServer()

			expect(supervisor.isDown()).toBe(false)
			expect(supervisor.isReady()).toBe(true)
		})
	})

	describe('restartPrototypeServer', () => {
		it('stops the current server and starts a new one on the same port', async () => {
			await startAndWait(3010)

			const oldProcess = mockChildProcess
			const newProcess = replaceProcess()

			await supervisor.restartPrototypeServer()

			expect(oldProcess.kill).toHaveBeenCalledWith('SIGTERM')
			expect(fork).toHaveBeenCalledTimes(2)
			expect(fork).toHaveBeenLastCalledWith(expect.stringContaining('prototype-server.js'), [], {
				silent: true,
				serialization: 'advanced'
			})
			expect(newProcess.send).toHaveBeenCalledWith({ action: 'start', port: 3010, buildResult: { state: 'ok' } })
		})

		it('restarts with the build result the parent has now', async () => {
			await startAndWait(3010)

			const newProcess = replaceProcess()
			const newBuildResult = { state: 'error', error: new Error('broken sass') }
			getBuildResult.mockReturnValue(newBuildResult)

			await supervisor.restartPrototypeServer()

			expect(buildPrototype).not.toHaveBeenCalled()
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
					queueMicrotask(() => child.emit('message', 'ready'))
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
