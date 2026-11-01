// Development only. Holds the port the browser uses: serves the manage UI and
// proxies the prototype to the prototype server running on another port.
//
// Manage prototype lives here rather than in the prototype process so it
// survives prototype restarts and keeps working when the prototype cannot
// start. The session is a file store shared with the prototype process, so the
// password and clear-data pages still work.

import express from 'express'

import { getManagePrototypeApp } from '../../manage-prototype/app.js'
import { templatePreviewPath } from '../../manage-prototype/routes/preview.js'
import { errorHandler, pageNotFound } from '../middleware/errors.js'
import session from '../middleware/session.js'
import livereload from './livereload.js'
import { createProxyMiddleware } from './proxy.js'

const livereloadPath = '/manage-prototype/livereload'

const devServer = {
	async start({ port, prototypePort }) {
		const app = express()
		const proxy = createProxyMiddleware({ target: `http://localhost:${prototypePort}` })

		// live reload is a long lived event stream that must not restart with the
		// prototype
		app.get(livereloadPath, livereload.route)

		// The one manage path that needs the prototype's views is proxied before
		// the manage app, so the manage app never parses its body. POSTs are
		// proxied too, so the prototype can handle them the same way as any page.
		app.use(templatePreviewPath, proxy)

		// The session pages work here because the session is a file store shared
		// with the prototype process.
		const manage = express.Router()
		await session.addSessionMiddleware(manage)
		manage.use(await getManagePrototypeApp())

		// An unmatched manage path is a 404, not something to send to the
		// prototype with its body already parsed.
		manage.use(pageNotFound)
		manage.use(errorHandler)

		app.use('/manage-prototype', manage)

		// everything else is the prototype
		app.use(proxy)

		// a request made while the prototype is restarting fails to proxy, so it
		// gets the error page rather than express's stack trace
		app.use(errorHandler)

		return app.listen(port)
	}
}

export default devServer
