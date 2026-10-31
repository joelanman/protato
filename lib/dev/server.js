// Development only. Holds the port the browser uses: serves the manage UI and
// proxies everything else to the prototype server running on another port.

import express from 'express'
import { pagePaths } from '../../manage-prototype/app.js'
import managePrototype from '../../manage-prototype/dev-app.js'
import { templatePreviewPath } from '../../manage-prototype/routes/template-preview.js'
import { createProxyMiddleware } from './proxy.js'

const MANAGE_PROTOTYPE_PATH = '/manage-prototype'

// The manage pages served by the prototype server: the session pages, plus
// template previews. Their paths come from the apps that register them, so
// there is no list to keep in sync. They are mounted before the dev app so it
// never sees them, which keeps its body parsing and CSRF away from requests it
// does not handle. Any other /manage-prototype path is the dev app's, and 404s.
const PROXY_MANAGE_PATHS = [...pagePaths.map((path) => `${MANAGE_PROTOTYPE_PATH}${path}`), templatePreviewPath]

const devServer = {
	start({ port, prototypePort }) {
		const app = express()
		const proxy = createProxyMiddleware({ target: `http://localhost:${prototypePort}` })

		for (const path of PROXY_MANAGE_PATHS) {
			app.use(path, proxy)
		}

		app.use(MANAGE_PROTOTYPE_PATH, managePrototype.getDevApp())
		app.use(proxy)

		return app.listen(port)
	}
}

export default devServer
