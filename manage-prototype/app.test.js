import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installPlugin } from '../lib/manage-plugins/change.js'
import * as registry from '../lib/manage-plugins/registry.js'
import { getManagePrototypeApp } from './app.js'

vi.mock('../lib/config.js', () => ({
	getConfig: () => ({
		env: 'development',
		serviceName: 'Test Service',
		isSecure: false,
		passwords: ['secret']
	})
}))

vi.mock('../lib/manage-plugins/registry.js', () => ({
	getPluginLists: vi.fn(() => ({ installedPlugins: [], availablePlugins: [] })),
	fetchAllPluginData: vi.fn()
}))

vi.mock('../lib/manage-plugins/change.js', () => ({
	installPlugin: vi.fn(),
	uninstallPlugin: vi.fn(),
	updatePlugin: vi.fn()
}))

describe('manage prototype app', () => {
	let app

	// mounted the way the dev server and prototype/app.js mount it
	const createTestApp = async (env = 'development') => {
		const testApp = express()

		testApp.use('/manage-prototype', await getManagePrototypeApp({ env }))

		return testApp
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.mocked(registry.getPluginLists).mockReturnValue({ installedPlugins: [], availablePlugins: [] })
		app = await createTestApp()
	})

	it('renders the manage pages with the service name and development navigation', async () => {
		const response = await request(app).get('/manage-prototype')

		expect(response.status).toBe(200)
		expect(response.text).toContain('Manage your prototype')
		expect(response.text).toContain('Test Service')
		expect(response.text).toContain('href="/manage-prototype/templates"')
		expect(response.text).toContain('href="/manage-prototype/plugins"')
		expect(response.text).toContain('href="/manage-prototype/clear-data"')
	})

	it('gives the pages the manage prototype asset path', async () => {
		const response = await request(app).get('/manage-prototype')

		expect(response.text).toContain('/manage-prototype/public/stylesheets/manage-prototype.css')
		expect(response.text).toContain('/manage-prototype/govuk-frontend/dist/govuk/assets/images/favicon.ico')
	})

	it('serves the manage stylesheet and the govuk frontend script', async () => {
		const stylesheet = await request(app).get('/manage-prototype/public/stylesheets/manage-prototype.css')
		expect(stylesheet.status).toBe(200)

		const script = await request(app).get('/manage-prototype/govuk-frontend/dist/govuk/govuk-frontend.min.js')
		expect(script.status).toBe(200)
	})

	it('mounts the development pages in development', async () => {
		expect((await request(app).get('/manage-prototype/templates')).status).toBe(200)
		expect((await request(app).get('/manage-prototype/plugins')).status).toBe(200)
	})

	it('serves only the pages that need the session in production', async () => {
		const productionApp = await createTestApp('production')

		expect((await request(productionApp).get('/manage-prototype')).status).toBe(404)
		expect((await request(productionApp).get('/manage-prototype/templates')).status).toBe(404)
		expect((await request(productionApp).get('/manage-prototype/plugins')).status).toBe(404)

		const password = await request(productionApp).get('/manage-prototype/password')
		expect(password.status).toBe(200)
		expect(password.text).toContain('This is a prototype used for research')

		const clearData = await request(productionApp).get('/manage-prototype/clear-data')
		expect(clearData.status).toBe(200)
		expect(clearData.text).toContain('Clear session data')
	})

	it('shows the not found page for an unknown page', async () => {
		const response = await request(app).get('/manage-prototype/missing-page')

		expect(response.status).toBe(404)
		expect(response.text).toContain('Page not found')
		expect(response.text).toContain('There is no page at <strong>/manage-prototype/missing-page</strong>')
	})

	it('shows the server error page when a page throws', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.mocked(registry.getPluginLists).mockImplementation(() => {
			throw new Error('registry is down')
		})

		const response = await request(app).get('/manage-prototype/plugins')

		expect(response.status).toBe(500)
		expect(response.text).toContain('There is an error')
		expect(response.text).toContain('registry is down')

		consoleError.mockRestore()
	})

	it('rejects a form without a csrf token', async () => {
		const response = await request(app)
			.post('/manage-prototype/plugins/install')
			.type('form')
			.send({ packageName: 'new-plugin' })

		expect(response.status).toBe(403)
		expect(response.text).toContain('Your form has expired')
		expect(installPlugin).not.toHaveBeenCalled()
	})
})
