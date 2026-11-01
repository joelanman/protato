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

// A plugin change runs npm in the prototype process. Restarting then would kill
// npm part way through, so restarts are held until the change finishes.
let changeRunning = false

// Resolved when the restart that a held request asked for has finished, so a
// caller waiting on a restart still reloads the browser at the right time.
let heldRestart = null

// Whether the prototype process is listening and can take requests. The dev
// server's proxy buffers requests while it is not.
let ready = false
let stopping = false
const readyListeners = new Set()

function getReady() {
	return ready
}

function onReadyChange(listener) {
	readyListeners.add(listener)
}

function setReady(isReady) {
	ready = isReady

	for (const listener of readyListeners) {
		listener(isReady)
	}
}

// Messages to the prototype process are only possible when it is running as a
// child of this process, which it is in development and is not in tests.
function sendMessage(message) {
	if (serverProcess?.connected) {
		serverProcess.send(message)
	}
}

function handleMessage(message, onReady) {
	if (message === 'ready') {
		setReady(true)
		onReady()
	}

	// the prototype asks for a reload when it has no new css to trigger one
	if (message.action === 'reload') {
		livereload.reload()
	}

	if (message.action === 'change-start') {
		changeRunning = true
	}

	if (message.action === 'change-end') {
		endChange()
	}
}

async function startPrototypeServer(port) {
	serverPort = port

	return new Promise((resolve, reject) => {
		console.log('supervisor - Starting prototype server')

		const commandPath = path.join(__dirname, '..', 'prototype-server.js')

		serverProcess = fork(commandPath, [], {
			silent: true,
			serialization: 'advanced'
		})

		serverProcess.stdout.pipe(process.stdout)
		serverProcess.stderr.pipe(process.stderr)

		serverProcess.on('message', (message) => handleMessage(message, resolve))

		// the prototype process builds and loads everything itself
		serverProcess.send({ action: 'start', port: serverPort })

		serverProcess.on('error', reject)

		serverProcess.on('exit', (code) => {
			if (!stopping) {
				setReady(false)
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

		const forceKillTimeout = setTimeout(() => {
			serverProcess?.kill('SIGKILL')
		}, 2000)

		try {
			await once(serverProcess, 'exit')
		} finally {
			clearTimeout(forceKillTimeout)
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

	if (changeRunning) {
		return holdRestart()
	}

	return startRestarts()
}

function holdRestart() {
	if (!heldRestart) {
		let resolve
		let reject
		const promise = new Promise((promiseResolve, promiseReject) => {
			resolve = promiseResolve
			reject = promiseReject
		})

		heldRestart = { promise, resolve, reject }
	}

	return heldRestart.promise
}

function startRestarts() {
	if (!pendingRestart) {
		pendingRestart = runRestarts()
	}

	return pendingRestart
}

function endChange() {
	changeRunning = false

	const held = heldRestart
	heldRestart = null

	// nothing was asked for during the change
	if (!restartRequested) {
		held?.resolve()
		return
	}

	// one restart for everything that was asked for during the change
	const restarted = startRestarts()

	if (held) {
		restarted.then(held.resolve, held.reject)
	}
}

async function runRestarts() {
	try {
		while (restartRequested && !changeRunning) {
			restartRequested = false

			console.log('supervisor - Restarting prototype server...')

			// buffer requests until the new process is ready
			setReady(false)

			await stopPrototypeServer()

			// a change may have started while the process was stopping, in which
			// case its restart waits for the change to finish
			if (changeRunning) {
				restartRequested = true
				break
			}

			await startPrototypeServer(serverPort)
		}
	} finally {
		// cleared without an await after the loop's last check, so a request
		// made in between cannot be lost
		pendingRestart = null
	}
}

export default {
	getReady,
	onReadyChange,
	restartPrototypeServer,
	sendMessage,
	startPrototypeServer,
	stopPrototypeServer
}
