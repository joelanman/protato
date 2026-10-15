import managePrototype from '../manage-prototype/index.js'
import { buildPrototype } from './build.js'
import { getConfig } from './config.js'
import serverManager from './server-manager.js'
import { watch } from './watch.js'

const start = async () => {
	const config = getConfig()
	const isDev = config.env === 'development'

	if (isDev) {
		process.env.PROTOTYPE_PORT = config.port + 10

		const devApp = managePrototype.getDevApp()
		devApp.listen(config.port)
	} else {
		process.env.PROTOTYPE_PORT = config.port
	}

	const buildResult = buildPrototype()

	await serverManager.start(buildResult)

	if (isDev) {
		watch(buildResult)
	}

	console.log('Running at http://localhost:' + config.port)
}

export { start }
