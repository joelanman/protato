import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installPlugin, uninstallPlugin, updatePlugin } from '../../lib/manage-plugins/change.js'
import { checkForUpdates, listAvailablePlugins, listInstalledPlugins } from '../../lib/manage-plugins/list.js'
import pluginRoutes from './plugins.js'

vi.mock('../../lib/manage-plugins/change.js', () => ({
	installPlugin: vi.fn(),
	uninstallPlugin: vi.fn(),
	updatePlugin: vi.fn()
}))

vi.mock('../../lib/manage-plugins/list.js', () => ({
	checkForUpdates: vi.fn(),
	listAvailablePlugins: vi.fn(),
	listInstalledPlugins: vi.fn()
}))

const installedPlugins = [
	{
		packageName: 'asset-plugin',
		name: 'Asset Plugin',
		installed: true,
		version: '1.0.0',
		description: 'Adds assets',
		protectedPackage: false
	}
]

const availablePlugins = [
	{
		packageName: 'new-plugin',
		name: 'New Plugin',
		installed: false
	}
]

const readRender = (response) => {
	const separator = response.text.indexOf(' ')

	if (separator === -1) {
		return { view: response.text, model: undefined }
	}

	return {
		view: response.text.slice(0, separator),
		model: JSON.parse(response.text.slice(separator + 1))
	}
}

describe('plugin routes', () => {
	let app

	beforeEach(() => {
		vi.clearAllMocks()

		listInstalledPlugins.mockReturnValue(installedPlugins)
		checkForUpdates.mockImplementation(async (plugins) => plugins)
		listAvailablePlugins.mockReturnValue(availablePlugins)

		app = express()
		app.use(express.urlencoded({ extended: true }))
		app.use((req, res, next) => {
			res.render = (view, model) => res.send(`${view} ${JSON.stringify(model)}`)
			next()
		})
		app.use('/manage-prototype/plugins', pluginRoutes)
	})

	describe('GET /', () => {
		it('renders the installed and available plugins', async () => {
			const response = await request(app).get('/manage-prototype/plugins')

			const { view, model } = readRender(response)
			expect(view).toBe('plugins')
			expect(checkForUpdates).toHaveBeenCalledWith(installedPlugins)
			expect(model).toEqual({
				pageName: 'Plugins',
				installedPlugins,
				availablePlugins,
				availableUpdatesCount: 0
			})
		})

		it('counts the plugins that have updates available', async () => {
			checkForUpdates.mockResolvedValue([
				{ ...installedPlugins[0], updateAvailable: true, latestVersion: '2.0.0' },
				{ ...installedPlugins[0], packageName: 'other-plugin', updateAvailable: false }
			])

			const response = await request(app).get('/manage-prototype/plugins')

			const { model } = readRender(response)
			expect(model).toEqual(expect.objectContaining({ availableUpdatesCount: 1 }))
		})
	})

	describe('removed confirmation routes', () => {
		it('does not have a confirmation page for install', async () => {
			const response = await request(app).get('/manage-prototype/plugins/install?packageName=new-plugin')

			expect(response.status).toBe(404)
		})

		it('does not have a confirmation page for uninstall', async () => {
			const response = await request(app).get('/manage-prototype/plugins/uninstall?packageName=asset-plugin')

			expect(response.status).toBe(404)
		})

		it('does not have a confirmation page for update', async () => {
			const response = await request(app).get('/manage-prototype/plugins/update?packageName=asset-plugin')

			expect(response.status).toBe(404)
		})
	})

	describe('POST /install', () => {
		it('installs the plugin and reports success', async () => {
			installPlugin.mockResolvedValue({
				ok: true,
				packages: ['new-plugin', 'needed-plugin']
			})

			const response = await request(app)
				.post('/manage-prototype/plugins/install')
				.type('form')
				.send({ packageName: 'new-plugin' })

			expect(installPlugin).toHaveBeenCalledWith('new-plugin')
			const { view, model } = readRender(response)
			expect(view).toBe('plugin-result')
			expect(model).toEqual(
				expect.objectContaining({
					outcome: 'installed',
					installedPackages: ['new-plugin', 'needed-plugin']
				})
			)
		})

		it('reports npm failure', async () => {
			installPlugin.mockResolvedValue({
				ok: false,
				error: 'The plugin could not be installed.',
				npmOutput: 'npm error 404 Not Found'
			})

			const response = await request(app)
				.post('/manage-prototype/plugins/install')
				.type('form')
				.send({ packageName: 'missing-plugin' })

			const { model } = readRender(response)
			expect(model).toEqual(
				expect.objectContaining({
					outcome: 'failed',
					message: 'The plugin could not be installed.',
					npmOutput: 'npm error 404 Not Found'
				})
			)
		})

		it('refuses a second change while one is running', async () => {
			installPlugin.mockResolvedValue({ busy: true })

			const response = await request(app)
				.post('/manage-prototype/plugins/install')
				.type('form')
				.send({ packageName: 'new-plugin' })

			const { model } = readRender(response)
			expect(model).toEqual(expect.objectContaining({ outcome: 'busy' }))
		})

		it('shows a server-side refusal', async () => {
			installPlugin.mockResolvedValue({ error: 'Choose a valid npm package name.' })

			const response = await request(app)
				.post('/manage-prototype/plugins/install')
				.type('form')
				.send({ packageName: 'plugin; rm -rf /' })

			const { model } = readRender(response)
			expect(model).toEqual(expect.objectContaining({ outcome: 'failed', message: 'Choose a valid npm package name.' }))
		})

		it('reports that there is nothing to do when already installed', async () => {
			installPlugin.mockResolvedValue({ noChange: 'asset-plugin is already installed.' })

			const response = await request(app)
				.post('/manage-prototype/plugins/install')
				.type('form')
				.send({ packageName: 'asset-plugin' })

			const { model } = readRender(response)
			expect(model).toEqual(expect.objectContaining({ outcome: 'noChange' }))
		})
	})

	describe('POST /uninstall', () => {
		it('uninstalls the plugins and reports success', async () => {
			uninstallPlugin.mockResolvedValue({
				ok: true,
				packages: ['asset-plugin', 'dependent-plugin']
			})

			const response = await request(app)
				.post('/manage-prototype/plugins/uninstall')
				.type('form')
				.send({ packageName: 'asset-plugin' })

			expect(uninstallPlugin).toHaveBeenCalledWith('asset-plugin')
			const { model } = readRender(response)
			expect(model).toEqual(
				expect.objectContaining({
					outcome: 'uninstalled',
					removedPackages: ['asset-plugin', 'dependent-plugin']
				})
			)
		})

		it('shows the refusal for a protected plugin', async () => {
			uninstallPlugin.mockResolvedValue({ error: 'protato cannot be uninstalled.' })

			const response = await request(app)
				.post('/manage-prototype/plugins/uninstall')
				.type('form')
				.send({ packageName: 'protato' })

			const { model } = readRender(response)
			expect(model).toEqual(expect.objectContaining({ outcome: 'failed', message: 'protato cannot be uninstalled.' }))
		})
	})

	describe('POST /update', () => {
		it('updates the plugin and reports success', async () => {
			updatePlugin.mockResolvedValue({
				ok: true,
				updatedPackage: 'asset-plugin',
				installedPackages: ['needed-plugin']
			})

			const response = await request(app)
				.post('/manage-prototype/plugins/update')
				.type('form')
				.send({ packageName: 'asset-plugin' })

			expect(updatePlugin).toHaveBeenCalledWith('asset-plugin')
			const { view, model } = readRender(response)
			expect(view).toBe('plugin-result')
			expect(model).toEqual(
				expect.objectContaining({
					outcome: 'updated',
					updatedPackage: 'asset-plugin',
					installedPackages: ['needed-plugin']
				})
			)
		})

		it('reports that there is nothing to do when already up to date', async () => {
			updatePlugin.mockResolvedValue({ noChange: 'asset-plugin is already up to date.' })

			const response = await request(app)
				.post('/manage-prototype/plugins/update')
				.type('form')
				.send({ packageName: 'asset-plugin' })

			const { model } = readRender(response)
			expect(model).toEqual(
				expect.objectContaining({
					outcome: 'noChange',
					message: 'asset-plugin is already up to date.'
				})
			)
		})

		it('refuses a second change while one is running', async () => {
			updatePlugin.mockResolvedValue({ busy: true })

			const response = await request(app)
				.post('/manage-prototype/plugins/update')
				.type('form')
				.send({ packageName: 'asset-plugin' })

			const { model } = readRender(response)
			expect(model).toEqual(expect.objectContaining({ outcome: 'busy' }))
		})

		it('reports a failed update', async () => {
			updatePlugin.mockResolvedValue({ ok: false, error: 'The plugin could not be updated.' })

			const response = await request(app)
				.post('/manage-prototype/plugins/update')
				.type('form')
				.send({ packageName: 'asset-plugin' })

			const { model } = readRender(response)
			expect(model).toEqual(expect.objectContaining({ outcome: 'failed', message: 'The plugin could not be updated.' }))
		})
	})
})
