// Development only. The prototype server runs as a separate process that
// restarts on changes while the dev server holds the main port, so requests
// are proxied through to the prototype server.

import http from 'node:http'
import https from 'node:https'

const defaultPorts = {
	'http:': 80,
	'https:': 443
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
				headers: {
					...request.headers,
					host: targetUrl.host
				}
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

export { createProxyMiddleware }
