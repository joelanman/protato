import http from 'node:http'
import chokidar from 'chokidar'
import { debounce } from 'radash'
import { getPaths } from './paths.js'

let clients = []

function serve(port) {
	const paths = getPaths()

	// Create HTTP server for EventSource
	const server = http.createServer((request, response) => {
		if (request.url === '/livereload') {
			response.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Access-Control-Allow-Origin': '*'
			})

			clients.push(response)

			request.on('close', () => {
				clients = clients.filter((client) => client !== response)
			})
		}
	})

	server.listen(port, () => {
		console.log(`Live reload server running on port ${port}`)
	})

	// Watch files
	const watcher = chokidar.watch([paths.public, paths.views], {
		ignoreInitial: true
	})

	const debouncedReload = debounce({ delay: 100 }, () => {
		console.log('livereload - reloading')
		reload()
	})

	watcher.on('change', (path) => {
		console.log(`livereload - file changed: ${path}`)
		debouncedReload()
	})
}

function reload() {
	console.log('livereload - reload')
	clients.forEach((client) => {
		client.write('data: reload\n\n')
	})
}

export default { serve, reload }
