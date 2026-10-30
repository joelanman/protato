import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('express')
vi.mock('../../manage-prototype/dev-app.js', () => ({
	default: { getDevApp: vi.fn() }
}))
vi.mock('./proxy.js', () => ({
	createProxyMiddleware: vi.fn()
}))

import express from 'express'
import managePrototype from '../../manage-prototype/dev-app.js'
import { createProxyMiddleware } from './proxy.js'
import devServer from './server.js'

describe('devServer', () => {
	let mockApp

	beforeEach(() => {
		vi.clearAllMocks()

		mockApp = { use: vi.fn(), listen: vi.fn() }
		vi.mocked(express).mockReturnValue(mockApp)
	})

	describe('start', () => {
		it('serves the manage UI and proxies everything else to the prototype server', () => {
			devServer.start({ port: 3000, prototypePort: 3010 })

			expect(mockApp.use).toHaveBeenCalledWith('/manage-prototype', managePrototype.getDevApp())
			expect(createProxyMiddleware).toHaveBeenCalledWith({ target: 'http://localhost:3010' })
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
