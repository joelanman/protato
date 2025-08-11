import { spawn } from 'node:child_process'
import path from 'node:path'
import chokidar from 'chokidar'
import { debounce } from 'radash'
import livereload from './livereload.js'
import { getPaths } from './paths.js'
import { stopProcess } from './utils/stop-process.js'

const __dirname = import.meta.dirname

let childProcess

const startApp = (doneFunc) => {
	console.log('appManager - Starting app...')

	const commandPath = path.join(__dirname, 'server.js')

	childProcess = spawn('node', [commandPath], {
		stdio: 'pipe'
	})

	childProcess.stdout.pipe(process.stdout)
	childProcess.stderr.pipe(process.stderr)

	// listen for server start if there's a done function to call

	if (doneFunc) {
		const onData = (data) => {
			const output = data.toString()
			if (output.includes('Running')) {
				doneFunc()
				childProcess.stdout.off('data', onData)
			}
		}
		childProcess.stdout.on('data', onData)
	}

	childProcess.on('error', (err) => {
		console.error('appManager - Failed to start app:', err)
	})

	childProcess.on('exit', (code, signal) => {
		if (code === 0) {
			console.log('appManager - App exited cleanly')
		} else {
			console.log(`appManager - App exited with code ${code}`)
		}
	})
}

const stopApp = async () => {
	if (childProcess.exitCode === null) {
		await stopProcess(childProcess)
	} else {
		console.log('appManager - Child process already exited')
	}
}

const restartApp = async () => {
	console.log('appManager - Restarting app...')

	await stopApp()

	// start app then reload the browser

	startApp(livereload.reload)
}

// debounce restart so we don't restart many times if many files change at once

const debouncedRestart = debounce({ delay: 200 }, () => {
	restartApp()
})

function ignoreWatchFiles(path, stats) {
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
		console.log('appManager - Watch: ' + event + ': ' + path)
		debouncedRestart()
	})
}

// Graceful shutdown handler
const cleanup = async (signal) => {
	console.log(`appManager - Received ${signal} - cleaning up...`)

	try {
		await stopApp()
		console.log('appManager - Cleanup completed')
		process.exit(0)
	} catch (error) {
		console.error('appManager - Error during cleanup:', error)
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
