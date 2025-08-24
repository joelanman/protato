import { buildPrototype } from './build.js'
import { getConfig } from './config.js'
import serverManager from './server-manager.js'
import { watch } from './watch.js'

const start = async () => {
	const config = getConfig()

	if (config.env === 'development') {
		process.env.MANAGE_PROTOTYPE_PORT = config.port
		process.env.PROTOTYPE_PORT = config.port + 10

		serverManager.startManagePrototype()

		watch()
	} else {
		process.env.PROTOTYPE_PORT = config.port
	}

	buildPrototype()
	await serverManager.startPrototype()

	console.log('Running at http://localhost:' + config.port)
}

export { start }
