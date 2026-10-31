import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginProject } from '../../tests/helpers/plugin-project.js'
import { buildPrototype } from '../build.js'
import supervisor from '../dev/supervisor.js'
import { getPaths } from '../paths.js'
import plugins, { CONFIG_FILE } from '../plugins.js'
import { installPlugin, isChangeRunning, uninstallPlugin, updatePlugin } from './change.js'
import { runNpm } from './npm.js'
import { clearRegistryCache, fetchLatestVersion } from './registry.js'

vi.mock('../paths.js', () => ({
	getPaths: vi.fn()
}))

vi.mock('./npm.js', async (importOriginal) => {
	const actual = await importOriginal()

	return {
		...actual,
		runNpm: vi.fn()
	}
})

vi.mock('../build.js', () => ({
	buildPrototype: vi.fn()
}))

vi.mock('../dev/supervisor.js', () => ({
	default: { restartPrototypeServer: vi.fn() }
}))

vi.mock('./registry.js', async (importOriginal) => {
	const actual = await importOriginal()

	return {
		...actual,
		clearRegistryCache: vi.fn(),
		fetchLatestVersion: vi.fn()
	}
})

let clearCache
let dir
let projects = []

function setupProject(options = { dependencies: {} }) {
	const project = createPluginProject(options)
	projects.push(project)
	dir = project.dir
	getPaths.mockReturnValue({ project: dir, app: path.join(dir, 'app') })
	return project
}

function packagePath(packageName) {
	return path.join(dir, 'node_modules', packageName)
}

function writeInstalledPackage(packageName, { version = '2.0.0', config } = {}) {
	const packageDir = packagePath(packageName)

	fs.mkdirSync(packageDir, { recursive: true })
	fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: packageName, version }, null, 2))

	if (config !== undefined) {
		fs.writeFileSync(path.join(packageDir, CONFIG_FILE), JSON.stringify(config, null, 2))
	}
}

describe('manage plugins change', () => {
	beforeEach(() => {
		vi.resetAllMocks()
		clearCache = vi.spyOn(plugins, 'clearCache').mockImplementation(() => {})
		vi.mocked(fetchLatestVersion).mockResolvedValue('2.0.0')
	})

	afterEach(() => {
		for (const project of projects) {
			project.cleanup()
		}
		projects = []
		clearCache.mockRestore()
	})

	describe('installPlugin', () => {
		it('installs the plugin and restarts the prototype', async () => {
			setupProject()
			vi.mocked(runNpm).mockImplementation(async (args) => {
				if (args.includes('new-plugin')) {
					writeInstalledPackage('new-plugin', { config: {} })
				}
				return { ok: true }
			})

			const result = await installPlugin('new-plugin')

			expect(runNpm).toHaveBeenCalledWith(['install', 'new-plugin', '--save-exact'])
			expect(clearCache).toHaveBeenCalledOnce()
			expect(buildPrototype).toHaveBeenCalledOnce()
			expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
			expect(result).toEqual({
				ok: true,
				packages: ['new-plugin']
			})
		})

		it('installs a plugin dependency that is not installed yet', async () => {
			setupProject()
			vi.mocked(runNpm).mockImplementation(async (args) => {
				if (args.includes('new-plugin')) {
					writeInstalledPackage('new-plugin', { config: { pluginDependencies: ['needed-plugin'] } })
				}
				if (args.includes('needed-plugin')) {
					writeInstalledPackage('needed-plugin', { config: {} })
				}
				return { ok: true }
			})

			const result = await installPlugin('new-plugin')

			expect(runNpm).toHaveBeenNthCalledWith(1, ['install', 'new-plugin', '--save-exact'])
			expect(runNpm).toHaveBeenNthCalledWith(2, ['install', 'needed-plugin', '--save-exact'])
			expect(result).toEqual({
				ok: true,
				packages: ['new-plugin', 'needed-plugin']
			})
		})

		it('does not install a dependency that is already installed', async () => {
			setupProject({
				dependencies: { 'needed-plugin': '1.0.0' },
				plugins: [{ packageName: 'needed-plugin', config: {} }]
			})
			vi.mocked(runNpm).mockImplementation(async (args) => {
				if (args.includes('new-plugin')) {
					writeInstalledPackage('new-plugin', { config: { pluginDependencies: ['needed-plugin'] } })
				}
				return { ok: true }
			})

			const result = await installPlugin('new-plugin')

			expect(runNpm).toHaveBeenCalledTimes(1)
			expect(result.packages).toEqual(['new-plugin'])
		})

		it('refuses an invalid package name before running npm', async () => {
			setupProject()

			const result = await installPlugin('new-plugin; rm -rf /')

			expect(result).toEqual({ error: 'Choose a valid npm package name.' })
			expect(runNpm).not.toHaveBeenCalled()
		})

		it('does nothing when the plugin is already installed', async () => {
			setupProject({
				dependencies: { 'new-plugin': '1.0.0' },
				plugins: [{ packageName: 'new-plugin', config: {} }]
			})

			const result = await installPlugin('new-plugin')

			expect(result).toEqual({ noChange: 'new-plugin is already installed.' })
			expect(runNpm).not.toHaveBeenCalled()
			expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		})

		it('reports when the plugin could not be installed', async () => {
			setupProject()
			vi.mocked(runNpm).mockResolvedValue({ ok: false, output: 'npm error something went wrong' })

			const result = await installPlugin('missing-plugin')

			expect(result).toEqual({
				ok: false,
				error: 'The plugin could not be installed.',
				npmOutput: 'npm error something went wrong'
			})
			expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		})

		it('reports when a plugin dependency could not be installed', async () => {
			setupProject()
			vi.mocked(runNpm).mockImplementation(async (args) => {
				if (args.includes('new-plugin')) {
					writeInstalledPackage('new-plugin', { config: { pluginDependencies: ['needed-plugin'] } })
					return { ok: true }
				}
				return { ok: false, output: 'npm error something went wrong' }
			})

			const result = await installPlugin('new-plugin')

			expect(result).toEqual({
				ok: false,
				error: 'The plugin dependencies could not be installed.',
				npmOutput: 'npm error something went wrong'
			})
			expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		})

		it('refuses a second change while one is running', async () => {
			setupProject()
			let finishFirstInstall

			vi.mocked(runNpm).mockImplementation((args) => {
				if (args.includes('first-plugin')) {
					return new Promise((resolve) => {
						finishFirstInstall = resolve
					})
				}
				return Promise.resolve({ ok: true })
			})

			const firstChange = installPlugin('first-plugin')
			const secondChange = await installPlugin('second-plugin')

			expect(secondChange).toEqual({ busy: true })
			expect(runNpm).toHaveBeenCalledTimes(1)
			expect(isChangeRunning()).toBe(true)

			writeInstalledPackage('first-plugin', { config: {} })
			finishFirstInstall({ ok: true })
			await firstChange

			expect(isChangeRunning()).toBe(false)
		})
	})

	describe('uninstallPlugin', () => {
		it('uninstalls the plugin and the plugins that depend on it, then restarts', async () => {
			setupProject({
				dependencies: {
					base: '1.0.0',
					dependent: '1.0.0',
					unrelated: '1.0.0'
				},
				plugins: [
					{ packageName: 'base', config: {} },
					{ packageName: 'dependent', config: { pluginDependencies: ['base'] } },
					{ packageName: 'unrelated', config: {} }
				]
			})

			vi.mocked(runNpm).mockImplementation(async (args) => {
				for (const packageName of args.slice(1)) {
					fs.rmSync(packagePath(packageName), { recursive: true, force: true })
				}
				return { ok: true }
			})

			const result = await uninstallPlugin('base')

			expect(runNpm).toHaveBeenCalledWith(['uninstall', 'base', 'dependent'])
			expect(clearCache).toHaveBeenCalledOnce()
			expect(buildPrototype).toHaveBeenCalledOnce()
			expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
			expect(result).toEqual({
				ok: true,
				packages: ['base', 'dependent']
			})
		})

		it('refuses to uninstall protato before running npm', async () => {
			setupProject({
				dependencies: { protato: 'file:..' },
				plugins: [{ packageName: 'protato', config: {} }]
			})

			const result = await uninstallPlugin('protato')

			expect(result).toEqual({ error: 'protato cannot be uninstalled.' })
			expect(runNpm).not.toHaveBeenCalled()
		})

		it('refuses to uninstall govuk-frontend before running npm', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '6.6.0' },
				plugins: [{ packageName: 'govuk-frontend', version: '6.6.0', config: {} }]
			})

			const result = await uninstallPlugin('govuk-frontend')

			expect(result).toEqual({ error: 'govuk-frontend cannot be uninstalled.' })
			expect(runNpm).not.toHaveBeenCalled()
		})

		it('does nothing when the plugin is not installed', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '1.0.0' },
				plugins: []
			})

			const result = await uninstallPlugin('asset-plugin')

			expect(result).toEqual({ noChange: 'asset-plugin is not installed.' })
			expect(runNpm).not.toHaveBeenCalled()
			expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		})

		it('reports when the plugins could not be uninstalled', async () => {
			setupProject({
				dependencies: { base: '1.0.0' },
				plugins: [{ packageName: 'base', config: {} }]
			})
			vi.mocked(runNpm).mockResolvedValue({ ok: false, output: 'npm error something went wrong' })

			const result = await uninstallPlugin('base')

			expect(result).toEqual({
				ok: false,
				error: 'The plugins could not be uninstalled.',
				npmOutput: 'npm error something went wrong'
			})
			expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		})
	})

	describe('updatePlugin', () => {
		function setupInstalledPlugin({ config = {} } = {}) {
			return setupProject({
				dependencies: { 'asset-plugin': '^1.0.0' },
				plugins: [{ packageName: 'asset-plugin', version: '1.0.0', config }]
			})
		}

		it('installs the latest version, clears caches and restarts the prototype', async () => {
			setupInstalledPlugin()
			vi.mocked(runNpm).mockImplementation(async (args) => {
				if (args.includes('asset-plugin@2.0.0')) {
					writeInstalledPackage('asset-plugin', { version: '2.0.0', config: {} })
				}
				return { ok: true }
			})

			const result = await updatePlugin('asset-plugin')

			expect(runNpm).toHaveBeenCalledWith(['install', 'asset-plugin@2.0.0', '--save-exact'])
			expect(clearRegistryCache).toHaveBeenCalledOnce()
			expect(clearCache).toHaveBeenCalledOnce()
			expect(buildPrototype).toHaveBeenCalledOnce()
			expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
			expect(result).toEqual({
				ok: true,
				updatedPackage: 'asset-plugin',
				installedPackages: []
			})
		})

		it('installs a plugin dependency introduced by the new version', async () => {
			setupInstalledPlugin()
			vi.mocked(runNpm).mockImplementation(async (args) => {
				if (args.includes('asset-plugin@2.0.0')) {
					writeInstalledPackage('asset-plugin', {
						version: '2.0.0',
						config: { pluginDependencies: ['needed-plugin'] }
					})
				}
				if (args.includes('needed-plugin')) {
					writeInstalledPackage('needed-plugin', { config: {} })
				}
				return { ok: true }
			})

			const result = await updatePlugin('asset-plugin')

			expect(runNpm).toHaveBeenNthCalledWith(1, ['install', 'asset-plugin@2.0.0', '--save-exact'])
			expect(runNpm).toHaveBeenNthCalledWith(2, ['install', 'needed-plugin', '--save-exact'])
			expect(result).toEqual({
				ok: true,
				updatedPackage: 'asset-plugin',
				installedPackages: ['needed-plugin']
			})
		})

		it('does not reinstall a dependency that is already installed', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '^1.0.0', 'needed-plugin': '1.0.0' },
				plugins: [
					{ packageName: 'asset-plugin', version: '1.0.0', config: {} },
					{ packageName: 'needed-plugin', version: '1.0.0', config: {} }
				]
			})
			vi.mocked(runNpm).mockImplementation(async (args) => {
				if (args.includes('asset-plugin@2.0.0')) {
					writeInstalledPackage('asset-plugin', {
						version: '2.0.0',
						config: { pluginDependencies: ['needed-plugin'] }
					})
				}
				return { ok: true }
			})

			const result = await updatePlugin('asset-plugin')

			expect(runNpm).toHaveBeenCalledTimes(1)
			expect(result.installedPackages).toEqual([])
		})

		it('reports when the plugin could not be updated', async () => {
			setupInstalledPlugin()
			vi.mocked(runNpm).mockResolvedValue({ ok: false, output: 'npm error something went wrong' })

			const result = await updatePlugin('asset-plugin')

			expect(result).toEqual({
				ok: false,
				error: 'The plugin could not be updated.',
				npmOutput: 'npm error something went wrong'
			})
			expect(clearRegistryCache).not.toHaveBeenCalled()
			expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		})

		it('reports when a new plugin dependency could not be installed', async () => {
			setupInstalledPlugin()
			vi.mocked(runNpm).mockImplementation(async (args) => {
				if (args.includes('asset-plugin@2.0.0')) {
					writeInstalledPackage('asset-plugin', {
						version: '2.0.0',
						config: { pluginDependencies: ['needed-plugin'] }
					})
					return { ok: true }
				}
				return { ok: false, output: 'npm error something went wrong' }
			})

			const result = await updatePlugin('asset-plugin')

			expect(result).toEqual({
				ok: false,
				error: 'The plugin dependencies could not be installed.',
				npmOutput: 'npm error something went wrong'
			})
			expect(clearRegistryCache).not.toHaveBeenCalled()
			expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		})

		it('does nothing when the plugin is already up to date', async () => {
			setupInstalledPlugin()
			vi.mocked(fetchLatestVersion).mockResolvedValue('1.0.0')

			const result = await updatePlugin('asset-plugin')

			expect(result).toEqual({ noChange: 'asset-plugin is already up to date.' })
			expect(runNpm).not.toHaveBeenCalled()
			expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		})

		it('refuses a second change while one is running', async () => {
			setupInstalledPlugin()
			let finishFirstUpdate

			vi.mocked(runNpm).mockImplementation((args) => {
				if (args.includes('asset-plugin@2.0.0')) {
					return new Promise((resolve) => {
						finishFirstUpdate = resolve
					})
				}
				return Promise.resolve({ ok: true })
			})

			const firstChange = updatePlugin('asset-plugin')
			const secondChange = await updatePlugin('other-plugin')

			expect(secondChange).toEqual({ busy: true })
			expect(runNpm).toHaveBeenCalledTimes(1)

			finishFirstUpdate({ ok: true })
			await firstChange
		})
	})
})
