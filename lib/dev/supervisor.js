// Development only. Starts, stops and restarts the prototype server as a
// separate process so a rebuild never drops the dev server's port.

import { fork } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

const __dirname = import.meta.dirname

let serverPort = null
let serverProcess = null
let restartRequested = false
let pendingRestart = null
let stopping = false

// lib/start.js passes the build module in, so this file imports nothing from
// outside lib/dev/. The supervisor reads the build result; it never builds.
let build = null

// Whether the prototype process is listening. The dev server's proxy waits for
// GET requests while it is not, and tells POST requests to try again.
let ready = false

// True after the prototype stops without being asked to. The dev server's proxy
// fails requests at once rather than waiting for a process that is not coming
// back on its own.
let down = false

function isReady() {
	return ready
}

function isDown() {
	return down
}

function setBuild(buildModule) {
	build = buildModule
}

async function startPrototypeServer(port) {
	serverPort = port
	ready = false
	down = false

	// the prototype server shows a build error as well as an app startup error
	const buildResult = build?.getBuildResult()

	if (!buildResult) {
		throw new Error('Build the prototype before starting it')
	}

	return new Promise((resolve, reject) => {
		console.log('supervisor - Starting prototype server')

		const commandPath = path.join(__dirname, '..', 'prototype-server.js')

		serverProcess = fork(commandPath, [], {
			silent: true,
			serialization: 'advanced'
		})

		serverProcess.stdout.pipe(process.stdout)
		serverProcess.stderr.pipe(process.stderr)

		serverProcess.on('message', (message) => {
			if (message === 'ready') {
				ready = true
				resolve()
			}
		})

		// a forked process cannot see the build result held in this one
		serverProcess.send({ action: 'start', port: serverPort, buildResult })

		serverProcess.on('error', reject)

		serverProcess.on('exit', (code) => {
			ready = false

			if (!stopping) {
				down = true
				console.error('supervisor - The prototype stopped unexpectedly')
			}

			if (code) {
				reject(new Error(`Server exited with code ${code}`))
			}
		})
	})
}

async function stopPrototypeServer() {
	ready = false

	if (serverProcess?.exitCode === null && serverProcess?.signalCode === null) {
		stopping = true
		serverProcess.kill('SIGTERM')

		try {
			// the prototype waits for requests in progress, including a plugin
			// change, before it exits
			await once(serverProcess, 'exit')
		} finally {
			stopping = false
		}
	}
}

// Restarts are coalesced: a restart asked for while one is running gets one
// more restart when that one finishes, because only the latest files matter.
// Without this, two restarts close together can interleave one's stop with the
// other's start, and leave the prototype down or unable to take the port.
function restartPrototypeServer() {
	restartRequested = true

	if (!pendingRestart) {
		pendingRestart = runRestarts()
	}

	return pendingRestart
}

async function runRestarts() {
	try {
		while (restartRequested) {
			restartRequested = false

			console.log('supervisor - Restarting prototype server...')

			await stopPrototypeServer()
			await startPrototypeServer(serverPort)
		}
	} finally {
		// cleared without an await after the loop's last check, so a request
		// made in between cannot be lost
		pendingRestart = null
	}
}

export default {
	isDown,
	isReady,
	restartPrototypeServer,
	setBuild,
	startPrototypeServer,
	stopPrototypeServer
}
