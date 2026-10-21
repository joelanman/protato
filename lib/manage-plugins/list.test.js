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

function getPlugin(plugins, packageName) {
	return plugins.find((plugin) => plugin.packageName === packageName)
}

async function list(registryOptions) {
	resetRegistryMock(registryMock, registryOptions)
	return listPlugins()
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
