import fs from 'node:fs'
import path from 'node:path'

import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRegistry } = vi.hoisted(() => ({
	mockRegistry: {
		latest: {},
		configs: {},
		errors: {},
		getPackageMetadata: vi.fn(),
		getUpdateInfo: vi.fn(),
		getConfig: vi.fn()
	}
}))

vi.mock('../../lib/paths.js', () => ({
	getPaths: vi.fn()
}))

vi.mock('../../lib/config.js', () => ({
	getConfig: vi.fn(() => ({
		env: 'development',
		serviceName: 'Test service'
	}))
}))

vi.mock('../../lib/dev-server.js', () => ({
	default: {
		updatePlugins: vi.fn()
	}
}))

vi.mock('../../lib/plugin-registry.js', async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...actual,
		createPluginRegistry: vi.fn(() => mockRegistry)
	}
})

import devServer from '../../lib/dev-server.js'
import { getPaths } from '../../lib/paths.js'
import { createPluginProject, knownPluginsProject } from '../../tests/helpers/plugin-project.js'
import { resetRegistryMock } from '../../tests/helpers/plugin-registry-mock.js'
import { mockProjectPaths } from '../../tests/helpers/project-paths.js'
import { getManagePrototypeApp } from '../app.js'
import { getManagePrototypeDevApp } from '../dev-app.js'
import pluginRoutes from './plugins.js'

let dir
let projects = []

function configureRegistry(options) {
	resetRegistryMock(mockRegistry, options)
}

function setupProject(options = {}) {
	const project = createPluginProject(options)
	projects.push(project)
	dir = project.dir
	getPaths.mockReturnValue(mockProjectPaths({ projectDir: dir }))
	return project
}

const packagePath = (packageName, ...parts) => path.join(dir, 'node_modules', packageName, ...parts)

function getPlugin(page, packageName) {
	return page.plugins.find((plugin) => plugin.packageName === packageName)
}

function createApp() {
	const app = express()
	const renders = []

	app.use(express.urlencoded({ extended: true }))
	app.use((req, response, next) => {
		response.render = (view, model) => {
			renders.push({ view, model })
			response.send('rendered')
		}
		next()
	})

	app.use('/manage-prototype/plugins', pluginRoutes)

	return { app, renders }
}

function createDevApp() {
	const app = express()
	app.use('/manage-prototype', getManagePrototypeDevApp())
	return app
}

describe('plugins management route', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		configureRegistry()
	})

	afterEach(() => {
		for (const project of projects) {
			project.cleanup()
		}
		projects = []
		dir = undefined
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	describe('page', () => {
		it('renders the plugin list without public network calls', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})
			const fetchSpy = vi.fn()
			vi.stubGlobal('fetch', fetchSpy)

			const { app, renders } = createApp()
			const response = await request(app).get('/manage-prototype/plugins')

			expect(response.status).toBe(200)
			expect(renders).toHaveLength(1)
			expect(renders[0].view).toBe('plugins')
			expect(renders[0].model.pageName).toBe('Plugins')
			expect(getPlugin(renders[0].model, 'hmrc-frontend').installedVersion).toBe('6.0.0')
			expect(fetchSpy).not.toHaveBeenCalled()
		})

		it('renders installed state, protected and read-only explanations and escaped diagnostics', async () => {
			setupProject({
				dependencies: {
					'govuk-frontend': 'file:../govuk-frontend',
					'hmrc-frontend': '^6.0.0',
					'broken-plugin': '1.0.0'
				},
				plugins: [
					{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
					{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} },
					{ packageName: 'broken-plugin', version: '1.0.0', config: '<script>alert(1)</script>' }
				]
			})

			const response = await request(createDevApp()).get('/manage-prototype/plugins')
			const html = response.text

			expect(response.status).toBe(200)
			expect(html).toContain('HMRC Frontend')
			expect(html).toContain('Installed version 6.0.0')
			expect(html).toContain('Not installed')

			// protected and read-only are independent explanations
			expect(html).toContain('This plugin is protected, so it cannot be uninstalled.')
			expect(html).toContain('This plugin was installed from outside the npm registry, so it is read-only.')
			expect(html).toContain("This plugin is not in Protato's known list, so it is read-only.")

			expect(html).toContain('&lt;script&gt;')
			expect(html).not.toContain('<script>alert(1)')
		})
	})

	describe('plugin actions', () => {
		it('renders action buttons and latest versions', async () => {
			setupProject(knownPluginsProject)
			configureRegistry({
				latest: { 'hmrc-frontend': '7.0.0', '@govuk-prototype-kit/step-by-step': '2.0.0' }
			})

			const response = await request(createDevApp()).get('/manage-prototype/plugins')
			const html = response.text

			expect(response.status).toBe(200)
			expect(html).toContain('Latest version 7.0.0')
			expect(html).toContain('data-plugin-action="update"')
			expect(html).toContain('data-plugin-action="install"')
			expect(html).toContain('data-plugin-action="uninstall"')
		})
	})

	describe('plugin confirmation and execution', () => {
		async function getConfirmation({ action, packageName, registry } = {}) {
			if (registry) {
				configureRegistry(registry)
			}
			const { app, renders } = createApp()
			const query = new URLSearchParams({ action, packageName })
			const response = await request(app).get(`/manage-prototype/plugins/confirm?${query}`)
			return { app, renders, response }
		}

		function postConfirm(app, body) {
			return request(app).post('/manage-prototype/plugins/confirm').type('form').send(body)
		}

		it('shows the plan with a confirmation form', async () => {
			setupProject({})

			const { renders, response } = await getConfirmation({
				action: 'install',
				packageName: 'hmrc-frontend',
				registry: { latest: { 'hmrc-frontend': '7.41.0' } }
			})

			expect(response.status).toBe(200)
			const model = renders[0].model
			expect(model.action).toBe('install')
			expect(model.pluginName).toBe('HMRC Frontend')
			expect(model.token).toMatch(/^[a-f0-9]{32}$/)
			expect(model.expectedChanges).toBe('install:hmrc-frontend::7.41.0')
		})

		it('shows an offline message when the registry cannot check an install', async () => {
			setupProject({})

			const { response, renders } = await getConfirmation({
				action: 'install',
				packageName: 'hmrc-frontend',
				registry: { errors: { 'hmrc-frontend': 'registry unavailable' } }
			})

			expect(response.status).toBe(503)
			expect(renders[0].model.error).toContain('registry unavailable')
		})

		it('rejects protected, read-only and invalid targets', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2', 'hmrc-frontend': 'file:../hmrc-frontend' },
				plugins: [
					{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
					{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }
				]
			})

			const protectedResult = await getConfirmation({
				action: 'uninstall',
				packageName: 'govuk-frontend'
			})
			expect(protectedResult.response.status).toBe(400)
			expect(protectedResult.renders[0].model.error).toContain('protected')

			const readOnlyResult = await getConfirmation({
				action: 'update',
				packageName: 'hmrc-frontend'
			})

			expect(readOnlyResult.response.status).toBe(400)
			expect(readOnlyResult.renders[0].model.error).toContain('read-only')

			const invalidAction = await getConfirmation({ action: 'remove', packageName: 'hmrc-frontend' })
			expect(invalidAction.response.status).toBe(400)

			const unknown = await getConfirmation({ action: 'install', packageName: 'unknown-plugin' })
			expect(unknown.response.status).toBe(400)
		})

		it('executes the confirmed plan and redirects to the refreshed list', async () => {
			setupProject({})
			vi.mocked(devServer.updatePlugins).mockResolvedValue({ ok: true, exitCode: 0 })
			configureRegistry({ latest: { 'hmrc-frontend': '7.41.0' } })
			const { app, renders } = createApp()

			const confirmResponse = await request(app).get(
				'/manage-prototype/plugins/confirm?action=install&packageName=hmrc-frontend'
			)
			expect(confirmResponse.status).toBe(200)
			const model = renders[0].model

			const response = await postConfirm(app, {
				token: model.token,
				expectedChanges: model.expectedChanges,
				action: 'install',
				packageName: 'hmrc-frontend'
			})

			expect(response.status).toBe(303)
			expect(response.headers.location).toBe('/manage-prototype/plugins?updated=1')
			expect(devServer.updatePlugins).toHaveBeenCalledWith({
				operation: 'install',
				packages: [{ packageName: 'hmrc-frontend', version: '7.41.0' }]
			})
		})

		it('rejects a plan with blocking problems', async () => {
			setupProject({
				dependencies: {
					'hmrc-frontend': '6.0.0',
					'@govuk-prototype-kit/step-by-step': '2.0.0'
				},
				plugins: [
					{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} },
					{
						packageName: '@govuk-prototype-kit/step-by-step',
						version: '2.0.0',
						config: { pluginDependencies: [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }] }
					}
				]
			})
			configureRegistry({
				latest: { 'hmrc-frontend': '7.0.0', 'govuk-frontend': '5.11.2' },
				configs: { 'hmrc-frontend@7.0.0': [{ packageName: 'govuk-frontend', maxVersion: '5.11.2' }] }
			})
			const { app, renders } = createApp()

			await request(app).get('/manage-prototype/plugins/confirm?action=update&packageName=hmrc-frontend')
			const model = renders[0].model
			expect(model.problems.length).toBeGreaterThan(0)

			const response = await postConfirm(app, {
				token: model.token,
				expectedChanges: model.expectedChanges,
				action: 'update',
				packageName: 'hmrc-frontend'
			})

			expect(response.status).toBe(409)
			expect(renders.at(-1).model.error).toBe('The plan has blocking problems.')
			expect(renders.at(-1).model.problems.length).toBeGreaterThan(0)
			expect(devServer.updatePlugins).not.toHaveBeenCalled()
		})

		it('rejects an old plan after the registry changes', async () => {
			setupProject({})
			configureRegistry({ latest: { 'hmrc-frontend': '7.41.0' } })
			const { app, renders } = createApp()

			await request(app).get('/manage-prototype/plugins/confirm?action=install&packageName=hmrc-frontend')
			const model = renders[0].model
			mockRegistry.latest['hmrc-frontend'] = '7.42.0'

			const response = await postConfirm(app, {
				token: model.token,
				expectedChanges: model.expectedChanges,
				action: 'install',
				packageName: 'hmrc-frontend'
			})

			expect(response.status).toBe(409)
			expect(renders.at(-1).model.error).toContain('Review the latest plugin plan')
			expect(devServer.updatePlugins).not.toHaveBeenCalled()
		})

		it('rejects bad tokens, cross-origin posts and busy updates', async () => {
			setupProject({})
			configureRegistry({ latest: { 'hmrc-frontend': '7.41.0' } })
			const { app, renders } = createApp()

			await request(app).get('/manage-prototype/plugins/confirm?action=install&packageName=hmrc-frontend')
			const model = renders[0].model
			const body = {
				token: model.token,
				expectedChanges: model.expectedChanges,
				action: 'install',
				packageName: 'hmrc-frontend'
			}

			const badToken = await postConfirm(app, { ...body, token: 'wrong' })
			expect(badToken.status).toBe(403)

			const crossOrigin = await postConfirm(app, body).set('origin', 'https://evil.example')
			expect(crossOrigin.status).toBe(403)

			vi.mocked(devServer.updatePlugins).mockRejectedValueOnce(new Error('Another plugin operation is already running'))
			const busy = await postConfirm(app, body)
			expect(busy.status).toBe(409)
			expect(renders.at(-1).model.error).toContain('already running')

			expect(devServer.updatePlugins).toHaveBeenCalledOnce()
		})

		it('escapes npm output when an update fails', async () => {
			setupProject({})
			vi.mocked(devServer.updatePlugins).mockResolvedValue({
				ok: false,
				exitCode: 1,
				stdout: '<script>alert(1)</script>',
				stderr: 'npm failed',
				outputTruncated: false
			})
			configureRegistry({ latest: { 'hmrc-frontend': '7.41.0' } })
			const app = createDevApp()

			const confirmResponse = await request(app).get(
				'/manage-prototype/plugins/confirm?action=install&packageName=hmrc-frontend'
			)
			const html = confirmResponse.text
			const token = html.match(/name="token" value="([^"]+)"/)[1]
			const expectedChanges = html.match(/name="expectedChanges" value="([^"]+)"/)[1]

			const response = await request(app)
				.post('/manage-prototype/plugins/confirm')
				.type('form')
				.send({ token, expectedChanges, action: 'install', packageName: 'hmrc-frontend' })

			expect(response.status).toBe(500)
			expect(response.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
			expect(response.text).not.toContain('<script>alert(1)</script>')
		})

		it('completes the browser flow and shows the resulting installed state', async () => {
			setupProject({})
			vi.mocked(devServer.updatePlugins).mockImplementation(async () => {
				fs.writeFileSync(
					path.join(dir, 'package.json'),
					JSON.stringify({ dependencies: { 'hmrc-frontend': '7.41.0' } })
				)
				const packageDir = packagePath('hmrc-frontend')
				fs.mkdirSync(packageDir, { recursive: true })
				fs.writeFileSync(
					path.join(packageDir, 'package.json'),
					JSON.stringify({ name: 'hmrc-frontend', version: '7.41.0' })
				)
				fs.writeFileSync(path.join(packageDir, 'govuk-prototype-kit.config.json'), '{}')
				return { ok: true, exitCode: 0 }
			})
			configureRegistry({ latest: { 'hmrc-frontend': '7.41.0' } })
			const app = createDevApp()

			const listResponse = await request(app).get('/manage-prototype/plugins')
			expect(listResponse.text).toContain('data-plugin-action="install"')
			expect(listResponse.text).toContain('Latest version 7.41.0')

			const confirmResponse = await request(app).get(
				'/manage-prototype/plugins/confirm?action=install&packageName=hmrc-frontend'
			)
			expect(confirmResponse.status).toBe(200)
			expect(devServer.updatePlugins).not.toHaveBeenCalled()
			const html = confirmResponse.text
			const token = html.match(/name="token" value="([^"]+)"/)[1]
			const expectedChanges = html.match(/name="expectedChanges" value="([^"]+)"/)[1]

			const executeResponse = await request(app)
				.post('/manage-prototype/plugins/confirm')
				.type('form')
				.send({ token, expectedChanges, action: 'install', packageName: 'hmrc-frontend' })

			expect(executeResponse.status).toBe(303)
			expect(executeResponse.headers.location).toBe('/manage-prototype/plugins?updated=1')
			expect(devServer.updatePlugins).toHaveBeenCalledOnce()

			const refreshed = await request(app).get('/manage-prototype/plugins?updated=1')
			expect(refreshed.text).toContain('Installed version 7.41.0')
			expect(refreshed.text).toContain('The plugin changes were made.')
		})
	})

	describe('plugin routes in production', () => {
		it('does not expose the confirmation endpoints', async () => {
			setupProject({})
			const app = getManagePrototypeApp()

			const getResponse = await request(app).get('/manage-prototype/plugins/confirm')
			expect(getResponse.status).toBe(404)

			const postResponse = await request(app)
				.post('/manage-prototype/plugins/confirm')
				.type('form')
				.send({ action: 'install', packageName: 'hmrc-frontend' })
			expect(postResponse.status).toBe(404)
		})
	})
})
