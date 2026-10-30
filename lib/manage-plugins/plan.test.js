import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginProject } from '../../tests/helpers/plugin-project.js'
import { getPaths } from '../paths.js'
import { planInstall, planUninstall } from './plan.js'

vi.mock('../paths.js', () => ({
	getPaths: vi.fn()
}))

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

			expect(planInstall('plugin; rm -rf /')).toEqual({ error: 'Choose a valid npm package name.' })
			expect(planInstall('../../etc')).toEqual({ error: 'Choose a valid npm package name.' })
		})

		it('reports no change when the package is already installed', () => {
			setupProject({
				dependencies: { 'asset-plugin': '1.0.0' },
				plugins: [{ packageName: 'asset-plugin', config: {} }]
			})

			expect(planInstall('asset-plugin')).toEqual({ noChange: 'asset-plugin is already installed.' })
		})

		it('allows a valid package name that is not installed', () => {
			setupProject({ dependencies: {} })

			expect(planInstall('new-plugin')).toEqual({ packageName: 'new-plugin' })
		})

		it('allows a known plugin that is in node_modules but not in package.json', () => {
			setupProject({
				dependencies: {},
				plugins: [{ packageName: 'jquery', version: '3.7.1' }]
			})

			expect(planInstall('jquery')).toEqual({ packageName: 'jquery' })
		})
	})

	describe('planUninstall', () => {
		it('refuses an invalid package name', () => {
			setupProject({ dependencies: {} })

			expect(planUninstall('plugin && rm -rf /')).toEqual({ error: 'Choose a valid npm package name.' })
		})

		it('refuses to uninstall protato before checking whether it is installed', () => {
			setupProject({ dependencies: {} })

			expect(planUninstall('protato')).toEqual({ error: 'protato cannot be uninstalled.' })
		})

		it('refuses to uninstall govuk-frontend before checking whether it is installed', () => {
			setupProject({ dependencies: {} })

			expect(planUninstall('govuk-frontend')).toEqual({ error: 'govuk-frontend cannot be uninstalled.' })
		})

		it('reports no change when the plugin is not installed', () => {
			setupProject({
				dependencies: { 'asset-plugin': '1.0.0' },
				plugins: []
			})

			expect(planUninstall('asset-plugin')).toEqual({ noChange: 'asset-plugin is not installed.' })
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

			expect(plan.packages.map((plugin) => plugin.packageName)).toEqual(['base', 'dependent'])
		})
	})
})
