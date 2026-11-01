// Development only. Sends requests to the prototype process, which runs
// separately so it can be restarted without dropping the port the browser uses.
//
// GET and HEAD requests wait for the prototype to be ready, because they have no
// body and are safe to send again. Other requests are sent once, when the
// prototype is ready. A POST that arrives during a restart is refused rather
// than replayed, because sending it again could repeat a side effect.

import http from 'node:http'
import https from 'node:https'

const defaultPorts = {
	'http:': 80,
	'https:': 443
}

// A restart rebuilds the prototype before it listens. This is the longest a GET
// waits before it is told the prototype did not start.
const defaultTimeoutMs = 30_000

const retryDelayMs = 100

const notStartedMessage = 'The prototype did not start, check the terminal'
const restartingMessage = 'The prototype is restarting, try again'

const repeatableMethods = new Set(['GET', 'HEAD'])

const createProxy = ({ target, timeoutMs = defaultTimeoutMs, isReady = () => true, isDown = () => false }) => {
	const targetUrl = new URL(target)
	const client = targetUrl.protocol === 'https:' ? https : http
	const port = targetUrl.port || defaultPorts[targetUrl.protocol]

	function send(response, statusCode, message) {
		if (response.headersSent || response.destroyed) {
			return
		}

		response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' })
		response.end(message)
	}

	function sendNotStarted(response) {
		send(response, 503, notStartedMessage)
	}

	function sendRestarting(response) {
		send(response, 503, restartingMessage)
	}

	function sendFailed(response) {
		send(response, 502, 'The prototype server could not be reached')
	}

	function clearRetry(item) {
		clearTimeout(item.timer)
		item.timer = null
	}

	function retry(item) {
		if (item.response.headersSent || item.response.destroyed) {
			clearRetry(item)
			return
		}

		const remaining = item.deadline - Date.now()

		if (remaining <= 0) {
			sendNotStarted(item.response)
			return
		}

		item.timer = setTimeout(() => forward(item), Math.min(retryDelayMs, remaining))
	}

	function forward(item) {
		clearRetry(item)

		if (isDown()) {
			sendNotStarted(item.response)
			return
		}

		const { request, response } = item

		const proxyRequest = client.request(
			{
				protocol: targetUrl.protocol,
				hostname: targetUrl.hostname,
				port,
				method: request.method,
				path: request.originalUrl ?? request.url,
				headers: {
					...request.headers,
					host: targetUrl.host
				}
			},
			(proxyResponse) => {
				response.writeHead(proxyResponse.statusCode, proxyResponse.headers)
				proxyResponse.on('error', () => response.destroy())
				proxyResponse.pipe(response)
			}
		)

		proxyRequest.on('error', () => {
			if (response.headersSent || response.destroyed) {
				return
			}

			// A GET can be sent again. A POST may already have reached the
			// prototype, so it is not replayed.
			if (repeatableMethods.has(request.method) && !isDown()) {
				retry(item)
				return
			}

			sendFailed(response)
		})

		request.pipe(proxyRequest)
	}

	function handle(request, response) {
		const item = {
			request,
			response,
			deadline: Date.now() + timeoutMs,
			timer: null
		}

		response.on('close', () => clearRetry(item))

		if (isDown()) {
			request.resume()
			sendNotStarted(response)
			return
		}

		if (isReady()) {
			forward(item)
			return
		}

		if (repeatableMethods.has(request.method)) {
			retry(item)
			return
		}

		// Do not leave a request body unread on a refused connection.
		request.resume()
		sendRestarting(response)
	}

	return { handle }
}

export { createProxy, notStartedMessage, restartingMessage }
