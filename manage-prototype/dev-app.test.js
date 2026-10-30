import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPlugin, uninstallPlugin, updatePlugin } from '../lib/manage-plugins/change.js'
import { checkForUpdates } from '../lib/manage-plugins/list.js'
import { getDevApp } from './dev-app.js'

const { packageName, template, templatesByPlugin, templateFilePath } = vi.hoisted(() => {
	const packageName = '@govuk-prototype-kit/common-templates'
	const template = { name: 'Start page', path: '/templates/start.html', type: 'nunjucks' }

	return {
		packageName,
		template,
		templatesByPlugin: [
			{
				packageName,
				name: 'Common Templates',
				publisher: 'GOV.UK Prototype Kit',
				templates: [template]
			}
		],
		templateFilePath: `/mock/project/node_modules/${packageName}/templates/start.html`
	}
})

const invalidPathMessage = "Path must not include !$&'()*+,;=:?#[]@.% or space"

vi.mock('../lib/config.js', () => ({
	getConfig: vi.fn(() => ({
		env: 'development',
		serviceName: 'Test Service',
		passwords: ['secret']
	}))
}))

vi.mock('../lib/paths.js', () => ({
	getPaths: vi.fn(() => ({
		package: '/mock/package',
		project: '/mock/project',
		app: '/mock/project/app',
		views: '/mock/project/app/views',
		managePrototype: {
			public: '/mock/package/manage-prototype/public',
			govukFrontend: '/mock/package/govuk',
			views: '/mock/package/manage-prototype/views',
			govukFrontendViews: '/mock/package/govuk/dist'
		}
	}))
}))

vi.mock('../lib/plugins.js', async (importOriginal) => {
	const actual = await importOriginal()

	return {
		formatPackageName: actual.formatPackageName,
		default: {
			...actual.default,
			getTemplatesByPlugin: vi.fn(() => templatesByPlugin),
			getTemplate: vi.fn((requestedPackageName, requestedPath) =>
				requestedPackageName === packageName && requestedPath === template.path ? template : undefined
			),
			getTemplateFilePath: vi.fn((requestedPackageName, requestedPath) =>
				requestedPackageName === packageName && requestedPath === template.path ? templateFilePath : undefined
			)
		}
	}
})

vi.mock('../lib/manage-plugins/list.js', () => ({
	checkForUpdates: vi.fn(async (plugins) => plugins),
	listInstalledPlugins: vi.fn(() => []),
	listAvailablePlugins: vi.fn(() => [])
}))

vi.mock('../lib/manage-plugins/change.js', () => ({
	installPlugin: vi.fn(),
	uninstallPlugin: vi.fn(),
	updatePlugin: vi.fn()
}))

vi.mock('../lib/dev/livereload.js', () => ({
	default: {
		getRoute: vi.fn(() => (req, res) => res.send('livereload'))
	}
}))

const { mockNunjucksEnv } = vi.hoisted(() => ({
	mockNunjucksEnv: {
		express: vi.fn(),
		addGlobal: vi.fn(),
		render: vi.fn()
	}
}))

vi.mock('nunjucks', () => ({
	default: {
		configure: vi.fn(() => mockNunjucksEnv)
	}
}))

// both the test app's res.render and the nunjucks mock serialise renders
// the same way, so tests can read back the view and model that were rendered
const renderToString = (view, model) => (model === undefined ? view : `${view} ${JSON.stringify(model)}`)

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

const errorFromRedirect = (response) => new URL(response.headers.location, 'http://localhost').searchParams.get('error')

const createUrl = `/manage-prototype/templates/create?packageName=${encodeURIComponent(packageName)}&templatePath=${encodeURIComponent(template.path)}`

describe('manage prototype dev app', () => {
	let app
	let devApp

	beforeEach(() => {
		vi.clearAllMocks()
		mockNunjucksEnv.render.mockImplementation(renderToString)
		app = express()
		app.use((req, res, next) => {
			res.render = (view, model) => res.send(renderToString(view, model))
			next()
		})
		devApp = getDevApp()
		app.use('/manage-prototype', devApp)
	})

	it('sets serviceName and isDevelopment as nunjucks globals', () => {
		expect(mockNunjucksEnv.addGlobal).toHaveBeenCalledWith('serviceName', 'Test Service')
		expect(mockNunjucksEnv.addGlobal).toHaveBeenCalledWith('isDevelopment', true)
	})

	describe('GET /', () => {
		it('renders the home page', async () => {
			const response = await request(app).get('/manage-prototype')

			expect(response.status).toBe(200)
			expect(readRender(response).view).toBe('home')
		})

		it('sets a CSRF token on pages outside the plugin and template routes', async () => {
			const response = await request(app).get('/manage-prototype')

			expect(response.headers['set-cookie'][0]).toMatch(/^protato\.csrf=/)
		})
	})

	describe('unmatched manage paths', () => {
		let cookie
		let token

		beforeEach(async () => {
			const homePage = await request(app).get('/manage-prototype')
			cookie = homePage.headers['set-cookie'][0].split(';')[0]
			token = cookie.split('=')[1]
		})

		it('renders the not found page rather than falling through', async () => {
			const response = await request(app).get('/manage-prototype/does-not-exist')

			expect(response.status).toBe(404)
			expect(readRender(response).view).toBe('page-not-found.njk')
		})

		it('renders the not found page for a POST instead of proxying it', async () => {
			// the body has already been parsed, so letting this fall through to
			// the proxy would hang the prototype server
			const response = await request(app)
				.post('/manage-prototype/does-not-exist')
				.set('Cookie', cookie)
				.type('form')
				.send({ _csrf: token })

			expect(response.status).toBe(404)
			expect(readRender(response).view).toBe('page-not-found.njk')
		})
	})

	describe('GET /templates', () => {
		it('renders the templates page with the available templates', async () => {
			const response = await request(app).get('/manage-prototype/templates')

			expect(response.status).toBe(200)
			const { view, model } = readRender(response)
			expect(view).toBe('templates/index')
			expect(model).toEqual({ pageName: 'Templates', templatesByPlugin })
		})
	})

	describe('GET /templates/create', () => {
		it('renders the template create page when found', async () => {
			const response = await request(app).get(createUrl)

			expect(response.status).toBe(200)
			const { view, model } = readRender(response)
			expect(view).toBe('templates/create')
			expect(model).toEqual({ pageName: 'Create new Start page' })
		})

		it('renders the not found page when the template is not found', async () => {
			const response = await request(app).get(
				'/manage-prototype/templates/create?packageName=unknown&templatePath=unknown'
			)

			expect(response.status).toBe(404)
			const { view, model } = readRender(response)
			expect(view).toBe('page-not-found.njk')
			expect(model).toEqual(expect.objectContaining({ reason: 'There is no template at unknown.' }))
		})
	})

	describe('POST /templates/create', () => {
		let existsSync
		let cookie
		let token

		const postCreate = (newPagePath) =>
			request(app).post(createUrl).set('Cookie', cookie).type('form').send({ newPagePath, _csrf: token })

		beforeEach(async () => {
			existsSync = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
			vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
			vi.spyOn(fs, 'copyFileSync').mockReturnValue(undefined)

			// the token is in the cookie as well as the form, so read it from
			// the cookie the form page would set
			const formPage = await request(app).get(createUrl)
			cookie = formPage.headers['set-cookie'][0].split(';')[0]
			token = cookie.split('=')[1]
		})

		afterEach(() => {
			vi.mocked(fs.existsSync).mockRestore()
			vi.mocked(fs.mkdirSync).mockRestore()
			vi.mocked(fs.copyFileSync).mockRestore()
		})

		it('rejects a POST without a token', async () => {
			const response = await request(app).post(createUrl).type('form').send({ newPagePath: '/my-page' })

			expect(response.status).toBe(403)
			expect(readRender(response).view).toBe('form-expired.njk')
			expect(fs.copyFileSync).not.toHaveBeenCalled()
		})

		it('copies the template and redirects to the created page', async () => {
			const response = await postCreate('/my-folder/my-page')

			expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('/mock/project/app/views', 'my-folder'), {
				recursive: true
			})
			expect(fs.copyFileSync).toHaveBeenCalledWith(
				templateFilePath,
				path.join('/mock/project/app/views', 'my-folder', 'my-page.html')
			)
			expect(response.status).toBe(302)
			expect(response.headers.location).toBe('/manage-prototype/templates/created?newPagePath=%2Fmy-folder%2Fmy-page')
		})

		it('adds a leading slash when the path has none', async () => {
			const response = await postCreate('my-page')

			expect(response.status).toBe(302)
			expect(response.headers.location).toBe('/manage-prototype/templates/created?newPagePath=%2Fmy-page')
		})

		it('redirects with an error when the path is empty', async () => {
			const response = await postCreate('')

			expect(errorFromRedirect(response)).toBe('Enter a path')
			expect(fs.copyFileSync).not.toHaveBeenCalled()
		})

		it.each([
			{ typed: '/my-page/', normalised: '/my-page' },
			{ typed: '/my//page', normalised: '/my/page' },
			{ typed: '//my-page', normalised: '/my-page' }
		])('normalises $typed to $normalised', async ({ typed, normalised }) => {
			const response = await postCreate(typed)

			expect(response.headers.location).toBe(
				`/manage-prototype/templates/created?newPagePath=${encodeURIComponent(normalised)}`
			)
			expect(fs.copyFileSync).toHaveBeenCalledWith(
				templateFilePath,
				path.join('/mock/project/app/views', `${normalised}.html`)
			)
		})

		it.each([
			{ typed: '/', error: 'Enter a path' },
			{ typed: '../evil', error: invalidPathMessage },
			{ typed: '/my page', error: invalidPathMessage }
		])('rejects $typed with an error', async ({ typed, error }) => {
			const response = await postCreate(typed)

			expect(errorFromRedirect(response)).toBe(error)
			expect(fs.copyFileSync).not.toHaveBeenCalled()
		})

		it('redirects with an error when the file already exists', async () => {
			existsSync.mockReturnValue(true)

			const response = await postCreate('/existing')

			expect(errorFromRedirect(response)).toBe('Path already exists')
			expect(fs.copyFileSync).not.toHaveBeenCalled()
		})
	})

	describe('GET /templates/created', () => {
		it('renders the confirmation page with the url and file path', async () => {
			const response = await request(app).get('/manage-prototype/templates/created?newPagePath=%2Fmy-page')

			expect(response.status).toBe(200)
			const { view, model } = readRender(response)
			expect(view).toBe('templates/created')
			expect(model).toEqual({
				pageName: 'Page created',
				newPagePath: '/my-page',
				filePath: 'app/views/my-page.html'
			})
		})

		it('renders the normalised path and file path', async () => {
			const response = await request(app).get('/manage-prototype/templates/created?newPagePath=%2Fmy%2F%2Fpage%2F')

			const { model } = readRender(response)
			expect(model).toEqual(
				expect.objectContaining({
					newPagePath: '/my/page',
					filePath: 'app/views/my/page.html'
				})
			)
		})

		it('returns 400 explaining why the new page path is invalid', async () => {
			const response = await request(app).get('/manage-prototype/templates/created?newPagePath=..%2Fevil')

			expect(response.status).toBe(400)
			expect(response.text).toBe(invalidPathMessage)
		})
	})

	describe('GET /plugins', () => {
		it('renders the plugins page', async () => {
			const response = await request(app).get('/manage-prototype/plugins')

			expect(response.status).toBe(200)
			const { view, model } = readRender(response)
			expect(view).toBe('plugins')
			expect(model).toEqual({
				pageName: 'Plugins',
				installedPlugins: [],
				availablePlugins: [],
				availableUpdatesCount: 0
			})
		})

		it('reports how many plugin updates are available', async () => {
			vi.mocked(checkForUpdates).mockResolvedValueOnce([
				{
					packageName: 'asset-plugin',
					name: 'Asset Plugin',
					installed: true,
					version: '1.0.0',
					latestVersion: '2.0.0',
					updateAvailable: true
				}
			])

			const response = await request(app).get('/manage-prototype/plugins')

			expect(readRender(response).model).toEqual(expect.objectContaining({ availableUpdatesCount: 1 }))
		})
	})

	describe('POST /plugins', () => {
		let cookie
		let token

		beforeEach(async () => {
			vi.mocked(installPlugin).mockResolvedValue({ packages: ['new-plugin'] })
			vi.mocked(uninstallPlugin).mockResolvedValue({ packages: ['asset-plugin'] })
			vi.mocked(updatePlugin).mockResolvedValue({
				updatedPackage: 'asset-plugin',
				installedPackages: ['needed-plugin']
			})

			const pluginsPage = await request(app).get('/manage-prototype/plugins')
			cookie = pluginsPage.headers['set-cookie'][0].split(';')[0]
			token = cookie.split('=')[1]
		})

		const postPlugin = (action, requestBody) =>
			request(app)
				.post(`/manage-prototype/plugins/${action}`)
				.set('Cookie', cookie)
				.type('form')
				.send({ ...requestBody, _csrf: token })

		it('installs the plugin when the token is valid', async () => {
			const response = await postPlugin('install', { packageName: 'new-plugin' })

			expect(installPlugin).toHaveBeenCalledWith('new-plugin')
			expect(readRender(response).model).toEqual(
				expect.objectContaining({ outcome: 'installed', installedPackages: ['new-plugin'] })
			)
		})

		it('uninstalls the plugin when the token is valid', async () => {
			const response = await postPlugin('uninstall', { packageName: 'asset-plugin' })

			expect(uninstallPlugin).toHaveBeenCalledWith('asset-plugin')
			expect(readRender(response).model).toEqual(
				expect.objectContaining({ outcome: 'uninstalled', removedPackages: ['asset-plugin'] })
			)
		})

		it('updates the plugin when the token is valid', async () => {
			const response = await postPlugin('update', { packageName: 'asset-plugin' })

			expect(updatePlugin).toHaveBeenCalledWith('asset-plugin')
			expect(readRender(response).model).toEqual(
				expect.objectContaining({
					outcome: 'updated',
					updatedPackage: 'asset-plugin',
					installedPackages: ['needed-plugin']
				})
			)
		})

		it('rejects a change without a token', async () => {
			const response = await request(app)
				.post('/manage-prototype/plugins/install')
				.set('Cookie', cookie)
				.type('form')
				.send({ packageName: 'new-plugin' })

			expect(response.status).toBe(403)
			expect(installPlugin).not.toHaveBeenCalled()
		})

		it('rejects an update without a token', async () => {
			const response = await request(app)
				.post('/manage-prototype/plugins/update')
				.set('Cookie', cookie)
				.type('form')
				.send({ packageName: 'asset-plugin' })

			expect(response.status).toBe(403)
			expect(updatePlugin).not.toHaveBeenCalled()
		})
	})

	describe('GET /livereload', () => {
		it('handles livereload route', async () => {
			const response = await request(app).get('/manage-prototype/livereload')

			expect(response.status).toBe(200)
			expect(response.text).toBe('livereload')
		})

		it('does not generate a CSRF token for the event stream', async () => {
			const response = await request(app).get('/manage-prototype/livereload')

			expect(response.headers['set-cookie']).toBeUndefined()
		})
	})
})
