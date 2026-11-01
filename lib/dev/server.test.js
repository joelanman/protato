import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./livereload.js', () => ({
	default: { route: vi.fn((request, response) => response.end('livereload')) }
}))

vi.mock('./supervisor.js', () => ({
	default: {
		isDown: vi.fn(() => false),
		isReady: vi.fn(() => true),
		restartPrototypeServer: vi.fn()
	}
}))

import livereload from './livereload.js'
import devServer from './server.js'
import supervisor from './supervisor.js'

const servers = []

const listen = async (handler) => {
	const server = http.createServer(handler)
	servers.push(server)
	await new Promise((resolve) => server.listen(0, resolve))
	return server
}

describe('devServer', () => {
	let targetRequests
	let prototypeServer

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.mocked(supervisor.isDown).mockReturnValue(false)
		vi.mocked(supervisor.isReady).mockReturnValue(true)
		vi.mocked(supervisor.restartPrototypeServer).mockResolvedValue()

		targetRequests = []

		prototypeServer = await listen((request, response) => {
			targetRequests.push(request.url)
			response.writeHead(200)
			response.end('prototype page')
		})
	})

	afterEach(async () => {
		for (const server of servers) {
			server.closeAllConnections?.()
			await new Promise((resolve) => server.close(resolve))
		}
		servers.length = 0
	})

	const start = () => {
		const server = devServer.start({ port: 0, prototypePort: prototypeServer.address().port })
		servers.push(server)
		return `http://localhost:${server.address().port}`
	}

	it('listens on the port the browser uses', () => {
		const server = devServer.start({ port: 0, prototypePort: 3010 })
		servers.push(server)

		expect(server.listening).toBe(true)
	})

	it('proxies requests to the prototype server', async () => {
		const root = start()

		const response = await fetch(`${root}/a-page`)

		expect(await response.text()).toBe('prototype page')
		expect(targetRequests).toEqual(['/a-page'])
	})

	it('serves livereload itself, so it survives a restart', async () => {
		const root = start()

		const response = await fetch(`${root}/manage-prototype/livereload`)

		expect(await response.text()).toBe('livereload')
		expect(livereload.route).toHaveBeenCalledOnce()
		expect(targetRequests).toEqual([])
	})

	it('fails requests straight away when the prototype has stopped unexpectedly', async () => {
		vi.mocked(supervisor.isDown).mockReturnValue(true)
		const root = start()

		const response = await fetch(`${root}/`)

		expect(response.status).toBe(503)
		expect(targetRequests).toEqual([])
	})

	describe('restart', () => {
		it('restarts the prototype before redirecting to the plugins page', async () => {
			const root = start()

			const response = await fetch(`${root}/__protato/restart?returnTo=/manage-prototype/plugins`, {
				method: 'POST',
				redirect: 'manual'
			})

			expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
			expect(response.status).toBe(303)
			expect(response.headers.get('location')).toBe('/manage-prototype/plugins')
			expect(targetRequests).toEqual([])
		})

		it('defaults to the plugins page when no return path is given', async () => {
			const root = start()

			const response = await fetch(`${root}/__protato/restart`, {
				method: 'POST',
				redirect: 'manual'
			})

			expect(response.headers.get('location')).toBe('/manage-prototype/plugins')
		})

		it('ignores a return path to another site', async () => {
			const root = start()

			const response = await fetch(`${root}/__protato/restart?returnTo=//example.com`, {
				method: 'POST',
				redirect: 'manual'
			})

			expect(response.headers.get('location')).toBe('/manage-prototype/plugins')
		})

		it('reports a restart that did not start', async () => {
			vi.mocked(supervisor.restartPrototypeServer).mockRejectedValue(new Error('port in use'))
			const root = start()

			const response = await fetch(`${root}/__protato/restart`, { method: 'POST' })

			expect(response.status).toBe(500)
			expect(await response.text()).toBe('The prototype did not start, check the terminal')
		})
	})
})
