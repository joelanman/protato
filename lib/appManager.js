import { spawn } from 'node:child_process'
import path from 'node:path'
import chokidar from 'chokidar'
import { debounce } from 'radash'
import livereload from './livereload.js'
import { getPaths } from './paths.js'
import { stopProcess } from './utils/stop-process.js'

const __dirname = import.meta.dirname

let appProcess

const startApp = (doneFunc) => {
	console.log('appManager - Starting app...')

	const commandPath = path.join(__dirname, 'server.js')

	appProcess = spawn('node', [commandPath], {
		stdio: 'pipe'
	})

	appProcess.stdout.pipe(process.stdout)
	appProcess.stderr.pipe(process.stderr)

	// listen for server start if there's a done function to call

	if (doneFunc) {
		const onData = (data) => {
			const output = data.toString()
			if (output.includes('Running')) {
				doneFunc()
				appProcess.stdout.off('data', onData)
			}
		}
		appProcess.stdout.on('data', onData)
	}

	appProcess.on('error', (err) => {
		console.error('appManager - Failed to start app:', err)
	})

	appProcess.on('exit', (code, signal) => {
		if (code === 0) {
			console.log('appManager - App exited cleanly')
		} else {
			console.log(`appManager - App exited with code ${code}`)
		}
	})
}

const stopApp = async () => {
	if (appProcess.exitCode === null) {
		await stopProcess(appProcess)
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
