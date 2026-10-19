import fs from 'node:fs'
import path from 'node:path'

import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPaths } from '../../lib/paths.js'
import { createPluginProject } from '../../tests/helpers/plugin-project.js'
import { getManagePrototypeDevApp } from '../dev-app.js'
import pluginRoutes from './plugins.js'

vi.mock('../../lib/paths.js', () => ({
	getPaths: vi.fn()
}))

vi.mock('../../lib/config.js', () => ({
	getConfig: vi.fn(() => ({
		env: 'development',
		serviceName: 'Test service'
	}))
}))

const repoRoot = path.join(import.meta.dirname, '../..')

let dir
let projects = []

function setupProject(options = {}) {
	const project = createPluginProject(options)
	projects.push(project)
	dir = project.dir
	getPaths.mockReturnValue({
		project: dir,
		package: repoRoot,
		managePrototype: {
			views: path.join(repoRoot, 'manage-prototype', 'views'),
			govukFrontendViews: path.join(repoRoot, 'node_modules', 'govuk-frontend', 'dist'),
			public: path.join(repoRoot, 'manage-prototype', 'public'),
			govukFrontend: path.join(repoRoot, 'node_modules', 'govuk-frontend')
		}
	})
	return project
}

const packagePath = (packageName, ...parts) => path.join(dir, 'node_modules', packageName, ...parts)

function getPlugin(page, packageName) {
	return page.plugins.find((plugin) => plugin.packageName === packageName)
}

function createApp() {
	const app = express()
	const renders = []

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

async function getPageModel() {
	const { app, renders } = createApp()
	const response = await request(app).get('/manage-prototype/plugins')

	expect(response.status).toBe(200)
	expect(renders).toHaveLength(1)

	return renders[0].model
}

describe('plugins management route', () => {
	beforeEach(() => {
		vi.clearAllMocks()
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

	describe('page data', () => {
		it('lists protected, available and installed plugins in plugin order', async () => {
			setupProject({
				dependencies: {
					protato: '0.1.0',
					'govuk-frontend': '5.11.2',
					'@govuk-prototype-kit/common-templates': '2.0.1',
					'hmrc-frontend': '^6.0.0'
				},
				plugins: [
					{ packageName: 'protato', version: '0.1.0', config: {} },
					{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
					{ packageName: '@govuk-prototype-kit/common-templates', version: '2.0.1', config: {} },
					{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }
				]
			})

			const page = await getPageModel()

			expect(page.diagnostics).toEqual([])
			expect(page.plugins.map((plugin) => plugin.packageName)).toEqual([
				'protato',
				'govuk-frontend',
				'@govuk-prototype-kit/common-templates',
				'@govuk-prototype-kit/step-by-step',
				'@ministryofjustice/frontend',
				'hmrc-frontend'
			])

			const protato = getPlugin(page, 'protato')
			expect(protato.installedVersion).toBe('0.1.0')
			expect(protato.protectedPackage).toBe(true)
			expect(protato.readOnly).toBe(true)

			const govukFrontend = getPlugin(page, 'govuk-frontend')
			expect(govukFrontend.name).toBe('GOV.UK Frontend')
			expect(govukFrontend.declaration).toBe('5.11.2')
			expect(govukFrontend.installedVersion).toBe('5.11.2')
			expect(govukFrontend.installSource).toBe('registry')
			expect(govukFrontend.known).toBe(true)
			expect(govukFrontend.protectedPackage).toBe(true)
			expect(govukFrontend.readOnly).toBe(false)
			expect(govukFrontend.dependenciesKnown).toBe(true)

			const stepByStep = getPlugin(page, '@govuk-prototype-kit/step-by-step')
			expect(stepByStep.declaration).toBeUndefined()
			expect(stepByStep.installedVersion).toBeUndefined()
			expect(stepByStep.installSource).toBeUndefined()
			expect(stepByStep.known).toBe(true)
			expect(stepByStep.readOnly).toBe(false)
			expect(stepByStep.diagnostics).toEqual([])
		})

		it('uses the existing display name formatter', async () => {
			setupProject({})

			const commonTemplates = getPlugin(await getPageModel(), '@govuk-prototype-kit/common-templates')

			expect({ name: commonTemplates.name, publisher: commonTemplates.publisher }).toEqual({
				name: 'Common Templates',
				publisher: 'GOV.UK Prototype Kit'
			})
		})

		it('shows installed unknown plugins as read-only and hides config-less dependencies', async () => {
			setupProject({
				dependencies: {
					'govuk-frontend': '5.11.2',
					'unknown-plugin': '1.0.0',
					'ordinary-dependency': '1.0.0'
				},
				plugins: [
					{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
					{ packageName: 'unknown-plugin', version: '1.0.0', config: { scripts: ['/plugin.js'] } },
					{ packageName: 'ordinary-dependency', version: '1.0.0' }
				]
			})

			const page = await getPageModel()
			const unknownPlugin = getPlugin(page, 'unknown-plugin')

			expect(unknownPlugin.declaration).toBe('1.0.0')
			expect(unknownPlugin.installedVersion).toBe('1.0.0')
			expect(unknownPlugin.known).toBe(false)
			expect(unknownPlugin.readOnly).toBe(true)
			expect(getPlugin(page, 'ordinary-dependency')).toBeUndefined()
		})

		it('does not treat transitive packages as directly installed plugins', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [
					{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
					{ packageName: 'transitive-plugin', version: '1.0.0', config: {} }
				]
			})

			expect(getPlugin(await getPageModel(), 'transitive-plugin')).toBeUndefined()
		})

		it('keeps a declared but missing known plugin in the list', async () => {
			setupProject({ dependencies: { 'hmrc-frontend': '^6.0.0' } })

			const hmrcFrontend = getPlugin(await getPageModel(), 'hmrc-frontend')

			expect(hmrcFrontend.declaration).toBe('^6.0.0')
			expect(hmrcFrontend.installedVersion).toBeUndefined()
			expect(hmrcFrontend.installSource).toBe('registry')
			expect(hmrcFrontend.known).toBe(true)
			expect(hmrcFrontend.readOnly).toBe(false)
		})

		it('reports whether plugin dependency metadata can be read', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})

			expect(getPlugin(await getPageModel(), 'govuk-frontend').dependenciesKnown).toBe(true)

			fs.writeFileSync(packagePath('govuk-frontend', 'govuk-prototype-kit.config.json'), '{ not valid json')

			const govukFrontend = getPlugin(await getPageModel(), 'govuk-frontend')

			expect(govukFrontend.dependenciesKnown).toBe(false)
			expect(govukFrontend.diagnostics.join(' ')).toContain(
				'Could not read govuk-prototype-kit.config.json for govuk-frontend'
			)
		})

		it('shows an installed unknown plugin whose config cannot be read', async () => {
			setupProject({
				dependencies: { 'broken-plugin': '1.0.0' },
				plugins: [{ packageName: 'broken-plugin', version: '1.0.0', config: '{ not valid json' }]
			})

			const brokenPlugin = getPlugin(await getPageModel(), 'broken-plugin')

			expect(brokenPlugin).toBeDefined()
			expect(brokenPlugin.known).toBe(false)
			expect(brokenPlugin.readOnly).toBe(true)
			expect(brokenPlugin.dependenciesKnown).toBe(false)
			expect(brokenPlugin.diagnostics.join(' ')).toContain(
				'Could not read govuk-prototype-kit.config.json for broken-plugin'
			)
		})
	})

	describe('install sources', () => {
		it.each([
			['file:../local-plugin', 'local'],
			['link:../local-plugin', 'local'],
			['../local-plugin', 'local'],
			['git+https://example.com/plugin.git', 'git'],
			['github:example/plugin', 'git'],
			['owner/repo#main', 'git'],
			['npm:other-package@1.0.0', 'alias'],
			['https://example.com/plugin.tgz', 'url'],
			['unrecognised:specifier', 'other']
		])('treats %s as a read-only %s dependency', async (declaration, installSource) => {
			setupProject({
				dependencies: { 'plugin-under-test': declaration },
				plugins: [{ packageName: 'plugin-under-test', version: '1.0.0', config: {} }]
			})

			const plugin = getPlugin(await getPageModel(), 'plugin-under-test')

			expect(plugin.installSource).toBe(installSource)
			expect(plugin.known).toBe(false)
			expect(plugin.readOnly).toBe(true)
		})

		it('makes a known plugin from a local source read-only', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': 'file:../hmrc-frontend' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const hmrcFrontend = getPlugin(await getPageModel(), 'hmrc-frontend')

			expect(hmrcFrontend.known).toBe(true)
			expect(hmrcFrontend.protectedPackage).toBe(false)
			expect(hmrcFrontend.readOnly).toBe(true)
		})

		it('makes a known plugin from GitHub shorthand read-only', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': 'owner/repo#main' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const hmrcFrontend = getPlugin(await getPageModel(), 'hmrc-frontend')

			expect(hmrcFrontend.known).toBe(true)
			expect(hmrcFrontend.installSource).toBe('git')
			expect(hmrcFrontend.readOnly).toBe(true)
		})

		it('makes a known plugin with an unrecognised source read-only', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': 'something:unexpected' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const hmrcFrontend = getPlugin(await getPageModel(), 'hmrc-frontend')

			expect(hmrcFrontend.known).toBe(true)
			expect(hmrcFrontend.installSource).toBe('other')
			expect(hmrcFrontend.readOnly).toBe(true)
		})

		it('reports an invalid dependency declaration and keeps the plugin ineligible', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': 123 },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const hmrcFrontend = getPlugin(await getPageModel(), 'hmrc-frontend')

			expect(hmrcFrontend.declaration).toBe(123)
			expect(hmrcFrontend.installSource).toBe('invalid')
			expect(hmrcFrontend.readOnly).toBe(true)
			expect(hmrcFrontend.diagnostics.join(' ')).toContain('Invalid dependency declaration for hmrc-frontend')
		})
	})

	describe('diagnostics', () => {
		it('reports a corrupt project package.json and still lists known plugins', async () => {
			setupProject({})
			fs.writeFileSync(path.join(dir, 'package.json'), '{ not valid json')

			const page = await getPageModel()

			expect(page.diagnostics.some((diagnostic) => diagnostic.includes('Could not read project package.json'))).toBe(
				true
			)
			expect(page.plugins.map((plugin) => plugin.packageName)).toContain('govuk-frontend')
		})

		it('reports a missing known list and still lists installed plugins', async () => {
			setupProject({
				dependencies: { 'unknown-plugin': '1.0.0' },
				plugins: [{ packageName: 'unknown-plugin', version: '1.0.0', config: {} }]
			})
			getPaths.mockReturnValue({
				project: dir,
				package: path.join(dir, 'package-root'),
				managePrototype: {
					views: path.join(repoRoot, 'manage-prototype', 'views'),
					govukFrontendViews: path.join(repoRoot, 'node_modules', 'govuk-frontend', 'dist'),
					public: path.join(repoRoot, 'manage-prototype', 'public'),
					govukFrontend: path.join(repoRoot, 'node_modules', 'govuk-frontend')
				}
			})

			const page = await getPageModel()

			expect(page.diagnostics.some((diagnostic) => diagnostic.includes('Could not read known-plugins.json'))).toBe(true)
			expect(getPlugin(page, 'unknown-plugin').readOnly).toBe(true)
		})

		it('reports corrupt installed package metadata', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})
			fs.writeFileSync(packagePath('govuk-frontend', 'package.json'), '{ not valid json')

			const govukFrontend = getPlugin(await getPageModel(), 'govuk-frontend')

			expect(govukFrontend.installedVersion).toBeUndefined()
			expect(govukFrontend.diagnostics.join(' ')).toContain('Could not read package.json for govuk-frontend')
		})
	})

	describe('repeated reads', () => {
		it('sees file edits on the next read', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			expect(getPlugin(await getPageModel(), 'hmrc-frontend').installedVersion).toBe('6.0.0')

			const packageJsonPath = packagePath('hmrc-frontend', 'package.json')
			const installedPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
			installedPackage.version = '6.1.0'
			fs.writeFileSync(packageJsonPath, JSON.stringify(installedPackage))

			expect(getPlugin(await getPageModel(), 'hmrc-frontend').installedVersion).toBe('6.1.0')
		})
	})

	describe('page', () => {
		it('renders the plugin list without network calls', async () => {
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

		it('shows independent protected and read-only explanations', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': 'file:../govuk-frontend' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})

			const app = express()
			app.use('/manage-prototype', getManagePrototypeDevApp())
			const response = await request(app).get('/manage-prototype/plugins')
			const html = response.text

			expect(response.status).toBe(200)
			expect(html).toContain('This plugin is protected, so it cannot be uninstalled.')
			expect(html).toContain('This plugin was installed from outside the npm registry, so it is read-only.')
		})

		it('renders installed state, policy explanations and escaped diagnostics in the dev app', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0', 'broken-plugin': '1.0.0' },
				plugins: [
					{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} },
					{ packageName: 'broken-plugin', version: '1.0.0', config: '<script>alert(1)</script>' }
				]
			})

			const app = express()
			app.use('/manage-prototype', getManagePrototypeDevApp())
			const response = await request(app).get('/manage-prototype/plugins')
			const html = response.text

			expect(response.status).toBe(200)
			expect(html).toContain('HMRC Frontend')
			expect(html).toContain('Installed version 6.0.0')
			expect(html).toContain('Not installed')
			expect(html).toContain('This plugin is protected, so it cannot be uninstalled.')
			expect(html).toContain("This plugin is not in Protato's known list, so it is read-only.")
			expect(html).toContain('&lt;script&gt;')
			expect(html).not.toContain('<script>alert(1)')
			expect(html).not.toContain('<form')
		})
	})
})
