// Development only. Starts, stops and restarts the prototype server as a
// separate process so a rebuild never drops the dev server's port.

import { fork } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

import livereload from './livereload.js'

const __dirname = import.meta.dirname

let serverPort = null
let serverProcess = null
let restartRequested = false
let pendingRestart = null
let stopping = false

// True after the prototype stops without being asked to. The dev server's proxy
// fails requests at once rather than waiting for a process that is not coming
// back on its own.
let down = false

function isDown() {
	return down
}

// Messages to the prototype process are only possible when it is running as a
// child of this process, which it is in development and is not in tests.
function sendMessage(message) {
	if (serverProcess?.connected) {
		serverProcess.send(message)
	}
}

function handleMessage(message) {
	// the prototype asks for a reload when it has no new css to trigger one
	if (message.action === 'reload') {
		livereload.reload()
	}
}

async function startPrototypeServer(port) {
	serverPort = port
	down = false

	return new Promise((resolve, reject) => {
		console.log('supervisor - Starting prototype server')

		const commandPath = path.join(__dirname, '..', 'prototype-server.js')

		serverProcess = fork(commandPath, [], {
			env: { ...process.env, PROTATO_PROTOTYPE_PORT: String(port) },
			silent: true,
			serialization: 'advanced'
		})

		serverProcess.stdout.pipe(process.stdout)
		serverProcess.stderr.pipe(process.stderr)

		serverProcess.on('message', (message) => {
			if (message === 'ready') {
				resolve()
				return
			}

			handleMessage(message)
		})

		serverProcess.on('error', reject)

		serverProcess.on('exit', (code) => {
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
	restartPrototypeServer,
	sendMessage,
	startPrototypeServer,
	stopPrototypeServer
}
