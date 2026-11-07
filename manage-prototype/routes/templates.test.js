import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import plugins from '../../lib/plugins.js'
import { createManagePrototypeApp, errorFromRedirect, readCsrf } from '../../tests/helpers/manage-prototype.js'
import templateRoutes from './templates.js'

const packageName = '@govuk-prototype-kit/common-templates'
const template = { name: 'Start page', path: '/templates/start.html', type: 'nunjucks' }
const templatesByPlugin = [
	{ packageName, name: 'Common Templates', publisher: 'GOV.UK Prototype Kit', templates: [template] }
]
const templateContents = 'start page template'
const invalidPathMessage = "Path must not include !$&'()*+,;=:?#[]@.% or space"

let projectDir
let templateFilePath

vi.mock('../../lib/config.js', () => ({
	getConfig: () => ({ env: 'development', serviceName: 'Test Service', isSecure: false })
}))

// the real manage prototype views come from the package, only the project moves
vi.mock('../../lib/paths.js', async (importOriginal) => {
	const actual = await importOriginal()

	return {
		getPaths: vi.fn((...args) => ({
			...actual.getPaths(...args),
			project: projectDir,
			app: path.join(projectDir, 'app'),
			views: path.join(projectDir, 'app/views')
		}))
	}
})

vi.mock('../../lib/plugins.js', () => ({
	default: {
		getTemplatesByPlugin: vi.fn(),
		getTemplate: vi.fn(),
		getTemplateFilePath: vi.fn()
	}
}))

const createUrl = `/manage-prototype/templates/create?packageName=${encodeURIComponent(packageName)}&templatePath=${encodeURIComponent(template.path)}`

describe('template routes', () => {
	let app

	beforeAll(() => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-manage-templates-'))
		templateFilePath = path.join(projectDir, 'node_modules', packageName, 'templates', 'start.html')

		fs.mkdirSync(path.dirname(templateFilePath), { recursive: true })
		fs.writeFileSync(templateFilePath, templateContents)
	})

	afterAll(() => {
		fs.rmSync(projectDir, { recursive: true, force: true })
	})

	beforeEach(() => {
		vi.clearAllMocks()

		vi.mocked(plugins.getTemplatesByPlugin).mockReturnValue(templatesByPlugin)
		vi.mocked(plugins.getTemplate).mockImplementation((requestedPackageName, requestedPath) =>
			requestedPackageName === packageName && requestedPath === template.path ? template : undefined
		)
		vi.mocked(plugins.getTemplateFilePath).mockImplementation((requestedPackageName, requestedPath) =>
			requestedPackageName === packageName && requestedPath === template.path ? templateFilePath : undefined
		)

		fs.rmSync(path.join(projectDir, 'app'), { recursive: true, force: true })
		app = createManagePrototypeApp(templateRoutes, { mountPath: '/manage-prototype/templates' })
	})

	describe('GET /templates', () => {
		it('lists the templates with links to view and create them', async () => {
			const response = await request(app).get('/manage-prototype/templates')

			expect(response.status).toBe(200)
			expect(response.text).toContain('<h1 class="govuk-heading-l">Templates</h1>')
			expect(response.text).toContain('Common Templates')
			expect(response.text).toContain('From GOV.UK Prototype Kit')
			expect(response.text).toContain('Start page')

			const query = `packageName=${encodeURIComponent(packageName)}&amp;templatePath=${encodeURIComponent(template.path)}`

			expect(response.text).toContain(`href="/manage-prototype/templates/view?${query}"`)
			expect(response.text).toContain(`href="/manage-prototype/templates/create?${query}"`)
		})
	})

	describe('GET /templates/create', () => {
		it('renders the form with a back link and a csrf token', async () => {
			const response = await request(app).get(createUrl)

			expect(response.status).toBe(200)
			expect(response.text).toContain('Create new Start page')
			expect(response.text).toContain('Path for the new page')
			expect(response.text).toContain('href="/manage-prototype/templates"')
			expect(response.text).toContain('name="newPagePath"')
			expect(response.text).toMatch(/name="_csrf" value="[^"]+"/)
		})

		it('shows the error in the form', async () => {
			const response = await request(app).get(createUrl + '&error=' + encodeURIComponent('Enter a path'))

			expect(response.status).toBe(200)
			expect(response.text).toContain('There is a problem')
			expect(response.text).toContain('Enter a path')
		})

		it('shows the not found page when the template does not exist', async () => {
			const response = await request(app).get(
				'/manage-prototype/templates/create?packageName=unknown&templatePath=unknown'
			)

			expect(response.status).toBe(404)
			expect(response.text).toContain('Page not found')
			expect(response.text).toContain('There is no page at <strong>/manage-prototype/templates/create</strong>')
		})
	})

	describe('POST /templates/create', () => {
		const postCreate = async (newPagePath, { withToken = true } = {}) => {
			const formPage = await request(app).get(createUrl)
			const { token, cookie } = readCsrf(formPage)
			const requestBuilder = request(app).post(createUrl)

			if (withToken) {
				requestBuilder.set('Cookie', cookie)
			}

			return requestBuilder.type('form').send({ newPagePath, _csrf: withToken ? token : undefined })
		}

		it('copies the template and redirects to the created page', async () => {
			const response = await postCreate('/my-folder/my-page')

			expect(response.status).toBe(302)
			expect(response.headers.location).toBe('/manage-prototype/templates/created?newPagePath=%2Fmy-folder%2Fmy-page')

			const createdFilePath = path.join(projectDir, 'app/views/my-folder/my-page.html')

			expect(fs.existsSync(createdFilePath)).toBe(true)
			expect(fs.readFileSync(createdFilePath, 'utf8')).toBe(templateContents)
		})

		it('adds a leading slash when the path has none', async () => {
			const response = await postCreate('my-page')

			expect(response.status).toBe(302)
			expect(response.headers.location).toBe('/manage-prototype/templates/created?newPagePath=%2Fmy-page')
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
			expect(fs.existsSync(path.join(projectDir, `app/views${normalised}.html`))).toBe(true)
		})

		it.each([
			{ typed: '', error: 'Enter a path' },
			{ typed: '/', error: 'Enter a path' },
			{ typed: '../evil', error: invalidPathMessage },
			{ typed: '/my page', error: invalidPathMessage }
		])('rejects $typed with an error', async ({ typed, error }) => {
			const response = await postCreate(typed)

			expect(response.status).toBe(302)
			expect(errorFromRedirect(response)).toBe(error)
			expect(fs.existsSync(path.join(projectDir, 'app/views'))).toBe(false)
		})

		it('redirects with an error when the file already exists', async () => {
			const existingFilePath = path.join(projectDir, 'app/views/existing.html')

			fs.mkdirSync(path.dirname(existingFilePath), { recursive: true })
			fs.writeFileSync(existingFilePath, 'existing page')

			const response = await postCreate('/existing')

			expect(errorFromRedirect(response)).toBe('Path already exists')
			expect(fs.readFileSync(existingFilePath, 'utf8')).toBe('existing page')
		})

		it('rejects a form without a csrf token', async () => {
			const response = await postCreate('/no-token', { withToken: false })

			expect(response.status).toBe(403)
			expect(response.text).toContain('Your form has expired')
			expect(fs.existsSync(path.join(projectDir, 'app/views'))).toBe(false)
		})
	})

	describe('GET /templates/created', () => {
		it('shows the url and file path of the new page', async () => {
			const response = await request(app).get('/manage-prototype/templates/created?newPagePath=%2Fmy-page')

			expect(response.status).toBe(200)
			expect(response.text).toContain('Page created')
			expect(response.text).toContain('href="/my-page"')
			expect(response.text).toContain('app/views/my-page.html')
		})

		it('shows the normalised path', async () => {
			const response = await request(app).get('/manage-prototype/templates/created?newPagePath=%2Fmy%2F%2Fpage%2F')

			expect(response.status).toBe(200)
			expect(response.text).toContain('href="/my/page"')
			expect(response.text).toContain('app/views/my/page.html')
		})

		it('returns 400 explaining why the new page path is invalid', async () => {
			const response = await request(app).get('/manage-prototype/templates/created?newPagePath=..%2Fevil')

			expect(response.status).toBe(400)
			expect(response.text).toBe(invalidPathMessage)
		})
	})
})
