import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createProxyMiddleware } from './proxy.js'

const servers = []

// the middleware is mounted by express, which adds originalUrl
const listen = async (handler) => {
	const server = http.createServer(handler)
	servers.push(server)
	await new Promise((resolve) => server.listen(0, resolve))
	return server
}

const listenOnTarget = (handler) => listen(handler)

const startProxy = async (target, { onError } = {}) => {
	const proxy = createProxyMiddleware({ target })

	const server = await listen((request, response) => {
		request.originalUrl = request.url

		proxy(request, response, (error) => {
			if (onError) {
				onError(error)
			}

			if (!response.headersSent) {
				response.writeHead(500)
			}

			response.end('proxy error')
		})
	})

	return `http://localhost:${server.address().port}`
}

const getPort = async () => {
	const server = await listen(() => {})
	const port = server.address().port
	await new Promise((resolve) => server.close(resolve))
	servers.pop()
	return port
}

afterEach(async () => {
	for (const server of servers) {
		server.closeAllConnections?.()
		await new Promise((resolve) => server.close(resolve))
	}
	servers.length = 0
})

describe('createProxyMiddleware', () => {
	it('proxies the request and the response', async () => {
		let received
		const target = await listenOnTarget((request, response) => {
			received = {
				method: request.method,
				url: request.url
			}
			response.writeHead(201, { 'x-from-prototype': 'yes' })
			response.end('prototype page')
		})

		const root = await startProxy(`http://localhost:${target.address().port}`)
		const response = await fetch(`${root}/a-page?query=1`)

		expect(received).toEqual({ method: 'GET', url: '/a-page?query=1' })
		expect(response.status).toBe(201)
		expect(response.headers.get('x-from-prototype')).toBe('yes')
		expect(await response.text()).toBe('prototype page')
	})

	it('streams a request body through unchanged', async () => {
		let receivedBody = ''
		const target = await listenOnTarget((request, response) => {
			request.on('data', (chunk) => {
				receivedBody += chunk
			})
			request.on('end', () => response.end('stored'))
		})

		const body =
			'--boundary\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\ncontents\r\n--boundary--'

		const root = await startProxy(`http://localhost:${target.address().port}`)
		const response = await fetch(`${root}/upload`, {
			method: 'POST',
			body,
			headers: { 'content-type': 'multipart/form-data; boundary=boundary' }
		})

		expect(await response.text()).toBe('stored')
		expect(receivedBody).toBe(body)
	})

	it('streams a chunked request body through unchanged', async () => {
		let receivedBody = ''
		let receivedTransferEncoding
		const target = await listenOnTarget((request, response) => {
			receivedTransferEncoding = request.headers['transfer-encoding']
			request.on('data', (chunk) => {
				receivedBody += chunk
			})
			request.on('end', () => response.end('stored'))
		})

		const root = await startProxy(`http://localhost:${target.address().port}`)
		const port = new URL(root).port

		const responseBody = await new Promise((resolve, reject) => {
			const request = http.request(
				{ port, method: 'POST', path: '/upload', headers: { 'content-type': 'application/octet-stream' } },
				(response) => {
					let body = ''
					response.on('data', (chunk) => {
						body += chunk
					})
					response.on('end', () => resolve(body))
				}
			)
			request.on('error', reject)
			request.write('first chunk')
			request.write('second chunk')
			request.end()
		})

		expect(responseBody).toBe('stored')
		expect(receivedBody).toBe('first chunksecond chunk')
		expect(receivedTransferEncoding).toBe('chunked')
	})

	it('sends the response headers before the first byte of the body', async () => {
		// a server sending events, which waits before its first byte
		const target = await listenOnTarget((request, response) => {
			response.writeHead(200, { 'content-type': 'text/event-stream' })
			response.flushHeaders()

			setTimeout(() => {
				response.write('data: first\n\n')
				response.end()
			}, 600)
		})

		const root = await startProxy(`http://localhost:${target.address().port}`)

		const startedAt = Date.now()
		const response = await fetch(`${root}/events`)
		const headersReceivedAfter = Date.now() - startedAt

		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(headersReceivedAfter).toBeLessThan(400)

		await response.body.cancel()
	})

	it('ends the browser response when the prototype dies mid-response', async () => {
		const target = await listenOnTarget((request, response) => {
			response.writeHead(200, { 'content-length': '100' })
			response.write('part of the page')
			setTimeout(() => response.destroy(), 50)
		})

		const root = await startProxy(`http://localhost:${target.address().port}`)

		// 'hung' means the browser would have been left waiting forever
		const outcome = await new Promise((resolve) => {
			const request = http.get(root, (response) => {
				response.resume()
				response.on('end', () => resolve('ended'))
				response.on('error', () => resolve('errored'))
				response.on('close', () => resolve('closed'))
			})
			request.on('error', () => resolve('errored'))
			setTimeout(() => resolve('hung'), 1500)
		})

		expect(outcome).not.toBe('hung')
	})

	it('closes the upstream request when the browser cancels an upload', async () => {
		let upstreamClosed = false
		const target = await listenOnTarget((request, response) => {
			request.on('data', () => {})
			request.on('close', () => {
				upstreamClosed = true
			})
			response.on('close', () => {
				upstreamClosed = true
			})
		})

		const root = await startProxy(`http://localhost:${target.address().port}`)
		const port = new URL(root).port

		await new Promise((resolve) => {
			const request = http.request({
				port,
				method: 'POST',
				path: '/upload',
				headers: { 'content-length': '100000', 'content-type': 'application/octet-stream' }
			})
			request.on('error', () => {})
			request.write(Buffer.alloc(5000))
			setTimeout(() => {
				request.destroy()
				resolve()
			}, 100)
		})

		await new Promise((resolve) => setTimeout(resolve, 300))

		expect(upstreamClosed).toBe(true)
	})

	it('reports the error when the prototype cannot be reached', async () => {
		const port = await getPort()
		const errors = []

		const root = await startProxy(`http://localhost:${port}`, {
			onError: (error) => errors.push(error)
		})

		const response = await fetch(root)

		expect(response.status).toBe(500)
		expect(await response.text()).toBe('proxy error')
		expect(errors[0].code).toBe('ECONNREFUSED')
	})

	it('reports the error when the prototype dies before replying', async () => {
		// the prototype server restarts while a form is being posted
		const target = await listenOnTarget((request) => {
			request.on('data', () => {})
			setTimeout(() => request.socket.destroy(), 50)
		})

		const errors = []
		const root = await startProxy(`http://localhost:${target.address().port}`, {
			onError: (error) => errors.push(error)
		})
		const port = new URL(root).port

		const responseBody = await new Promise((resolve) => {
			const request = http.request(
				{ port, method: 'POST', path: '/form', headers: { 'content-length': '100000' } },
				(response) => {
					let body = ''
					response.on('data', (chunk) => {
						body += chunk
					})
					response.on('end', () => resolve(body))
				}
			)
			request.on('error', () => {})
			request.write(Buffer.alloc(5000))
			setTimeout(() => resolve('hung'), 1500)
		})

		expect(responseBody).toBe('proxy error')
		expect(errors[0].code).toBe('ECONNRESET')
	})
})
