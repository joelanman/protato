// Development only. Starts, stops and restarts the prototype server as a
// separate process so a rebuild never drops the dev server's port.

import { fork } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

import { getBuildResult } from '../build.js'

const __dirname = import.meta.dirname

let serverPort = null
let serverProcess = null
let restartRequested = false
let pendingRestart = null

async function startPrototypeServer(port) {
	serverPort = port

	// the prototype server shows a build error as well as an app startup error
	const buildResult = getBuildResult()

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
				resolve()
			}
		})

		serverProcess.send({
			action: 'start',
			port: serverPort,
			buildResult
		})

		serverProcess.on('error', reject)

		serverProcess.on('exit', (code) => {
			if (code) {
				reject(new Error(`Server exited with code ${code}`))
			}
		})
	})
}

async function stopPrototypeServer() {
	if (serverProcess?.exitCode === null && serverProcess?.signalCode === null) {
		serverProcess.kill('SIGTERM')

		const forceKillTimeout = setTimeout(() => {
			serverProcess?.kill('SIGKILL')
		}, 2000)

		try {
			await once(serverProcess, 'exit')
		} finally {
			clearTimeout(forceKillTimeout)
		}
	}
}

// Restarts are coalesced: a restart asked for while one is running gets one
// more restart when that one finishes, because only the latest build result
// matters. Without this, two restarts close together can interleave one's stop
// with the other's start, and leave the prototype down or unable to take the
// port.
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

export default { restartPrototypeServer, startPrototypeServer, stopPrototypeServer }
