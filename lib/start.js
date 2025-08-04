import { performance } from 'node:perf_hooks'
import { build, watchSass } from './build.js'
import { getConfig } from './config.js'
import { startApp, watchApp } from './controlApp.js'
import livereload from './livereload.js'

const startTime = performance.now()

const start = async () => {
	const config = getConfig()

	build()

	console.log(`build ${(performance.now() - startTime).toFixed(2)}ms`)

	startApp()

	if (config.env === 'development') {
		watchSass()
		livereload.serve(config.port + 10)
		watchApp()
	}

	const endTime = performance.now()
	console.log(`Total ${(endTime - startTime).toFixed(2)}ms`)
}

export { start }
