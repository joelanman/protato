// Development only. Holds the port the browser uses: serves the manage UI and
// proxies everything else to the prototype server running on another port.

import express from 'express'

import managePrototype from '../../manage-prototype/dev-app.js'
import { createProxyMiddleware } from './proxy.js'

const devServer = {
	start({ port, prototypePort }) {
		const app = express()

		app.use('/manage-prototype', managePrototype.getDevApp())
		app.use(
			createProxyMiddleware({
				target: `http://localhost:${prototypePort}`
			})
		)

		return app.listen(port)
	}
}

export default devServer
