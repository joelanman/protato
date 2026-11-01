// Development only. Holds the port the browser uses. Every request is proxied
// to the prototype process, except the live reload stream, which stays in this
// process so a restart does not disconnect the browser.

import http from 'node:http'

import livereload from './livereload.js'
import { createProxy } from './proxy.js'
import supervisor from './supervisor.js'

const livereloadPath = '/manage-prototype/livereload'

const devServer = {
	start({ port, prototypePort }) {
		const proxy = createProxy({ target: `http://localhost:${prototypePort}` })

		// requests wait in the proxy while the prototype process is restarting
		supervisor.onReadyChange((isReady) => proxy.setReady(isReady))
		proxy.setReady(supervisor.getReady())

		const server = http.createServer((request, response) => {
			if (request.url === livereloadPath) {
				livereload.route(request, response)
				return
			}

			proxy.handle(request, response)
		})

		server.listen(port)

		return server
	}
}

export default devServer
