import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import getApp from './app.js'

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
	checkAuth: vi.fn((req, res, next) => next())
}))

vi.mock('../manage-prototype/index.js', async () => {
	const { default: express } = await import('express')
	return {
		default: {
			getApp: vi.fn(() => {
				const app = express()
				app.get('/', (req, res) => res.send('manage prototype'))
				return app
			}),
			getDevApp: vi.fn(),
			nunjucks: { configure: vi.fn() }
		}
	}
})

vi.mock('./middleware/session.js', () => ({
	default: {
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
		getAssetPaths: vi.fn(() => []),
		getTmpViewPaths: vi.fn(() => ['/tmp/views']),
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

vi.mock('./middleware/autoRenderView.js', () => ({
	default: vi.fn((req, res) => res.send('auto rendered'))
}))

vi.mock('./middleware/postRedirectGet.js', () => ({
	postRedirectGet: vi.fn((req, res) => res.redirect('/'))
}))

vi.mock('./middleware/errors.js', () => ({
	pageNotFound: vi.fn((req, res) => res.status(404).send('Not Found')),
	errorHandler: vi.fn((err, req, res, next) => res.status(500).send('Error'))
}))

describe('getApp', () => {
	beforeEach(() => {
		vi.clearAllMocks()
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
		expect(app.locals.GOVUKPrototypeKit).toBe(app.locals.protato)
		expect(app.locals.serviceName).toBe('Test Service')
	})

	it('mounts manage prototype app', async () => {
		const app = await getApp()
		const response = await request(app).get('/manage-prototype')

		expect(response.status).toBe(200)
		expect(response.text).toBe('manage prototype')
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
