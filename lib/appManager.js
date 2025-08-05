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
	console.log('controlApp - Starting app...')

	const commandPath = path.join(__dirname, 'server.js')

	childProcess = spawn('node', [commandPath], {
		stdio: 'pipe',
		cwd: process.cwd()
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
	if (childProcess.exitCode === null) {
		await stopProcess(childProcess)
	} else {
		console.log('controlApp - Child process already exited')
	}
}

const restartApp = async () => {
	console.log('controlApp - Restarting app...')

	await stopApp()
	startApp(livereload.reload)
}

const debouncedRestart = debounce({ delay: 200 }, () => {
	restartApp()
})

function ignoreFiles(path, stats) {
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
		ignored: ignoreFiles,
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
		if (childProcess.exitCode === null) {
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
