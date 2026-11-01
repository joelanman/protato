import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProxy, notStartedMessage, restartHeader } from './proxy.js'

// The proxy talks to a real http server, so these tests use real sockets rather
// than mocks. Every server picks a free port.
const servers = []

const listen = async (handler) => {
	const server = http.createServer(handler)
	servers.push(server)
	await new Promise((resolve) => server.listen(0, resolve))
	return { server, url: `http://localhost:${server.address().port}` }
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
	it('forwards a request when the prototype is ready', async () => {
		const { url: targetUrl } = await listen((request, response) => {
			response.writeHead(200, { 'Content-Type': 'text/plain' })
			response.end(`target got ${request.url}`)
		})

		const proxy = createProxy({ target: targetUrl })
		proxy.setReady(true)
		const proxyUrl = await createProxyServer(proxy)

		const { response, body } = await readBody(`${proxyUrl}/a-page?x=1`)

		expect(response.status).toBe(200)
		expect(body).toBe('target got /a-page?x=1')
	})

	it('waits while the prototype is not ready, then sends the request', async () => {
		let requestsReceived = 0

		const { url: targetUrl } = await listen((request, response) => {
			requestsReceived += 1
			response.writeHead(200)
			response.end('ready now')
		})

		const proxy = createProxy({ target: targetUrl })
		const proxyUrl = await createProxyServer(proxy)
		const responsePromise = fetch(proxyUrl)

		await settle()
		expect(requestsReceived).toBe(0)

		proxy.setReady(true)

		const response = await responsePromise
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ready now')
		expect(requestsReceived).toBe(1)
	})

	it('sends a held request body when the request is replayed', async () => {
		let receivedBody

		const { url: targetUrl } = await listen((request, response) => {
			let body = ''
			request.on('data', (chunk) => {
				body += chunk
			})
			request.on('end', () => {
				receivedBody = body
				response.writeHead(200)
				response.end()
			})
		})

		const proxy = createProxy({ target: targetUrl })
		const proxyUrl = await createProxyServer(proxy)

		const responsePromise = fetch(proxyUrl, { method: 'POST', body: 'name=value' })
		await settle()
		proxy.setReady(true)
		await responsePromise

		expect(receivedBody).toBe('name=value')
	})

	it('gives up with a 503 when the prototype is not ready in time', async () => {
		const proxy = createProxy({ target: 'http://localhost:1', timeoutMs: 10 })
		const proxyUrl = await createProxyServer(proxy)

		const { response, body } = await readBody(proxyUrl)

		expect(response.status).toBe(503)
		expect(body).toBe(notStartedMessage)
	})

	it('restarts before sending a response with the restart header', async () => {
		let responseFinished = false
		let restartReason

		const { url: targetUrl } = await listen((request, response) => {
			response.writeHead(303, { Location: '/next', 'x-protato-restart': '1' })
			response.end()
		})

		const proxy = createProxy({
			target: targetUrl,
			onRestart: () => {
				restartReason = responseFinished ? 'after the response' : 'before the response'
			}
		})
		proxy.setReady(true)
		const proxyUrl = await createProxyServer(proxy)

		const responsePromise = fetch(proxyUrl, { redirect: 'manual' })

		// the browser's response ends after the restart callback has run
		responsePromise.then(() => {
			responseFinished = true
		})

		const response = await responsePromise

		expect(restartReason).toBe('before the response')
		expect(response.status).toBe(303)
		expect(response.headers.get(restartHeader)).toBeNull()
		expect(response.headers.get('location')).toBe('/next')
	})

	it('holds the next request after a restart header until the prototype is ready', async () => {
		let requestsReceived = 0

		const { url: targetUrl } = await listen((request, response) => {
			requestsReceived += 1

			if (request.url === '/change') {
				response.writeHead(303, { Location: '/result', 'x-protato-restart': '1' })
				response.end()
				return
			}

			response.writeHead(200)
			response.end('result page')
		})

		const proxy = createProxy({ target: targetUrl })
		proxy.setReady(true)
		const proxyUrl = await createProxyServer(proxy)

		await fetch(`${proxyUrl}/change`, { redirect: 'manual' })

		const resultPromise = fetch(`${proxyUrl}/result`)
		await settle()
		expect(requestsReceived).toBe(1)

		proxy.setReady(true)

		const response = await resultPromise
		expect(await response.text()).toBe('result page')
		expect(requestsReceived).toBe(2)
	})

	it('responds 502 when the prototype cannot be reached while it is ready', async () => {
		const proxy = createProxy({ target: 'http://localhost:1' })
		proxy.setReady(true)
		const proxyUrl = await createProxyServer(proxy)

		const response = await fetch(proxyUrl)

		expect(response.status).toBe(502)
	})

	it('waits for the next process when the connection fails while restarting', async () => {
		let requestsReceived = 0
		let firstRequestReceived
		let allowDestroy

		const arrived = new Promise((resolve) => {
			firstRequestReceived = resolve
		})

		const destroyed = new Promise((resolve) => {
			allowDestroy = resolve
		})

		const { url: targetUrl } = await listen((request, response) => {
			requestsReceived += 1

			if (requestsReceived === 1) {
				firstRequestReceived()
				destroyed.then(() => request.socket.destroy())
				return
			}

			response.writeHead(200)
			response.end('second time')
		})

		const proxy = createProxy({ target: targetUrl })
		proxy.setReady(true)
		const proxyUrl = await createProxyServer(proxy)

		const responsePromise = fetch(proxyUrl)

		// the restart begins after the request has gone to the old process
		await arrived
		proxy.setReady(false)
		allowDestroy()

		await settle()
		proxy.setReady(true)

		const response = await responsePromise
		expect(await response.text()).toBe('second time')
		expect(requestsReceived).toBe(2)
	})

	it('does not call the restart callback for a normal response', async () => {
		const onRestart = vi.fn()
		const { url: targetUrl } = await listen((request, response) => {
			response.writeHead(200)
			response.end('fine')
		})

		const proxy = createProxy({ target: targetUrl, onRestart })
		proxy.setReady(true)
		const proxyUrl = await createProxyServer(proxy)

		await readBody(proxyUrl)

		expect(onRestart).not.toHaveBeenCalled()
	})
})
