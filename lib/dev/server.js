// Development only. Holds the port the browser uses: serves the manage UI and
// proxies everything else to the prototype server running on another port.

import express from 'express'
import { getDevApp } from '../../manage-prototype/apps/dev-app.js'
import managePrototype from '../../manage-prototype/index.js'
import { createProxy } from './proxy.js'
import supervisor from './supervisor.js'

const restart = () => {
	supervisor.restartPrototypeServer().catch((error) => {
		console.error(`Could not restart the prototype: ${error.message}`)
	})
}

const devServer = {
	start({ port, prototypePort }) {
		const app = express()
		const proxy = createProxy({
			target: `http://localhost:${prototypePort}`,
			onRestart: restart
		})

		// requests wait in the proxy while the prototype process is restarting
		supervisor.onReadyChange((isReady) => proxy.setReady(isReady))
		proxy.setReady(supervisor.getReady())

		// The pages the prototype server serves are mounted before the dev app so
		// it never sees them, which keeps its body parsing and CSRF away from
		// requests it does not handle. Any other manage path belongs to the dev
		// app, and 404s.
		for (const path of managePrototype.proxyPaths) {
			app.use(path, proxy.handle)
		}

		app.use('/manage-prototype', getDevApp())
		app.use(proxy.handle)

		return app.listen(port)
	}
}

export default devServer
