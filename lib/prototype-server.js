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
import { renderErrorPage } from './middleware/errors.js'
import replaceRequire from './utils/replace-require.js'

let prototypeApp = null

// Set when the prototype's own routes or views could not be loaded. It is not
// fixed by rebuilding, so it lasts until the process restarts.
let startupError = null

// Created by start, once the environment is known and the build has run.
let errorApp = null

// The manage pages still work while the prototype cannot be built or started.
function createErrorApp() {
	const app = express()

	app.use('/manage-prototype', managePrototype.getSessionApp())
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

function handleRequest(request, response) {
	if (prototypeApp) {
		prototypeApp(request, response)
		return
	}

	errorApp(request, response)
}

async function buildAndLoadApp() {
	replaceRequire()
	buildPrototype()

	if (getBuildResult().state === 'error') {
		return
	}

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

async function start({ port }) {
	errorApp = createErrorApp()

	await buildAndLoadApp()

	const server = http.createServer(handleRequest)

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
		if (buildResult.state === 'error') {
			process.send({ action: 'reload' })
		}
	}
})

process.on('disconnect', () => {
	process.exit(0)
})

export default { start }
