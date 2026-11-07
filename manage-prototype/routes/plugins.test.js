import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installPlugin, uninstallPlugin, updatePlugin } from '../../lib/manage-plugins/change.js'
import * as registry from '../../lib/manage-plugins/registry.js'
import { createManagePrototypeApp, readCsrf } from '../../tests/helpers/manage-prototype.js'
import pluginRoutes from './plugins.js'

vi.mock('../../lib/config.js', () => ({
	getConfig: () => ({ env: 'development', serviceName: 'Test Service', isSecure: false })
}))

vi.mock('../../lib/manage-plugins/change.js', () => ({
	installPlugin: vi.fn(),
	uninstallPlugin: vi.fn(),
	updatePlugin: vi.fn()
}))

vi.mock('../../lib/manage-plugins/registry.js', () => ({
	getPluginLists: vi.fn(),
	fetchAllPluginData: vi.fn()
}))

const installedPlugin = {
	packageName: 'asset-plugin',
	name: 'Asset Plugin',
	installed: true,
	version: '1.0.0',
	description: 'Adds assets',
	protectedPackage: false
}

const availablePlugin = {
	packageName: 'new-plugin',
	name: 'New Plugin',
	installed: false
}

describe('plugin routes', () => {
	let app

	beforeEach(() => {
		vi.clearAllMocks()

		registry.getPluginLists.mockReturnValue({
			installedPlugins: [installedPlugin],
			availablePlugins: [availablePlugin]
		})
		app = createManagePrototypeApp(pluginRoutes, { mountPath: '/manage-prototype/plugins' })
	})

	const readPluginPageHtml = async (plugins) => {
		registry.getPluginLists.mockReturnValue(plugins)

		const response = await request(app).get('/manage-prototype/plugins')

		return response.text
	}

	const postAction = async (action, body, { withToken = true } = {}) => {
		const requestBuilder = request(app).post(`/manage-prototype/plugins/${action}`)

		if (withToken) {
			const formPage = await request(app).get('/manage-prototype/plugins')
			const { token, cookie } = readCsrf(formPage)

			return requestBuilder
				.set('Cookie', cookie)
				.type('form')
				.send({ ...body, _csrf: token })
		}

		return requestBuilder.type('form').send(body)
	}

	describe('GET /plugins', () => {
		it('lists the installed and available plugins with their actions', async () => {
			const response = await request(app).get('/manage-prototype/plugins')

			expect(response.status).toBe(200)
			expect(response.text).toContain('<h1 class="govuk-heading-l">Plugins</h1>')
			expect(response.text).toContain('Installed plugins')
			expect(response.text).toContain('Available plugins')

			expect(response.text).toContain('Asset Plugin')
			expect(response.text).toContain('Version 1.0.0')
			expect(response.text).toContain('Adds assets')
			expect(response.text).toContain('New Plugin')

			expect(response.text).toContain('<form method="post" action="/manage-prototype/plugins/uninstall">')
			expect(response.text).toContain('<form method="post" action="/manage-prototype/plugins/install">')
			expect(response.text).toContain('name="packageName" value="asset-plugin"')
			expect(response.text).toMatch(/name="_csrf" value="[^"]+"/)
		})

		it('says when there are no plugins to list', async () => {
			const html = await readPluginPageHtml({ installedPlugins: [], availablePlugins: [] })

			expect(html).toContain('No plugins are installed.')
			expect(html).toContain('There are no other plugins available.')
		})

		it('shows how many plugins have updates available', async () => {
			const updateAvailable = { ...installedPlugin, updateAvailable: true, latestVersion: '2.0.0' }

			const oneUpdate = await readPluginPageHtml({ installedPlugins: [updateAvailable], availablePlugins: [] })
			expect(oneUpdate).toContain('1 update available')
			expect(oneUpdate).toContain('(version 2.0.0 available)')

			const twoUpdates = await readPluginPageHtml({
				installedPlugins: [updateAvailable, { ...updateAvailable, packageName: 'other-plugin' }],
				availablePlugins: []
			})
			expect(twoUpdates).toContain('2 updates available')
		})

		it('does not check for updates on a page load', async () => {
			await request(app).get('/manage-prototype/plugins')

			expect(registry.fetchAllPluginData).not.toHaveBeenCalled()
		})
	})

	describe('plugin actions', () => {
		it('offers install for a plugin that is not installed', async () => {
			const html = await readPluginPageHtml({ installedPlugins: [], availablePlugins: [availablePlugin] })

			expect(html).toContain('action="/manage-prototype/plugins/install"')
			expect(html).toContain('Install')
			expect(html).not.toContain('action="/manage-prototype/plugins/uninstall"')
		})

		it('offers uninstall for an installed plugin with no update', async () => {
			const html = await readPluginPageHtml({ installedPlugins: [installedPlugin], availablePlugins: [] })

			expect(html).toContain('action="/manage-prototype/plugins/uninstall"')
			expect(html).not.toContain('action="/manage-prototype/plugins/update"')
		})

		it('offers update and uninstall when an update is available', async () => {
			const html = await readPluginPageHtml({
				installedPlugins: [{ ...installedPlugin, updateAvailable: true }],
				availablePlugins: []
			})

			expect(html).toContain('action="/manage-prototype/plugins/update"')
			expect(html).toContain('action="/manage-prototype/plugins/uninstall"')
		})

		it('offers only update for a protected plugin', async () => {
			const html = await readPluginPageHtml({
				installedPlugins: [
					{ ...installedPlugin, packageName: 'govuk-frontend', protectedPackage: true, updateAvailable: true }
				],
				availablePlugins: []
			})

			expect(html).toContain('action="/manage-prototype/plugins/update"')
			expect(html).not.toContain('action="/manage-prototype/plugins/uninstall"')
		})

		it('offers nothing for a protected plugin with no update', async () => {
			const html = await readPluginPageHtml({
				installedPlugins: [{ ...installedPlugin, packageName: 'protato', protectedPackage: true }],
				availablePlugins: []
			})

			expect(html).toContain('Cannot be uninstalled')
			expect(html).not.toContain('action="/manage-prototype/plugins/install"')
			expect(html).not.toContain('action="/manage-prototype/plugins/uninstall"')
			expect(html).not.toContain('action="/manage-prototype/plugins/update"')
		})
	})

	describe('POST /check-for-updates', () => {
		it('checks again, then returns to the plugins page', async () => {
			const response = await postAction('check-for-updates', {})

			expect(registry.fetchAllPluginData).toHaveBeenCalledOnce()
			expect(response.status).toBe(302)
			expect(response.headers.location).toBe('/manage-prototype/plugins')
		})
	})

	describe('POST outcomes', () => {
		it('rejects a form without a csrf token', async () => {
			const response = await postAction('install', { packageName: 'new-plugin' }, { withToken: false })

			expect(response.status).toBe(403)
			expect(response.text).toContain('Your form has expired')
			expect(installPlugin).not.toHaveBeenCalled()
		})

		it('shows the installed packages after an install', async () => {
			installPlugin.mockResolvedValue({ outcome: 'installed', installedPackages: ['new-plugin', 'needed-plugin'] })

			const response = await postAction('install', { packageName: 'new-plugin' })

			expect(installPlugin).toHaveBeenCalledWith('new-plugin')
			expect(response.status).toBe(200)
			expect(response.text).toContain('Plugin installed')
			expect(response.text).toContain('The prototype has restarted with the new plugins.')
			expect(response.text).toContain('Installed')
			expect(response.text).toContain('new-plugin')
			expect(response.text).toContain('needed-plugin')
			expect(response.text).toContain('href="/manage-prototype/plugins"')
		})

		it('shows the npm output when npm fails', async () => {
			installPlugin.mockResolvedValue({
				outcome: 'failed',
				message: 'The plugin could not be installed.',
				npmOutput: 'npm error 404 Not Found'
			})

			const response = await postAction('install', { packageName: 'missing-plugin' })

			expect(response.text).toContain('The plugin could not be changed')
			expect(response.text).toContain('The plugin could not be installed.')
			expect(response.text).toContain('npm output')
			expect(response.text).toContain('npm error 404 Not Found')
		})

		it('shows a message when there is nothing to change', async () => {
			installPlugin.mockResolvedValue({ outcome: 'noChange', message: 'asset-plugin is already installed.' })

			const response = await postAction('install', { packageName: 'asset-plugin' })

			expect(response.text).toContain('No changes needed')
			expect(response.text).toContain('asset-plugin is already installed.')
		})

		it('shows a message when a change is already running', async () => {
			installPlugin.mockResolvedValue({ outcome: 'busy' })

			const response = await postAction('install', { packageName: 'new-plugin' })

			expect(response.text).toContain('Another plugin change is already running. Try again when it has finished.')
		})

		it('shows the removed packages after an uninstall', async () => {
			uninstallPlugin.mockResolvedValue({
				outcome: 'uninstalled',
				removedPackages: ['asset-plugin', 'dependent-plugin']
			})

			const response = await postAction('uninstall', { packageName: 'asset-plugin' })

			expect(uninstallPlugin).toHaveBeenCalledWith('asset-plugin')
			expect(response.text).toContain('Plugins uninstalled')
			expect(response.text).toContain('Uninstalled')
			expect(response.text).toContain('dependent-plugin')
		})

		it('shows the updated package after an update', async () => {
			updatePlugin.mockResolvedValue({
				outcome: 'updated',
				packageName: 'asset-plugin',
				installedPackages: ['needed-plugin']
			})

			const response = await postAction('update', { packageName: 'asset-plugin' })

			expect(updatePlugin).toHaveBeenCalledWith('asset-plugin')
			expect(response.text).toContain('Plugin updated')
			expect(response.text).toContain('The prototype has restarted with the updated plugin.')
			expect(response.text).toContain('Updated')
			expect(response.text).toContain('asset-plugin')
		})
	})
})
