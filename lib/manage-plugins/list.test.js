import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginProject } from '../../tests/helpers/plugin-project.js'
import { getPaths } from '../paths.js'
import {
	getPackagesToUninstall,
	getPluginDependencyNames,
	listAllPlugins,
	listAvailablePlugins,
	listInstalledPlugins
} from './list.js'

vi.mock('../paths.js', () => ({
	getPaths: vi.fn()
}))

let dir
let projects = []

function setupProject(options) {
	const project = createPluginProject(options)
	projects.push(project)
	dir = project.dir
	getPaths.mockReturnValue({ project: dir, app: path.join(dir, 'app') })
	return project
}

describe('manage plugins list', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		for (const project of projects) {
			project.cleanup()
		}
		projects = []
		vi.restoreAllMocks()
	})

	describe('listInstalledPlugins', () => {
		it('lists installed plugins with their version and description', () => {
			setupProject({
				dependencies: { 'asset-plugin': '1.2.3' },
				plugins: [
					{
						packageName: 'asset-plugin',
						version: '1.2.3',
						packageJson: { description: 'Adds assets to your prototype' },
						config: {}
					}
				]
			})

			expect(listInstalledPlugins()).toEqual([
				{
					packageName: 'asset-plugin',
					name: 'Asset Plugin',
					installed: true,
					version: '1.2.3',
					description: 'Adds assets to your prototype',
					protectedPackage: false
				}
			])
		})

		it('lists a known plugin that is not installed yet', () => {
			setupProject({ dependencies: { 'hmrc-frontend': '7.41.0' } })

			expect(listInstalledPlugins()).toEqual([
				expect.objectContaining({
					packageName: 'hmrc-frontend',
					installed: false,
					protectedPackage: false
				})
			])
		})

		it('lists a proxy plugin that does not ship a config', () => {
			setupProject({
				dependencies: { jquery: '3.7.1' },
				plugins: [
					{
						packageName: 'jquery',
						version: '3.7.1',
						packageJson: {
							description: 'JavaScript library for DOM operations',
							homepage: 'https://jquery.com'
						}
					}
				]
			})

			expect(listInstalledPlugins()).toEqual([
				expect.objectContaining({
					packageName: 'jquery',
					installed: true,
					version: '3.7.1',
					description: 'JavaScript library for DOM operations',
					homepage: 'https://jquery.com'
				})
			])
		})

		it('lists a known plugin that only has a built-in proxy config', () => {
			setupProject({
				dependencies: { 'notifications-node-client': '8.5.0' },
				plugins: [
					{
						packageName: 'notifications-node-client',
						version: '8.5.0',
						packageJson: { description: 'GOV.UK Notify Node.js client' }
					}
				]
			})

			expect(listInstalledPlugins()).toEqual([
				expect.objectContaining({
					packageName: 'notifications-node-client',
					installed: true,
					version: '8.5.0',
					description: 'GOV.UK Notify Node.js client'
				})
			])
		})

		it('leaves out dependencies that are not plugins', () => {
			setupProject({
				dependencies: { 'not-a-plugin': '1.0.0' },
				plugins: [{ packageName: 'not-a-plugin' }]
			})

			expect(listInstalledPlugins()).toEqual([])
		})

		it('warns and treats a plugin with an unreadable package.json as not installed', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({
				dependencies: { 'asset-plugin': '1.0.0' },
				plugins: [{ packageName: 'asset-plugin', config: {} }]
			})
			fs.writeFileSync(path.join(dir, 'node_modules/asset-plugin/package.json'), '{ not valid json')

			expect(listInstalledPlugins()).toEqual([
				expect.objectContaining({
					packageName: 'asset-plugin',
					installed: false
				})
			])
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not read package.json for asset-plugin'))
		})

		it('marks protato and govuk-frontend as protected', () => {
			setupProject({
				dependencies: { protato: 'file:..', 'govuk-frontend': '6.6.0' },
				plugins: [
					{ packageName: 'protato', version: '0.1.0', config: {} },
					{ packageName: 'govuk-frontend', version: '6.6.0', config: {} }
				]
			})

			expect(listInstalledPlugins()).toEqual([
				expect.objectContaining({ packageName: 'govuk-frontend', protectedPackage: true }),
				expect.objectContaining({ packageName: 'protato', protectedPackage: true })
			])
		})
	})

	describe('listAvailablePlugins', () => {
		it('lists known plugins that are not in the project', () => {
			setupProject({
				dependencies: { 'govuk-frontend': '6.0.0' },
				plugins: [{ packageName: 'govuk-frontend', version: '6.0.0', config: {} }]
			})

			const installed = listInstalledPlugins()
			const available = listAvailablePlugins(installed)
			const packageNames = available.map((plugin) => plugin.packageName)

			expect(packageNames).not.toContain('govuk-frontend')
			expect(packageNames).toContain('accessible-autocomplete')
			expect(packageNames).toContain('jquery')
			expect(available[0]).toEqual(
				expect.objectContaining({
					packageName: expect.any(String),
					name: expect.any(String),
					installed: false
				})
			)

			// the registry fills the description in later, in withPluginData
			const jqueryPlugin = available.find((plugin) => plugin.packageName === 'jquery')

			expect(jqueryPlugin.description).toBeUndefined()
		})
	})

	describe('listAllPlugins', () => {
		it('lists the installed plugins and the available plugins together', () => {
			setupProject({
				dependencies: { 'asset-plugin': '1.0.0' },
				plugins: [{ packageName: 'asset-plugin', config: {} }]
			})

			const packageNames = listAllPlugins().map((plugin) => plugin.packageName)

			expect(packageNames).toContain('asset-plugin')
			expect(packageNames).toContain('accessible-autocomplete')
		})
	})

	describe('getPluginDependencyNames', () => {
		it('reads a single dependency string', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: { pluginDependencies: 'dependency' }
					}
				]
			})

			expect(getPluginDependencyNames('plugin')).toEqual(['dependency'])
		})

		it('reads a list of strings and objects', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: {
							pluginDependencies: ['dependency-one', { packageName: 'dependency-two', minVersion: '2.0.0' }]
						}
					}
				]
			})

			expect(getPluginDependencyNames('plugin')).toEqual(['dependency-one', 'dependency-two'])
		})

		it('reads a single dependency object', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: { pluginDependencies: { packageName: 'dependency' } }
					}
				]
			})

			expect(getPluginDependencyNames('plugin')).toEqual(['dependency'])
		})

		it('returns no dependencies when the plugin has none', () => {
			setupProject({
				plugins: [{ packageName: 'plugin', config: {} }]
			})

			expect(getPluginDependencyNames('plugin')).toEqual([])
		})

		it('returns no dependencies when the config cannot be read', () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({
				plugins: [{ packageName: 'plugin', config: '{ not valid json' }]
			})

			expect(getPluginDependencyNames('plugin')).toEqual([])
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('Could not read govuk-prototype-kit.config.json for plugin')
			)
		})
	})

	describe('getPackagesToUninstall', () => {
		it('includes installed plugins that depend on it', () => {
			setupProject({
				dependencies: {
					base: '1.0.0',
					middle: '1.0.0',
					top: '1.0.0',
					unrelated: '1.0.0'
				},
				plugins: [
					{ packageName: 'base', config: {} },
					{ packageName: 'middle', config: { pluginDependencies: ['base'] } },
					{ packageName: 'top', config: { pluginDependencies: ['middle'] } },
					{ packageName: 'unrelated', config: {} }
				]
			})

			const packages = getPackagesToUninstall('base')

			expect(packages.map((plugin) => plugin.packageName)).toEqual(['base', 'middle'])
			expect(packages.map((plugin) => plugin.requested)).toEqual([true, false])
		})
	})
})
