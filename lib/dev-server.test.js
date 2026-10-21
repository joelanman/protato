import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process')
vi.mock('express')
vi.mock('../manage-prototype/index.js', () => ({
	default: { getDevApp: vi.fn() }
}))
vi.mock('./build.js', () => ({
	buildPrototype: vi.fn(() => ({ state: 'ok' }))
}))
vi.mock('./livereload.js', () => ({
	default: { reload: vi.fn() }
}))
vi.mock('./middleware/proxy.js', () => ({
	createProxyMiddleware: vi.fn()
}))
vi.mock('./plugin-manager.js', () => ({
	runPluginAction: vi.fn()
}))
vi.mock('./plugins.js', () => ({
	default: { clearCache: vi.fn() }
}))
vi.mock('./watch.js', () => ({
	setBuildResult: vi.fn(),
	syncPackageState: vi.fn(),
	watch: vi.fn()
}))

import express from 'express'
import managePrototype from '../manage-prototype/index.js'
import { buildPrototype } from './build.js'
import devServer from './dev-server.js'
import livereload from './livereload.js'
import { createProxyMiddleware } from './middleware/proxy.js'
import { runPluginAction } from './plugin-manager.js'
import plugins from './plugins.js'
import { setBuildResult, syncPackageState, watch } from './watch.js'

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

describe('devServer', () => {
	let mockChildProcess

	beforeEach(() => {
		vi.clearAllMocks()

		mockChildProcess = createMockChildProcess()
		vi.mocked(fork).mockReturnValue(mockChildProcess)

		devServer.prototypePort = 3010
		devServer.prototypeProcess = null
		devServer.updatingPlugins = false
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('start', () => {
		it('starts the dev app, prototype server on port + 10, and file watcher', async () => {
			const mockApp = { use: vi.fn(), listen: vi.fn() }
			vi.mocked(express).mockReturnValue(mockApp)

			const buildResult = { state: 'ok' }
			const startPromise = devServer.start(3000, buildResult)
			mockChildProcess.emit('message', 'ready')
			await startPromise

			expect(mockApp.use).toHaveBeenCalledWith('/manage-prototype', managePrototype.getDevApp())
			expect(createProxyMiddleware).toHaveBeenCalledWith({ target: 'http://localhost:3010' })
			expect(mockApp.listen).toHaveBeenCalledWith(3000)
			expect(mockChildProcess.send).toHaveBeenCalledWith({
				action: 'start',
				port: 3010,
				buildResult
			})
			expect(watch).toHaveBeenCalledWith(buildResult)
		})

		it('returns 503 for prototype requests while plugins are updating', async () => {
			const middlewares = []
			const mockApp = {
				use: vi.fn((...args) => {
					if (typeof args[0] === 'function') {
						middlewares.push(args[0])
					}
				}),
				listen: vi.fn()
			}
			vi.mocked(express).mockReturnValue(mockApp)

			const startPromise = devServer.start(3000, { state: 'ok' })
			mockChildProcess.emit('message', 'ready')
			await startPromise

			const statusMiddleware = middlewares[0]
			const response = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn()
			}
			const next = vi.fn()

			statusMiddleware({}, response, next)
			expect(next).toHaveBeenCalledOnce()

			devServer.updatingPlugins = true
			statusMiddleware({}, response, next)
			expect(response.status).toHaveBeenCalledWith(503)
			expect(response.send).toHaveBeenCalledWith('The prototype is restarting while plugins are being updated.')
		})
	})

	describe('startPrototype', () => {
		it('forks the prototype server, sends start message, and resolves when ready', async () => {
			const buildResult = { state: 'ok' }
			const startPromise = devServer.startPrototype(buildResult)
			mockChildProcess.emit('message', 'ready')
			await startPromise

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

		it('rejects when server exits with non-zero code', async () => {
			const startPromise = devServer.startPrototype({ state: 'ok' })
			mockChildProcess.emit('exit', 1)

			await expect(startPromise).rejects.toThrow('Server exited with code 1')
		})
	})

	describe('stopPrototype', () => {
		it('stops running server process with SIGTERM', async () => {
			devServer.prototypeProcess = mockChildProcess

			const stopPromise = devServer.stopPrototype()
			mockChildProcess.emit('exit', null, 'SIGTERM')
			await stopPromise

			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')
		})

		it('does nothing when server already exited', async () => {
			devServer.prototypeProcess = mockChildProcess

			mockChildProcess.exitCode = 0
			await devServer.stopPrototype()

			mockChildProcess.exitCode = null
			mockChildProcess.signalCode = 'SIGTERM'
			await devServer.stopPrototype()

			expect(mockChildProcess.kill).not.toHaveBeenCalled()
		})

		it('escalates to SIGKILL if graceful stop times out', async () => {
			vi.useFakeTimers()
			devServer.prototypeProcess = mockChildProcess

			const stopPromise = devServer.stopPrototype()
			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM')

			vi.advanceTimersByTime(2000)
			expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL')

			mockChildProcess.emit('exit', null, 'SIGKILL')
			await stopPromise

			vi.useRealTimers()
		})
	})

	describe('restartPrototype', () => {
		it('stops current server and starts a new one', async () => {
			const oldProcess = createMockChildProcess()
			const newProcess = createMockChildProcess()
			oldProcess.kill.mockImplementation(() => queueMicrotask(() => oldProcess.emit('exit', null, 'SIGTERM')))
			newProcess.send.mockImplementation(() => newProcess.emit('message', 'ready'))
			vi.mocked(fork).mockReturnValue(newProcess)

			devServer.prototypeProcess = oldProcess

			await devServer.restartPrototype({ state: 'ok' })

			expect(oldProcess.kill).toHaveBeenCalledWith('SIGTERM')
			expect(fork).toHaveBeenCalledOnce()
		})

		it('does not start a new prototype if an update starts while stopping', async () => {
			const oldProcess = createMockChildProcess()
			const newProcess = createMockChildProcess()
			vi.mocked(fork).mockReturnValue(newProcess)
			devServer.prototypeProcess = oldProcess

			const restartPromise = devServer.restartPrototype({ state: 'ok' })
			devServer.updatingPlugins = true
			oldProcess.emit('exit', null, 'SIGTERM')
			await restartPromise

			expect(fork).not.toHaveBeenCalled()
		})

		it('does nothing while plugins are updating', async () => {
			devServer.updatingPlugins = true
			devServer.prototypeProcess = mockChildProcess

			await devServer.restartPrototype({ state: 'ok' })

			expect(mockChildProcess.kill).not.toHaveBeenCalled()
			expect(fork).not.toHaveBeenCalled()
		})
	})

	describe('updatePlugins', () => {
		const plan = {
			action: 'install',
			changes: [{ packageName: 'hmrc-frontend', version: '7.41.0' }]
		}

		it('stops the prototype, runs npm, rebuilds, restarts, and reloads in order', async () => {
			const order = []
			const oldProcess = createMockChildProcess()
			const newProcess = createMockChildProcess()
			oldProcess.kill.mockImplementation(() => {
				order.push('stop')
				queueMicrotask(() => oldProcess.emit('exit', null, 'SIGTERM'))
			})
			newProcess.send.mockImplementation(() => {
				order.push('start')
				newProcess.emit('message', 'ready')
			})
			vi.mocked(fork).mockReturnValue(newProcess)
			vi.mocked(runPluginAction).mockImplementation(async () => {
				order.push('npm')
				return { ok: true, exitCode: 0 }
			})
			vi.mocked(plugins.clearCache).mockImplementation(() => order.push('clearCache'))
			vi.mocked(buildPrototype).mockImplementation(() => {
				order.push('build')
				return { state: 'ok' }
			})
			vi.mocked(livereload.reload).mockImplementation(() => order.push('reload'))

			devServer.prototypeProcess = oldProcess

			const result = await devServer.updatePlugins(plan)

			expect(result).toEqual({ ok: true, exitCode: 0 })
			expect(order).toEqual(['stop', 'npm', 'clearCache', 'build', 'start', 'reload'])
			expect(setBuildResult).toHaveBeenCalledWith({ state: 'ok' })
			expect(syncPackageState).toHaveBeenCalledOnce()
			expect(devServer.updatingPlugins).toBe(false)
		})

		it('still rebuilds and restarts when npm fails', async () => {
			mockChildProcess.send.mockImplementation(() => mockChildProcess.emit('message', 'ready'))
			vi.mocked(runPluginAction).mockResolvedValue({ ok: false, exitCode: 1, stderr: 'ERR!' })

			const result = await devServer.updatePlugins(plan)

			expect(result.ok).toBe(false)
			expect(plugins.clearCache).toHaveBeenCalledOnce()
			expect(buildPrototype).toHaveBeenCalledOnce()
			expect(fork).toHaveBeenCalledOnce()
			expect(devServer.updatingPlugins).toBe(false)
		})

		it('resets the update flag when rebuilding throws', async () => {
			vi.mocked(runPluginAction).mockResolvedValue({ ok: true, exitCode: 0 })
			vi.mocked(buildPrototype).mockImplementation(() => {
				throw new Error('layout broke')
			})

			await expect(devServer.updatePlugins(plan)).rejects.toThrow('layout broke')

			expect(devServer.updatingPlugins).toBe(false)
			expect(syncPackageState).toHaveBeenCalledOnce()
			expect(fork).not.toHaveBeenCalled()
		})

		it('rejects overlapping plugin operations', async () => {
			devServer.updatingPlugins = true

			await expect(devServer.updatePlugins(plan)).rejects.toMatchObject({
				message: 'Another plugin operation is already running',
				code: 'BUSY'
			})
			expect(runPluginAction).not.toHaveBeenCalled()
		})
	})

	describe('refreshPlugins', () => {
		it('stops, clears the plugin cache, rebuilds, restarts and reloads once', async () => {
			const order = []
			const oldProcess = createMockChildProcess()
			const newProcess = createMockChildProcess()
			oldProcess.kill.mockImplementation(() => {
				order.push('stop')
				queueMicrotask(() => oldProcess.emit('exit', null, 'SIGTERM'))
			})
			newProcess.send.mockImplementation(() => {
				order.push('start')
				newProcess.emit('message', 'ready')
			})
			vi.mocked(fork).mockReturnValue(newProcess)
			vi.mocked(plugins.clearCache).mockImplementation(() => order.push('clearCache'))
			vi.mocked(buildPrototype).mockImplementation(() => {
				order.push('build')
				return { state: 'ok' }
			})
			vi.mocked(livereload.reload).mockImplementation(() => order.push('reload'))

			devServer.prototypeProcess = oldProcess

			await devServer.refreshPlugins()

			expect(order).toEqual(['stop', 'clearCache', 'build', 'start', 'reload'])
			expect(runPluginAction).not.toHaveBeenCalled()
			expect(syncPackageState).not.toHaveBeenCalled()
			expect(devServer.updatingPlugins).toBe(false)
		})

		it('does nothing while another plugin operation is running', async () => {
			devServer.updatingPlugins = true

			await devServer.refreshPlugins()

			expect(plugins.clearCache).not.toHaveBeenCalled()
			expect(fork).not.toHaveBeenCalled()
		})

		it('resets the update flag when rebuilding throws', async () => {
			vi.mocked(buildPrototype).mockImplementation(() => {
				throw new Error('layout broke')
			})

			await expect(devServer.refreshPlugins()).rejects.toThrow('layout broke')

			expect(devServer.updatingPlugins).toBe(false)
			expect(syncPackageState).not.toHaveBeenCalled()
			expect(fork).not.toHaveBeenCalled()
		})
	})
})
