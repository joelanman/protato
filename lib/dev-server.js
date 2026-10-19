import { fork } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'

import express from 'express'

import managePrototype from '../manage-prototype/index.js'
import { buildPrototype } from './build.js'
import livereload from './livereload.js'
import { createProxyMiddleware } from './middleware/proxy.js'
import { runPluginNpm } from './plugin-npm.js'
import plugins from './plugins.js'
import { setBuildResult, syncPackageState, watch } from './watch.js'

const __dirname = import.meta.dirname

const devServer = {
	prototypePort: null,
	prototypeProcess: null,
	updatingPlugins: false,

	async start(port, buildResult) {
		this.prototypePort = port + 10

		const app = express()
		app.use('/manage-prototype', managePrototype.getDevApp())
		app.use((request, response, next) => {
			if (this.updatingPlugins) {
				response.status(503).send('The prototype is restarting while plugins are being updated.')
				return
			}
			next()
		})
		app.use(
			createProxyMiddleware({
				target: `http://localhost:${this.prototypePort}`
			})
		)
		app.listen(port)

		await this.startPrototype(buildResult)
		watch(buildResult)
	},

	// buildResult is the latest result from build.js. The prototype server
	// needs it so it can show a build error as well as an app startup error.
	async startPrototype(buildResult) {
		return new Promise((resolve, reject) => {
			console.log('dev server - Starting prototype server')

			const commandPath = path.join(__dirname, 'prototype-server.js')
			this.prototypeProcess = fork(commandPath, [], {
				silent: true,
				serialization: 'advanced'
			})

			this.prototypeProcess.stdout.pipe(process.stdout)
			this.prototypeProcess.stderr.pipe(process.stderr)

			this.prototypeProcess.on('message', (message) => {
				if (message === 'ready') {
					resolve()
				}
			})

			// the prototype server needs the build result to show build errors
			this.prototypeProcess.send({
				action: 'start',
				port: this.prototypePort,
				buildResult
			})

			this.prototypeProcess.on('error', reject)

			this.prototypeProcess.on('exit', (code) => {
				if (code) {
					reject(new Error(`Server exited with code ${code}`))
				}
			})
		})
	},

	async stopPrototype() {
		if (this.prototypeProcess?.exitCode === null && this.prototypeProcess?.signalCode === null) {
			this.prototypeProcess.kill('SIGTERM')

			const forceKillTimeout = setTimeout(() => {
				this.prototypeProcess?.kill('SIGKILL')
			}, 2000)

			try {
				await once(this.prototypeProcess, 'exit')
			} finally {
				clearTimeout(forceKillTimeout)
			}
		}
	},

	async restartPrototype(buildResult) {
		if (this.updatingPlugins) {
			return
		}
		console.log('dev server - Restarting server...')
		await this.stopPrototype()

		// an update may have started while the old prototype was stopping
		if (this.updatingPlugins) {
			return
		}

		await this.startPrototype(buildResult)
	},

	async updatePlugins(plan) {
		if (this.updatingPlugins) {
			throw new Error('Another plugin operation is already running')
		}

		this.updatingPlugins = true
		let cleanupFailed = false

		try {
			await this.stopPrototype()
			return await runPluginNpm(plan)
		} catch (error) {
			cleanupFailed = error?.code === 'CLEANUP_FAILED'
			throw error
		} finally {
			if (!cleanupFailed) {
				try {
					await this.rebuildAndRestart()
				} finally {
					this.updatingPlugins = false
					syncPackageState()
				}
			}
		}
	},

	// A command-line install changed the project files. The packages are already
	// there, so this re-reads them and restarts, but never runs npm.
	async refreshPlugins() {
		if (this.updatingPlugins) {
			return
		}

		this.updatingPlugins = true

		try {
			await this.stopPrototype()
			await this.rebuildAndRestart()
		} finally {
			this.updatingPlugins = false
		}
	},

	async rebuildAndRestart() {
		plugins.clearCache()
		const buildResult = buildPrototype()
		setBuildResult(buildResult)
		await this.startPrototype(buildResult)
		livereload.reload()
	}
}

export default devServer
