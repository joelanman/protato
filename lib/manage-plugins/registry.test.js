import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginProject } from '../../tests/helpers/plugin-project.js'
import { getPaths } from '../paths.js'
import { listInstalledPlugins } from './list.js'
import {
	clearRegistryCache,
	fetchAllPluginData,
	fetchPluginData,
	getPluginData,
	getPluginLists,
	hasNewVersion,
	isRegistryDependency,
	withPluginData
} from './registry.js'

vi.mock('../paths.js', () => ({
	getPaths: vi.fn()
}))

function registryResponse({ ok = true, status = 200, body = {} } = {}) {
	return {
		ok,
		status,
		json: vi.fn().mockResolvedValue(body)
	}
}

let dir
let projects = []

function setupProject(options) {
	const project = createPluginProject(options)
	projects.push(project)
	dir = project.dir
	getPaths.mockReturnValue({ project: dir, app: path.join(dir, 'app') })
	return project
}

describe('manage plugins registry', () => {
	beforeEach(() => {
		clearRegistryCache()
	})

	afterEach(() => {
		for (const project of projects) {
			project.cleanup()
		}
		projects = []
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	describe('fetchPluginData', () => {
		it('fetches the latest version from the npm registry', async () => {
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0' } }))
			vi.stubGlobal('fetch', fetch)

			const pluginData = await fetchPluginData('asset-plugin')

			expect(pluginData).toEqual({ latestVersion: '2.0.0' })
			expect(fetch).toHaveBeenCalledWith(
				'https://registry.npmjs.org/asset-plugin/latest',
				expect.objectContaining({ signal: expect.any(AbortSignal) })
			)
		})

		it('fetches the description from the npm registry', async () => {
			const fetch = vi
				.fn()
				.mockResolvedValue(registryResponse({ body: { version: '2.0.0', description: '  Adds assets  ' } }))
			vi.stubGlobal('fetch', fetch)

			const pluginData = await fetchPluginData('asset-plugin')

			expect(pluginData).toEqual({ latestVersion: '2.0.0', description: 'Adds assets' })
		})

		it('fetches a scoped package name', async () => {
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { version: '1.0.0' } }))
			vi.stubGlobal('fetch', fetch)

			await fetchPluginData('@govuk-prototype-kit/common-templates')

			expect(fetch).toHaveBeenCalledWith(
				'https://registry.npmjs.org/@govuk-prototype-kit/common-templates/latest',
				expect.any(Object)
			)
		})

		it('uses the registry npm is configured to use', async () => {
			// npm sets this for the processes it starts, and a project may point at
			// a mirror. Read at import time, so the module is loaded again here.
			vi.stubEnv('npm_config_registry', 'https://npm.example.com/')
			vi.resetModules()

			const { clearRegistryCache: clearCache, fetchPluginData: fetchWithMirror } = await import('./registry.js')
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0' } }))
			vi.stubGlobal('fetch', fetch)

			await fetchWithMirror('asset-plugin')

			expect(fetch).toHaveBeenCalledWith('https://npm.example.com/asset-plugin/latest', expect.any(Object))

			clearCache()
		})

		it.each([
			{
				description: 'a non-2xx response',
				response: registryResponse({ ok: false, status: 404 })
			},
			{
				description: 'a response without a version or description',
				response: registryResponse({ body: {} })
			},
			{
				description: 'a response with an invalid version and no description',
				response: registryResponse({ body: { version: 'not-a-version' } })
			}
		])('returns undefined for $description', async ({ response }) => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

			expect(await fetchPluginData('asset-plugin')).toBeUndefined()
		})

		it('returns the description when the response has no valid version', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(registryResponse({ body: { description: 'Adds assets' } })))

			expect(await fetchPluginData('asset-plugin')).toEqual({ description: 'Adds assets' })
		})

		it('returns undefined when the request fails', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

			expect(await fetchPluginData('asset-plugin')).toBeUndefined()
		})

		it('returns undefined when the response is not valid JSON', async () => {
			const response = registryResponse()
			response.json.mockRejectedValue(new SyntaxError('invalid json'))
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

			expect(await fetchPluginData('asset-plugin')).toBeUndefined()
		})

		it('shares one request when two are running at the same time', async () => {
			const fetch = vi.fn().mockReturnValue(new Promise(() => {}))
			vi.stubGlobal('fetch', fetch)

			fetchPluginData('asset-plugin')
			fetchPluginData('asset-plugin')

			expect(fetch).toHaveBeenCalledOnce()
		})
	})

	describe('getPluginData', () => {
		it('has nothing to say about a package that was never asked about', () => {
			expect(getPluginData('asset-plugin')).toBeUndefined()
		})

		it('reports the version and description from the last request', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0', description: 'Adds assets' } }))
			)

			await fetchPluginData('asset-plugin')

			expect(getPluginData('asset-plugin')).toEqual({ latestVersion: '2.0.0', description: 'Adds assets' })
		})

		it('keeps the last known data when a later request fails', async () => {
			const fetch = vi
				.fn()
				.mockResolvedValue(registryResponse({ body: { version: '2.0.0', description: 'Adds assets' } }))
			vi.stubGlobal('fetch', fetch)

			await fetchPluginData('asset-plugin')

			fetch.mockRejectedValue(new Error('offline'))
			await fetchPluginData('asset-plugin')

			expect(getPluginData('asset-plugin')).toEqual({ latestVersion: '2.0.0', description: 'Adds assets' })
		})

		it('forgets everything when the cache is cleared', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0' } })))

			await fetchPluginData('asset-plugin')
			clearRegistryCache()

			expect(getPluginData('asset-plugin')).toBeUndefined()
		})
	})

	describe('withPluginData', () => {
		function setupInstalledPlugin({ dependencyVersion = '^1.0.0', version = '1.0.0' } = {}) {
			setupProject({
				dependencies: { 'asset-plugin': dependencyVersion },
				plugins: [{ packageName: 'asset-plugin', version, config: {} }]
			})
		}

		it('shows an update when the registry has a newer version', async () => {
			setupInstalledPlugin()
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0' } })))

			await fetchPluginData('asset-plugin')

			expect(withPluginData(listInstalledPlugins())).toEqual([
				expect.objectContaining({
					packageName: 'asset-plugin',
					version: '1.0.0',
					latestVersion: '2.0.0',
					updateAvailable: true
				})
			])
		})

		it('fills in a description from the registry when the package has none', async () => {
			setupInstalledPlugin()
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(registryResponse({ body: { version: '1.0.0', description: 'Adds assets' } }))
			)

			await fetchPluginData('asset-plugin')

			expect(withPluginData(listInstalledPlugins())).toEqual([
				expect.objectContaining({
					packageName: 'asset-plugin',
					description: 'Adds assets'
				})
			])
		})

		it('prefers the description the package provides', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '^1.0.0' },
				plugins: [
					{
						packageName: 'asset-plugin',
						version: '1.0.0',
						packageJson: { description: 'The package description' },
						config: {}
					}
				]
			})
			vi.stubGlobal(
				'fetch',
				vi
					.fn()
					.mockResolvedValue(registryResponse({ body: { version: '1.0.0', description: 'The registry description' } }))
			)

			await fetchPluginData('asset-plugin')

			expect(withPluginData(listInstalledPlugins())).toEqual([
				expect.objectContaining({ description: 'The package description' })
			])
		})

		it('adds a registry description to a plugin that is not installed', async () => {
			setupInstalledPlugin()
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(registryResponse({ body: { description: 'Design patterns for HMRC frontends' } }))
			)

			await fetchPluginData('hmrc-frontend')

			const availablePlugin = { packageName: 'hmrc-frontend', name: 'HMRC Frontend', installed: false }

			expect(withPluginData([availablePlugin])).toEqual([
				{
					packageName: 'hmrc-frontend',
					name: 'HMRC Frontend',
					installed: false,
					description: 'Design patterns for HMRC frontends',
					updateAvailable: false
				}
			])
		})

		it.each([
			{ description: 'already up to date', installed: '1.0.0', latest: '1.0.0' },
			{ description: 'ahead of the registry', installed: '2.0.0', latest: '1.0.0' },
			{ description: 'the registry has no answer', installed: '1.0.0', latest: undefined }
		])('does not show an update when $description', async ({ installed, latest }) => {
			setupInstalledPlugin({ version: installed })

			if (latest) {
				vi.stubGlobal('fetch', vi.fn().mockResolvedValue(registryResponse({ body: { version: latest } })))
				await fetchPluginData('asset-plugin')
			}

			const plugins = withPluginData(listInstalledPlugins())

			expect(plugins[0]).toEqual(expect.objectContaining({ updateAvailable: false }))
			expect(plugins[0].latestVersion).toBeUndefined()
		})

		it('does not ask the registry about protato', () => {
			setupProject({
				dependencies: { protato: 'file:..' },
				plugins: [{ packageName: 'protato', version: '0.1.0', config: {} }]
			})
			const fetch = vi.fn()
			vi.stubGlobal('fetch', fetch)

			const plugins = withPluginData(listInstalledPlugins())

			expect(plugins[0]).toEqual(expect.objectContaining({ packageName: 'protato', updateAvailable: false }))
			expect(fetch).not.toHaveBeenCalled()
		})

		it.each(['file:../asset-plugin', 'github:owner/asset-plugin'])(
			'does not ask the registry about a non-registry dependency: %s',
			(dependencyVersion) => {
				setupInstalledPlugin({ dependencyVersion })
				const fetch = vi.fn()
				vi.stubGlobal('fetch', fetch)

				const plugins = withPluginData(listInstalledPlugins())

				expect(plugins[0]).toEqual(expect.objectContaining({ updateAvailable: false }))
				expect(fetch).not.toHaveBeenCalled()
			}
		)

		it('allows govuk-frontend to update while keeping it protected', async () => {
			setupProject({
				dependencies: { 'govuk-frontend': '6.0.0' },
				plugins: [{ packageName: 'govuk-frontend', version: '6.0.0', config: {} }]
			})
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(registryResponse({ body: { version: '6.1.0' } })))

			await fetchPluginData('govuk-frontend')

			expect(withPluginData(listInstalledPlugins())).toEqual([
				expect.objectContaining({
					packageName: 'govuk-frontend',
					protectedPackage: true,
					latestVersion: '6.1.0',
					updateAvailable: true
				})
			])
		})
	})

	describe('getPluginLists', () => {
		it('adds registry data to the installed plugins and lists the available ones', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '^1.0.0' },
				plugins: [{ packageName: 'asset-plugin', version: '1.0.0', config: {} }]
			})
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0', description: 'Adds assets' } }))
			)

			await fetchPluginData('asset-plugin')

			const { installedPlugins, availablePlugins } = getPluginLists()

			expect(installedPlugins).toEqual([
				expect.objectContaining({
					packageName: 'asset-plugin',
					description: 'Adds assets',
					latestVersion: '2.0.0',
					updateAvailable: true
				})
			])

			const hmrcPlugin = availablePlugins.find((plugin) => plugin.packageName === 'hmrc-frontend')

			expect(hmrcPlugin).toEqual(expect.objectContaining({ updateAvailable: false }))
			expect(availablePlugins.map((plugin) => plugin.packageName)).not.toContain('asset-plugin')
		})
	})

	describe('fetchAllPluginData', () => {
		it('fetches data for every plugin the page lists', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '^1.0.0' },
				plugins: [{ packageName: 'asset-plugin', version: '1.0.0', config: {} }]
			})
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0' } }))
			vi.stubGlobal('fetch', fetch)

			await fetchAllPluginData()

			expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/asset-plugin/latest', expect.any(Object))
			expect(getPluginData('asset-plugin')).toEqual({ latestVersion: '2.0.0' })
		})

		it('asks the registry about plugins that are not installed, for their descriptions', async () => {
			setupProject({
				dependencies: { 'asset-plugin': '^1.0.0' },
				plugins: [{ packageName: 'asset-plugin', version: '1.0.0', config: {} }]
			})
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { description: 'Design patterns' } }))
			vi.stubGlobal('fetch', fetch)

			await fetchAllPluginData()

			expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/hmrc-frontend/latest', expect.any(Object))
			expect(getPluginData('hmrc-frontend')).toEqual({ description: 'Design patterns' })
		})

		it('does not ask about plugins the registry cannot answer for', async () => {
			setupProject({
				dependencies: { protato: 'file:..', 'local-plugin': 'file:../local' },
				plugins: [
					{ packageName: 'protato', version: '0.1.0', config: {} },
					{ packageName: 'local-plugin', version: '1.0.0', config: {} }
				]
			})
			const fetch = vi.fn().mockResolvedValue(registryResponse())
			vi.stubGlobal('fetch', fetch)

			await fetchAllPluginData()

			const requestedUrls = fetch.mock.calls.map(([url]) => url)
			expect(requestedUrls).not.toContain('https://registry.npmjs.org/protato/latest')
			expect(requestedUrls).not.toContain('https://registry.npmjs.org/local-plugin/latest')
		})
	})

	describe('hasNewVersion', () => {
		it.each([
			{ installed: '1.0.0', latest: '1.0.1', expected: true },
			{ installed: '1.0.0', latest: '1.1.0', expected: true },
			{ installed: '1.2.0', latest: '1.10.0', expected: true },
			{ installed: '1.0.0', latest: '2.0.0', expected: true },
			{ installed: '1.0.0', latest: '1.0.0', expected: false },
			{ installed: '2.0.0', latest: '1.0.0', expected: false },
			{ installed: '1.0.0', latest: '1.0.0-beta.1', expected: false },
			{ installed: '1.0.0-beta.1', latest: '1.0.0', expected: true },
			{ installed: '1.0.0-beta.1', latest: '1.0.0-beta.2', expected: true },
			{ installed: '1.0.0-beta.2', latest: '1.0.0-beta.10', expected: true }
		])('compares $installed with $latest', ({ installed, latest, expected }) => {
			expect(hasNewVersion(installed, latest)).toBe(expected)
		})

		it.each([
			{ installed: undefined, latest: '2.0.0' },
			{ installed: '1.0.0', latest: undefined },
			{ installed: 'not-a-version', latest: '2.0.0' },
			{ installed: '1.0.0', latest: 'latest' }
		])('returns false for $installed and $latest', ({ installed, latest }) => {
			expect(hasNewVersion(installed, latest)).toBe(false)
		})
	})

	describe('isRegistryDependency', () => {
		it.each([
			'1.2.3',
			'^1.2.3',
			'~1.2.3',
			'>=1.0.0',
			'>1.0.0',
			'<=1.0.0',
			'<1.0.0',
			'=1.0.0',
			'*',
			'1.x',
			'v1.2.3',
			'1.2.3 - 2.0.0'
		])('accepts %s', (version) => {
			expect(isRegistryDependency(version)).toBe(true)
		})

		it.each([
			'file:../plugin',
			'github:owner/repo',
			'git+https://example.com/plugin.git',
			'http://example.com/plugin',
			'link:../plugin',
			'workspace:*',
			'latest',
			'v',
			'version:1',
			'xyz',
			undefined
		])('rejects %s', (version) => {
			expect(isRegistryDependency(version)).toBe(false)
		})

		it.each(['', '   '])('treats %s as any version, like npm does', (version) => {
			expect(isRegistryDependency(version)).toBe(true)
		})
	})
})
