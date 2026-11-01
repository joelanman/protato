import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./livereload.js', () => ({
	default: { route: vi.fn((request, response) => response.end('livereload')) }
}))

vi.mock('./supervisor.js', () => ({
	default: {
		getReady: vi.fn(() => true),
		onReadyChange: vi.fn(),
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('devServer', () => {
	let targetRequests
	let prototypeServer

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.mocked(supervisor.getReady).mockReturnValue(true)
		vi.mocked(supervisor.restartPrototypeServer).mockResolvedValue()

		targetRequests = []

		prototypeServer = await listen((request, response) => {
			targetRequests.push(request.url)

			if (request.url === '/after-change') {
				response.writeHead(303, { Location: '/next', 'x-protato-restart': '1' })
				response.end()
				return
			}

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

	it('holds requests until the supervisor says the prototype is ready', async () => {
		vi.mocked(supervisor.getReady).mockReturnValue(false)
		const root = start()

		const responsePromise = fetch(`${root}/`)
		await settle()

		expect(targetRequests).toEqual([])

		const [onReadyChange] = vi.mocked(supervisor.onReadyChange).mock.calls[0]
		onReadyChange(true)

		const response = await responsePromise
		expect(await response.text()).toBe('prototype page')
	})

	it('restarts the prototype when a response asks for one', async () => {
		const root = start()

		const response = await fetch(`${root}/after-change`, { redirect: 'manual' })

		expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
		expect(response.headers.get('x-protato-restart')).toBeNull()
	})
})
