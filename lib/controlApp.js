import { spawn } from 'node:child_process'
import path from 'node:path'
import chokidar from 'chokidar'
import { debounce } from 'radash'
import { getPaths } from './paths.js'
import { stopProcess } from './stop-process.js'

const __dirname = import.meta.dirname

let childProcess

const startApp = () => {
	console.log('controlApp - Starting app...')

	const listenPath = path.join(__dirname, 'server.js')

	childProcess = spawn('node', [listenPath], {
		stdio: 'inherit',
		cwd: process.cwd()
	})

	childProcess.on('error', (err) => {
		console.error('controlApp - Failed to start app:', err)
	})

	childProcess.on('exit', (code, signal) => {
		if (code !== 0) {
			console.log(`controlApp - App exited with code ${code}`)
		} else {
			console.log('controlApp - App exited cleanly')
		}
	})
}

const stopApp = async () => {
	await stopProcess(childProcess)
}

const restartApp = async () => {
	console.log('controlApp - Restarting app...')

	await stopApp()
	startApp()
}

const debouncedRestart = debounce({ delay: 200 }, () => {
	restartApp()
})

const watchApp = () => {
	const paths = getPaths()
	const watcher = chokidar.watch(paths.app, {
		ignoreInitial: true,
		persistent: true
	})

	watcher.on('all', (event, path) => {
		console.log('controlApp - Watch: ' + event + ': ' + path)
		debouncedRestart()
	})
}

// Graceful shutdown handler
const cleanup = async (signal) => {
	console.log(`\ncontrolApp - Received ${signal} - cleaning up...`)

	try {
		// Stop child process
		if (childProcess) {
			await stopProcess(childProcess)
		}

		console.log('controlApp - Cleanup completed')
		process.exit(0)
	} catch (error) {
		console.error('controlApp - Error during cleanup:', error)
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

export { startApp, watchApp }
