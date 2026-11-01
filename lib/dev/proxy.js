// Development only. Sends every request to the prototype process, which runs
// separately so it can be restarted without dropping the port the browser uses.
//
// While that process is starting or restarting there is nothing to connect to,
// so a refused connection is retried until the deadline. A refused connection
// never reached the process, so this is safe even for a POST. A connection that
// was made and then failed might have reached it, so only requests that can
// safely be repeated are retried in that case.

import http from 'node:http'
import https from 'node:https'

const defaultPorts = {
	'http:': 80,
	'https:': 443
}

// A restart can wait for npm to finish a plugin change, so this is longer than
// an ordinary startup.
const defaultTimeoutMs = 120_000

const retryDelayMs = 100

const notStartedMessage = 'The prototype did not start, check the terminal'

const repeatableMethods = new Set(['GET', 'HEAD'])

const canRepeat = (request) => repeatableMethods.has(request.method)

const wasRefused = (error) => error.code === 'ECONNREFUSED'

const createProxy = ({ target, timeoutMs = defaultTimeoutMs, isDown = () => false }) => {
	const targetUrl = new URL(target)
	const client = targetUrl.protocol === 'https:' ? https : http
	const port = targetUrl.port || defaultPorts[targetUrl.protocol]

	// Requests waiting to be sent, so a crashed prototype can fail them at once
	const waiting = new Set()

	function sendNotStarted(response) {
		response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
		response.end(notStartedMessage)
	}

	function sendFailed(response) {
		if (response.headersSent) {
			response.end()
			return
		}

		response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
		response.end('The prototype server could not be reached')
	}

	function stopWaiting(waitingRequest) {
		waiting.delete(waitingRequest)
		clearTimeout(waitingRequest.timer)
	}

	function giveUp(waitingRequest, sendError) {
		stopWaiting(waitingRequest)

		if (!waitingRequest.response.headersSent && !waitingRequest.response.destroyed) {
			sendError(waitingRequest.response)
		}
	}

	function retry(waitingRequest) {
		const remaining = waitingRequest.deadline - Date.now()

		if (remaining <= 0) {
			giveUp(waitingRequest, sendNotStarted)
			return
		}

		waitingRequest.timer = setTimeout(() => forward(waitingRequest), Math.min(retryDelayMs, remaining))
	}

	// A request is kept with its body so it can be sent again if the prototype
	// is not listening yet.
	function forward(waitingRequest) {
		if (isDown()) {
			giveUp(waitingRequest, sendNotStarted)
			return
		}

		const { request, response, body } = waitingRequest

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
				stopWaiting(waitingRequest)
				response.writeHead(proxyResponse.statusCode, proxyResponse.headers)
				proxyResponse.pipe(response)
			}
		)

		proxyRequest.on('error', (error) => {
			const safeToRetry = wasRefused(error) || canRepeat(request)

			if (safeToRetry && !response.headersSent && !response.destroyed) {
				retry(waitingRequest)
				return
			}

			giveUp(waitingRequest, sendFailed)
		})

		proxyRequest.end(body)
	}

	function handle(request, response) {
		// the body is read here rather than streamed, so a request can be sent
		// again after a restart. Prototypes do not upload large files.
		const chunks = []

		request.on('data', (chunk) => chunks.push(chunk))

		request.on('end', () => {
			const waitingRequest = {
				request,
				response,
				body: Buffer.concat(chunks),
				deadline: Date.now() + timeoutMs,
				timer: null
			}

			waiting.add(waitingRequest)

			response.on('close', () => stopWaiting(waitingRequest))

			forward(waitingRequest)
		})
	}

	return { handle }
}

export { createProxy, notStartedMessage }
