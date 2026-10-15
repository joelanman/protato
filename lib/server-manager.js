import { fork } from 'node:child_process'
import path from 'node:path'

import { stopProcess } from './utils/stop-process.js'

const __dirname = import.meta.dirname

class ServerManager {
	constructor() {
		this.serverProcess = null
		this.setupProcessHandlers()
	}

	// buildResult is the latest result from build.js. The prototype server
	// needs it so it can show a build error as well as an app startup error.
	async start(buildResult) {
		return new Promise((resolve, reject) => {
			console.log('server manager - Starting prototype server')

			const commandPath = path.join(__dirname, 'prototype-server.js')
			this.serverProcess = fork(commandPath, [], { silent: true })

			this.serverProcess.stdout.pipe(process.stdout)
			this.serverProcess.stderr.pipe(process.stderr)

			this.serverProcess.on('message', (message) => {
				if (message === 'ready') {
					resolve()
				}
			})

			// the prototype server needs the build result to show build errors
			const error = buildResult.error
			this.serverProcess.send({
				type: 'buildResult',
				buildResult: {
					state: buildResult.state,
					error: error ? { message: error.message, stack: error.stack } : undefined
				}
			})

			this.serverProcess.on('error', reject)

			let stderrOutput = ''
			this.serverProcess.stderr.on('data', (data) => {
				stderrOutput += data.toString()
			})

			this.serverProcess.on('exit', (code) => {
				if (code === 0) {
					console.log('server manager - server exited cleanly')
					resolve()
				} else {
					console.log(`server manager - server exited with code ${code}`)
					reject(new Error(stderrOutput))
				}
			})
		})
	}

	async stop() {
		if (this.serverProcess?.exitCode === null) {
			await stopProcess(this.serverProcess)
		} else {
			console.log('server manager - server process already exited')
		}
	}

	async restart(buildResult) {
		console.log('server manager - Restarting server...')
		await this.stop()
		await this.start(buildResult)
	}

	async cleanup(signal) {
		console.log(`server manager - Received ${signal} - cleaning up...`)
		try {
			await this.stop()
			console.log('server manager - Cleanup completed')
			process.exit(0)
		} catch (error) {
			console.error('server manager - Error during cleanup:', error)
			process.exit(1)
		}
	}

	setupProcessHandlers() {
		process.on('SIGINT', () => this.cleanup('SIGINT'))
		process.on('SIGTERM', () => this.cleanup('SIGTERM'))
		process.on('SIGHUP', () => this.cleanup('SIGHUP'))
		process.on('uncaughtException', async (error) => {
			console.error('Uncaught Exception:', error)
			await this.cleanup('uncaughtException')
		})
		process.on('unhandledRejection', async (reason, promise) => {
			console.error('Unhandled Rejection at:', promise, 'reason:', reason)
			await this.cleanup('unhandledRejection')
		})
	}
}

// Create and export singleton instance
const serverManager = new ServerManager()
export default serverManager
