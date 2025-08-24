import { fork } from 'node:child_process'
import path from 'node:path'

import { getManagePrototypeApp } from '../manage-prototype/app.js'
import { getBuildState } from './build.js'
import livereload from './livereload.js'
import { stopProcess } from './utils/stop-process.js'

const __dirname = import.meta.dirname

class ServerManager {
	constructor() {
		this.serverProcess = null
		this.serverState = null
		this.setupProcessHandlers()
	}

	startManagePrototype() {
		const managePrototypeApp = getManagePrototypeApp()
		managePrototypeApp.listen(process.env.MANAGE_PROTOTYPE_PORT)
		console.log('server manager - manage prototype ready')
	}

	async startPrototype() {
		const buildState = getBuildState()

		if (buildState.state === 'error') {
			await this.startErrorServer(buildState.error)
			return
		}

		try {
			await this.start('prototype-server.js')
			this.serverState = 'prototype'
		} catch (err) {
			await this.startErrorServer(err)
		}
	}

	async startErrorServer(err) {
		await this.start('error-server.js', [err])
		this.serverState = 'error'
		livereload.reload()
	}

	async start(script, args = []) {
		return new Promise((resolve, reject) => {
			console.log('server manager - Starting server: ' + script)

			const commandPath = path.join(__dirname, script)

			this.serverProcess = fork(commandPath, args, { silent: true })

			this.serverProcess.stdout.pipe(process.stdout)
			this.serverProcess.stderr.pipe(process.stderr)

			const onData = (data) => {
				if (data.toString().includes('Running')) {
					this.serverProcess.stdout.off('data', onData)
					resolve()
				}
			}

			this.serverProcess.stdout.on('data', onData)
			this.serverProcess.on('error', reject)

			let stderrOutput = ''
			this.serverProcess.stderr.on('data', (data) => {
				stderrOutput += data.toString()
			})

			this.serverProcess.on('exit', (code) => {
				if (code === 0) {
					console.log('server manager - server exited cleanly')
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
			this.serverState = null
		} else {
			console.log('server manager - server process already exited')
		}
	}

	async restart() {
		console.log('server manager - Restarting server...')
		await this.stop()
		await this.startPrototype()
		livereload.reload()
	}

	getState() {
		return this.serverState
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
