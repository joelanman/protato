// Development only. Holds the port the browser uses. Every request is proxied
// to the prototype process, except the live reload stream and the explicit
// restart control.

import http from 'node:http'

import livereload from './livereload.js'
import { createProxy } from './proxy.js'
import supervisor from './supervisor.js'

const livereloadPath = '/manage-prototype/livereload'
const restartPath = '/__protato/restart'
const defaultReturnTo = '/manage-prototype/plugins'
const restartFailedMessage = 'The prototype did not start, check the terminal'

function getUrl(request) {
	return new URL(request.url, 'http://localhost')
}

// Only send the browser back to a page on this site.
function getReturnTo(url) {
	const returnTo = url.searchParams.get('returnTo')

	if (!returnTo?.startsWith('/') || returnTo.startsWith('//') || returnTo.startsWith(restartPath)) {
		return defaultReturnTo
	}

	return returnTo
}

async function restartAndRedirect(request, response) {
	request.resume()

	try {
		await supervisor.restartPrototypeServer()
	} catch {
		if (!response.destroyed) {
			response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
			response.end(restartFailedMessage)
		}
		return
	}

	if (response.destroyed) {
		return
	}

	response.writeHead(303, { Location: getReturnTo(getUrl(request)) })
	response.end()
}

const devServer = {
	start({ port, prototypePort }) {
		const proxy = createProxy({
			target: `http://localhost:${prototypePort}`,
			isReady: supervisor.isReady,
			isDown: supervisor.isDown
		})

		const server = http.createServer((request, response) => {
			const url = getUrl(request)

			if (url.pathname === livereloadPath) {
				livereload.route(request, response)
				return
			}

			if (request.method === 'POST' && url.pathname === restartPath) {
				restartAndRedirect(request, response)
				return
			}

			proxy.handle(request, response)
		})

		server.listen(port)

		return server
	}
}

export default devServer
