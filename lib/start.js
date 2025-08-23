import { buildPrototype, watchSass } from './build.js'
import { getConfig } from './config.js'
import { startManagePrototypeServer, startPrototypeServer, watchApp } from './server-manager.js'

const start = async () => {
	const config = getConfig()

	if (config.env === 'development') {
		process.env.MANAGE_PROTOTYPE_PORT = config.port
		process.env.PROTOTYPE_PORT = config.port + 10

		startManagePrototypeServer()

		buildPrototype()
		startPrototypeServer()

		watchSass()
		watchApp()
	} else {
		process.env.PROTOTYPE_PORT = config.port
		buildPrototype()
		startPrototypeServer()
	}
}

export { start }
