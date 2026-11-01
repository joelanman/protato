import { getConfig } from './config.js'
import devServer from './dev/server.js'
import supervisor from './dev/supervisor.js'
import { watch } from './dev/watch.js'
import { getPaths } from './paths.js'
import prototypeServer from './prototype-server.js'

const start = async () => {
	const { env, port } = getConfig()
	const isDev = env === 'development'

	if (isDev) {
		// the prototype process is restarted on changes, so it can't hold the port
		// the browser uses - the dev server holds that and proxies through to it
		const prototypePort = port + 10

		// bring the prototype up first, so the browser port is not held while
		// there is nothing to proxy to
		await supervisor.startPrototypeServer(prototypePort)
		devServer.start({ port, prototypePort })
		watch(getPaths())
	} else {
		await prototypeServer.start({ port })
	}

	console.log('Running at http://localhost:' + port)
}

export { start }
