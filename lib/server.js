import { performance } from 'node:perf_hooks'
import getApp from './app.js'
import build from './build.js'
import { getConfig } from './config.js'
import livereload from './livereload.js'
import replaceRequire from './replace-require.js'

const startTime = performance.now()

let app

const server = {
	start: async () => {
		replaceRequire()

		const config = getConfig()

		build()

		console.log(`build ${(performance.now() - startTime).toFixed(2)}ms`)

		if (config.env === 'development') {
			livereload.serve()
		}

		app = await getApp()

		console.log(`app ${(performance.now() - startTime).toFixed(2)}ms`)

		const port = config.port
		app.listen(port)

		console.log('Running at http://localhost:' + port)

		const endTime = performance.now()
		console.log(`Total ${(endTime - startTime).toFixed(2)}ms`)
	}
}

export default server
