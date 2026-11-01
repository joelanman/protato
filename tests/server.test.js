import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const __dirname = import.meta.dirname
const cliFilePath = path.resolve(__dirname, '../bin/cli.js')
const starterDir = path.join(__dirname, '../starter')
const starterNodeModulesDir = path.join(starterDir, 'node_modules')

// Copy the starter project without node_modules, then point node_modules at the
// installed copy. Copying node_modules is unreliable on Windows because it
// contains symlinks and junctions.
const copyStarter = (destinationDir) => {
	fs.cpSync(starterDir, destinationDir, {
		recursive: true,
		filter: (source) => source !== starterNodeModulesDir
	})
	fs.symlinkSync(starterNodeModulesDir, path.join(destinationDir, 'node_modules'), 'junction')
}

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

// Reads the CSRF token and cookie from a rendered form, the way a browser would
const getCsrf = async (url) => {
	const response = await fetch(url)
	const html = await response.text()
	const token = /name="_csrf" value="([^"]+)"/.exec(html)?.[1]
	const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0]

	return { token, cookie }
}

// Signs in to a production prototype and returns the cookies for later requests.
const logIn = async (root, password) => {
	const { token, cookie } = await getCsrf(root + '/manage-prototype/password')

	const response = await fetch(root + '/manage-prototype/password', {
		method: 'POST',
		redirect: 'manual',
		headers: {
			cookie,
			'content-type': 'application/x-www-form-urlencoded',
			// production sets a secure session cookie; this test runs over HTTP
			'x-forwarded-proto': 'https'
		},
		body: new URLSearchParams({ _csrf: token, password, returnURL: '/' })
	})

	const cookies = response.headers.getSetCookie().map((setCookie) => setCookie.split(';')[0])
	return cookies.join('; ')
}

describe('Server', () => {
	let serverProcess = null
	let testDir = null
	const port = 3030
	const root = 'http://localhost:' + port

	beforeAll(async () => {
		// create test directory
		testDir = path.join(__dirname, '../tmp/test')

		fs.rmSync(testDir, { recursive: true, force: true })
		copyStarter(testDir)
	})

	afterAll(() => {
		fs.rmSync(testDir, { recursive: true, force: true })
	})

	// helper function to start server with given npm script
	const startServer = async (options = {}) => {
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
		afterEach(async () => {
			if (serverProcess) {
				await stopProcess(serverProcess)
			}
		})

		it('errors if no passwords set', async () => {
			console.log('prod test')
			await startServer({ args: ['start'] })

			const response = await fetch(root)
			expect(response.status).toBe(500)
		})

		it('redirects to password page without dead management links', async () => {
			console.log('prod test')
			await startServer({ args: ['start'], env: { PASSWORD: 'test' } })

			const response = await fetch(root)
			expect(response.redirected).toBe(true)
			expect(response.url).toBe(root + '/manage-prototype/password?returnURL=%2F')

			const html = await response.text()
			expect(html).not.toContain('/manage-prototype/templates')
			expect(html).not.toContain('/manage-prototype/plugins')

			// the password page's assets must load without a password too. No redirects:
			// following one would turn the auth redirect into a 200 password page.
			const stylesheet = await fetch(root + '/manage-prototype/public/stylesheets/manage-prototype.css', {
				redirect: 'manual'
			})
			expect(stylesheet.status).toBe(200)

			const script = await fetch(root + '/manage-prototype/govuk-frontend/dist/govuk/govuk-frontend.min.js', {
				redirect: 'manual'
			})
			expect(script.status).toBe(200)
		})
	})

	describe('development', () => {
		beforeAll(async () => {
			fs.writeFileSync(
				path.join(testDir, 'app/assets/sass/custom-pkg.scss'),
				`@use "pkg:govuk-frontend/dist/govuk/base" as *;
				.custom-pkg {
					color: govuk-colour("green");
				}`
			)

			await startServer({ args: ['dev'] })
		})

		afterAll(async () => {
			if (serverProcess) {
				await stopProcess(serverProcess)
			}
			fs.rmSync(path.join(testDir, 'app/assets/sass/custom-pkg.scss'), { force: true })
		})

		it('responds to requests', async () => {
			const response = await fetch(root)
			expect(response.status).toBe(200)

			const response2 = await fetch(root + '/manage-prototype/password')
			expect(response2.status).toBe(200)

			const response3 = await fetch(root + '/manage-prototype/clear-data')
			expect(response3.status).toBe(200)

			const clearDataPage = await getCsrf(root + '/manage-prototype/clear-data')
			const response4 = await fetch(root + '/manage-prototype/clear-data', {
				method: 'POST',
				headers: { cookie: clearDataPage.cookie, 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ _csrf: clearDataPage.token })
			})
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
		})

		it('serves templates, previews them and creates pages from them', async () => {
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

			// a POST under /manage-prototype needs a form token, even for a path
			// that is not one of the manage pages
			const previewPostResponse = await fetch(manageUrl('view'), {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ example: 'value' }),
				redirect: 'manual'
			})
			expect(previewPostResponse.status).toBe(403)
			expect(await previewPostResponse.text()).toContain('Your form has expired')

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
			const createPage = await getCsrf(manageUrl('create'))
			const createResponse = await fetch(manageUrl('create'), {
				method: 'POST',
				headers: { cookie: createPage.cookie, 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ newPagePath, _csrf: createPage.token }),
				redirect: 'manual'
			})
			expect(createResponse.status).toBe(302)
			expect(createResponse.headers.get('location')).toBe(
				`/manage-prototype/templates/created?newPagePath=${encodeURIComponent(newPagePath)}`
			)

			const rejectedResponse = await fetch(manageUrl('create'), {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ newPagePath: '/no-token' }),
				redirect: 'manual'
			})
			expect(rejectedResponse.status).toBe(403)
			expect(await rejectedResponse.text()).toContain('Your form has expired')

			const createdResponse = await fetch(root + newPagePath)
			expect(createdResponse.status).toBe(200)
			const createdHtml = await createdResponse.text()
			expect(createdHtml).toContain('Use this service to:')
			expect(createdHtml).toContain('Service name goes here')
		})

		it('shows the not found page for a missing template preview', async () => {
			const query = new URLSearchParams({
				packageName: '@govuk-prototype-kit/common-templates',
				templatePath: '/templates/does-not-exist.html'
			})
			const response = await fetch(root + `/manage-prototype/templates/view?${query}`)

			expect(response.status).toBe(404)
			const html = await response.text()
			expect(html).toContain('Page not found')
			expect(html).toContain('There is no page at')
		})

		it('compiles custom sass using pkg: URLs into its own CSS file', async () => {
			const response = await fetch(root + '/public/stylesheets/custom-pkg.css')
			expect(response.status).toBe(200)

			const css = await response.text()
			expect(css).toContain('.custom-pkg')
			expect(css).toContain('#0f7a52') // govuk-colour("green")
		})
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
		copyStarter(testDir)
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
		// read with require('govuk-prototype-kit/lib/config') in app/filters.js
		expect(view).toContain('Service name goes here')

		const route = await (await fetch(root + '/hello-route')).text()
		expect(route).toBe('hello from user route')
	})
})

describe('Server (error in user routes)', () => {
	let serverProcess = null
	let testDir = null
	const port = 3032
	const root = 'http://localhost:' + port

	beforeAll(() => {
		testDir = path.join(__dirname, '../tmp/test-routes-error')

		fs.rmSync(testDir, { recursive: true, force: true })
		copyStarter(testDir)
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
	})
})

describe('Server (error in Sass)', () => {
	let serverProcess = null
	let testDir = null
	const port = 3033
	const root = 'http://localhost:' + port

	beforeAll(() => {
		testDir = path.join(__dirname, '../tmp/test-sass-error')

		fs.rmSync(testDir, { recursive: true, force: true })
		copyStarter(testDir)
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

	it.each(['dev', 'start'])('shows the error page for Sass build errors in %s mode', async (command) => {
		serverProcess = spawn('node', [cliFilePath, command], {
			cwd: testDir,
			stdio: 'pipe',
			env: { ...process.env, PORT: port, PASSWORD: 'test' }
		})

		serverProcess.stdout.pipe(process.stdout)
		serverProcess.stderr.pipe(process.stderr)

		let cookie

		if (command === 'start') {
			// the error app must still be behind the password in production
			const unauthenticated = await waitForResponse(root, { redirect: 'manual' })
			expect(unauthenticated.status).toBe(302)
			expect(unauthenticated.headers.get('location')).toContain('/manage-prototype/password')

			cookie = await logIn(root, 'test')
		}

		const body = await waitForErrorPage(root, { cookie })

		expect(body).toContain('There is an error')
		expect(body).toContain('application.scss')
	})
})

// helper function to wait for server ready message in stdout
async function waitForServerReady(process, readyMessage) {
	return new Promise((resolve, reject) => {
		const onData = (data) => {
			const output = data.toString()
			if (output.includes(readyMessage)) {
				process.stdout.off('data', onData)
				process.stderr.off('data', onError)
				resolve()
			}
		}

		const onError = (data) => {
			const error = data.toString()
			// Sass deprecation warnings are not startup failures
			if (!error.includes('connect.session() MemoryStore') && !error.includes('WARNING:')) {
				reject(new Error(`Server startup failed: ${error}`))
				process.stdout.off('data', onData)
				process.stderr.off('data', onError)
			} else {
				console.log('ignoring startup warning')
			}
		}

		process.stdout.on('data', onData)
		process.stderr.on('data', onError)

		// handle process exit
		process.on('exit', (code) => {
			if (code !== 0) {
				reject(new Error(`Server process exited with code ${code}`))
			}
		})
	})
}

// wait for the server to accept requests without following redirects
async function waitForResponse(url, options = {}, timeout = 4000) {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		try {
			return await fetch(url, options)
		} catch {
			// server not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	throw new Error(`No response from ${url} within ${timeout}ms`)
}

// wait for the error page to be served, ignoring any early proxy errors
async function waitForErrorPage(url, { cookie, timeout = 4000 } = {}) {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		try {
			const response = await fetch(url, { headers: { 'x-forwarded-proto': 'https', ...(cookie ? { cookie } : {}) } })
			const body = await response.text()
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
