import http from 'node:http'
import chokidar from 'chokidar'

function serve(options = {}) {
	const port = options.port || 35729
	const watchPaths = ['.tmp/public/**/*.*', 'app/views/**/*.*', 'app/config.json']

	let clients = []

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
	const watcher = chokidar.watch(watchPaths, {
		ignored: /node_modules/,
		ignoreInitial: true
	})

	watcher.on('change', (path) => {
		console.log(`File changed: ${path}`)
		clients.forEach((client) => {
			client.write('data: reload\n\n')
		})
	})
}

export default { serve }
