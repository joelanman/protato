// Development only. The prototype server runs as a separate process that
// restarts on changes while the dev server holds the main port, so requests
// are proxied through to the prototype server.

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

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
				headers: getForwardedHeaders(request, targetUrl)
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
const createUpgradeProxy = ({ target }) => {
	const targetUrl = new URL(target)
	const port = targetUrl.port || defaultPorts[targetUrl.protocol]

	return (request, socket, head) => {
		const proxySocket = net.connect(Number(port), targetUrl.hostname, () => {
			proxySocket.write(formatRequestHead(request, targetUrl))

			// bytes the browser sent after the handshake
			if (head?.length) {
				proxySocket.write(head)
			}

			socket.pipe(proxySocket)
			proxySocket.pipe(socket)
		})

		// A websocket is a pair of sockets, so either side going closes both. 'end'
		// matters as well as 'close': a socket from an http server stays open when
		// the other end finishes, so without it the prototype's connection would be
		// left half open until it timed out.
		const close = () => {
			proxySocket.destroy()
			socket.destroy()
		}

		proxySocket.on('error', close)
		proxySocket.on('close', close)
		proxySocket.on('end', close)
		socket.on('error', close)
		socket.on('close', close)
		socket.on('end', close)
	}
}

export { createProxyMiddleware, createUpgradeProxy }
