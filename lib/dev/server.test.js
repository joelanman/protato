import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../manage-prototype/app.js', async () => {
	const { default: express } = await import('express')

	return {
		getManagePrototypeApp: vi.fn(async () => {
			const app = express()
			app.get('/', (request, response) => response.end('manage page'))
			app.get('/password', (request, response) => response.end('password page'))
			return app
		})
	}
})

vi.mock('../../manage-prototype/routes/preview.js', () => ({
	templatePreviewPath: '/manage-prototype/templates/view'
}))

vi.mock('../middleware/session.js', () => ({
	default: {
		addSessionMiddleware: vi.fn(async () => {})
	}
}))

vi.mock('../middleware/errors.js', () => ({
	pageNotFound: (request, response) => response.status(404).end('manage not found'),
	errorHandler: (error, request, response, next) => response.status(500).end('manage error')
}))

vi.mock('./livereload.js', () => ({
	default: {
		route: vi.fn((request, response) => response.end('livereload'))
	}
}))

import { getManagePrototypeApp } from '../../manage-prototype/app.js'
import livereload from './livereload.js'
import devServer from './server.js'

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

	const start = async () => {
		const server = await devServer.start({ port: 0, prototypePort: prototypeServer.address().port })
		servers.push(server)
		return `http://localhost:${server.address().port}`
	}

	// a port nothing is listening on, which is the state of the prototype while it
	// restarts
	const unusedPort = async () => {
		const server = http.createServer()
		await new Promise((resolve) => server.listen(0, resolve))
		const port = server.address().port
		await new Promise((resolve) => server.close(resolve))
		return port
	}

	it('serves manage prototype from the dev server', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype`)

		expect(await response.text()).toBe('manage page')
		expect(targetRequests).toEqual([])
		expect(getManagePrototypeApp).toHaveBeenCalledWith({ env: 'development' })
	})

	it('serves the session pages from the dev server too', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype/password`)

		expect(await response.text()).toBe('password page')
		expect(targetRequests).toEqual([])
	})

	it('proxies the prototype', async () => {
		const root = await start()

		const response = await fetch(`${root}/a-page`)

		expect(await response.text()).toBe('prototype page')
		expect(targetRequests).toEqual(['/a-page'])
	})

	it('proxies the template preview, which needs the prototype views', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype/templates/view`)

		expect(await response.text()).toBe('prototype page')
		expect(targetRequests).toEqual(['/manage-prototype/templates/view'])
	})

	it('serves livereload itself, so it survives a restart', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype/livereload`)

		expect(await response.text()).toBe('livereload')
		expect(livereload.route).toHaveBeenCalledOnce()
		expect(targetRequests).toEqual([])
	})

	it('proxies websocket upgrades to the prototype', async () => {
		let receivedRequest
		let upgradedSocket

		const upgradeTarget = await listen((request, response) => response.end('prototype page'))
		upgradeTarget.on('upgrade', (request, socket) => {
			receivedRequest = request
			socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
			// echo anything the browser sends, as a websocket library would
			socket.on('data', (chunk) => socket.write(chunk))
			socket.on('end', () => socket.destroy())
		})

		const server = await devServer.start({ port: 0, prototypePort: upgradeTarget.address().port })
		servers.push(server)

		const result = await new Promise((resolve) => {
			const request = http.request({
				port: server.address().port,
				path: '/socket',
				headers: {
					connection: 'Upgrade',
					upgrade: 'websocket',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-protocol': 'chat, superchat',
					'sec-websocket-version': '13'
				}
			})

			request.on('upgrade', (response, socket) => {
				upgradedSocket = socket
				socket.on('data', (chunk) => {
					resolve({ status: response.statusCode, echoed: chunk.toString() })
				})
				socket.write('ping')
			})

			request.on('error', () => resolve({ status: 'error' }))
			setTimeout(() => resolve({ status: 'hung' }), 1500)
			request.end()
		})

		expect(result).toEqual({ status: 101, echoed: 'ping' })
		expect(receivedRequest.url).toBe('/socket')
		expect(receivedRequest.headers['sec-websocket-protocol']).toBe('chat, superchat')

		// an upgraded socket is no longer the server's to close
		upgradedSocket.destroy()
	})

	it('does not proxy websocket upgrades for manage paths', async () => {
		let targetUpgraded = false

		const upgradeTarget = await listen((request, response) => response.end('prototype page'))
		upgradeTarget.on('upgrade', () => {
			targetUpgraded = true
		})

		const server = await devServer.start({ port: 0, prototypePort: upgradeTarget.address().port })
		servers.push(server)

		const result = await new Promise((resolve) => {
			const request = http.request({
				port: server.address().port,
				path: '/manage-prototype/anything',
				headers: { connection: 'Upgrade', upgrade: 'websocket' }
			})

			request.on('upgrade', () => resolve('upgraded'))
			request.on('error', () => resolve('closed'))
			setTimeout(() => resolve('hung'), 1500)
			request.end()
		})

		expect(result).toBe('closed')
		expect(targetUpgraded).toBe(false)
	})

	it('replies with 502 when the prototype cannot accept a websocket', async () => {
		const server = await devServer.start({ port: 0, prototypePort: await unusedPort() })
		servers.push(server)

		const result = await new Promise((resolve) => {
			const request = http.request({
				port: server.address().port,
				path: '/socket',
				headers: { connection: 'Upgrade', upgrade: 'websocket' }
			})

			request.on('upgrade', () => resolve('upgraded'))
			request.on('response', (response) => resolve(response.statusCode))
			request.on('error', () => resolve('closed'))
			setTimeout(() => resolve('hung'), 1500)
			request.end()
		})

		expect(result).toBe(502)
	})

	it('shows the error page when the prototype cannot be reached', async () => {
		const server = await devServer.start({ port: 0, prototypePort: await unusedPort() })
		servers.push(server)

		const response = await fetch(`http://localhost:${server.address().port}/a-page`)

		expect(response.status).toBe(500)
		expect(await response.text()).toBe('manage error')
	})

	it('does not send an unmatched manage path to the prototype', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype/does-not-exist`)

		expect(response.status).toBe(404)
		expect(await response.text()).toBe('manage not found')
		expect(targetRequests).toEqual([])
	})
})
