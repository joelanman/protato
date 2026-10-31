// Development only. Holds the port the browser uses: serves the manage UI and
// proxies everything else to the prototype server running on another port.

import express from 'express'
import { getDevApp } from '../../manage-prototype/apps/dev-app.js'
import managePrototype from '../../manage-prototype/index.js'
import { createProxyMiddleware } from './proxy.js'

const devServer = {
	start({ port, prototypePort }) {
		const app = express()
		const proxy = createProxyMiddleware({ target: `http://localhost:${prototypePort}` })

		// The pages the prototype server serves are mounted before the dev app so
		// it never sees them, which keeps its body parsing and CSRF away from
		// requests it does not handle. Any other manage path belongs to the dev
		// app, and 404s.
		for (const path of managePrototype.proxyPaths) {
			app.use(path, proxy)
		}

		app.use('/manage-prototype', getDevApp())
		app.use(proxy)

		return app.listen(port)
	}
}

export default devServer
