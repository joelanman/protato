// Development only. The prototype server runs as a separate process that
// restarts on changes (or becomes the error server) while the manage server
// holds the main port, so requests are proxied through to PROTOTYPE_PORT.

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
				proxyResponse.pipe(response)
			}
		)

		proxyRequest.on('error', next)

		// stream the request body through to the target
		request.pipe(proxyRequest)
	}
}

export { createProxyMiddleware }
