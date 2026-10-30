// Development only. Starts, stops and restarts the prototype server as a
// separate process so a rebuild never drops the dev server's port.

import { fork } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

import { getBuildResult } from '../build.js'

const __dirname = import.meta.dirname

let serverPort = null
let serverProcess = null

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

async function restartPrototypeServer() {
	console.log('supervisor - Restarting prototype server...')
	await stopPrototypeServer()
	await startPrototypeServer(serverPort)
}

export default { restartPrototypeServer, startPrototypeServer, stopPrototypeServer }
