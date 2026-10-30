import { buildPrototype } from './build.js'
import { getConfig } from './config.js'
import devServer from './dev/server.js'
import supervisor from './dev/supervisor.js'
import { watch } from './dev/watch.js'
import prototypeServer from './prototype-server.js'

const start = async () => {
	const { env, port } = getConfig()
	const isDev = env === 'development'
	buildPrototype()

	if (isDev) {
		// the prototype server restarts on changes, so it can't hold the port the
		// browser uses - the dev server holds that and proxies through to it
		const prototypePort = port + 10

		// bring the prototype server up first, so requests can't arrive at the dev
		// server before there is anything to proxy them to
		await supervisor.startPrototypeServer(prototypePort)
		devServer.start({ port, prototypePort })
		watch()
	} else {
		await prototypeServer.start({ port })
	}

	console.log('Running at http://localhost:' + port)
}

export { start }
