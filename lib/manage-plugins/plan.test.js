import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginProject } from '../../tests/helpers/plugin-project.js'
import { getPaths } from '../paths.js'
import { planInstall, planUninstall, planUpdate } from './plan.js'
import { fetchPluginData } from './registry.js'

vi.mock('../paths.js', () => ({
	getPaths: vi.fn()
}))

vi.mock('./registry.js', async (importOriginal) => {
	const actual = await importOriginal()

	return {
		...actual,
		fetchPluginData: vi.fn()
	}
})

let projects = []

function setupProject(options) {
	const project = createPluginProject(options)
	projects.push(project)
	getPaths.mockReturnValue({ project: project.dir, app: path.join(project.dir, 'app') })
	return project
}

describe('manage plugins plan', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		for (const project of projects) {
			project.cleanup()
		}
		projects = []
	})

	describe('planInstall', () => {
		it('refuses an invalid package name', () => {
			setupProject({ dependencies: {} })

			expect(planInstall('plugin; rm -rf /')).toEqual({
				outcome: 'failed',
				message: 'Choose a valid npm package name.'
			})
			expect(planInstall('../../etc')).toEqual({ outcome: 'failed', message: 'Choose a valid npm package name.' })
		})

		it('reports no change when the package is already installed', () => {
			setupProject({
				dependencies: { 'asset-plugin': '1.0.0' },
				plugins: [{ packageName: 'asset-plugin', config: {} }]
			})

			expect(planInstall('asset-plugin')).toEqual({
				outcome: 'noChange',
				message: 'asset-plugin is already installed.'
			})
		})

		it('allows a valid package name that is not installed', () => {
			setupProject({ dependencies: {} })

			expect(planInstall('new-plugin')).toEqual({ outcome: 'ok', packageName: 'new-plugin' })
		})

		it('allows a known plugin that is in node_modules but not in package.json', () => {
			setupProject({
				dependencies: {},
				plugins: [{ packageName: 'jquery', version: '3.7.1' }]
			})

			expect(planInstall('jquery')).toEqual({ outcome: 'ok', packageName: 'jquery' })
		})
	})

	describe('planUninstall', () => {
		it('refuses an invalid package name', () => {
			setupProject({ dependencies: {} })

			expect(planUninstall('plugin && rm -rf /')).toEqual({
				outcome: 'failed',
				message: 'Choose a valid npm package name.'
			})
		})

		it('refuses to uninstall protato before checking whether it is installed', () => {
			setupProject({ dependencies: {} })

			expect(planUninstall('protato')).toEqual({ outcome: 'failed', message: 'protato cannot be uninstalled.' })
		})

		it('refuses to uninstall govuk-frontend before checking whether it is installed', () => {
			setupProject({ dependencies: {} })

			expect(planUninstall('govuk-frontend')).toEqual({
				outcome: 'failed',
				message: 'govuk-frontend cannot be uninstalled.'
			})
		})

		it('reports no change when the plugin is not installed', () => {
			setupProject({
				dependencies: { 'asset-plugin': '1.0.0' },
				plugins: []
			})

			expect(planUninstall('asset-plugin')).toEqual({ outcome: 'noChange', message: 'asset-plugin is not installed.' })
		})

		it('lists the plugin and the installed plugins that depend on it', () => {
			setupProject({
				dependencies: { base: '1.0.0', dependent: '1.0.0' },
				plugins: [
					{ packageName: 'base', config: {} },
					{ packageName: 'dependent', config: { pluginDependencies: ['base'] } }
				]
			})

			const plan = planUninstall('base')

			expect(plan).toEqual({ outcome: 'ok', packageNames: ['base', 'dependent'] })
		})
	})

	describe('planUpdate', () => {
		it('refuses an invalid package name', async () => {
			setupProject({ dependencies: {} })

			expect(await planUpdate('plugin; rm -rf /')).toEqual({
				outcome: 'failed',
				message: 'Choose a valid npm package name.'
			})
			expect(fetchPluginData).not.toHaveBeenCalled()
		})

		it('refuses to update protato', async () => {
			setupProject({
				dependencies: { protato: 'file:..' },
				plugins: [{ packageName: 'protato', config: {} }]
			})

			expect(await planUpdate('protato')).toEqual({ outcome: 'failed', message: 'protato cannot be updated.' })
			expect(fetchPluginData).not.toHaveBeenCalled()
		})

		it.each(['file:../asset-plugin', 'github:owner/asset-plugin'])(
			'refuses a non-registry dependency: %s',
			async (dependencyVersion) => {
				setupProject({
					dependencies: { 'asset-plugin': dependencyVersion },
					plugins: [{ packageName: 'asset-plugin', config: {} }]
				})

				expect(await planUpdate('asset-plugin')).toEqual({
					outcome: 'failed',
					message: 'asset-plugin cannot be updated.'
				})
				expect(fetchPluginData).not.toHaveBeenCalled()
			}
		)

		it('reports no change when the plugin is not installed', async () => {
			setupProject({ dependencies: { 'asset-plugin': '^1.0.0' } })

			expect(await planUpdate('asset-plugin')).toEqual({
				outcome: 'noChange',
				message: 'asset-plugin is not installed.'
			})
			expect(fetchPluginData).not.toHaveBeenCalled()
		})

		it('reports no change when the plugin is installed but not in package.json', async () => {
			setupProject({
				dependencies: {},
				plugins: [{ packageName: 'asset-plugin', config: {} }]
			})

			expect(await planUpdate('asset-plugin')).toEqual({
				outcome: 'noChange',
				message: 'asset-plugin is not installed.'
			})
		})

		it('reports no change when the plugin is already up to date', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '^1.0.0' },
				plugins: [{ packageName: 'asset-plugin', version: '1.0.0', config: {} }]
			})
			vi.mocked(fetchPluginData).mockResolvedValue({ latestVersion: '1.0.0' })

			expect(await planUpdate('asset-plugin')).toEqual({
				outcome: 'noChange',
				message: 'asset-plugin is already up to date.'
			})
		})

		it('reports an error when the registry cannot be reached', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '^1.0.0' },
				plugins: [{ packageName: 'asset-plugin', version: '1.0.0', config: {} }]
			})
			vi.mocked(fetchPluginData).mockResolvedValue(undefined)

			expect(await planUpdate('asset-plugin')).toEqual({
				outcome: 'failed',
				message: 'The plugin could not be updated.'
			})
		})

		it('returns the latest version when an update is available', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '^1.0.0' },
				plugins: [{ packageName: 'asset-plugin', version: '1.0.0', config: {} }]
			})
			vi.mocked(fetchPluginData).mockResolvedValue({ latestVersion: '2.0.0' })

			expect(await planUpdate('asset-plugin')).toEqual({ outcome: 'ok', packageName: 'asset-plugin', version: '2.0.0' })
			expect(fetchPluginData).toHaveBeenCalledWith('asset-plugin')
		})
	})
})
