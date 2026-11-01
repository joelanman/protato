import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('express')
vi.mock('../../manage-prototype/apps/dev-app.js', () => ({
	getDevApp: vi.fn()
}))
vi.mock('./proxy.js', () => ({
	createProxy: vi.fn()
}))
vi.mock('./supervisor.js', () => ({
	default: {
		getReady: vi.fn(),
		onReadyChange: vi.fn(),
		restartPrototypeServer: vi.fn()
	}
}))

import express from 'express'
import { getDevApp } from '../../manage-prototype/apps/dev-app.js'
import managePrototype from '../../manage-prototype/index.js'
import { createProxy } from './proxy.js'
import devServer from './server.js'
import supervisor from './supervisor.js'

describe('devServer', () => {
	let mockApp
	let proxy

	beforeEach(() => {
		vi.clearAllMocks()

		mockApp = { use: vi.fn(), listen: vi.fn() }
		proxy = { handle: vi.fn(), setReady: vi.fn() }
		vi.mocked(express).mockReturnValue(mockApp)
		vi.mocked(createProxy).mockReturnValue(proxy)
	})

	// the path of each app.use call, in the order they were registered
	const mountedPaths = () => mockApp.use.mock.calls.map(([path]) => path)

	describe('start', () => {
		it('serves the manage UI and proxies everything else to the prototype server', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			expect(mockApp.use).toHaveBeenCalledWith('/manage-prototype', getDevApp())
			expect(createProxy).toHaveBeenCalledWith({
				target: 'http://localhost:3010',
				onRestart: expect.any(Function)
			})
		})

		it('sends manage pages served by the prototype server straight to it', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			for (const path of managePrototype.proxyPaths) {
				expect(mockApp.use).toHaveBeenCalledWith(path, proxy.handle)
			}
		})

		it('mounts those manage pages before the dev app', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			const paths = mountedPaths()

			expect(paths.indexOf('/manage-prototype/templates/view')).toBeLessThan(paths.indexOf('/manage-prototype'))
		})

		it('proxies anything the dev app does not handle', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			expect(mountedPaths().at(-1)).toBe(proxy.handle)
		})

		it('buffers requests by following the supervisor ready state', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			expect(supervisor.onReadyChange).toHaveBeenCalledWith(expect.any(Function))

			const [onReadyChange] = vi.mocked(supervisor.onReadyChange).mock.calls[0]
			onReadyChange(true)

			expect(proxy.setReady).toHaveBeenCalledWith(true)
		})

		it('starts from the state the supervisor is already in', () => {
			vi.mocked(supervisor.getReady).mockReturnValue(true)

			devServer.start({ port: 3000, prototypePort: 3010 })

			expect(proxy.setReady).toHaveBeenCalledWith(true)
		})

		it('asks the supervisor to restart when a response asks for one', () => {
			vi.mocked(supervisor.restartPrototypeServer).mockResolvedValue()

			devServer.start({ port: 3000, prototypePort: 3010 })

			const { onRestart } = vi.mocked(createProxy).mock.calls[0][0]
			onRestart()

			expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
		})

		it('listens on the port the browser uses', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			expect(mockApp.listen).toHaveBeenCalledWith(3000)
		})

		it('returns the http server', () => {
			const httpServer = { close: vi.fn() }
			mockApp.listen.mockReturnValue(httpServer)

			expect(devServer.start({ port: 3000, prototypePort: 3010 })).toBe(httpServer)
		})

		it('proxies to the prototype server port it was given, not a derived one', () => {
			devServer.start({ port: 3000, prototypePort: 4123 })

			expect(createProxy).toHaveBeenCalledWith({ target: 'http://localhost:4123', onRestart: expect.any(Function) })
			expect(mockApp.listen).toHaveBeenCalledWith(3000)
		})
	})
})
