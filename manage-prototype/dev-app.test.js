import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagePrototypeDevApp } from './dev-app.js'

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

vi.mock('../lib/livereload.js', () => ({
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
		app.use(express.urlencoded({ extended: true }))
		app.use((req, res, next) => {
			res.render = (view, model) => res.send(renderToString(view, model))
			next()
		})
		devApp = getManagePrototypeDevApp()
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

		const postCreate = (newPagePath) => request(app).post(createUrl).type('form').send({ newPagePath })

		beforeEach(() => {
			existsSync = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
			vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
			vi.spyOn(fs, 'copyFileSync').mockReturnValue(undefined)
		})

		afterEach(() => {
			vi.mocked(fs.existsSync).mockRestore()
			vi.mocked(fs.mkdirSync).mockRestore()
			vi.mocked(fs.copyFileSync).mockRestore()
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
		it('renders the plugins placeholder page', async () => {
			const response = await request(app).get('/manage-prototype/plugins')

			expect(response.status).toBe(200)
			const { view, model } = readRender(response)
			expect(view).toBe('plugins')
			expect(model).toEqual({ pageName: 'Plugins' })
		})
	})

	describe('GET /livereload', () => {
		it('handles livereload route', async () => {
			const response = await request(app).get('/manage-prototype/livereload')

			expect(response.status).toBe(200)
			expect(response.text).toBe('livereload')
		})
	})
})
