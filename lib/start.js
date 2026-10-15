import { buildPrototype } from './build.js'
import { getConfig } from './config.js'
import serverManager from './server-manager.js'
import { watch } from './watch.js'

const start = async () => {
	const config = getConfig()
	const isDev = config.env === 'development'

	if (isDev) {
		process.env.DEV_SERVER_PORT = config.port
		process.env.PROTOTYPE_PORT = config.port + 10

		serverManager.startDevServer()
	} else {
		process.env.PROTOTYPE_PORT = config.port
	}

	const buildResult = buildPrototype()

	await serverManager.startPrototype(buildResult)

	if (isDev) {
		watch(buildResult)
	}

	console.log('Running at http://localhost:' + config.port)
}

export { start }
