// Serves the prototype. In development this runs as a child process of the
// supervisor (lib/dev/), which restarts it on changes. In production it runs in
// the process `protato start` started.
//
// Either way it builds the prototype itself, so a new process always picks up
// the files as they are now.

import http from 'node:http'

import express from 'express'

import managePrototype from '../manage-prototype/index.js'
import { buildPrototype, buildSass, getBuildResult } from './build.js'
import { getConfig } from './config.js'
import * as registry from './manage-plugins/registry.js'
import { renderErrorPage } from './middleware/errors.js'
import replaceRequire from './utils/replace-require.js'

let server = null
let prototypeApp = null

// Set when the prototype's own routes or views could not be loaded. It is not
// fixed by rebuilding, so it lasts until the process restarts.
let startupError = null

// Created by start, once the environment is known and the build has run.
let errorApp = null

// The manage pages still work while the prototype cannot be built or started.
function createErrorApp() {
	const app = express()

	app.use('/manage-prototype', managePrototype.getManagePrototypeApp())
	app.use((request, response) => {
		renderErrorPage(getError(), request, response)
	})

	return app
}

function getError() {
	if (startupError) {
		return startupError
	}

	return getBuildResult()?.error
}

// Decided per request, so a sass error shows on the next request without
// restarting the process.
function handleRequest(request, response) {
	const buildResult = getBuildResult()

	if (prototypeApp && buildResult.state !== 'error') {
		prototypeApp(request, response)
		return
	}

	errorApp(request, response)
}

async function buildAndLoadApp() {
	replaceRequire()
	buildPrototype()

	// loaded even when the build failed, so fixing the build does not need a
	// restart. What a request gets is decided when it arrives.
	try {
		// imported here, not statically, so a syntax or import error in
		// app.js is caught and shown on the error page
		const { default: getApp } = await import('./app.js')
		prototypeApp = await getApp()
	} catch (error) {
		console.error('Prototype startup error:', error)
		startupError = error
	}
}

// Requests already being served are given a chance to finish, so a restart does
// not drop a response that is on its way to the browser.
function stop() {
	if (!server) {
		process.exit(0)
	}

	server.close(() => process.exit(0))
	server.closeIdleConnections()

	setTimeout(() => process.exit(0), 1000).unref()
}

async function start({ port }) {
	errorApp = createErrorApp()

	await buildAndLoadApp()

	if (getConfig().env === 'development') {
		// the dev plugins page shows update status. Not awaited: nothing about
		// starting the server depends on it.
		registry.startFetchingPluginData()
	}

	server = http.createServer(handleRequest)

	return new Promise((resolve, reject) => {
		server.on('error', reject)
		server.listen(port, () => {
			console.log('prototype server ready')
			resolve(server)
		})
	})
}

// Only does anything when forked by lib/dev/supervisor.js.
process.on('message', async (message) => {
	if (message.action === 'start') {
		await start({ port: message.port })
		process.send('ready')
	}

	if (message.action === 'build-sass') {
		const buildResult = buildSass()

		// A failed build writes no css, so nothing else tells the browser to
		// reload onto the error page.
		if (buildResult.state === 'error' && process.send) {
			process.send({ action: 'reload' })
		}
	}
})

process.on('SIGTERM', stop)

process.on('disconnect', () => {
	process.exit(0)
})

export default { start }
