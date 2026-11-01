// Serves the prototype. In development this runs as a child process of the
// supervisor (lib/dev/), which builds before it forks and sends the build
// result over IPC, because a child process cannot see the result held in
// memory by its parent. In production it runs in the process `protato start`
// started, which builds before starting it.

import http from 'node:http'

import express from 'express'

import { getBuildResult } from './build.js'
import { getConfig } from './config.js'
import { isChangeRunning } from './manage-plugins/change.js'
import * as registry from './manage-plugins/registry.js'
import { addBaseAppMiddleware } from './middleware/base-app.js'
import { renderErrorPage } from './middleware/errors.js'
import replaceRequire from './utils/replace-require.js'

let server = null

// The manage pages still work while the prototype cannot be built or started.
// The same body parsing, session, auth and manage middleware are mounted as in
// the normal app, so manage forms keep working too.
async function createErrorApp(error) {
	const app = express()

	await addBaseAppMiddleware(app)

	// The build error has already been reported, so render it without logging it
	// again for every request.
	app.use((request, response) => {
		renderErrorPage(error, request, response)
	})

	return app
}

// A failed build and a prototype that cannot be loaded both show the error page
// in place of the prototype, so manage prototype keeps working either way.
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

async function start({ port, buildResult = getBuildResult() }) {
	if (!buildResult) {
		throw new Error('Build the prototype before starting it')
	}

	if (getConfig().env === 'development') {
		// the dev plugins page shows update status. Not awaited: nothing about
		// starting the server depends on it.
		registry.startFetchingPluginData()
	}

	const app = await createApp(buildResult)

	server = http.createServer(app)

	return new Promise((resolve, reject) => {
		server.on('error', reject)
		server.listen(port, () => {
			console.log('prototype server ready')
			resolve(server)
		})
	})
}

// Requests already being served are given a chance to finish, so a restart does
// not drop a response that is on its way to the browser.
function stop() {
	if (!server) {
		process.exit(0)
	}

	server.close(() => process.exit(0))
	server.closeIdleConnections()

	// A plugin change runs npm in this process and the request that started it
	// is still open. server.close waits for it, so do not force exit while a
	// change is running.
	const forceExit = () => {
		if (isChangeRunning()) {
			setTimeout(forceExit, 1000).unref()
			return
		}

		process.exit(0)
	}

	setTimeout(forceExit, 1000).unref()
}

process.on('message', async (message) => {
	if (message.action === 'start') {
		try {
			await start({ port: message.port, buildResult: message.buildResult })
			process.send('ready')
		} catch (error) {
			console.error(error)
			process.exit(1)
		}
	}
})

process.on('SIGTERM', stop)

process.on('disconnect', () => {
	process.exit(0)
})

export default { start }
