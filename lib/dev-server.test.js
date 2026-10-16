import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process')
vi.mock('express')
vi.mock('../manage-prototype/index.js', () => ({
	default: { getDevApp: vi.fn() }
}))
vi.mock('./middleware/proxy.js', () => ({
	createProxyMiddleware: vi.fn()
}))
vi.mock('./watch.js', () => ({
	watch: vi.fn()
}))

import express from 'express'
import managePrototype from '../manage-prototype/index.js'
import devServer from './dev-server.js'
import { createProxyMiddleware } from './middleware/proxy.js'
import { watch } from './watch.js'

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
	})
})
