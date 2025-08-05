import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { stopProcess } from '../lib/utils/stop-process.js'

const __dirname = import.meta.dirname
const cliFilePath = path.resolve(__dirname, '../bin/cli.js')

describe.sequential('Server', () => {
	let serverProcess = null
	let testDir = null
	const port = 3030
	const root = 'http://localhost:' + port

	beforeAll(async () => {
		// create test directory
		testDir = path.join(__dirname, '../tmp/test')
		const starterDir = path.join(__dirname, '../starter')

		fs.rmSync(testDir, { recursive: true, force: true })
		fs.cpSync(starterDir, testDir, { recursive: true })
	})

	afterEach(async () => {
		// kill server process if it's running
		if (serverProcess) {
			await stopProcess(serverProcess)
		}
	})

	afterAll(() => {
		fs.rmSync(testDir, { recursive: true, force: true })
	})

	// helper function to start server with given npm script
	const startServer = async (options) => {
		const env = {
			...process.env,
			...options.env,
			PORT: port
		}

		const commandArgs = [cliFilePath, ...options.args]

		serverProcess = spawn('node', commandArgs, {
			cwd: testDir,
			stdio: 'pipe',
			env
		})

		serverProcess.stdout.pipe(process.stdout)
		serverProcess.stderr.pipe(process.stderr)

		// wait for server to be ready
		await waitForServerReady(serverProcess, 'Running at ' + root)
	}

	describe('production', () => {
		it('errors if no passwords set', async () => {
			console.log('prod test')
			await startServer({ args: ['start'] })

			const response = await fetch(root)
			expect(response.status).toBe(500)
		}, 5000)

		it('redirects to password page', async () => {
			console.log('prod test')
			await startServer({ args: ['start'], env: { PASSWORD: 'test' } })

			const response = await fetch(root)
			expect(response.redirected).toBe(true)
			expect(response.url).toBe(root + '/manage-prototype/password?returnURL=%2F')
		}, 5000)
	})

	describe('development', () => {
		it('responds to requests', async () => {
			console.log('dev test')
			await startServer({ args: ['dev'] })

			const response = await fetch(root)
			expect(response.status).toBe(200)

			const response2 = await fetch(root + '/manage-prototype/password')
			expect(response2.status).toBe(200)

			const response3 = await fetch(root + '/?page=1', { method: 'POST' })
			expect(response3.redirected).toBe(true)
			expect(response3.url).toBe(root + '/?page=1')
		}, 5000)
	})
})

// helper function to wait for server ready message in stdout
async function waitForServerReady(process, readyMessage, timeout = 3000) {
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
			if (!error.includes('connect.session() MemoryStore')) {
				reject(new Error(`Server startup failed: ${error}`))
				process.stdout.off('data', onData)
				process.stderr.off('data', onError)
			} else {
				console.log('ignoring session warning')
			}
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
