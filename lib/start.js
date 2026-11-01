import { buildPrototype } from './build.js'
import { getConfig } from './config.js'
import devServer from './dev/server.js'
import supervisor from './dev/supervisor.js'
import { watch } from './dev/watch.js'
import * as registry from './manage-plugins/registry.js'
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
		await devServer.start({ port, prototypePort })
		watch()

		// The plugins page is dev only, so fetching plugin data is too. Not awaited:
		// nothing about starting the server depends on it.
		registry.startFetchingPluginData()
	} else {
		await prototypeServer.start({ port })
	}

	console.log('Running at http://localhost:' + port)
}

export { start }
