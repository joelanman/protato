import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createLocalRegistry, createPluginTarball } from './helpers/local-registry.js'
import { runNpm } from './helpers/npm.js'
import { createPluginProject } from './helpers/plugin-project.js'

// Installs, updates and uninstalls a plugin through the manage UI, with real
// npm, a real rebuild and a real restart. The plugin comes from a local
// registry, so the test does not use the network.

// Every wait here is 30 times what the machine needs, so a slow npm or sass run
// still passes while a hung server fails in reasonable time.
const TIMEOUT_MS = 30_000

const repoRoot = path.resolve(import.meta.dirname, '..')
const cliFilePath = path.join(repoRoot, 'bin/cli.js')
const port = 3131
const root = 'http://localhost:' + port
// lib/start.js starts the prototype server ten ports above the dev server
const prototypeRoot = 'http://localhost:' + (port + 10)

// installed from the plugins page, and updated by it
const installPackageName = 'e2e-plugin-install'
const installPackageHomepage = 'https://example.com/e2e-plugin-install'
// installed with npm before the server starts, so the page can offer an update
const updatePackageName = 'e2e-plugin-update'

const stylesheetUrl = (packageName) => `/plugin-assets/${packageName}/css/plugin.css`

const colour = (version) => `.e2e-plugin { color: rgb(0, 0, ${version}); }`

let project
let registry
let serverProcess
let tarballs = []

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

const get = (url, options = {}) => fetch(root + url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...options })

// The dev server and the prototype server log to here, so a failure that only
// happens on CI can be diagnosed from the log it prints.
const SERVER_OUTPUT_LIMIT = 200
const serverOutput = []

function recordServerOutput(data) {
	for (const line of String(data).split('\n')) {
		if (line.trim()) {
			serverOutput.push(line)
		}
	}

	while (serverOutput.length > SERVER_OUTPUT_LIMIT) {
		serverOutput.shift()
	}
}

// A dev server 500 is either the prototype's own error page (which names what
// broke) or a proxy failure because the prototype is not listening. Ask the
// prototype directly to tell the two apart.
async function describePrototype() {
	const requestPath = '/'

	try {
		const response = await fetch(prototypeRoot + requestPath, { signal: AbortSignal.timeout(5000) })
		return `prototype server answered ${response.status} for ${requestPath}`
	} catch (error) {
		return `prototype server did not answer for ${requestPath}: ${error.message}`
	}
}

const readPage = async (response) => {
	const body = await response.text()

	if (response.status !== 200) {
		throw new Error(
			[
				`Expected 200 from ${response.url}, got ${response.status}`,
				body,
				'',
				await describePrototype(),
				'',
				'Last server output:',
				serverOutput.slice(-40).join('\n')
			].join('\n')
		)
	}

	return body
}

// Reads the CSRF token and cookie from a rendered form, the way a browser would
const readForm = async (formPath) => {
	const response = await get(formPath)
	const html = await response.text()
	const token = /name="_csrf" value="([^"]+)"/.exec(html)?.[1]
	const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0]

	return { html, token, cookie }
}

// Registry versions are fetched in the background by the prototype process, so
// a page loaded just after a restart may not have them yet.
async function waitForPluginsPageText(text) {
	const timeout = Date.now() + TIMEOUT_MS / 3

	while (Date.now() < timeout) {
		const page = await readForm('/manage-prototype/plugins')

		if (page.html.includes(text)) {
			return page
		}

		await new Promise((resolve) => setTimeout(resolve, 250))
	}

	throw new Error(`The plugins page never showed: ${text}`)
}

// Posts the change, then follows the redirect the way a browser would. The
// result goes in a session the POST creates, so the cookie it sets has to be
// sent with the request that follows.
const postChange = async (action, pluginPackageName) => {
	const form = await readForm('/manage-prototype/plugins')

	const response = await fetch(`${root}/manage-prototype/plugins${action}`, {
		method: 'POST',
		redirect: 'manual',
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			cookie: form.cookie
		},
		body: new URLSearchParams({ _csrf: form.token, packageName: pluginPackageName })
	})

	const location = response.headers.get('location')

	if (response.status !== 303 || location !== '/manage-prototype/plugins/result') {
		throw new Error(`Expected a 303 to the result page, got ${response.status} ${location}: ${await response.text()}`)
	}

	const sessionCookie = response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('connect.sid='))
		.split(';')[0]

	return readPage(await get(location, { headers: { cookie: sessionCookie } }))
}

const readProjectPackage = () => JSON.parse(fs.readFileSync(path.join(project.dir, 'package.json'), 'utf8'))

const isInstalled = (packageName, version) => {
	return readProjectPackage().dependencies[packageName] === version
}

describe('plugin management end to end', () => {
	beforeAll(async () => {
		const installable = createPluginTarball({
			packageName: installPackageName,
			version: '1.0.0',
			description: 'Test plugin to install',
			homepage: installPackageHomepage,
			stylesheet: colour(1)
		})

		const first = createPluginTarball({
			packageName: updatePackageName,
			version: '1.0.0',
			description: 'Test plugin, first version',
			stylesheet: colour(2)
		})

		const second = createPluginTarball({
			packageName: updatePackageName,
			version: '1.0.1',
			description: 'Test plugin, second version',
			stylesheet: colour(3)
		})

		tarballs = [installable, first, second]

		registry = await createLocalRegistry({
			packages: [
				{ packageName: installPackageName, tarballs: [installable] },
				{ packageName: updatePackageName, tarballs: [first, second] }
			]
		})

		project = createPluginProject({
			// local paths, so installing the test plugin does not also pull these
			// from the registry
			dependencies: {
				protato: `file:${repoRoot}`,
				'govuk-frontend': `file:${path.join(repoRoot, 'node_modules', 'govuk-frontend')}`
			},
			plugins: [
				{ packageName: 'protato', linkFrom: repoRoot },
				{ packageName: 'govuk-frontend', linkFrom: path.join(repoRoot, 'node_modules', 'govuk-frontend') }
			],
			files: {
				'app/config.json': {},
				'app/views/index.html': '{% extends "layouts/main.html" %}{% block content %}e2e index{% endblock %}',
				'app/views/layouts/main.html': '{% extends "govuk-prototype-kit/layouts/govuk-branded.njk" %}',
				'app/assets/sass/application.scss': '// e2e\n',
				'app/assets/sass/settings.scss': '// e2e\n'
			}
		})

		// a real npm install of the plugin that the update test acts on, pinned to
		// the older version so there is genuinely something to update
		// async on purpose: the registry runs in this process, so a synchronous
		// child process would deadlock waiting for its own packument
		await runNpm(['install', `${updatePackageName}@1.0.0`, '--save-exact', '--no-audit', '--no-fund'], {
			cwd: project.dir,
			env: { ...process.env, npm_config_registry: registry.url }
		})

		serverProcess = spawn('node', [cliFilePath, 'dev'], {
			cwd: project.dir,
			stdio: 'pipe',
			env: {
				...process.env,
				PORT: String(port),
				npm_config_registry: registry.url,
				npm_config_audit: 'false',
				npm_config_fund: 'false'
			}
		})

		serverProcess.stdout.on('data', (data) => {
			recordServerOutput(data)
			process.stdout.write(data)
		})

		serverProcess.stderr.on('data', (data) => {
			recordServerOutput(data)
			process.stderr.write(data)
		})

		console.log(
			`e2e project ${project.dir} on ${process.platform}, node ${process.version}, npm ${await readNpmVersion()}`
		)

		await waitForServerReady(serverProcess, 'Running at ' + root)
	}, TIMEOUT_MS * 2)

	afterAll(async () => {
		await stopProcess(serverProcess)
		await registry?.close()
		project?.cleanup()

		for (const tarball of tarballs) {
			tarball.cleanup()
		}
	})

	it(
		'installs a plugin, then rebuilds and restarts with it',
		async () => {
			const result = await postChange('/install', installPackageName)

			expect(result).toContain('Plugin installed')
			expect(isInstalled(installPackageName, '1.0.0')).toBe(true)

			// the stylesheet is served and linked from the prototype's own pages, so
			// the rebuild and restart picked the plugin up
			const url = stylesheetUrl(installPackageName)
			expect(await readPage(await get(url))).toContain(colour(1))

			expect(await readPage(await get('/'))).toContain(url)

			// the link comes from the installed package.json
			const pluginsPage = await readForm('/manage-prototype/plugins')
			expect(pluginsPage.html).toContain(`href="${installPackageHomepage}"`)
		},
		TIMEOUT_MS
	)

	it(
		'reports why npm could not install a plugin',
		async () => {
			const result = await postChange('/install', 'e2e-plugin-missing')

			expect(result).toContain('The plugin could not be installed.')
			expect(result).toContain('npm output')
			expect(result).toContain('e2e-plugin-missing')
		},
		TIMEOUT_MS
	)

	it(
		'offers the newer version and updates the plugin',
		async () => {
			const pluginsPage = await waitForPluginsPageText('update available')
			expect(pluginsPage.html).toContain('(version 1.0.1 available)')

			const result = await postChange('/update', updatePackageName)

			expect(result).toContain('Plugin updated')
			expect(isInstalled(updatePackageName, '1.0.1')).toBe(true)

			const url = stylesheetUrl(updatePackageName)
			expect(await readPage(await get(url))).toContain(colour(3))
		},
		TIMEOUT_MS
	)

	it(
		'uninstalls the plugin and restarts without it',
		async () => {
			const result = await postChange('/uninstall', updatePackageName)

			expect(result).toContain('Plugins uninstalled')
			expect(readProjectPackage().dependencies[updatePackageName]).toBeUndefined()

			expect(await readPage(await get('/'))).not.toContain(stylesheetUrl(updatePackageName))
		},
		TIMEOUT_MS
	)
})

async function readNpmVersion() {
	const { stdout } = await runNpm(['--version'])
	return stdout.trim()
}

async function waitForServerReady(proc, readyMessage) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('Timed out waiting for: ' + readyMessage)), TIMEOUT_MS)

		const onData = (data) => {
			if (data.toString().includes(readyMessage)) {
				clearTimeout(timeout)
				proc.stdout.off('data', onData)
				proc.stderr.off('data', onError)
				resolve()
			}
		}

		const onError = (data) => {
			const error = data.toString()

			// sass deprecation warnings are not startup failures
			if (error.includes('connect.session() MemoryStore') || error.includes('WARNING:')) {
				return
			}

			clearTimeout(timeout)
			reject(new Error(`Server startup failed: ${error}`))
		}

		proc.stdout.on('data', onData)
		proc.stderr.on('data', onError)
	})
}
