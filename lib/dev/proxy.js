// Development only. The prototype server runs as a separate process that
// restarts on changes while the dev server holds the main port, so requests
// are proxied through to the prototype server.

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { pipeline } from 'node:stream'

const defaultPorts = {
	'http:': 80,
	'https:': 443
}

// The prototype sees the request as the browser sent it, with the host it is
// listening on. Sharing this keeps websocket and ordinary requests the same.
const getForwardedHeaders = (request, targetUrl) => ({
	...request.headers,
	host: targetUrl.host
})

// The request line and headers of an upgrade request, which is written to the
// prototype by hand because http.request cannot forward a handshake.
const formatRequestHead = (request, targetUrl) => {
	const lines = Object.entries(getForwardedHeaders(request, targetUrl)).flatMap(([name, value]) => {
		const values = Array.isArray(value) ? value : [value]
		return values.map((one) => `${name}: ${one}`)
	})

	return `${request.method} ${request.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`
}

const createProxyMiddleware = ({ target }) => {
	const targetUrl = new URL(target)
	const client = targetUrl.protocol === 'https:' ? https : http
	const port = targetUrl.port || defaultPorts[targetUrl.protocol]

	return (request, response, next) => {
		const proxyRequest = client.request(
			{
				protocol: targetUrl.protocol,
				hostname: targetUrl.hostname,
				port,
				method: request.method,
				path: request.originalUrl,
				headers: getForwardedHeaders(request, targetUrl),
				// the prototype restarts constantly, and a pooled socket it closed when
				// it restarted would fail one request with a socket hang up
				agent: false
			},
			(proxyResponse) => {
				response.writeHead(proxyResponse.statusCode, proxyResponse.headers)

				// send the headers straight away, so a response that waits before its
				// first byte, such as server-sent events, is not held back
				response.flushHeaders()

				// the prototype can restart or crash part way through a response, which
				// would leave the browser waiting for data that is never coming
				proxyResponse.on('error', () => response.destroy())
				proxyResponse.on('close', () => {
					if (!proxyResponse.complete) {
						response.destroy()
					}
				})

				proxyResponse.pipe(response)
			}
		)

		proxyRequest.on('error', (error) => {
			// the browser has gone, so there is nothing left to reply to
			if (response.destroyed) {
				return
			}

			// the response has already started, so it can only be cut short
			if (response.headersSent) {
				response.destroy()
				return
			}

			next(error)
		})

		// the browser has gone: a cancelled upload, or a closed event stream. Without
		// this the prototype keeps the request open until it times out.
		response.on('close', () => {
			if (!response.writableFinished) {
				proxyRequest.destroy()
			}
		})

		// stream the request body through to the target
		request.pipe(proxyRequest)
	}
}

// Express only handles ordinary requests, so an upgrade request never reaches
// the middleware above. This tunnels the connection to the prototype instead,
// then leaves the two sockets to talk to each other.
//
// The target is always a plain http address: it is the prototype process the dev
// server started, on localhost. A TLS target would need tls.connect here.
const createUpgradeProxy = ({ target }) => {
	const targetUrl = new URL(target)
	const port = targetUrl.port || defaultPorts[targetUrl.protocol]

	return (request, socket, head) => {
		let handshakeSent = false
		let finished = 0

		const close = () => {
			proxySocket.destroy()
			socket.destroy()
		}

		const finish = (error) => {
			// a broken connection tears down the pair, which is what makes a
			// restarted prototype disconnect the browser
			if (error) {
				close()
				return
			}

			// both directions get to flush, so the last frame either side sent is
			// not cut off by the teardown
			finished += 1

			if (finished === 2) {
				close()
			}
		}

		const proxySocket = net.connect(Number(port), targetUrl.hostname, () => {
			proxySocket.write(formatRequestHead(request, targetUrl))
			handshakeSent = true

			// bytes the browser sent after the handshake
			if (head?.length) {
				proxySocket.write(head)
			}

			pipeline(socket, proxySocket, finish)
			pipeline(proxySocket, socket, finish)
		})

		// the prototype was not listening, which usually means it is restarting
		proxySocket.on('error', () => {
			if (!handshakeSent) {
				socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
				return
			}

			close()
		})
	}
}

export { createProxyMiddleware, createUpgradeProxy }
