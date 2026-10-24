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

import { createPluginProject } from '../../tests/helpers/plugin-project.js'
import { resetRegistryMock } from '../../tests/helpers/plugin-registry-mock.js'
import { mockProjectPaths } from '../../tests/helpers/project-paths.js'
import { getPaths } from '../paths.js'
import { makePluginPlan } from './make-plan.js'

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

async function plan(action, packageName, registryOptions) {
	resetRegistryMock(registryMock, registryOptions)
	return makePluginPlan(action, packageName)
}

beforeEach(() => {
	vi.clearAllMocks()
	resetRegistryMock(registryMock)
})

afterEach(() => {
	project?.cleanup()
	project = undefined
})

describe('makePluginPlan', () => {
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

		expect(result.plugin.name).toBe('HMRC Frontend')
		expect(result.plugin.publisher).toBeUndefined()
		expect(result.version).toBe('7.41.0')
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

	it('refuses targets the plan cannot act on, with a reason', async () => {
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
		expect(await plan('install', 'govuk-frontend', { latest: { 'govuk-frontend': '5.11.2' } })).toEqual({
			error: 'govuk-frontend is already installed.',
			status: 400
		})
		expect(await plan('update', 'govuk-frontend', { latest: { 'govuk-frontend': '5.11.2' } })).toEqual({
			error: 'There is no newer version of govuk-frontend.',
			status: 400
		})
	})

	it('refuses an update whose installed version is not exact', async () => {
		setupProject({
			dependencies: { 'hmrc-frontend': '^6.0.0' },
			plugins: [{ packageName: 'hmrc-frontend', version: '6', config: {} }]
		})

		const result = await plan('update', 'hmrc-frontend')

		expect(result).toEqual({
			error: 'hmrc-frontend has an installed version that is not exact: 6',
			status: 400
		})
		expect(registryMock.fetchPackageMetadata).not.toHaveBeenCalled()
	})

	it('refuses an update of a plugin that is not installed before calling the registry', async () => {
		setupProject({})

		const result = await plan('update', 'hmrc-frontend', { errors: { 'hmrc-frontend': 'registry unavailable' } })

		expect(result).toEqual({ error: 'hmrc-frontend is not installed.', status: 400 })
		expect(registryMock.fetchPackageMetadata).not.toHaveBeenCalled()
	})

	it('refuses an install of an installed plugin before calling the registry', async () => {
		setupProject({
			dependencies: { 'hmrc-frontend': '6.0.0' },
			plugins: [{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} }]
		})

		const result = await plan('install', 'hmrc-frontend', { errors: { 'hmrc-frontend': 'registry unavailable' } })

		expect(result).toEqual({ error: 'hmrc-frontend is already installed.', status: 400 })
		expect(registryMock.fetchPackageMetadata).not.toHaveBeenCalled()
	})

	it('shows dependency changes', async () => {
		setupProject({})

		const result = await plan('install', 'hmrc-frontend', {
			latest: { 'hmrc-frontend': '7.0.0', 'govuk-frontend': '6.0.0' },
			configs: { 'hmrc-frontend@7.0.0': ['govuk-frontend'] }
		})

		expect(result.changes.map((change) => change.packageName)).toEqual(['govuk-frontend', 'hmrc-frontend'])
		expect(result.changes[0].requiredBy).toEqual([{ packageName: 'hmrc-frontend', name: 'HMRC Frontend' }])
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

		expect(result.problems.length).toBeGreaterThan(0)
		expect(result.problems.every((problem) => typeof problem === 'string')).toBe(true)
	})

	it('reports an unreadable project package.json instead of a missing plugin', async () => {
		setupProject({ files: { 'package.json': '{ not valid json' } })

		const result = await plan('uninstall', 'hmrc-frontend')

		expect(result.status).toBe(500)
		expect(result.error).toContain('Could not read project package.json')
	})

	it('reports a registry failure for a target that cannot be looked up', async () => {
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
		setupProject({ dependencies: { jquery: '^3.7.1' } })

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

		expect(result.problems).toEqual([])
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})

	it('plans an uninstalled package that only has a user proxy config', async () => {
		setupProject({
			files: { 'app/plugin-proxy.json': { 'custom-proxy-plugin': { assets: ['/files'] } } }
		})

		const result = await plan('install', 'custom-proxy-plugin', {
			latest: { 'custom-proxy-plugin': '1.0.0' }
		})

		expect(result.problems).toEqual([])
		expect(result.changes).toEqual([
			expect.objectContaining({ action: 'install', packageName: 'custom-proxy-plugin', version: '1.0.0' })
		])
		expect(registryMock.fetchPluginConfig).not.toHaveBeenCalled()
	})

	describe('dependency planning', () => {
		it('installs the target and a missing dependency at the highest stable version', async () => {
			setupProject({})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0', dep: '1.2.0' },
				versions: { dep: ['1.0.0', '1.2.0'] },
				configs: { 'hmrc-frontend@2.0.0': ['dep'], 'dep@1.2.0': [] }
			})

			expect(result.problems).toEqual([])
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
				requiredBy: [{ packageName: 'hmrc-frontend' }]
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

			expect(result.problems).toEqual([])
			expect(getPlugin(result.changes, 'govuk-frontend')).toMatchObject({
				action: 'update',
				version: '6.1.0',
				installedVersion: '5.0.0',
				reason: 'dependency',
				requiredBy: [{ packageName: 'hmrc-frontend' }]
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

			expect(result.changes).toEqual([])
			expect(result.problems.join(' ')).toContain('No stable version of govuk-frontend')
		})

		it('reports a conflict discovered after a dependency version was chosen', async () => {
			setupProject({})

			const result = await plan('install', 'target', {
				latest: { target: '1.0.0', dep: '2.0.0', other: '1.0.0' },
				versions: { dep: ['1.0.0', '2.0.0'] },
				configs: {
					'target@1.0.0': [{ packageName: 'dep', minVersion: '1.0.0' }, 'other'],
					'other@1.0.0': [{ packageName: 'dep', maxVersion: '1.0.0' }]
				}
			})

			expect(result.changes).toEqual([])
			expect(result.problems.join(' ')).toContain('dep 2.0.0 does not satisfy requirements from other, target')
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

			expect(result.problems.join(' ')).toContain('hmrc-frontend 2.0.0 does not satisfy requirements')
		})

		it('checks a plugin dependency and a peer range separately when the peer range uses ||', async () => {
			setupProject({
				dependencies: {
					'govuk-frontend': '5.11.2',
					'@govuk-prototype-kit/step-by-step': '2.0.0'
				},
				plugins: [
					{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
					{
						packageName: '@govuk-prototype-kit/step-by-step',
						version: '2.0.0',
						config: {
							pluginDependencies: [{ packageName: 'govuk-frontend', minVersion: '4.0.0', maxVersion: '5.99.0' }]
						},
						packageJson: { peerDependencies: { 'govuk-frontend': '^4.0.0 || ^5.0.0 || ^6.0.0' } }
					}
				]
			})

			const result = await plan('update', 'govuk-frontend', {
				latest: { 'govuk-frontend': '6.0.0' },
				versions: { 'govuk-frontend': ['5.11.2', '6.0.0'] }
			})

			expect(result.problems.join(' ')).toContain(
				'does not satisfy requirements from @govuk-prototype-kit/step-by-step'
			)
		})

		it('ignores a peer dependency that is not a plugin', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '2.0.0' },
				plugins: [
					{
						packageName: 'hmrc-frontend',
						version: '2.0.0',
						config: {},
						// lodash is not a plugin here, so this peer must not constrain the plan
						packageJson: { peerDependencies: { lodash: '^2.0.0' } }
					}
				]
			})

			const result = await plan('install', 'other-plugin', {
				latest: { 'other-plugin': '1.0.0', lodash: '3.7.2' },
				versions: { lodash: ['3.7.2'] },
				configs: { 'other-plugin@1.0.0': ['lodash'], 'lodash@3.7.2': [] }
			})

			expect(result.problems).toEqual([])
			expect(result.changes.map((change) => change.packageName)).toEqual(['lodash', 'other-plugin'])
			expect(getPlugin(result.changes, 'lodash').requiredBy.map((entry) => entry.packageName)).toEqual(['other-plugin'])
		})

		it('ignores a blank peer range even when the peer is a plugin', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '2.0.0' },
				plugins: [
					{
						packageName: 'hmrc-frontend',
						version: '2.0.0',
						config: {},
						// semver reads a blank range as *, so it must not be recorded as a
						// requirement and claim to require govuk-frontend
						packageJson: { peerDependencies: { 'govuk-frontend': '' } }
					}
				]
			})

			const result = await plan('install', 'other-plugin', {
				latest: { 'other-plugin': '1.0.0', 'govuk-frontend': '5.11.2' },
				configs: { 'other-plugin@1.0.0': ['govuk-frontend'], 'govuk-frontend@5.11.2': [] }
			})

			expect(result.problems).toEqual([])
			expect(getPlugin(result.changes, 'govuk-frontend').requiredBy.map((entry) => entry.packageName)).toEqual([
				'other-plugin'
			])
		})

		it('reports a read-only dependency', async () => {
			setupProject({ dependencies: { 'govuk-frontend': 'file:../govuk-frontend' } })

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0' },
				configs: { 'hmrc-frontend@2.0.0': ['govuk-frontend'] }
			})

			expect(result.problems.join(' ')).toContain('govuk-frontend is required by hmrc-frontend but is read-only')
		})

		it('resolves a dependency from its proxy config without fetching an archive', async () => {
			setupProject({})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0', jquery: '3.7.2' },
				configs: { 'hmrc-frontend@2.0.0': ['jquery'] }
			})

			expect(result.problems).toEqual([])
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

			expect(result.problems).toEqual([])
			expect(result.changes.map((change) => change.packageName)).toEqual(['dep', 'hmrc-frontend'])
		})

		it('installs transitive dependencies declared by an already-installed dependency', async () => {
			setupProject({
				dependencies: { b: '1.0.0' },
				plugins: [{ packageName: 'b', version: '1.0.0', config: { pluginDependencies: ['a'] } }]
			})

			const result = await plan('install', 'c', {
				latest: { c: '1.0.0', a: '1.0.0' },
				configs: {
					'c@1.0.0': ['b'],
					'a@1.0.0': []
				}
			})

			expect(result.problems).toEqual([])
			expect(result.changes.map((change) => change.packageName)).toEqual(['a', 'c'])
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

			expect(result.problems).toEqual([])
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

			expect(result.problems).toEqual([])
			expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
		})

		it('reports invalid dependency declarations as problems instead of throwing', async () => {
			setupProject({})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0' },
				configs: { 'hmrc-frontend@2.0.0': [{ packageName: 'dep', minVersion: '^1.0.0' }] }
			})

			expect(result.problems.join(' ')).toContain('invalid minVersion')
		})

		it('reports invalid dependency package names as problems instead of throwing', async () => {
			setupProject({})

			const result = await plan('install', 'hmrc-frontend', {
				latest: { 'hmrc-frontend': '2.0.0' },
				configs: { 'hmrc-frontend@2.0.0': [{ packageName: '--registry=https://evil.example' }] }
			})

			expect(result.problems.join(' ')).toContain('had an invalid package name')
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

			expect(result.problems).toEqual([])
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
				requiredBy: [{ packageName: '@govuk-prototype-kit/common-templates' }]
			})
			expect(getPlugin(result.changes, 'hmrc-frontend')).toMatchObject({
				reason: 'dependent',
				requiredBy: [{ packageName: '@govuk-prototype-kit/step-by-step' }]
			})
			expect(getPlugin(result.changes, 'govuk-frontend')).toBeUndefined()
		})

		it('removes installed dependents that depend on the package via peerDependencies', async () => {
			setupProject({
				dependencies: {
					'plugin-a': '1.0.0',
					'plugin-b': '1.0.0',
					'govuk-frontend': '5.11.2'
				},
				plugins: [
					{
						packageName: 'plugin-a',
						version: '1.0.0',
						config: {},
						packageJson: { peerDependencies: { 'plugin-b': '^1.0.0' } }
					},
					{ packageName: 'plugin-b', version: '1.0.0', config: {} },
					{ packageName: 'govuk-frontend', version: '5.11.2', config: {} }
				]
			})

			const result = await plan('uninstall', 'plugin-b')

			expect(result.problems).toEqual([])
			expect(result.changes.map((change) => change.packageName)).toEqual(['plugin-a', 'plugin-b'])
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

			expect(protectedResult.problems).toEqual([
				'govuk-frontend is protected and cannot be uninstalled, so hmrc-frontend cannot be removed.'
			])

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

			expect(readOnlyResult.problems).toEqual([
				'local-plugin is read-only and cannot be uninstalled, so hmrc-frontend cannot be removed.'
			])
		})

		it('ignores invalid versions when deciding which plugins depend on the target', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '2.0.0', 'broken-b': '2.0.0' },
				plugins: [
					{ packageName: 'hmrc-frontend', version: '2.0.0', config: {} },
					{
						packageName: 'broken-b',
						version: '2.0.0',
						config: { pluginDependencies: [{ packageName: 'hmrc-frontend', minVersion: '^2.0.0' }] }
					}
				]
			})

			const result = await plan('uninstall', 'hmrc-frontend')

			expect(result.problems).toEqual([])
			expect(result.changes.map((change) => change.packageName)).toEqual(['broken-b', 'hmrc-frontend'])
		})

		it('uninstalls a package whose own dependency declarations are invalid', async () => {
			setupProject({
				dependencies: { 'broken-a': '2.0.0' },
				plugins: [
					{
						packageName: 'broken-a',
						version: '2.0.0',
						config: {
							pluginDependencies: [
								{ packageName: 'dep', minVersion: '2.0.0', maxVersion: '1.0.0' },
								{ packageName: '--registry=https://evil.example' }
							]
						}
					}
				]
			})

			const result = await plan('uninstall', 'broken-a')

			expect(result.problems).toEqual([])
			expect(result.changes.map((change) => change.packageName)).toEqual(['broken-a'])
		})

		it('uninstalls a declared package that npm has not installed', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '2.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', config: {}, packageJson: { version: undefined } }]
			})

			const result = await plan('uninstall', 'hmrc-frontend')

			expect(result.problems).toEqual([])
			expect(result.changes).toEqual([
				expect.objectContaining({ action: 'uninstall', packageName: 'hmrc-frontend', installedVersion: undefined })
			])
		})

		it('uninstalls a package whose installed version is not exact', async () => {
			setupProject({
				dependencies: { 'hmrc-frontend': '^6.0.0' },
				plugins: [{ packageName: 'hmrc-frontend', version: '6', config: {} }]
			})

			const result = await plan('uninstall', 'hmrc-frontend')

			expect(result.problems).toEqual([])
			expect(result.changes).toEqual([
				expect.objectContaining({ action: 'uninstall', packageName: 'hmrc-frontend', installedVersion: '6' })
			])
		})
	})
})
