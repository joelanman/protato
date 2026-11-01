import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createProxy, notStartedMessage } from './proxy.js'

// The proxy talks to a real http server, so these tests use real sockets rather
// than mocks. Every server picks a free port.
const servers = []

const listen = async (handler, port = 0) => {
	const server = http.createServer(handler)
	servers.push(server)
	await new Promise((resolve) => server.listen(port, resolve))
	return { server, url: `http://localhost:${server.address().port}` }
}

const getFreePort = async () => {
	const server = http.createServer()
	await new Promise((resolve) => server.listen(0, resolve))
	const port = server.address().port
	await new Promise((resolve) => server.close(resolve))
	return port
}

const createProxyServer = async (proxy) => {
	const { url } = await listen((request, response) => proxy.handle(request, response))
	return url
}

const readBody = async (url, options) => {
	const response = await fetch(url, options)
	return { response, body: await response.text() }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

afterEach(async () => {
	for (const server of servers) {
		server.closeAllConnections?.()
		await new Promise((resolve) => server.close(resolve))
	}
	servers.length = 0
})

describe('proxy', () => {
	it('forwards a request to the prototype', async () => {
		const { url: targetUrl } = await listen((request, response) => {
			response.writeHead(200, { 'Content-Type': 'text/plain' })
			response.end(`target got ${request.url}`)
		})

		const proxy = createProxy({ target: targetUrl })
		const proxyUrl = await createProxyServer(proxy)

		const { response, body } = await readBody(`${proxyUrl}/a-page?x=1`)

		expect(response.status).toBe(200)
		expect(body).toBe('target got /a-page?x=1')
	})

	it('retries while the prototype is not listening, then sends the request', async () => {
		const port = await getFreePort()
		let requestsReceived = 0

		const proxy = createProxy({ target: `http://localhost:${port}`, timeoutMs: 2000 })
		const proxyUrl = await createProxyServer(proxy)

		const responsePromise = fetch(proxyUrl)

		await settle()
		expect(requestsReceived).toBe(0)

		await listen((request, response) => {
			requestsReceived += 1
			response.writeHead(200)
			response.end('ready now')
		}, port)

		const response = await responsePromise
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ready now')
		expect(requestsReceived).toBe(1)
	})

	it('retries a refused POST with its body', async () => {
		const port = await getFreePort()
		let receivedBody

		const proxy = createProxy({ target: `http://localhost:${port}`, timeoutMs: 2000 })
		const proxyUrl = await createProxyServer(proxy)

		const responsePromise = fetch(proxyUrl, { method: 'POST', body: 'name=value' })

		await settle()

		await listen((request, response) => {
			let body = ''
			request.on('data', (chunk) => {
				body += chunk
			})
			request.on('end', () => {
				receivedBody = body
				response.writeHead(200)
				response.end()
			})
		}, port)

		await responsePromise

		expect(receivedBody).toBe('name=value')
	})

	it('gives up with a 503 when the prototype never starts', async () => {
		const proxy = createProxy({ target: 'http://localhost:1', timeoutMs: 10 })
		const proxyUrl = await createProxyServer(proxy)

		const { response, body } = await readBody(proxyUrl)

		expect(response.status).toBe(503)
		expect(body).toBe(notStartedMessage)
	})

	it('responds 502 when a POST connection fails after it was made', async () => {
		const { url: targetUrl } = await listen((request) => {
			request.socket.destroy()
		})

		const proxy = createProxy({ target: targetUrl })
		const proxyUrl = await createProxyServer(proxy)

		const response = await fetch(proxyUrl, { method: 'POST', body: 'name=value' })

		expect(response.status).toBe(502)
	})

	it('retries a GET when the connection fails after it was made', async () => {
		let requestsReceived = 0

		const { url: targetUrl } = await listen((request, response) => {
			requestsReceived += 1

			if (requestsReceived === 1) {
				request.socket.destroy()
				return
			}

			response.writeHead(200)
			response.end('second time')
		})

		const proxy = createProxy({ target: targetUrl })
		const proxyUrl = await createProxyServer(proxy)

		const response = await fetch(proxyUrl)

		expect(await response.text()).toBe('second time')
		expect(requestsReceived).toBe(2)
	})

	it('fails a request straight away when the prototype is down', async () => {
		const proxy = createProxy({
			target: 'http://localhost:1',
			timeoutMs: 5000,
			isDown: () => true
		})
		const proxyUrl = await createProxyServer(proxy)

		const { response, body } = await readBody(proxyUrl)

		expect(response.status).toBe(503)
		expect(body).toBe(notStartedMessage)
	})

	it('fails a waiting request when the prototype stops unexpectedly', async () => {
		let down = false

		const proxy = createProxy({
			target: 'http://localhost:1',
			timeoutMs: 5000,
			isDown: () => down
		})
		const proxyUrl = await createProxyServer(proxy)

		const responsePromise = fetch(proxyUrl)

		await settle()
		down = true

		const response = await responsePromise
		expect(response.status).toBe(503)
	})
})
