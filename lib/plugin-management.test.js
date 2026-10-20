import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./paths.js', () => ({
	getPaths: vi.fn()
}))

import { createPluginProject, knownPluginsProject } from '../tests/helpers/plugin-project.js'
import { createRegistryMock } from '../tests/helpers/plugin-registry-mock.js'
import { mockProjectPaths } from '../tests/helpers/project-paths.js'
import { getPaths } from './paths.js'
import { addUpdateState, buildActionPlan, readPlugins } from './plugin-management.js'
import { createPluginRegistry } from './plugin-registry.js'

let project
let projectDir

function setupProject(options = {}) {
	project = createPluginProject(options)
	projectDir = project.dir
	getPaths.mockReturnValue(mockProjectPaths({ projectDir }))
	return project
}

const packagePath = (packageName, ...parts) => path.join(projectDir, 'node_modules', packageName, ...parts)

function getPlugin(pagePlugins, packageName) {
	return pagePlugins.find((plugin) => plugin.packageName === packageName)
}

// the page needs registry versions and actions, so this is the read and the
// update pass together, with the registry injected rather than fetched
async function getPagePlugins(registryOptions) {
	const registry = createRegistryMock(registryOptions)
	const { pagePlugins, diagnostics } = readPlugins()

	await addUpdateState(pagePlugins, { registry })

	return { pagePlugins, diagnostics }
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	project?.cleanup()
	project = undefined
})

describe('readPlugins', () => {
	it('lists protected, available and installed plugins in plugin order', () => {
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

		const { pagePlugins, diagnostics } = readPlugins()

		expect(diagnostics).toEqual([])
		expect(pagePlugins.map((plugin) => plugin.packageName)).toEqual([
			'protato',
			'govuk-frontend',
			'@govuk-prototype-kit/common-templates',
			'@govuk-prototype-kit/step-by-step',
			'@ministryofjustice/frontend',
			'hmrc-frontend',
			'jquery',
			'notifications-node-client'
		])

		const protato = getPlugin(pagePlugins, 'protato')
		expect(protato.installedVersion).toBe('0.1.0')
		expect(protato.protectedPackage).toBe(true)
		expect(protato.readOnly).toBe(true)

		const govukFrontend = getPlugin(pagePlugins, 'govuk-frontend')
		expect(govukFrontend.name).toBe('GOV.UK Frontend')
		expect(govukFrontend.declaration).toBe('5.11.2')
		expect(govukFrontend.installedVersion).toBe('5.11.2')
		expect(govukFrontend.installSource).toBe('registry')
		expect(govukFrontend.known).toBe(true)
		expect(govukFrontend.protectedPackage).toBe(true)
		expect(govukFrontend.readOnly).toBe(false)

		const stepByStep = getPlugin(pagePlugins, '@govuk-prototype-kit/step-by-step')
		expect(stepByStep.declaration).toBeUndefined()
		expect(stepByStep.installedVersion).toBeUndefined()
		expect(stepByStep.installSource).toBeUndefined()
		expect(stepByStep.known).toBe(true)
		expect(stepByStep.readOnly).toBe(false)
		expect(stepByStep.diagnostics).toEqual([])
	})

	it('shows installed unknown plugins as read-only and hides other dependencies', () => {
		setupProject({
			dependencies: {
				'govuk-frontend': '5.11.2',
				'unknown-plugin': '1.0.0',
				'ordinary-dependency': '1.0.0'
			},
			plugins: [
				{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
				{ packageName: 'unknown-plugin', version: '1.0.0', config: { scripts: ['/plugin.js'] } },
				{ packageName: 'ordinary-dependency', version: '1.0.0' },
				{ packageName: 'transitive-plugin', version: '1.0.0', config: {} }
			]
		})

		const { pagePlugins } = readPlugins()
		const unknownPlugin = getPlugin(pagePlugins, 'unknown-plugin')

		expect(unknownPlugin.declaration).toBe('1.0.0')
		expect(unknownPlugin.installedVersion).toBe('1.0.0')
		expect(unknownPlugin.known).toBe(false)
		expect(unknownPlugin.readOnly).toBe(true)
		expect(getPlugin(pagePlugins, 'ordinary-dependency')).toBeUndefined()

		// only packages the project declares directly are listed, even when they
		// are installed and have a plugin config
		expect(getPlugin(pagePlugins, 'transitive-plugin')).toBeUndefined()
	})

	it('keeps a declared but missing known plugin in the list', () => {
		setupProject({ dependencies: { 'hmrc-frontend': '^6.0.0' } })

		const hmrcFrontend = getPlugin(readPlugins().pagePlugins, 'hmrc-frontend')

		expect(hmrcFrontend.declaration).toBe('^6.0.0')
		expect(hmrcFrontend.installedVersion).toBeUndefined()
		expect(hmrcFrontend.installSource).toBe('registry')
		expect(hmrcFrontend.known).toBe(true)
		expect(hmrcFrontend.readOnly).toBe(false)
	})

	it('keeps a diagnostic when plugin dependency metadata cannot be read', () => {
		setupProject({
			dependencies: { 'govuk-frontend': '5.11.2' },
			plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
		})

		expect(getPlugin(readPlugins().pagePlugins, 'govuk-frontend').pluginDependencies).toBeUndefined()

		fs.writeFileSync(packagePath('govuk-frontend', 'govuk-prototype-kit.config.json'), '{ not valid json')

		const govukFrontend = getPlugin(readPlugins().pagePlugins, 'govuk-frontend')

		expect(govukFrontend.pluginDependencies).toBeUndefined()
		expect(govukFrontend.diagnostics.join(' ')).toContain(
			'Could not read govuk-prototype-kit.config.json for govuk-frontend'
		)
	})

	it('shows an installed unknown plugin whose config cannot be read', () => {
		setupProject({
			dependencies: { 'broken-plugin': '1.0.0' },
			plugins: [{ packageName: 'broken-plugin', version: '1.0.0', config: '{ not valid json' }]
		})

		const brokenPlugin = getPlugin(readPlugins().pagePlugins, 'broken-plugin')

		expect(brokenPlugin).toBeDefined()
		expect(brokenPlugin.known).toBe(false)
		expect(brokenPlugin.readOnly).toBe(true)
		expect(brokenPlugin.diagnostics.join(' ')).toContain(
			'Could not read govuk-prototype-kit.config.json for broken-plugin'
		)
	})

	it('sees file edits on the next read', () => {
		setupProject({
			dependencies: { 'hmrc-frontend': '^6.0.0' },
			plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
		})

		expect(getPlugin(readPlugins().pagePlugins, 'hmrc-frontend').installedVersion).toBe('6.0.0')

		const packageJsonPath = packagePath('hmrc-frontend', 'package.json')
		const installedPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
		installedPackage.version = '6.1.0'
		fs.writeFileSync(packageJsonPath, JSON.stringify(installedPackage))

		expect(getPlugin(readPlugins().pagePlugins, 'hmrc-frontend').installedVersion).toBe('6.1.0')
	})

	describe('diagnostics', () => {
		it('reports a corrupt project package.json and still lists known plugins', () => {
			setupProject({})
			fs.writeFileSync(path.join(projectDir, 'package.json'), '{ not valid json')

			const { pagePlugins, diagnostics } = readPlugins()

			expect(diagnostics.some((diagnostic) => diagnostic.includes('Could not read project package.json'))).toBe(true)
			expect(pagePlugins.map((plugin) => plugin.packageName)).toContain('govuk-frontend')
		})

		it('reports corrupt installed package metadata', () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})
			fs.writeFileSync(packagePath('govuk-frontend', 'package.json'), '{ not valid json')

			const govukFrontend = getPlugin(readPlugins().pagePlugins, 'govuk-frontend')

			expect(govukFrontend.installedVersion).toBeUndefined()
			expect(govukFrontend.diagnostics.join(' ')).toContain('Could not read package.json for govuk-frontend')
		})
	})

	describe('install sources', () => {
		it.each([
			['file:../local-plugin', 'other'],
			['link:../local-plugin', 'other'],
			['../local-plugin', 'other'],
			['git+https://example.com/plugin.git', 'other'],
			['github:example/plugin', 'other'],
			['owner/repo#main', 'other'],
			['npm:other-package@1.0.0', 'other'],
			['https://example.com/plugin.tgz', 'other'],
			['unrecognised:specifier', 'other'],
			['^1.0.0', 'registry']
		])('treats %s as a read-only %s dependency', (declaration, installSource) => {
			setupProject({
				dependencies: { 'plugin-under-test': declaration },
				plugins: [{ packageName: 'plugin-under-test', version: '1.0.0', config: {} }]
			})

			const plugin = getPlugin(readPlugins().pagePlugins, 'plugin-under-test')

			expect(plugin.installSource).toBe(installSource)
			expect(plugin.known).toBe(false)
			expect(plugin.readOnly).toBe(true)
		})

		it.each([
			['file:../hmrc-frontend', 'other'],
			['owner/repo#main', 'other'],
			['something:unexpected', 'other']
		])('makes a known plugin from %s read-only', (declaration, installSource) => {
			setupProject({
				dependencies: { 'hmrc-frontend': declaration },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const hmrcFrontend = getPlugin(readPlugins().pagePlugins, 'hmrc-frontend')

			expect(hmrcFrontend.known).toBe(true)
			expect(hmrcFrontend.installSource).toBe(installSource)
			expect(hmrcFrontend.readOnly).toBe(true)
		})

		it('reports an invalid dependency declaration and keeps the plugin ineligible', () => {
			setupProject({
				dependencies: { 'hmrc-frontend': 123 },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const hmrcFrontend = getPlugin(readPlugins().pagePlugins, 'hmrc-frontend')

			expect(hmrcFrontend.declaration).toBe(123)
			expect(hmrcFrontend.installSource).toBe('invalid')
			expect(hmrcFrontend.readOnly).toBe(true)
			expect(hmrcFrontend.diagnostics.join(' ')).toContain('Invalid dependency declaration for hmrc-frontend')
		})
	})
})

describe('addUpdateState', () => {
	it('shows install, update and uninstall actions only where policy allows', async () => {
		setupProject(knownPluginsProject)

		const { pagePlugins } = await getPagePlugins({
			latest: {
				'govuk-frontend': '6.0.0',
				'hmrc-frontend': '7.0.0',
				'@govuk-prototype-kit/step-by-step': '2.0.0'
			}
		})

		expect(getPlugin(pagePlugins, 'govuk-frontend')).toMatchObject({
			latestVersion: '6.0.0',
			updateAvailable: true,
			actions: { install: false, update: true, uninstall: false }
		})
		expect(getPlugin(pagePlugins, 'hmrc-frontend')).toMatchObject({
			latestVersion: '7.0.0',
			updateAvailable: true,
			actions: { install: false, update: true, uninstall: true }
		})
		expect(getPlugin(pagePlugins, '@govuk-prototype-kit/step-by-step')).toMatchObject({
			latestVersion: '2.0.0',
			actions: { install: true, update: false, uninstall: false }
		})
		expect(getPlugin(pagePlugins, 'protato').actions).toEqual({ install: false, update: false, uninstall: false })
		expect(getPlugin(pagePlugins, 'local-plugin').actions).toEqual({ install: false, update: false, uninstall: false })
		expect(getPlugin(pagePlugins, 'unknown-plugin').actions).toEqual({
			install: false,
			update: false,
			uninstall: false
		})
	})

	it('reports registry errors and still allows uninstalling an installed plugin', async () => {
		setupProject(knownPluginsProject)

		const { pagePlugins } = await getPagePlugins({ errors: { 'hmrc-frontend': 'registry unavailable' } })

		const hmrcFrontend = getPlugin(pagePlugins, 'hmrc-frontend')
		expect(hmrcFrontend.latestVersion).toBeUndefined()
		expect(hmrcFrontend.actions).toEqual({ install: false, update: false, uninstall: true })
		expect(hmrcFrontend.diagnostics.join(' ')).toContain('registry unavailable')
	})
})

describe('buildActionPlan', () => {
	function plan(action, packageName, registryOptions) {
		const registry = createRegistryMock(registryOptions)
		const state = readPlugins()

		return buildActionPlan(action, packageName, state, { registry })
	}

	it('plans an install with every change', async () => {
		setupProject({})

		const result = await plan('install', 'hmrc-frontend', { latest: { 'hmrc-frontend': '7.41.0' } })

		expect(result.plugin.name).toBe('HMRC Frontend')
		expect(result.version).toBe('7.41.0')
		expect(result.problems).toEqual([])
		expect(result.changes).toEqual([
			expect.objectContaining({
				action: 'install',
				packageName: 'hmrc-frontend',
				version: '7.41.0'
			})
		])
		expect(result.expectedChanges).toBe('install:hmrc-frontend::7.41.0')
	})

	it('plans updates and uninstalls', async () => {
		setupProject({
			dependencies: { 'hmrc-frontend': '6.0.0' },
			plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
		})

		const update = await plan('update', 'hmrc-frontend', { latest: { 'hmrc-frontend': '7.0.0' } })
		expect(update.version).toBe('7.0.0')
		expect(update.changes[0]).toMatchObject({
			action: 'update',
			installedVersion: '6.0.0',
			version: '7.0.0'
		})

		const uninstall = await plan('uninstall', 'hmrc-frontend')
		expect(uninstall.changes[0]).toMatchObject({
			action: 'uninstall',
			installedVersion: '6.0.0'
		})
	})

	it('shows dependency changes', async () => {
		setupProject({})

		const result = await plan('install', 'hmrc-frontend', {
			latest: { 'hmrc-frontend': '7.0.0', 'govuk-frontend': '6.0.0' },
			configs: { 'hmrc-frontend@7.0.0': ['govuk-frontend'] }
		})

		expect(result.changes.map((change) => change.packageName)).toEqual(['govuk-frontend', 'hmrc-frontend'])
		expect(result.changes[0].requiredByNames).toEqual([{ packageName: 'hmrc-frontend', name: 'HMRC Frontend' }])
	})

	it('reports blocking problems from the plan', async () => {
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

		const result = await plan('update', 'hmrc-frontend', {
			latest: { 'hmrc-frontend': '7.0.0', 'govuk-frontend': '5.11.2' },
			configs: {
				'hmrc-frontend@7.0.0': [{ packageName: 'govuk-frontend', maxVersion: '5.11.2' }]
			}
		})

		expect(result.plan.ok).toBe(false)
		expect(result.problems.length).toBeGreaterThan(0)
		expect(result.problems.every((problem) => typeof problem === 'string')).toBe(true)
	})

	it('reports registry failures separately from policy refusals', async () => {
		setupProject({})

		const result = await plan('install', 'hmrc-frontend', { errors: { 'hmrc-frontend': 'registry unavailable' } })

		expect(result).toEqual({ error: 'registry unavailable', status: 503 })
	})

	it('installs, updates and uninstalls jquery without fetching an archive', async () => {
		const urls = []
		const fetch = vi.fn(async (url) => {
			urls.push(String(url))

			if (!String(url).endsWith('/jquery')) {
				return new Response('', { status: 404 })
			}

			return new Response(
				JSON.stringify({
					'dist-tags': { latest: '3.7.2' },
					versions: {
						'3.7.1': { dist: { tarball: 'https://registry.npmjs.org/jquery/-/jquery-3.7.1.tgz' } },
						'3.7.2': { dist: { tarball: 'https://registry.npmjs.org/jquery/-/jquery-3.7.2.tgz' } }
					}
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		})
		const registry = createPluginRegistry({ allowedPackageNames: ['jquery'], fetch })

		setupProject({})

		const installed = await buildActionPlan('install', 'jquery', readPlugins(), { registry })
		expect(installed.plan.changes).toEqual([
			expect.objectContaining({ action: 'install', packageName: 'jquery', version: '3.7.2' })
		])

		fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ dependencies: { jquery: '3.7.1' } }))
		fs.mkdirSync(packagePath('jquery'), { recursive: true })
		fs.writeFileSync(packagePath('jquery', 'package.json'), JSON.stringify({ name: 'jquery', version: '3.7.1' }))

		const updated = await buildActionPlan('update', 'jquery', readPlugins(), { registry })
		expect(updated.plan.changes).toEqual([
			expect.objectContaining({ action: 'update', packageName: 'jquery', version: '3.7.2', installedVersion: '3.7.1' })
		])

		const uninstalled = await buildActionPlan('uninstall', 'jquery', readPlugins(), { registry })
		expect(uninstalled.plan.changes).toEqual([expect.objectContaining({ action: 'uninstall', packageName: 'jquery' })])

		expect(urls.filter((url) => url.endsWith('.tgz'))).toEqual([])
	})

	it('prefers a shipped config over a user proxy override when planning', async () => {
		setupProject({
			dependencies: { 'hmrc-frontend': '6.0.0' },
			plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }],
			files: {
				'app/plugin-proxy.json': {
					'hmrc-frontend': { pluginDependencies: ['jquery'] }
				}
			}
		})

		const result = await plan('update', 'hmrc-frontend', {
			latest: { 'hmrc-frontend': '7.0.0', jquery: '4.0.0' },
			configs: { 'hmrc-frontend@7.0.0': [] }
		})

		expect(result.plan.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})

	it('does not block installing another plugin when jquery is installed', async () => {
		setupProject({
			dependencies: { jquery: '3.7.1' },
			plugins: [{ packageName: 'jquery', version: '3.7.1' }]
		})

		const result = await plan('install', 'hmrc-frontend', { latest: { 'hmrc-frontend': '7.0.0' } })

		expect(result.plan.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})
})
