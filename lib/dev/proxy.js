// Development only. Sends every request to the prototype process, which runs
// separately so it can be restarted without dropping the port the browser uses.
//
// While that process is starting or restarting there is nothing to send a
// request to, so requests wait here and are replayed once it is ready. That
// makes a restart look like a slow response rather than a failed request.

import http from 'node:http'
import https from 'node:https'

const defaultPorts = {
	'http:': 80,
	'https:': 443
}

// A response with this header asks for a restart. The prototype uses it when it
// has changed something the new process must pick up, such as a plugin install.
const restartHeader = 'x-protato-restart'

const defaultTimeoutMs = 30_000

const notStartedMessage = 'The prototype did not start, check the terminal'

// A request that fails while the prototype is restarting is only sent again if
// doing so cannot repeat something that already happened.
const repeatableMethods = new Set(['GET', 'HEAD'])

const canRepeat = (request) => repeatableMethods.has(request.method)

const createProxy = ({ target, timeoutMs = defaultTimeoutMs, onRestart = () => {} }) => {
	const targetUrl = new URL(target)
	const client = targetUrl.protocol === 'https:' ? https : http
	const port = targetUrl.port || defaultPorts[targetUrl.protocol]

	let ready = false

	// Requests that arrived while the prototype was not ready, in arrival order
	let waiting = []

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

	function remove(waitingRequest) {
		waiting = waiting.filter((item) => item !== waitingRequest)
		clearTimeout(waitingRequest.timer)
	}

	// A request is kept with its body so it can be sent again if the prototype
	// restarts while it is on its way.
	function hold(waitingRequest) {
		waitingRequest.timer = setTimeout(
			() => {
				remove(waitingRequest)
				sendNotStarted(waitingRequest.response)
			},
			Math.max(0, waitingRequest.deadline - Date.now())
		)

		waiting.push(waitingRequest)
	}

	function forward(waitingRequest) {
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
				const headers = { ...proxyResponse.headers }

				if (headers[restartHeader]) {
					delete headers[restartHeader]

					// buffer the browser's next request, and start the restart
					// before it sees this response, so the follow up request
					// cannot reach the old process
					setReady(false)
					onRestart()
				}

				response.writeHead(proxyResponse.statusCode, headers)
				proxyResponse.pipe(response)
			}
		)

		proxyRequest.on('error', () => {
			// the process may be restarting, in which case a request that is safe
			// to repeat can wait for the new one instead of failing
			if (!ready && !response.headersSent && canRepeat(request)) {
				hold(waitingRequest)
				return
			}

			sendFailed(response)
		})

		proxyRequest.end(body)
	}

	function flush() {
		const waitingRequests = waiting
		waiting = []

		for (const waitingRequest of waitingRequests) {
			clearTimeout(waitingRequest.timer)
			forward(waitingRequest)
		}
	}

	function setReady(isReady) {
		ready = isReady

		if (ready) {
			flush()
		}
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

			response.on('close', () => remove(waitingRequest))

			if (ready) {
				forward(waitingRequest)
			} else {
				hold(waitingRequest)
			}
		})
	}

	return { handle, setReady }
}

export { createProxy, notStartedMessage, restartHeader }
