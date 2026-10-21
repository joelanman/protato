import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ spawn: null }))
const { registryMock } = vi.hoisted(() => ({
	registryMock: { fetchPackageMetadata: vi.fn(), fetchPluginConfig: vi.fn() }
}))
const spawnProjectDir = path.resolve('tmp', 'project with spaces')

vi.mock('./paths.js', () => ({ getPaths: vi.fn() }))
vi.mock('cross-spawn', () => ({ default: (...args) => state.spawn(...args) }))
vi.mock('./npm-registry.js', async (importOriginal) => {
	const actual = await importOriginal()

	return {
		...actual,
		fetchPackageMetadata: (...args) => registryMock.fetchPackageMetadata(...args),
		fetchPluginConfig: (...args) => registryMock.fetchPluginConfig(...args)
	}
})

import knownPlugins from '../known-plugins.json' with { type: 'json' }
import { createPluginProject, knownPluginsProject } from '../tests/helpers/plugin-project.js'
import { resetRegistryMock } from '../tests/helpers/plugin-registry-mock.js'
import { mockProjectPaths } from '../tests/helpers/project-paths.js'
import { getPaths } from './paths.js'
import { listPlugins, planPluginAction, runPluginAction } from './plugin-manager.js'

let project
let dir

function setupProject(options = {}) {
	project = createPluginProject(options)
	dir = project.dir
	getPaths.mockReturnValue(mockProjectPaths({ projectDir: dir }))
	return project
}

const packagePath = (packageName, ...parts) => path.join(dir, 'node_modules', packageName, ...parts)

function getPlugin(plugins, packageName) {
	return plugins.find((plugin) => plugin.packageName === packageName)
}

async function list(registryOptions) {
	resetRegistryMock(registryMock, registryOptions)
	return listPlugins()
}

async function plan(action, packageName, registryOptions) {
	resetRegistryMock(registryMock, registryOptions)
	return planPluginAction(action, packageName)
}

beforeEach(() => {
	vi.clearAllMocks()
	resetRegistryMock(registryMock)
})

afterEach(() => {
	project?.cleanup()
	project = undefined
})

describe('listPlugins', () => {
	describe('listing', () => {
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

			const { plugins, diagnostics } = await list()

			expect(diagnostics).toEqual([])
			expect(plugins.map((plugin) => plugin.packageName)).toEqual([
				'protato',
				'govuk-frontend',
				'@govuk-prototype-kit/common-templates',
				'@govuk-prototype-kit/step-by-step',
				'@ministryofjustice/frontend',
				'hmrc-frontend',
				'jquery',
				'notifications-node-client'
			])

			const protato = getPlugin(plugins, 'protato')
			expect(protato.installedVersion).toBe('0.1.0')
			expect(protato.protectedPackage).toBe(true)
			expect(protato.readOnly).toBe(true)

			const govukFrontend = getPlugin(plugins, 'govuk-frontend')
			expect(govukFrontend.name).toBe('GOV.UK Frontend')
			expect(govukFrontend.installedVersion).toBe('5.11.2')
			expect(govukFrontend.protectedPackage).toBe(true)
			expect(govukFrontend.readOnly).toBe(false)

			const stepByStep = getPlugin(plugins, '@govuk-prototype-kit/step-by-step')
			expect(stepByStep.installedVersion).toBeUndefined()
			expect(stepByStep.readOnly).toBe(false)
			expect(stepByStep.diagnostics).toEqual([])
		})

		it('lists installed plugins that are not suggested and hides other dependencies', async () => {
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

			const { plugins } = await list()
			const unlistedPlugin = getPlugin(plugins, 'unknown-plugin')

			expect(unlistedPlugin.installedVersion).toBe('1.0.0')
			expect(unlistedPlugin.readOnly).toBe(false)
			expect(getPlugin(plugins, 'ordinary-dependency')).toBeUndefined()

			// only packages the project declares directly are listed, even when
			// they are installed and have a plugin config
			expect(getPlugin(plugins, 'transitive-plugin')).toBeUndefined()
		})

		it('keeps a declared but missing suggested plugin in the list', async () => {
			setupProject({ dependencies: { 'hmrc-frontend': '^6.0.0' } })

			const hmrcFrontend = getPlugin((await list()).plugins, 'hmrc-frontend')

			expect(hmrcFrontend.installedVersion).toBeUndefined()
			expect(hmrcFrontend.readOnly).toBe(false)
		})

		it('keeps a diagnostic when plugin dependency metadata cannot be read', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})

			expect(getPlugin((await list()).plugins, 'govuk-frontend').pluginDependencies).toBeUndefined()

			fs.writeFileSync(packagePath('govuk-frontend', 'govuk-prototype-kit.config.json'), '{ not valid json')

			const govukFrontend = getPlugin((await list()).plugins, 'govuk-frontend')

			expect(govukFrontend.pluginDependencies).toBeUndefined()
			expect(govukFrontend.diagnostics.join(' ')).toContain(
				'Could not read govuk-prototype-kit.config.json for govuk-frontend'
			)
		})

		it('shows an installed plugin whose config cannot be read', async () => {
			setupProject({
				dependencies: { 'broken-plugin': '1.0.0' },
				plugins: [{ packageName: 'broken-plugin', version: '1.0.0', config: '{ not valid json' }]
			})

			const brokenPlugin = getPlugin((await list()).plugins, 'broken-plugin')

			expect(brokenPlugin).toBeDefined()
			expect(brokenPlugin.diagnostics.join(' ')).toContain(
				'Could not read govuk-prototype-kit.config.json for broken-plugin'
			)
		})

		it('sees file edits on the next read', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			expect(getPlugin((await list()).plugins, 'hmrc-frontend').installedVersion).toBe('6.0.0')

			const packageJsonPath = packagePath('hmrc-frontend', 'package.json')
			const installedPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
			installedPackage.version = '6.1.0'
			fs.writeFileSync(packageJsonPath, JSON.stringify(installedPackage))

			expect(getPlugin((await list()).plugins, 'hmrc-frontend').installedVersion).toBe('6.1.0')
		})

		describe('diagnostics', () => {
			it('reports a corrupt project package.json and still lists suggested plugins', async () => {
				setupProject({})
				fs.writeFileSync(path.join(dir, 'package.json'), '{ not valid json')

				const { plugins, diagnostics } = await list()

				expect(diagnostics.some((diagnostic) => diagnostic.includes('Could not read project package.json'))).toBe(true)
				expect(plugins.map((plugin) => plugin.packageName)).toContain('govuk-frontend')
			})

			it('reports corrupt installed package metadata', async () => {
				setupProject({
					dependencies: { 'govuk-frontend': '5.11.2' },
					plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
				})
				fs.writeFileSync(packagePath('govuk-frontend', 'package.json'), '{ not valid json')

				const govukFrontend = getPlugin((await list()).plugins, 'govuk-frontend')

				expect(govukFrontend.installedVersion).toBeUndefined()
				expect(govukFrontend.diagnostics.join(' ')).toContain('Could not read package.json for govuk-frontend')
			})

			it('reports an installed version that is not exact', async () => {
				setupProject({
					dependencies: { 'hmrc-frontend': '^6.0.0' },
					plugins: [{ packageName: 'hmrc-frontend', version: '6', config: {} }]
				})

				const hmrcFrontend = getPlugin((await list()).plugins, 'hmrc-frontend')

				expect(hmrcFrontend.diagnostics).toEqual(['Installed version of hmrc-frontend is not exact: 6'])
			})
		})

		describe('install sources', () => {
			it.each([
				['file:../local-plugin', true],
				['link:../local-plugin', true],
				['../local-plugin', true],
				['git+https://example.com/plugin.git', true],
				['github:example/plugin', true],
				['owner/repo#main', true],
				['npm:other-package@1.0.0', true],
				['https://example.com/plugin.tgz', true],
				['unrecognised:specifier', true],
				['^1.0.0', false]
			])('treats a plugin declared as %s as read-only: %s', async (declaration, readOnly) => {
				setupProject({
					dependencies: { 'plugin-under-test': declaration },
					plugins: [{ packageName: 'plugin-under-test', version: '1.0.0', config: {} }]
				})

				const plugin = getPlugin((await list()).plugins, 'plugin-under-test')

				expect(plugin.readOnly).toBe(readOnly)
			})

			it('reports an invalid dependency declaration and keeps the plugin ineligible', async () => {
				setupProject({
					dependencies: { 'hmrc-frontend': 123 },
					plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
				})

				const hmrcFrontend = getPlugin((await list()).plugins, 'hmrc-frontend')

				expect(hmrcFrontend.readOnly).toBe(true)
				expect(hmrcFrontend.diagnostics.join(' ')).toContain('Invalid dependency declaration for hmrc-frontend')
			})
		})
	})

	describe('latest versions', () => {
		it('adds the latest version', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const { plugins } = await list({ latest: { 'hmrc-frontend': '7.0.0' } })

			expect(getPlugin(plugins, 'hmrc-frontend').latestVersion).toBe('7.0.0')
		})

		it('turns a failed lookup into a diagnostic', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const { plugins } = await list({ errors: { 'hmrc-frontend': 'registry unavailable' } })

			const hmrcFrontend = getPlugin(plugins, 'hmrc-frontend')

			expect(hmrcFrontend.latestVersion).toBeUndefined()
			expect(hmrcFrontend.diagnostics).toEqual(['Could not check for updates for hmrc-frontend: registry unavailable'])
		})

		it('does not look up read-only plugins', async () => {
			setupProject(knownPluginsProject)

			const { plugins } = await list({ latest: { 'local-plugin': '9.0.0' } })

			expect(getPlugin(plugins, 'local-plugin').latestVersion).toBeUndefined()
			expect(registryMock.fetchPackageMetadata).not.toHaveBeenCalledWith('local-plugin')
			expect(registryMock.fetchPackageMetadata).not.toHaveBeenCalledWith('protato')
		})
	})

	describe('actions', () => {
		it('offers install, update and uninstall only where the planner will accept them', async () => {
			setupProject(knownPluginsProject)

			const { plugins } = await list({
				latest: {
					'hmrc-frontend': '7.0.0',
					'@govuk-prototype-kit/step-by-step': '2.0.0',
					'unknown-plugin': '2.0.0'
				}
			})

			expect(getPlugin(plugins, 'hmrc-frontend').actions).toEqual({
				install: false,
				update: true,
				uninstall: true
			})
			expect(getPlugin(plugins, '@govuk-prototype-kit/step-by-step').actions).toEqual({
				install: true,
				update: false,
				uninstall: false
			})
			expect(getPlugin(plugins, 'protato').actions).toEqual({ install: false, update: false, uninstall: false })
			expect(getPlugin(plugins, 'local-plugin').actions).toEqual({ install: false, update: false, uninstall: false })
			expect(getPlugin(plugins, 'unknown-plugin').actions).toMatchObject({ update: true, uninstall: true })
		})

		it('offers no uninstall for a protected plugin', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})

			const { plugins } = await list()

			expect(getPlugin(plugins, 'govuk-frontend').actions.uninstall).toBe(false)
		})

		it('offers no update when the installed version is not exact', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6', config: {} }]
			})

			const { plugins } = await list({ latest: { 'hmrc-frontend': '7.0.0' } })

			expect(getPlugin(plugins, 'hmrc-frontend').actions.update).toBe(false)
		})

		it('offers no update when the latest version is already installed', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '7.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '7.0.0', config: {} }]
			})

			const { plugins } = await list({ latest: { 'hmrc-frontend': '7.0.0' } })

			expect(getPlugin(plugins, 'hmrc-frontend').actions).toMatchObject({ update: false, uninstall: true })
		})

		it('offers no install when the plugin is already installed', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '7.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '7.0.0', config: {} }]
			})

			const { plugins } = await list({ latest: { 'hmrc-frontend': '8.0.0' } })

			expect(getPlugin(plugins, 'hmrc-frontend').actions.install).toBe(false)
		})
	})
})

describe('planPluginAction', () => {
	it('rejects invalid actions and package names', async () => {
		setupProject({})

		expect(await plan('remove', 'hmrc-frontend')).toEqual({
			error: 'Choose install, update or uninstall.',
			status: 400
		})
		expect(await plan('install', '-g')).toEqual({ error: 'Choose a valid plugin package name.', status: 400 })
		expect(await plan('install', '@scope')).toEqual({ error: 'Choose a valid plugin package name.', status: 400 })
	})

	it('plans an install with every change', async () => {
		setupProject({})

		const result = await plan('install', 'hmrc-frontend', { latest: { 'hmrc-frontend': '7.41.0' } })

		expect(result.pluginName).toBe('HMRC Frontend')
		expect(result.publisher).toBeUndefined()
		expect(result.version).toBe('7.41.0')
		expect(result.ok).toBe(true)
		expect(result.problems).toEqual([])
		expect(result.changes).toEqual([
			expect.objectContaining({
				action: 'install',
				packageName: 'hmrc-frontend',
				version: '7.41.0'
			})
		])
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

	it('refuses ineligible targets with a 400 and a reason', async () => {
		setupProject({
			dependencies: { 'govuk-frontend': '5.11.2', 'hmrc-frontend': 'file:../hmrc-frontend' },
			plugins: [
				{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
				{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }
			]
		})

		expect(await plan('uninstall', 'govuk-frontend')).toEqual({
			error: 'govuk-frontend is protected, so it cannot be uninstalled.',
			status: 400
		})
		expect(await plan('uninstall', 'hmrc-frontend')).toEqual({
			error: 'hmrc-frontend is read-only, so it cannot be uninstalled.',
			status: 400
		})
		expect(await plan('uninstall', 'jquery')).toEqual({ error: 'jquery is not installed.', status: 400 })
		expect(await plan('update', 'hmrc-frontend')).toEqual({ error: 'hmrc-frontend is read-only.', status: 400 })
	})

	it('refuses an install when the plugin is already installed', async () => {
		setupProject({
			dependencies: { 'hmrc-frontend': '6.0.0' },
			plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
		})

		expect(await plan('install', 'hmrc-frontend', { latest: { 'hmrc-frontend': '7.0.0' } })).toEqual({
			error: 'hmrc-frontend is already installed.',
			status: 400
		})
	})

	it('refuses an update when there is no newer version', async () => {
		setupProject({
			dependencies: { 'hmrc-frontend': '6.0.0' },
			plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
		})

		expect(await plan('update', 'hmrc-frontend', { latest: { 'hmrc-frontend': '6.0.0' } })).toEqual({
			error: 'There is no newer version of hmrc-frontend.',
			status: 400
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

		expect(result.ok).toBe(false)
		expect(result.noop).toBe(false)
		expect(result.problems.length).toBeGreaterThan(0)
		expect(result.problems.every((problem) => typeof problem === 'string')).toBe(true)
	})

	it('reports registry failures separately from policy refusals', async () => {
		setupProject({})

		const result = await plan('install', 'hmrc-frontend', { errors: { 'hmrc-frontend': 'registry unavailable' } })

		expect(result).toEqual({ error: 'registry unavailable', status: 503 })
	})

	it('fails when a dependency cannot be read from the registry', async () => {
		setupProject({})

		const result = await plan('install', 'hmrc-frontend', {
			latest: { 'hmrc-frontend': '2.0.0' },
			configs: { 'hmrc-frontend@2.0.0': ['dep'] },
			errors: { dep: 'registry unavailable' }
		})

		expect(result).toEqual({ error: 'registry unavailable', status: 503 })
	})

	it('installs, updates and uninstalls jquery without fetching an archive', async () => {
		setupProject({})

		const jqueryRegistry = {
			latest: { jquery: '3.7.2' },
			versions: { jquery: ['3.7.1', '3.7.2'] }
		}

		const installed = await plan('install', 'jquery', jqueryRegistry)
		expect(installed.changes).toEqual([
			expect.objectContaining({ action: 'install', packageName: 'jquery', version: '3.7.2' })
		])

		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { jquery: '3.7.1' } }))
		fs.mkdirSync(packagePath('jquery'), { recursive: true })
		fs.writeFileSync(packagePath('jquery', 'package.json'), JSON.stringify({ name: 'jquery', version: '3.7.1' }))

		const updated = await plan('update', 'jquery', jqueryRegistry)
		expect(updated.changes).toEqual([
			expect.objectContaining({ action: 'update', packageName: 'jquery', version: '3.7.2', installedVersion: '3.7.1' })
		])

		const uninstalled = await plan('uninstall', 'jquery', jqueryRegistry)
		expect(uninstalled.changes).toEqual([expect.objectContaining({ action: 'uninstall', packageName: 'jquery' })])

		expect(registryMock.fetchPluginConfig).not.toHaveBeenCalledWith('jquery', expect.anything())
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

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})

	it('plans an uninstalled package that only has a user proxy config', async () => {
		setupProject({
			files: { 'app/plugin-proxy.json': { 'custom-proxy-plugin': { assets: ['/files'] } } }
		})

		const result = await plan('install', 'custom-proxy-plugin', {
			latest: { 'custom-proxy-plugin': '1.0.0' }
		})

		expect(result.ok).toBe(true)
		expect(result.changes).toEqual([
			expect.objectContaining({ action: 'install', packageName: 'custom-proxy-plugin', version: '1.0.0' })
		])
		expect(registryMock.fetchPluginConfig).not.toHaveBeenCalled()
	})

	it('does not block installing another plugin when jquery is installed', async () => {
		setupProject({
			dependencies: { jquery: '3.7.1' },
			plugins: [{ packageName: 'jquery', version: '3.7.1' }]
		})

		const result = await plan('install', 'hmrc-frontend', { latest: { 'hmrc-frontend': '7.0.0' } })

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})

	describe('dependency planning', () => {
		it('installs the target and a missing dependency at the highest stable version', async () => {
			setupProject({})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0', dep: '1.2.0' },
				versions: { dep: ['1.0.0', '1.2.0'] },
				configs: { 'hmrc-frontend@2.0.0': ['dep'], 'dep@1.2.0': [] }
			})

			expect(result.ok).toBe(true)
			expect(result.noop).toBe(false)
			expect(result.changes.map((change) => change.packageName)).toEqual(['dep', 'hmrc-frontend'])
			expect(getPlugin(result.changes, 'hmrc-frontend')).toMatchObject({
				action: 'install',
				version: '2.0.0',
				reason: 'requested',
				requiredBy: []
			})
			expect(getPlugin(result.changes, 'dep')).toMatchObject({
				action: 'install',
				version: '1.2.0',
				reason: 'dependency',
				requiredBy: ['hmrc-frontend']
			})
		})

		it('updates an installed dependency that is below minVersion', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.0.0' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.0.0', config: {} }]
			})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0', 'govuk-frontend': '6.1.0' },
				versions: { 'govuk-frontend': ['5.0.0', '6.0.0', '6.1.0'] },
				configs: {
					'hmrc-frontend@2.0.0': [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }],
					'govuk-frontend@6.1.0': []
				}
			})

			expect(result.ok).toBe(true)
			expect(getPlugin(result.changes, 'govuk-frontend')).toMatchObject({
				action: 'update',
				version: '6.1.0',
				installedVersion: '5.0.0',
				reason: 'dependency',
				requiredBy: ['hmrc-frontend']
			})
		})

		it('reports a maxVersion conflict with another installed plugin', async () => {
			setupProject({
				dependencies: {
					'govuk-frontend': '6.0.0',
					'@govuk-prototype-kit/step-by-step': '2.0.0'
				},
				plugins: [
					{ packageName: 'govuk-frontend', version: '6.0.0', config: {} },
					{
						packageName: '@govuk-prototype-kit/step-by-step',
						version: '2.0.0',
						config: { pluginDependencies: [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }] }
					}
				]
			})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0', 'govuk-frontend': '6.0.0' },
				versions: { 'govuk-frontend': ['5.0.0', '6.0.0'] },
				configs: {
					'hmrc-frontend@2.0.0': [{ packageName: 'govuk-frontend', maxVersion: '5.0.0' }],
					'govuk-frontend@5.0.0': []
				}
			})

			expect(result.ok).toBe(false)
			expect(result.changes).toEqual([])
			expect(result.problems.join(' ')).toContain('No stable version of govuk-frontend')
		})

		it('reports a requested version that violates an installed plugin constraint', async () => {
			setupProject({
				dependencies: { '@govuk-prototype-kit/step-by-step': '2.0.0' },
				plugins: [
					{
						packageName: '@govuk-prototype-kit/step-by-step',
						version: '2.0.0',
						config: { pluginDependencies: [{ packageName: 'hmrc-frontend', minVersion: '3.0.0' }] }
					}
				]
			})

			const result = await plan('install', 'hmrc-frontend', { latest: { 'hmrc-frontend': '2.0.0' } })

			expect(result.ok).toBe(false)
			expect(result.problems.join(' ')).toContain('hmrc-frontend 2.0.0 does not satisfy requirements')
		})

		it('reports a read-only dependency', async () => {
			setupProject({ dependencies: { 'govuk-frontend': 'file:../govuk-frontend' } })

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0' },
				configs: { 'hmrc-frontend@2.0.0': ['govuk-frontend'] }
			})

			expect(result.ok).toBe(false)
			expect(result.problems.join(' ')).toContain('govuk-frontend is required by hmrc-frontend but is read-only')
		})

		it('resolves a dependency from its proxy config without fetching an archive', async () => {
			setupProject({})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0', jquery: '3.7.2' },
				configs: { 'hmrc-frontend@2.0.0': ['jquery'] }
			})

			expect(result.ok).toBe(true)
			expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend', 'jquery'])
			expect(registryMock.fetchPluginConfig).not.toHaveBeenCalledWith('jquery', expect.anything())
		})

		it('continues past an installed dependency with no pluginDependencies', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0', dep: '1.0.0' },
				configs: {
					'hmrc-frontend@2.0.0': ['govuk-frontend', 'dep'],
					'dep@1.0.0': []
				}
			})

			expect(result.ok).toBe(true)
			expect(result.changes.map((change) => change.packageName)).toEqual(['dep', 'hmrc-frontend'])
		})

		it('stops at a dependency cycle rather than looping', async () => {
			setupProject({})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0', '@govuk-prototype-kit/step-by-step': '2.0.0' },
				configs: {
					'hmrc-frontend@2.0.0': ['@govuk-prototype-kit/step-by-step'],
					'@govuk-prototype-kit/step-by-step@2.0.0': [{ packageName: 'hmrc-frontend', minVersion: '2.0.0' }]
				}
			})

			expect(result.ok).toBe(true)
			expect(result.changes.map((change) => change.packageName)).toEqual([
				'@govuk-prototype-kit/step-by-step',
				'hmrc-frontend'
			])
		})

		it('treats an unreadable installed config as having no dependencies', async () => {
			setupProject({
				dependencies: {
					'@govuk-prototype-kit/step-by-step': '2.0.0',
					'govuk-frontend': '5.0.0'
				},
				plugins: [
					{ packageName: '@govuk-prototype-kit/step-by-step', version: '2.0.0', config: '{ not valid json' },
					{ packageName: 'govuk-frontend', version: '5.0.0', config: {} }
				]
			})

			const result = await plan('install', 'hmrc-frontend', { latest: { 'hmrc-frontend': '2.0.0' } })

			expect(result.ok).toBe(true)
			expect(result.noop).toBe(false)
			expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
		})

		it('reports invalid dependency declarations as problems instead of throwing', async () => {
			setupProject({})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0' },
				configs: { 'hmrc-frontend@2.0.0': [{ packageName: 'dep', minVersion: '^1.0.0' }] }
			})

			expect(result.ok).toBe(false)
			expect(result.problems.join(' ')).toContain('invalid minVersion')
		})

		it('blocks a read-only target before planning', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': 'file:../hmrc-frontend' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			expect(await plan('update', 'hmrc-frontend')).toEqual({ error: 'hmrc-frontend is read-only.', status: 400 })
		})
	})

	describe('uninstall planning', () => {
		it('removes installed dependents recursively and leaves unrelated packages alone', async () => {
			setupProject({
				dependencies: {
					'hmrc-frontend': '2.0.0',
					'@govuk-prototype-kit/step-by-step': '2.0.0',
					'@govuk-prototype-kit/common-templates': '1.0.0',
					'govuk-frontend': '5.11.2'
				},
				plugins: [
					{
						packageName: 'hmrc-frontend',
						version: '2.0.0',
						config: { pluginDependencies: ['@govuk-prototype-kit/step-by-step', 'govuk-frontend'] }
					},
					{
						packageName: '@govuk-prototype-kit/step-by-step',
						version: '2.0.0',
						config: { pluginDependencies: ['@govuk-prototype-kit/common-templates'] }
					},
					{ packageName: '@govuk-prototype-kit/common-templates', version: '1.0.0', config: {} },
					{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }
				]
			})

			const result = await plan('uninstall', '@govuk-prototype-kit/common-templates')

			expect(result.ok).toBe(true)
			expect(result.changes.map((change) => change.packageName)).toEqual([
				'@govuk-prototype-kit/common-templates',
				'@govuk-prototype-kit/step-by-step',
				'hmrc-frontend'
			])
			expect(getPlugin(result.changes, '@govuk-prototype-kit/common-templates')).toMatchObject({
				action: 'uninstall',
				installedVersion: '1.0.0',
				reason: 'requested'
			})
			expect(getPlugin(result.changes, '@govuk-prototype-kit/step-by-step')).toMatchObject({
				reason: 'dependent',
				requiredBy: ['@govuk-prototype-kit/common-templates']
			})
			expect(getPlugin(result.changes, 'hmrc-frontend')).toMatchObject({
				reason: 'dependent',
				requiredBy: ['@govuk-prototype-kit/step-by-step']
			})
			expect(getPlugin(result.changes, 'govuk-frontend')).toBeUndefined()
		})

		it('blocks removal of a protected or read-only dependent', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '2.0.0', 'govuk-frontend': '5.11.2' },
				plugins: [
					{ packageName: 'hmrc-frontend', version: '2.0.0', config: {} },
					{
						packageName: 'govuk-frontend',
						version: '5.11.2',
						config: { pluginDependencies: ['hmrc-frontend'] }
					}
				]
			})

			const protectedResult = await plan('uninstall', 'hmrc-frontend')

			expect(protectedResult.ok).toBe(false)
			expect(protectedResult.problems.join(' ')).toContain('govuk-frontend is protected')

			setupProject({
				dependencies: { 'hmrc-frontend': '2.0.0', 'local-plugin': 'file:../local-plugin' },
				plugins: [
					{ packageName: 'hmrc-frontend', version: '2.0.0', config: {} },
					{
						packageName: 'local-plugin',
						version: '1.0.0',
						config: { pluginDependencies: ['hmrc-frontend'] }
					}
				]
			})

			const readOnlyResult = await plan('uninstall', 'hmrc-frontend')

			expect(readOnlyResult.ok).toBe(false)
			expect(readOnlyResult.problems.join(' ')).toContain('local-plugin is read-only')
		})

		it('blocks removal of a protected or read-only target', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})

			const protectedResult = await plan('uninstall', 'govuk-frontend')
			expect(protectedResult.ok).toBeUndefined()
			expect(protectedResult.error).toContain('protected')

			setupProject({
				dependencies: { 'hmrc-frontend': 'file:../hmrc-frontend' },
				plugins: [{ packageName: 'hmrc-frontend', version: '2.0.0', config: {} }]
			})

			const readOnlyResult = await plan('uninstall', 'hmrc-frontend')
			expect(readOnlyResult.ok).toBeUndefined()
			expect(readOnlyResult.error).toContain('read-only')
		})

		it('refuses a target whose installed version is not exact', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6', config: {} }]
			})

			expect(await plan('uninstall', 'hmrc-frontend')).toEqual({
				error: 'hmrc-frontend has an installed version that is not exact: 6',
				status: 400
			})
		})

		it('reports a package that is not installed instead of planning a no-op', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '5.11.2' },
				plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
			})

			expect(await plan('uninstall', 'hmrc-frontend')).toEqual({
				error: 'hmrc-frontend is not installed.',
				status: 400
			})
		})
	})
})

describe('runPluginAction', () => {
	let child

	const plan = { action: 'install', changes: [{ packageName: 'hmrc-frontend', version: '7.41.0' }] }

	function finishChild(code = 0) {
		child.exitCode = code
		child.emit('exit', code)
		child.emit('close', code)
	}

	beforeEach(() => {
		child = Object.assign(new EventEmitter(), {
			pid: 4242,
			exitCode: null,
			signalCode: null,
			stdout: new EventEmitter(),
			stderr: new EventEmitter()
		})
		state.spawn = vi.fn(() => child)
		getPaths.mockReturnValue({ project: spawnProjectDir })
	})

	afterEach(() => vi.restoreAllMocks())

	it('runs exact installs with fixed arguments, ignoring unrelated plan properties', async () => {
		const running = runPluginAction({
			...plan,
			changes: [{ ...plan.changes[0], args: ['--registry=https://evil.example'] }],
			flags: ['--ignore-scripts']
		})

		expect(state.spawn).toHaveBeenCalledWith(
			'npm',
			['install', '--no-audit', '--no-fund', '--save-exact', 'hmrc-frontend@7.41.0'],
			expect.objectContaining({ cwd: spawnProjectDir, shell: false })
		)
		expect(state.spawn.mock.calls[0][2]).not.toHaveProperty('detached')

		child.stdout.emit('data', Buffer.from('added 1 package\n'))
		finishChild()

		await expect(running).resolves.toEqual({
			ok: true,
			exitCode: 0,
			stdout: 'added 1 package\n',
			stderr: ''
		})
	})

	it('treats an update plan as an exact install', async () => {
		const running = runPluginAction({
			action: 'update',
			changes: [{ packageName: 'hmrc-frontend', version: '7.42.0' }]
		})

		expect(state.spawn.mock.calls[0][1]).toEqual([
			'install',
			'--no-audit',
			'--no-fund',
			'--save-exact',
			'hmrc-frontend@7.42.0'
		])

		finishChild()
		await running
	})

	it('uninstalls without versions or --save-exact', async () => {
		const running = runPluginAction({
			action: 'uninstall',
			changes: [{ packageName: '@ministryofjustice/frontend', version: 'ignored' }]
		})

		expect(state.spawn.mock.calls[0][1]).toEqual([
			'uninstall',
			'--no-audit',
			'--no-fund',
			'@ministryofjustice/frontend'
		])

		finishChild()
		await running
	})

	it('rejects invalid actions, empty lists and duplicate packages before spawning', async () => {
		for (const [invalid, message] of [
			[{ ...plan, action: 'remove' }, 'Unsupported npm operation: remove'],
			[{ ...plan, changes: [] }, 'A plugin plan must include at least one package'],
			[{ ...plan, changes: 'hmrc-frontend' }, 'A plugin plan must include at least one package'],
			[
				{ ...plan, changes: [plan.changes[0], { ...plan.changes[0], version: '7.42.0' }] },
				'hmrc-frontend appears more than once in the plan'
			]
		]) {
			await expect(runPluginAction(invalid)).rejects.toThrow(message)
		}

		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('rejects command, URL, path or shell input', async () => {
		for (const packageName of [
			'--registry=https://evil.example',
			'-g',
			'../plugin',
			'/tmp/plugin',
			'https://evil.example/plugin',
			'plugin;rm -rf /',
			'plugin && npm publish',
			'@scope',
			'a b'
		]) {
			for (const action of ['install', 'uninstall']) {
				await expect(runPluginAction({ action, changes: [{ packageName, version: '1.0.0' }] })).rejects.toThrow(
					`${packageName} is not a valid package name`
				)
			}
		}

		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('refuses to uninstall protected packages', async () => {
		for (const packageName of knownPlugins.protected) {
			await expect(runPluginAction({ action: 'uninstall', changes: [{ packageName }] })).rejects.toThrow(
				`${packageName} is protected and cannot be uninstalled`
			)
		}

		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('requires exact install versions', async () => {
		for (const version of ['^1.0.0', '~1.0.0', 'latest', '1.0', '1', '', null, 1]) {
			await expect(runPluginAction({ ...plan, changes: [{ ...plan.changes[0], version }] })).rejects.toThrow(
				`hmrc-frontend needs an exact version, got: ${version}`
			)
		}

		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('waits for close so output arriving after exit is included', async () => {
		let resolved = false
		const running = runPluginAction(plan).then((result) => {
			resolved = true
			return result
		})

		child.emit('exit', 0)
		child.stdout.emit('data', Buffer.from('final output\n'))
		child.stderr.emit('data', Buffer.from('final warning\n'))
		await nextTurn()
		expect(resolved).toBe(false)

		child.emit('close', 0)
		await expect(running).resolves.toMatchObject({
			ok: true,
			stdout: 'final output\n',
			stderr: 'final warning\n'
		})
	})

	it('reports non-zero exits', async () => {
		const running = runPluginAction(plan)
		child.stdout.emit('data', Buffer.from('some output'))
		child.stderr.emit('data', Buffer.from('ERROR'))
		finishChild(3)

		await expect(running).resolves.toEqual({
			ok: false,
			exitCode: 3,
			stdout: 'some output',
			stderr: 'ERROR'
		})
	})

	it('reports synchronous and asynchronous spawn errors', async () => {
		state.spawn.mockImplementationOnce(() => {
			throw new Error('nope')
		})
		await expect(runPluginAction(plan)).rejects.toThrow('nope')

		const running = runPluginAction(plan)
		child.emit('error', new Error('could not spawn'))
		await expect(running).rejects.toThrow('Could not run npm: could not spawn')
	})
})
