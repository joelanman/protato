import { fork } from 'node:child_process'
import path from 'node:path'
import chokidar from 'chokidar'
import { debounce } from 'radash'
import { getManagePrototypeApp } from '../manage-prototype/app.js'
import livereload from '../manage-prototype/livereload.js'
import { getBuildState } from './build.js'
import { getPaths } from './paths.js'
import { stopProcess } from './utils/stop-process.js'

const __dirname = import.meta.dirname

let serverProcess = null
let serverState = null

const startManagePrototypeServer = () => {
	const managePrototypeApp = getManagePrototypeApp()
	managePrototypeApp.listen(process.env.MANAGE_PROTOTYPE_PORT)
}

const startPrototypeServer = async () => {
	const buildState = getBuildState()

	// can't start if build failed
	if (buildState.state === 'error') {
		await startErrorServer(buildState.error)
		return
	}

	try {
		await startServer('prototype-server.js')
		serverState = 'prototype'
	} catch (err) {
		await startErrorServer(err)
	}
}

const startErrorServer = async (err) => {
	await startServer('error-server.js', [err])
	serverState = 'error'
	livereload.reload()
}

const startServer = async (script, args) => {
	return new Promise((resolve, reject) => {
		console.log('server manager - Starting server: ' + script)

		const commandPath = path.join(__dirname, script)

		serverProcess = fork(commandPath, args, {
			silent: true
		})

		serverProcess.stdout.pipe(process.stdout)
		serverProcess.stderr.pipe(process.stderr)

		const onData = (data) => {
			const output = data.toString()
			if (output.includes('Running')) {
				serverProcess.stdout.off('data', onData)
				resolve()
			}
		}
		serverProcess.stdout.on('data', onData)

		serverProcess.on('error', (err) => {
			console.error('server manager - Failed to start server:', err)
			reject(err)
		})

		let stderrOutput = ''

		serverProcess.stderr.on('data', (data) => {
			stderrOutput += data.toString()
		})

		serverProcess.on('exit', async (code, signal) => {
			if (code === 0) {
				console.log('server manager - server exited cleanly')
				return
			} else {
				console.log(`server manager - server exited with code ${code}`)
				reject(new Error(stderrOutput))
			}
		})
	})
}

const stopServer = async () => {
	if (serverProcess.exitCode === null) {
		await stopProcess(serverProcess)
	} else {
		console.log('server manager - server process already exited')
	}
}

const restartServer = async () => {
	console.log('server manager - Restarting server...')

	await stopServer()
	await startPrototypeServer()
	livereload.reload()
}

// debounce restart so we don't restart many times if many files change at once

const debouncedRestart = debounce({ delay: 200 }, () => {
	restartServer()
})

function ignoreWatchFiles(path, stats) {
	// don't ignore folders or it doesn't work

	if (!stats || !stats.isFile()) {
		return false
	}

	if (path.endsWith('.js') || path.endsWith('.json')) {
		return false
	} else {
		return true
	}
}

const watchApp = () => {
	const paths = getPaths()
	const watcher = chokidar.watch(paths.app, {
		ignored: ignoreWatchFiles,
		ignoreInitial: true,
		persistent: true
	})

	watcher.on('all', (event, path) => {
		console.log('server manager - Watch: ' + event + ': ' + path)
		debouncedRestart()
	})
}

const getServerState = () => {
	return serverState
}

// Graceful shutdown handler
const cleanup = async (signal) => {
	console.log(`server manager - Received ${signal} - cleaning up...`)

	try {
		await stopServer()
		console.log('server manager - Cleanup completed')
		process.exit(0)
	} catch (error) {
		console.error('server manager - Error during cleanup:', error)
		process.exit(1)
	}
}

// Listen for termination signals
process.on('SIGINT', () => cleanup('SIGINT')) // Ctrl+C
process.on('SIGTERM', () => cleanup('SIGTERM')) // Termination request
process.on('SIGHUP', () => cleanup('SIGHUP')) // Terminal closed

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', async (error) => {
	console.error('Uncaught Exception:', error)
	await cleanup('uncaughtException')
})

process.on('unhandledRejection', async (reason, promise) => {
	console.error('Unhandled Rejection at:', promise, 'reason:', reason)
	await cleanup('unhandledRejection')
})

export { startPrototypeServer, startManagePrototypeServer, watchApp, restartServer, getServerState }
