import chokidar from 'chokidar'
import { debounce } from 'radash'

import { getPaths } from '../lib/paths.js'

let clients = []
let watcher

const getRoute = () => {
	const paths = getPaths()
	
	const route = (request, response) => {
		console.log('livereload - client connected')
		response.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': '*'
		})

		clients.push(response)

		request.on('close', () => {
			console.log('livereload - client disconnected')
			clients = clients.filter((client) => client !== response)
		})
	}
	
	console.log([paths.public, paths.views])

	// Watch files
	watcher = chokidar.watch([paths.public, paths.views], {
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

	return route

}

function reload() {
	console.log('livereload - reload (' + clients.length + ' clients)')
	clients.forEach((client) => {
		client.write('data: reload\n\n')
	})
}

export default { getRoute, reload }
