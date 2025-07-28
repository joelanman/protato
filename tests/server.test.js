import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const __dirname = import.meta.dirname

describe('Server', () => {
	let serverProcess = null
	let testDir = null

	beforeEach(async () => {
		// create a unique test directory

		testDir = path.join(__dirname, '../tmp/test')

		if (!fs.existsSync(testDir)) {
			// copy starter directory to test directory

			const starterDir = path.join(__dirname, '../starter')
			fs.cpSync(starterDir, testDir, { recursive: true })
		}
	})

	afterEach(async () => {
		// kill server process if it's running

		if (serverProcess) {
			serverProcess.kill('SIGTERM')
			serverProcess = null
		}

		// clean up test directory

		if (testDir) {
			fs.rmSync(testDir, { recursive: true, force: true })
			testDir = null
		}
	})

	it('should start server and respond to requests', async () => {
		// start the server

		const port = '3030'
		const env = {
			...process.env, // Preserve existing environment variables
			PORT: port // Set the PORT variable to 3030
		}
		serverProcess = spawn('npm', ['run', 'dev'], {
			cwd: testDir,
			stdio: 'pipe',
			env
		})

		// wait for server to be ready by reading stdout

		await waitForServerReady(serverProcess, 'Running at http://localhost:' + port)

		// make requests to server

		const response = await fetch('http://localhost:' + port)

		expect(response.status).toBe(200)

		const response2 = await fetch('http://localhost:' + port + '/manage-prototype/password')

		expect(response2.status).toBe(200)
	}, 15000) // 15 second timeout for the entire test
})

// helper function to wait for server ready message in stdout

async function waitForServerReady(process, readyMessage, timeout = 10000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Server did not start within ${timeout}ms`))
		}, timeout)

		const onData = (data) => {
			const output = data.toString()
			if (output.includes(readyMessage)) {
				clearTimeout(timer)
				process.stdout.off('data', onData)
				process.stderr.off('data', onError)
				resolve()
			}
		}

		const onError = (data) => {
			const error = data.toString()
			clearTimeout(timer)
			process.stdout.off('data', onData)
			process.stderr.off('data', onError)
			reject(new Error(`Server startup failed: ${error}`))
		}

		process.stdout.on('data', onData)
		process.stderr.on('data', onError)

		// handle process exit

		process.on('exit', (code) => {
			if (code !== 0) {
				clearTimeout(timer)
				reject(new Error(`Server process exited with code ${code}`))
			}
		})
	})
}
