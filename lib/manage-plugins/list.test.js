import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { registryMock } = vi.hoisted(() => ({
	registryMock: { fetchPackageMetadata: vi.fn(), fetchPluginConfig: vi.fn() }
}))

vi.mock('../paths.js', () => ({ getPaths: vi.fn() }))
vi.mock('../npm-registry.js', async (importOriginal) => {
	const actual = await importOriginal()

	return {
		...actual,
		fetchPackageMetadata: (...args) => registryMock.fetchPackageMetadata(...args),
		fetchPluginConfig: (...args) => registryMock.fetchPluginConfig(...args)
	}
})

import { createPluginProject, knownPluginsProject } from '../../tests/helpers/plugin-project.js'
import { resetRegistryMock } from '../../tests/helpers/plugin-registry-mock.js'
import { mockProjectPaths } from '../../tests/helpers/project-paths.js'
import { getPaths } from '../paths.js'
import { listPlugins } from './list.js'

let project
let dir

function setupProject(options = {}) {
	project = createPluginProject(options)
	dir = project.dir
	getPaths.mockReturnValue(mockProjectPaths({ projectDir: dir }))
	return project
}

const packagePath = (packageName, ...parts) => path.join(dir, 'node_modules', packageName, ...parts)

async function list(registryOptions) {
	resetRegistryMock(registryMock, registryOptions)
	return listPlugins()
}

function getPlugin({ installed = [], available = [] }, packageName) {
	return [...installed, ...available].find((plugin) => plugin.packageName === packageName)
}

function names(plugins) {
	return plugins.map((plugin) => plugin.packageName)
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
	describe('installed plugins', () => {
		it('lists installed plugins in the order the runtime uses', async () => {
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

			const result = await list()

			expect(result.diagnostics).toEqual([])
			expect(names(result.installed)).toEqual([
				'protato',
				'govuk-frontend',
				'@govuk-prototype-kit/common-templates',
				'hmrc-frontend'
			])

			const protato = getPlugin(result, 'protato')
			expect(protato.installedVersion).toBe('0.1.0')
			expect(protato.pluginDependencies).toBeUndefined()
			expect(protato.protectedPackage).toBe(true)
			expect(protato.readOnly).toBe(true)

			const govukFrontend = getPlugin(result, 'govuk-frontend')
			expect(govukFrontend.name).toBe('GOV.UK Frontend')
			expect(govukFrontend.installedVersion).toBe('5.11.2')
			expect(govukFrontend.protectedPackage).toBe(true)
			expect(govukFrontend.readOnly).toBe(false)
		})

		it('lists installed plugins that are not offered and hides other dependencies', async () => {
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

			const result = await list()
			const unlistedPlugin = getPlugin(result, 'unknown-plugin')

			expect(unlistedPlugin.installedVersion).toBe('1.0.0')
			expect(unlistedPlugin.readOnly).toBe(false)
			expect(getPlugin(result, 'ordinary-dependency')).toBeUndefined()

			// only packages the project declares directly are listed, even when
			// they are installed and have a plugin config
			expect(getPlugin(result, 'transitive-plugin')).toBeUndefined()

			// and an installed plugin that is not offered is not advertised
			expect(names(result.available)).not.toContain('unknown-plugin')
		})

		it('keeps a declared plugin from outside the registry that is not installed yet', async () => {
			setupProject({ dependencies: { 'govuk-frontend': 'file:../govuk-frontend' } })

			const result = await list()

			expect(names(result.installed)).toEqual(['govuk-frontend'])
			expect(getPlugin(result, 'govuk-frontend')).toMatchObject({
				installedVersion: undefined,
				readOnly: true,
				actions: { update: false, uninstall: false }
			})

			// the planner must not replace it with a registry version, so it is
			// never offered for install either
			expect(names(result.available)).not.toContain('govuk-frontend')
		})

		it('shows an installed plugin whose config cannot be read, without dependencies', async () => {
			setupProject({
				dependencies: { 'broken-plugin': '1.0.0' },
				plugins: [{ packageName: 'broken-plugin', version: '1.0.0', config: '{ not valid json' }]
			})

			const brokenPlugin = getPlugin(await list(), 'broken-plugin')

			expect(brokenPlugin.pluginDependencies).toBeUndefined()
			expect(brokenPlugin.diagnostics.join(' ')).toContain(
				'Could not read govuk-prototype-kit.config.json for broken-plugin'
			)
		})

		it('sees file edits on the next read', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			expect(getPlugin(await list(), 'hmrc-frontend').installedVersion).toBe('6.0.0')

			const packageJsonPath = packagePath('hmrc-frontend', 'package.json')
			const installedPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
			installedPackage.version = '6.1.0'
			fs.writeFileSync(packageJsonPath, JSON.stringify(installedPackage))

			expect(getPlugin(await list(), 'hmrc-frontend').installedVersion).toBe('6.1.0')
		})

		describe('diagnostics', () => {
			it('reports a corrupt project package.json and still lists the plugins offered', async () => {
				setupProject({})
				fs.writeFileSync(path.join(dir, 'package.json'), '{ not valid json')

				const { installed, available, diagnostics } = await list()

				expect(diagnostics.some((diagnostic) => diagnostic.includes('Could not read project package.json'))).toBe(true)
				expect(installed).toEqual([])
				expect(names(available)).toContain('govuk-frontend')
			})

			it('reports corrupt installed package metadata', async () => {
				setupProject({
					dependencies: { 'govuk-frontend': '5.11.2' },
					plugins: [{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }]
				})
				fs.writeFileSync(packagePath('govuk-frontend', 'package.json'), '{ not valid json')

				const govukFrontend = getPlugin(await list(), 'govuk-frontend')

				expect(govukFrontend.installedVersion).toBeUndefined()
				expect(govukFrontend.diagnostics.join(' ')).toContain('Could not read package.json for govuk-frontend')
			})

			it('reports an installed version that is not exact', async () => {
				setupProject({
					dependencies: { 'hmrc-frontend': '^6.0.0' },
					plugins: [{ packageName: 'hmrc-frontend', version: '6', config: {} }]
				})

				const hmrcFrontend = getPlugin(await list(), 'hmrc-frontend')

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

				expect(getPlugin(await list(), 'plugin-under-test').readOnly).toBe(readOnly)
			})

			it('reports an invalid dependency declaration and keeps the plugin ineligible', async () => {
				setupProject({
					dependencies: { 'hmrc-frontend': 123 },
					plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
				})

				const hmrcFrontend = getPlugin(await list(), 'hmrc-frontend')

				expect(hmrcFrontend.readOnly).toBe(true)
				expect(hmrcFrontend.diagnostics.join(' ')).toContain('Invalid dependency declaration for hmrc-frontend')
			})
		})
	})

	describe('available plugins', () => {
		it('offers the plugins the kit lists and leaves out the installed ones', async () => {
			setupProject(knownPluginsProject)

			const { available } = await list()

			expect(names(available)).toEqual([
				'@govuk-prototype-kit/common-templates',
				'@govuk-prototype-kit/step-by-step',
				'@ministryofjustice/frontend',
				'jquery',
				'notifications-node-client'
			])
		})

		it('offers declared plugins that npm has not installed yet, proxy plugins included', async () => {
			setupProject({ dependencies: { 'hmrc-frontend': '^6.0.0', jquery: '^3.7.1' } })

			const result = await list({ latest: { 'hmrc-frontend': '7.0.0', jquery: '3.7.1' } })

			// a proxy config only applies once the package is on disk, so an
			// uninstalled proxy plugin is offered like any other
			expect(result.installed).toEqual([])
			expect(getPlugin(result, 'hmrc-frontend')).toMatchObject({ latestVersion: '7.0.0', actions: { install: true } })
			expect(getPlugin(result, 'jquery')).toMatchObject({ latestVersion: '3.7.1', actions: { install: true } })
		})
	})

	describe('latest versions', () => {
		it('turns a failed lookup into a diagnostic on either list', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0', 'notifications-node-client': '^10.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
			})

			const result = await list({
				errors: { 'hmrc-frontend': 'registry unavailable', 'notifications-node-client': 'registry unavailable' }
			})

			for (const packageName of ['hmrc-frontend', 'notifications-node-client']) {
				const plugin = getPlugin(result, packageName)

				expect(plugin.latestVersion).toBeUndefined()
				expect(plugin.actions.install).toBeFalsy()
				expect(plugin.actions.update).toBeFalsy()
				expect(plugin.diagnostics).toEqual([`Could not check for updates for ${packageName}: registry unavailable`])
			}
		})

		it('does not look up read-only plugins', async () => {
			setupProject(knownPluginsProject)

			await list({ latest: { 'local-plugin': '9.0.0' } })

			expect(registryMock.fetchPackageMetadata).not.toHaveBeenCalledWith('local-plugin')
			expect(registryMock.fetchPackageMetadata).not.toHaveBeenCalledWith('protato')
		})
	})

	describe('actions', () => {
		it('offers update and uninstall only where the planner will accept them', async () => {
			setupProject(knownPluginsProject)

			const result = await list({
				latest: {
					'hmrc-frontend': '7.0.0',
					'unknown-plugin': '2.0.0'
				}
			})

			expect(getPlugin(result, 'hmrc-frontend')).toMatchObject({
				latestVersion: '7.0.0',
				actions: { update: true, uninstall: true }
			})
			expect(getPlugin(result, 'govuk-frontend').actions.uninstall).toBe(false)
			expect(getPlugin(result, 'protato').actions).toEqual({ update: false, uninstall: false })
			expect(getPlugin(result, 'local-plugin').actions).toEqual({ update: false, uninstall: false })
			expect(getPlugin(result, 'unknown-plugin').actions).toEqual({ update: true, uninstall: true })
		})

		it('offers no update when the installed version is not exact', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6', config: {} }]
			})

			const { installed } = await list({ latest: { 'hmrc-frontend': '7.0.0' } })

			expect(getPlugin({ installed }, 'hmrc-frontend').actions.update).toBe(false)
		})

		it('offers uninstall when the installed version cannot be read', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', config: {}, packageJson: { version: undefined } }]
			})

			const { installed } = await list({ latest: { 'hmrc-frontend': '7.0.0' } })

			expect(getPlugin({ installed }, 'hmrc-frontend').actions).toEqual({ update: false, uninstall: true })
		})

		it('offers no update when the latest version is already installed', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '7.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '7.0.0', config: {} }]
			})

			const { installed } = await list({ latest: { 'hmrc-frontend': '7.0.0' } })

			expect(getPlugin({ installed }, 'hmrc-frontend').actions).toMatchObject({ update: false, uninstall: true })
		})
	})
})
