import { performance } from 'node:perf_hooks'
import { getManagePrototypeApp } from '../manage-prototype/app.js'
import { startApp, watchApp } from './appManager.js'
import { buildApp, watchSass } from './build.js'
import { getConfig } from './config.js'
import livereload from './livereload.js'

const startTime = performance.now()

const start = async () => {
	const config = getConfig()

	console.log(`build ${(performance.now() - startTime).toFixed(2)}ms`)

	if (config.env === 'development') {
		const managePrototypePort = config.port
		process.env.LIVE_RELOAD_PORT = config.port + 10
		process.env.PROTOTYPE_PORT = config.port + 20

		// manage prototype
		const managePrototypeApp = getManagePrototypeApp()
		managePrototypeApp.listen(managePrototypePort)

		// build and watch app
		buildApp()
		watchSass()

		// live reload
		livereload.serve()

		// prototype app
		startApp()
		watchApp()
	} else {
		process.env.PROTOTYPE_PORT = config.port
		buildApp()
		startApp()
	}

	const endTime = performance.now()
	console.log(`Total ${(endTime - startTime).toFixed(2)}ms`)
}

export { start }
