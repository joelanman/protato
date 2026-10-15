import managePrototype from '../manage-prototype/index.js'
import { buildPrototype } from './build.js'
import { getConfig } from './config.js'
import serverManager from './server-manager.js'
import { watch } from './watch.js'

const start = async () => {
	const { env, port } = getConfig()
	const isDev = env === 'development'
	const buildResult = buildPrototype()

	if (isDev) {
		process.env.PROTOTYPE_PORT = port + 10

		managePrototype.getDevApp().listen(port)
		await serverManager.start(buildResult)
		watch(buildResult)
	} else {
		process.env.PROTOTYPE_PORT = port

		await serverManager.start(buildResult)
	}

	console.log('Running at http://localhost:' + port)
}

export { start }
