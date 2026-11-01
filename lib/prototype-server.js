// Serves the prototype. In development this runs as a child process of the
// supervisor (lib/dev/), which builds before it forks and sends the build
// result over IPC, because a child process cannot see the result held in
// memory by its parent. In production it runs in the process `protato start`
// started, which builds before starting it.
//
// Manage prototype is mounted here only in production. In development the dev
// server serves it, so the manage UI survives a prototype restart.

import express from 'express'

import { getManagePrototypeApp } from '../manage-prototype/index.js'
import { getBuildResult } from './build.js'
import { getConfig } from './config.js'
import { checkAuth } from './middleware/auth.js'
import { renderErrorPage } from './middleware/errors.js'
import session from './middleware/session.js'
import replaceRequire from './utils/replace-require.js'

// The manage pages still work while the prototype cannot be built or started.
// In production the same body parsing, session, auth and manage middleware are
// mounted as in the normal app, so manage forms keep working too.
async function createErrorApp(error) {
	const app = express()

	await session.addSessionMiddleware(app)

	if (getConfig().env !== 'development') {
		app.use(checkAuth)
		app.use('/manage-prototype', await getManagePrototypeApp())
	}

	// The build error has already been reported, so render it without logging it
	// again for every request.
	app.use((request, response) => {
		renderErrorPage(error, request, response)
	})

	return app
}

// A failed build and a prototype that cannot be loaded both show the error page
// in place of the prototype.
async function createApp(buildResult) {
	if (buildResult.state === 'error') {
		return createErrorApp(buildResult.error)
	}

	replaceRequire()

	try {
		// imported here, not statically, so a syntax or import error in
		// app.js is caught and shown on the error page
		const { default: getApp } = await import('./app.js')
		return await getApp()
	} catch (error) {
		console.error('Prototype startup error:', error)
		return createErrorApp(error)
	}
}

// Serves the prototype for a build result. Used instead of start when the build
// result comes from somewhere other than this process. Returns the http server.
async function serve({ port, buildResult }) {
	if (!buildResult) {
		throw new Error('Build the prototype before starting it')
	}

	const app = await createApp(buildResult)
	const httpServer = app.listen(port)

	console.log('prototype server ready')

	return httpServer
}

// In production the build ran in this process, so use its result unless one is
// given, which is how tests start it with a specific result.
const start = ({ port, buildResult = getBuildResult() }) => serve({ port, buildResult })

// Only does anything when forked by lib/dev/supervisor.js, which sends the
// latest build result over IPC because a child process can't see the build
// result held in memory by its parent.
process.on('message', async (message) => {
	if (message.action === 'start') {
		await serve({ port: message.port, buildResult: message.buildResult })
		process.send('ready')
	}
})

process.on('disconnect', () => {
	process.exit(0)
})

export default { start }
