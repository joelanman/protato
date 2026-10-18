import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const __dirname = import.meta.dirname
const cliFilePath = path.resolve(__dirname, '../bin/cli.js')

const stopProcess = async (proc) => {
	if (proc?.exitCode === null && proc?.signalCode === null) {
		proc.kill('SIGTERM')
		const forceKillTimeout = setTimeout(() => proc.kill('SIGKILL'), 2000)
		try {
			await once(proc, 'exit')
		} finally {
			clearTimeout(forceKillTimeout)
		}
	}
}

describe('Server', () => {
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
	const startServer = async (options = {}) => {
		const env = {
			...process.env,
			...options.env
		}

		// default to forcing PORT from the test; portFromEnvFile leaves it
		// unset so the .env file can supply it (shell vars still win otherwise)
		if (options.portFromEnvFile) {
			delete env.PORT
		} else {
			env.PORT = port
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

		it('redirects to password page without dead management links', async () => {
			console.log('prod test')
			await startServer({ args: ['start'], env: { PASSWORD: 'test' } })

			const response = await fetch(root)
			expect(response.redirected).toBe(true)
			expect(response.url).toBe(root + '/manage-prototype/password?returnURL=%2F')

			const html = await response.text()
			expect(html).not.toContain('/manage-prototype/templates')
			expect(html).not.toContain('/manage-prototype/plugins')
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

			const response3 = await fetch(root + '/manage-prototype/clear-data')
			expect(response3.status).toBe(200)

			const response4 = await fetch(root + '/manage-prototype/clear-data', { method: 'POST' })
			expect(response4.status).toBe(200)

			const response5 = await fetch(root + '/?page=1', { method: 'POST' })
			expect(response5.redirected).toBe(true)
			expect(response5.url).toBe(root + '/?page=1')

			const unbrandedIconResponse = await fetch(
				root + '/plugin-assets/govuk-prototype-kit/plugin/assets/images/unbranded.ico'
			)
			expect(unbrandedIconResponse.status).toBe(200)

			const kitScriptResponse = await fetch(
				root + '/plugin-assets/govuk-prototype-kit/plugin/assets/javascripts/kit.js'
			)
			expect(kitScriptResponse.status).toBe(200)

			const homeResponse = await fetch(root + '/')
			expect(homeResponse.status).toBe(200)

			fs.writeFileSync(path.join(testDir, 'app/views/auto-render-test.html'), 'auto rendered page')
			const autoRenderResponse = await fetch(root + '/auto-render-test')
			expect(autoRenderResponse.status).toBe(200)
			expect(await autoRenderResponse.text()).toBe('auto rendered page')

			const nodeModulesResponse = await fetch(root + '/@govuk-prototype-kit/common-templates/templates/start')
			expect(nodeModulesResponse.status).toBe(404)

			const notFoundResponse = await fetch(root + '/does-not-exist')
			expect(notFoundResponse.status).toBe(404)
			const notFoundHtml = await notFoundResponse.text()
			expect(notFoundHtml).toContain('Page not found')
			expect(notFoundHtml).not.toContain('Template render error')
		}, 5000)

		it('serves templates, previews them and creates pages from them', async () => {
			await startServer({ args: ['dev'] })

			const packageName = '@govuk-prototype-kit/common-templates'
			const templateQuery = new URLSearchParams({
				packageName,
				templatePath: '/templates/start.html'
			}).toString()
			const managePath = (action) => `/manage-prototype/templates/${action}?${templateQuery}`
			const manageUrl = (action) => root + managePath(action)
			const htmlHref = (path) => `href="${path.replaceAll('&', '&amp;')}"`

			const listResponse = await fetch(root + '/manage-prototype/templates')
			expect(listResponse.status).toBe(200)
			const listHtml = await listResponse.text()
			expect(listHtml).toContain('Templates - Manage your prototype')
			expect(listHtml).toContain('Start page')
			expect(listHtml).toContain('Common Templates')
			expect(listHtml).toContain('From GOV.UK Prototype Kit')
			expect(listHtml).toContain(htmlHref(managePath('view')))
			expect(listHtml).toContain(htmlHref(managePath('create')))

			const previewResponse = await fetch(manageUrl('view'))
			expect(previewResponse.status).toBe(200)
			const previewHtml = await previewResponse.text()
			expect(previewHtml).toContain('Service name goes here')
			expect(previewHtml).toContain('href="/manage-prototype"')

			const unbrandedQuery = new URLSearchParams({
				packageName,
				templatePath: '/templates/blank-unbranded.html'
			})
			const unbrandedResponse = await fetch(root + `/manage-prototype/templates/view?${unbrandedQuery}`)
			expect(unbrandedResponse.status).toBe(200)
			const unbrandedHtml = await unbrandedResponse.text()
			expect(unbrandedHtml).toContain('/public/stylesheets/unbranded.css')
			expect(unbrandedHtml).toContain('Unbranded page template')
			expect(unbrandedHtml).toContain('/plugin-assets/govuk-prototype-kit/plugin/assets/images/unbranded.ico')
			expect(unbrandedHtml).not.toContain('govuk-header__')

			const newPagePath = '/created-from-template'
			const createResponse = await fetch(manageUrl('create'), {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ newPagePath }),
				redirect: 'manual'
			})
			expect(createResponse.status).toBe(302)
			expect(createResponse.headers.get('location')).toBe(
				`/manage-prototype/templates/created?newPagePath=${encodeURIComponent(newPagePath)}`
			)

			const createdResponse = await fetch(root + newPagePath)
			expect(createdResponse.status).toBe(200)
			const createdHtml = await createdResponse.text()
			expect(createdHtml).toContain('Use this service to:')
			expect(createdHtml).toContain('Service name goes here')
		}, 5000)

		it('shows the not found page for a missing template preview', async () => {
			await startServer({ args: ['dev'] })

			const query = new URLSearchParams({
				packageName: '@govuk-prototype-kit/common-templates',
				templatePath: '/templates/does-not-exist.html'
			})
			const response = await fetch(root + `/manage-prototype/templates/view?${query}`)

			expect(response.status).toBe(404)
			const html = await response.text()
			expect(html).toContain('Page not found')
			expect(html).toContain('There is no template at /templates/does-not-exist.html.')
		}, 5000)

		it('compiles custom sass using pkg: URLs into its own CSS file', async () => {
			fs.writeFileSync(
				path.join(testDir, 'app/assets/sass/custom-pkg.scss'),
				`@use "pkg:govuk-frontend/dist/govuk/base" as *;
                .custom-pkg {
                  color: govuk-colour("green");
                }`
			)

			await startServer({ args: ['dev'] })

			const response = await fetch(root + '/public/stylesheets/custom-pkg.css')
			expect(response.status).toBe(200)

			const css = await response.text()
			expect(css).toContain('.custom-pkg')
			expect(css).toContain('#00703c') // govuk-colour("green")
		}, 5000)
	})

	describe('environment variables', () => {
		afterEach(() => {
			fs.rmSync(path.join(testDir, '.env'), { force: true })
		})

		it('loads values from .env', async () => {
			fs.writeFileSync(path.join(testDir, '.env'), 'PORT=' + port)

			await startServer({ args: ['dev'], portFromEnvFile: true })

			const response = await fetch(root)
			expect(response.status).toBe(200)
		}, 5000)

		it('lets shell environment variables take precedence over .env', async () => {
			fs.writeFileSync(path.join(testDir, '.env'), 'PORT=3999')

			await startServer({ args: ['dev'] })

			const response = await fetch(root)
			expect(response.status).toBe(200)
		}, 5000)
	})
})

describe('Server (commonjs prototype)', () => {
	let serverProcess = null
	let testDir = null
	const port = 3031
	const root = 'http://localhost:' + port

	beforeAll(() => {
		testDir = path.join(__dirname, '../tmp/test-cjs')

		fs.rmSync(testDir, { recursive: true, force: true })
		fs.cpSync(path.join(__dirname, '../starter'), testDir, { recursive: true })
		fs.cpSync(path.join(__dirname, 'fixtures/commonjs-prototype'), testDir, { recursive: true })

		// make it a classic commonjs prototype, like those made by kit v13
		const packagePath = path.join(testDir, 'package.json')
		const pkg = JSON.parse(fs.readFileSync(packagePath))
		delete pkg.type
		fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2))
	})

	afterEach(async () => {
		if (serverProcess) {
			await stopProcess(serverProcess)
		}
	})

	afterAll(() => {
		fs.rmSync(testDir, { recursive: true, force: true })
	})

	it('loads user filters, functions, session data and routes', async () => {
		serverProcess = spawn('node', [cliFilePath, 'dev'], {
			cwd: testDir,
			stdio: 'pipe',
			env: { ...process.env, PORT: port }
		})

		serverProcess.stdout.pipe(process.stdout)
		serverProcess.stderr.pipe(process.stderr)

		await waitForServerReady(serverProcess, 'Running at ' + root)

		const view = await (await fetch(root + '/register-test')).text()
		expect(view).toContain('HI 42 Alice')

		const route = await (await fetch(root + '/hello-route')).text()
		expect(route).toBe('hello from user route')
	}, 5000)
})

describe('Server (error in user routes)', () => {
	let serverProcess = null
	let testDir = null
	const port = 3032
	const root = 'http://localhost:' + port

	beforeAll(() => {
		testDir = path.join(__dirname, '../tmp/test-routes-error')

		fs.rmSync(testDir, { recursive: true, force: true })
		fs.cpSync(path.join(__dirname, '../starter'), testDir, { recursive: true })
		fs.copyFileSync(path.join(__dirname, 'fixtures/routes-error.js'), path.join(testDir, 'app/routes.js'))
	})

	afterEach(async () => {
		if (serverProcess) {
			await stopProcess(serverProcess)
		}
	})

	afterAll(() => {
		fs.rmSync(testDir, { recursive: true, force: true })
	})

	it('shows the error page instead of swallowing the error', async () => {
		serverProcess = spawn('node', [cliFilePath, 'dev'], {
			cwd: testDir,
			stdio: 'pipe',
			env: { ...process.env, PORT: port }
		})

		serverProcess.stdout.pipe(process.stdout)
		serverProcess.stderr.pipe(process.stderr)

		const body = await waitForErrorPage(root)

		expect(body).toContain('There is an error')
		expect(body).toContain('app/routes.js (line 4)')
		expect(body).toContain('boom in user routes')
	}, 5000)
})

describe('Server (error in Sass)', () => {
	let serverProcess = null
	let testDir = null
	const port = 3033
	const root = 'http://localhost:' + port

	beforeAll(() => {
		testDir = path.join(__dirname, '../tmp/test-sass-error')

		fs.rmSync(testDir, { recursive: true, force: true })
		fs.cpSync(path.join(__dirname, '../starter'), testDir, { recursive: true })
		fs.writeFileSync(path.join(testDir, 'app/assets/sass/application.scss'), 'broken { sass')
	})

	afterEach(async () => {
		if (serverProcess) {
			await stopProcess(serverProcess)
		}
	})

	afterAll(() => {
		fs.rmSync(testDir, { recursive: true, force: true })
	})

	it.each(['dev', 'start'])(
		'shows the error page for Sass build errors in %s mode',
		async (command) => {
			serverProcess = spawn('node', [cliFilePath, command], {
				cwd: testDir,
				stdio: 'pipe',
				env: { ...process.env, PORT: port, PASSWORD: 'test' }
			})

			serverProcess.stdout.pipe(process.stdout)
			serverProcess.stderr.pipe(process.stderr)

			const body = await waitForErrorPage(root)

			expect(body).toContain('There is an error')
			expect(body).toContain('application.scss')
		},
		5000
	)
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

// wait for the error page to be served, ignoring any early proxy errors
async function waitForErrorPage(url, timeout = 4000) {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		try {
			const body = await (await fetch(url)).text()
			if (body.includes('There is an error')) {
				return body
			}
		} catch {
			// server not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	throw new Error(`Error page did not appear within ${timeout}ms`)
}
