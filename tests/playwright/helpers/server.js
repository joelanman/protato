import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'

import { stopProcess } from '../../helpers/process.js'

const cliFilePath = path.resolve(import.meta.dirname, '../../../bin/cli.js')
const outputLimit = 20_000
const startupTimeout = 30_000

// Finds an unused port. The temporary server is closed before Protato starts.
function findFreePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer()

		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address()
			server.close(() => resolve(port))
		})
	})
}

// Starts the development server in a project directory. The returned output
// function gives the last part of stdout and stderr, so a failing test can
// attach it to the report.
async function startServer({ cwd, port }) {
	const serverProcess = spawn(process.execPath, [cliFilePath, 'dev'], {
		cwd,
		stdio: 'pipe',
		env: { ...process.env, PORT: String(port) }
	})

	let output = ''

	const rememberOutput = (chunk) => {
		output += chunk.toString()

		if (output.length > outputLimit) {
			output = output.slice(-outputLimit)
		}
	}

	serverProcess.stdout.on('data', rememberOutput)
	serverProcess.stderr.on('data', rememberOutput)

	const url = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			serverProcess.kill('SIGTERM')
			reject(new Error(`Protato did not start within ${startupTimeout}ms.\n\n${output}`))
		}, startupTimeout)

		const checkOutput = () => {
			const readyMatch = /Running at (http:\/\/localhost:\d+)/.exec(output)

			if (readyMatch) {
				clearTimeout(timeout)
				resolve(readyMatch[1])
			}
		}

		serverProcess.stdout.on('data', checkOutput)
		serverProcess.stderr.on('data', checkOutput)
		serverProcess.once('error', (error) => {
			clearTimeout(timeout)
			reject(error)
		})
		serverProcess.once('exit', (code) => {
			clearTimeout(timeout)
			reject(new Error(`Protato exited with code ${code}.\n\n${output}`))
		})

		checkOutput()
	})

	return {
		url,
		getOutput: () => output,
		stop: () => stopProcess(serverProcess)
	}
}

export { findFreePort, startServer }
