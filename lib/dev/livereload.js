let clients = []

const getRoute = () => {
	const route = (request, response) => {
		console.log('livereload - client connected')
		response.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'Access-Control-Allow-Origin': '*'
		})

		clients.push(response)

		request.on('close', () => {
			console.log('livereload - client disconnected')
			clients = clients.filter((client) => client !== response)
		})
	}

	return route
}

function reload() {
	if (clients.length) {
		console.log('livereload - reload (' + clients.length + ' clients)')
		clients.forEach((client) => {
			client.write('data: reload\n\n')
		})
	}
}

export default { getRoute, reload }
