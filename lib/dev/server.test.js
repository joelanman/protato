import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('express')
vi.mock('../../manage-prototype/apps/dev-app.js', () => ({
	getDevApp: vi.fn()
}))
vi.mock('./proxy.js', () => ({
	createProxyMiddleware: vi.fn()
}))

import express from 'express'
import { getDevApp } from '../../manage-prototype/apps/dev-app.js'
import managePrototype from '../../manage-prototype/index.js'
import { createProxyMiddleware } from './proxy.js'
import devServer from './server.js'

describe('devServer', () => {
	let mockApp
	let proxy

	beforeEach(() => {
		vi.clearAllMocks()

		mockApp = { use: vi.fn(), listen: vi.fn() }
		proxy = vi.fn()
		vi.mocked(express).mockReturnValue(mockApp)
		vi.mocked(createProxyMiddleware).mockReturnValue(proxy)
	})

	// the path of each app.use call, in the order they were registered
	const mountedPaths = () => mockApp.use.mock.calls.map(([path]) => path)

	describe('start', () => {
		it('serves the manage UI and proxies everything else to the prototype server', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			expect(mockApp.use).toHaveBeenCalledWith('/manage-prototype', getDevApp())
			expect(createProxyMiddleware).toHaveBeenCalledWith({ target: 'http://localhost:3010' })
		})

		it('sends manage pages served by the prototype server straight to it', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			for (const path of managePrototype.proxyPaths) {
				expect(mockApp.use).toHaveBeenCalledWith(path, proxy)
			}
		})

		it('mounts those manage pages before the dev app', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			const paths = mountedPaths()

			expect(paths.indexOf('/manage-prototype/templates/view')).toBeLessThan(paths.indexOf('/manage-prototype'))
		})

		it('proxies anything the dev app does not handle', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			expect(mountedPaths().at(-1)).toBe(proxy)
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

			expect(createProxyMiddleware).toHaveBeenCalledWith({ target: 'http://localhost:4123' })
			expect(mockApp.listen).toHaveBeenCalledWith(3000)
		})
	})
})
