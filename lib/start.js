import { buildPrototype } from './build.js'
import { getConfig } from './config.js'
import devServer from './dev-server.js'
import prototypeServer from './prototype-server.js'

const start = async () => {
	const { env, port } = getConfig()
	const isDev = env === 'development'
	const buildResult = buildPrototype()

	if (isDev) {
		await devServer.start(port, buildResult)
	} else {
		await prototypeServer.start(port, buildResult)
	}

	console.log('Running at http://localhost:' + port)
}

export { start }
