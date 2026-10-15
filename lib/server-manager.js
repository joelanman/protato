import { fork } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

const __dirname = import.meta.dirname

class ServerManager {
	constructor() {
		this.serverProcess = null
	}

	// buildResult is the latest result from build.js. The prototype server
	// needs it so it can show a build error as well as an app startup error.
	async start(buildResult) {
		return new Promise((resolve, reject) => {
			console.log('server manager - Starting prototype server')

			const commandPath = path.join(__dirname, 'prototype-server.js')
			this.serverProcess = fork(commandPath, [], {
				silent: true,
				serialization: 'advanced'
			})

			this.serverProcess.stdout.pipe(process.stdout)
			this.serverProcess.stderr.pipe(process.stderr)

			this.serverProcess.on('message', (message) => {
				if (message === 'ready') {
					resolve()
				}
			})

			// the prototype server needs the build result to show build errors
			this.serverProcess.send({
				type: 'buildResult',
				buildResult
			})

			this.serverProcess.on('error', reject)

			this.serverProcess.on('exit', (code) => {
				if (code === 0) {
					console.log('server manager - server exited cleanly')
					resolve()
				} else {
					console.log(`server manager - server exited with code ${code}`)
					reject(new Error(`Server exited with code ${code}`))
				}
			})
		})
	}

	async stop() {
		if (this.serverProcess?.exitCode === null && this.serverProcess?.signalCode === null) {
			this.serverProcess.kill('SIGTERM')

			const forceKillTimeout = setTimeout(() => {
				this.serverProcess?.kill('SIGKILL')
			}, 2000)

			try {
				await once(this.serverProcess, 'exit')
			} finally {
				clearTimeout(forceKillTimeout)
			}
		}
	}

	async restart(buildResult) {
		console.log('server manager - Restarting server...')
		await this.stop()
		await this.start(buildResult)
	}
}

// Create and export singleton instance
const serverManager = new ServerManager()
export default serverManager
