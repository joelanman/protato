import path from 'node:path'
import nunjucks from 'nunjucks'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagePrototypeApp } from '../manage-prototype/app.js'
import getApp from './app.js'
import { getConfig } from './config.js'
import { checkAuth } from './middleware/auth.js'

vi.mock('nunjucks', () => ({
	default: {
		configure: vi.fn(() => ({}))
	}
}))

// Mock all modules at the top level
vi.mock('node:fs', () => ({
	default: {
		existsSync: vi.fn(() => false)
	}
}))

vi.mock('./config.js', () => ({
	getConfig: vi.fn(() => ({
		port: 3000,
		serviceName: 'Test Service',
		env: 'development',
		plugins: {
			'govuk-frontend': { rebrand: false }
		}
	}))
}))

vi.mock('./middleware/auth.js', () => ({
	checkAuth: vi.fn((request, response, next) => next())
}))

vi.mock('../manage-prototype/app.js', async () => {
	const { default: express } = await import('express')
	return {
		getManagePrototypeApp: vi.fn(async () => {
			const app = express()
			app.get('/', (req, res) => res.send('manage prototype'))
			return app
		})
	}
})

vi.mock('../manage-prototype/routes/preview.js', () => ({
	default: (req, res) => res.send('template preview'),
	templatePreviewPath: '/manage-prototype/templates/view'
}))

vi.mock('./middleware/session.js', () => ({
	default: {
		addSessionMiddleware: vi.fn(async () => {}),
		init: vi.fn(),
		autoStoreData: vi.fn((req, res, next) => next())
	}
}))

vi.mock('./paths.js', () => ({
	getPaths: vi.fn(() => ({
		managePrototype: {
			public: '/manage-prototype/public',
			govukFrontend: '/manage-prototype/govuk'
		},
		// app.js adds the project's node_modules as a dev-only view root
		project: '/project',
		public: '/public',
		assets: '/assets',
		views: '/views',
		app: '/app'
	}))
}))

vi.mock('./plugins.js', () => ({
	default: {
		getScriptPaths: vi.fn(() => ['/script1.js', '/script2.js']),
		getStylesheetPaths: vi.fn(() => ['/plugin-assets/plugin/style.css']),
		getAssetPaths: vi.fn(() => []),
		getViewPaths: vi.fn(() => ['/plugin/views']),
		getFilterPaths: vi.fn(() => []),
		getFunctionPaths: vi.fn(() => [])
	}
}))

vi.mock('../index.js', () => ({
	default: {
		init: vi.fn()
	}
}))

vi.mock('./middleware/auto-render-view.js', () => ({
	default: vi.fn((req, res) => res.send('auto rendered'))
}))

vi.mock('./middleware/errors.js', () => ({
	pageNotFound: vi.fn((req, res) => res.status(404).send('Not Found')),
	errorHandler: vi.fn((err, req, res, next) => res.status(500).send('Error'))
}))

describe('getApp', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getConfig).mockReturnValue({
			port: 3000,
			serviceName: 'Test Service',
			env: 'development',
			plugins: { 'govuk-frontend': { rebrand: false } }
		})
	})

	it('creates an Express application', async () => {
		const app = await getApp()
		expect(app).toBeDefined()
		expect(typeof app).toBe('function')
	})

	it('sets up app locals correctly', async () => {
		const app = await getApp()

		expect(app.locals.govukFrontend.assetPath).toBe('/dist/govuk/assets')
		expect(app.locals.protato.isDevelopment).toBe(true)
		expect(app.locals.protato.stylesheets).toEqual(['/plugin-assets/plugin/style.css'])
		expect(app.locals.GOVUKPrototypeKit).toBe(app.locals.protato)
		expect(app.locals.GOVUKPrototypeKit.stylesheets).toEqual(['/plugin-assets/plugin/style.css'])
		expect(app.locals.serviceName).toBe('Test Service')
	})

	it('does not mount manage prototype in development, because the dev server serves it', async () => {
		await getApp()

		expect(getManagePrototypeApp).not.toHaveBeenCalled()
	})

	it('mounts manage prototype in production', async () => {
		vi.mocked(getConfig).mockReturnValue({
			port: 3000,
			serviceName: 'Test Service',
			env: 'production',
			useAuth: true,
			plugins: { 'govuk-frontend': { rebrand: false } }
		})

		const app = await getApp()
		const response = await request(app).get('/manage-prototype')

		expect(getManagePrototypeApp).toHaveBeenCalledOnce()
		expect(getManagePrototypeApp).toHaveBeenCalledWith({ env: 'production' })
		expect(response.status).toBe(200)
		expect(response.text).toBe('manage prototype')
	})

	it('mounts authentication in production when useAuth is on', async () => {
		vi.mocked(getConfig).mockReturnValue({
			port: 3000,
			serviceName: 'Test Service',
			env: 'production',
			useAuth: true,
			plugins: { 'govuk-frontend': { rebrand: false } }
		})

		const app = await getApp()
		await request(app).get('/some-page')

		expect(checkAuth).toHaveBeenCalled()
	})

	it('does not mount authentication when useAuth is off', async () => {
		vi.mocked(getConfig).mockReturnValue({
			port: 3000,
			serviceName: 'Test Service',
			env: 'production',
			useAuth: false,
			plugins: { 'govuk-frontend': { rebrand: false } }
		})

		const app = await getApp()
		await request(app).get('/some-page')

		expect(checkAuth).not.toHaveBeenCalled()
	})

	it('mounts the template preview', async () => {
		const app = await getApp()
		const response = await request(app).get('/manage-prototype/templates/view')

		expect(response.status).toBe(200)
		expect(response.text).toBe('template preview')
	})

	it('searches project views before plugin views, then node_modules', async () => {
		await getApp()

		expect(nunjucks.configure).toHaveBeenCalledWith(
			['/views', '/plugin/views', path.join('/project', 'node_modules')],
			expect.any(Object)
		)
	})

	it('auto-renders views for paths without extensions', async () => {
		const app = await getApp()
		const response = await request(app).get('/some-page')

		expect(response.status).toBe(200)
		expect(response.text).toBe('auto rendered')
	})

	it('redirects POST requests to GET', async () => {
		const app = await getApp()
		const response = await request(app).post('/some-page')

		expect(response.status).toBe(302)
	})

	it('returns 404 for non-matching routes', async () => {
		const app = await getApp()
		const response = await request(app).get('/nonexistent.css')

		expect(response.status).toBe(404)
		expect(response.text).toBe('Not Found')
	})
})
