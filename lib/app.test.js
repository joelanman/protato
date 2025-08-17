import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import getApp from './app.js'

// Mock all the external dependencies
vi.mock('node:fs')
vi.mock('../index.js', () => ({
	default: { init: vi.fn() }
}))
vi.mock('../manage-prototype/app.js', () => ({
	getManagePrototypeApp: vi.fn(() => {
		const router = express.Router()
		router.get('/manage-prototype/mock', (req, res) => res.send('mock manage-prototype response'))
		return router
	})
}))
vi.mock('./middleware/auth.js', () => ({
	getAuth: vi.fn(() => (req, res, next) => next())
}))
vi.mock('./middleware/autoRenderView.js', () => ({
	default: vi.fn((req, res, next) => {
		next()
	})
}))
vi.mock('./middleware/errors.js', () => ({
	pageNotFound: vi.fn((req, res, next) => {
		const error = new Error('Mock page not found')
		error.status = 404
		next(error)
	}),
	errorHandler: vi.fn((err, req, res, next) => {
		res.status(err.status || 500)
		res.send(err.message || 'Mock error')
	})
}))
vi.mock('./config.js', () => ({
	getConfig: vi.fn(() => ({
		serviceName: 'Test Service',
		env: 'test'
	}))
}))
vi.mock('./paths.js', () => ({
	getPaths: vi.fn(() => ({
		assets: '/test/assets',
		public: '/test/public',
		views: '/test/views',
		app: '/test/app'
	}))
}))
vi.mock('./plugins.js', () => ({
	default: {
		getScriptPaths: vi.fn(() => []),
		getAssetPaths: vi.fn(() => []),
		getTmpViewPaths: vi.fn(() => []),
		getViewPaths: vi.fn(() => []),
		getFilterPaths: vi.fn(() => []),
		getFunctionPaths: vi.fn(() => [])
	}
}))
vi.mock('./session.js', () => ({
	default: {
		init: vi.fn(),
		autoStoreData: vi.fn((req, res, next) => next())
	}
}))

describe('app', () => {
	let app

	beforeEach(async () => {
		vi.clearAllMocks()
		app = await getApp()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('creates an Express app', async () => {
		expect(app).toBeDefined()
		expect(typeof app.listen).toBe('function')
	})

	it('sets up app locals correctly', async () => {
		expect(app.locals.serviceName).toBe('Test Service')
		expect(app.locals.govukFrontend.assetPath).toBe('/dist/govuk/assets')
		expect(app.locals.protato.scripts).toEqual([])
	})

	it('handles rebrand asset path', async () => {
		const { getConfig } = await import('./config.js')
		getConfig.mockReturnValue({
			serviceName: 'Test Service',
			env: 'test',
			plugins: {
				'govuk-frontend': { rebrand: true }
			}
		})

		const rebrandApp = await getApp()
		expect(rebrandApp.locals.govukFrontend.assetPath).toBe('/dist/govuk/assets/rebrand')
	})

	it('responds to basic requests', async () => {
		const response = await request(app).get('/some-route').expect(404)

		expect(response.text).toContain('Mock page not found')
	})

	it('mounts manage-prototype app', async () => {
		const response = await request(app).get('/manage-prototype/mock').expect(200)

		expect(response.text).toBe('mock manage-prototype response')
	})

	it('enables auth in production', async () => {
		const { getConfig } = await import('./config.js')
		const { getAuth } = await import('./middleware/auth.js')

		getConfig.mockReturnValue({
			serviceName: 'Test Service',
			env: 'production'
		})

		await getApp()
		expect(getAuth).toHaveBeenCalled()
	})

	it('does not enable auth in non-production', async () => {
		const { getAuth } = await import('./middleware/auth.js')

		// Already configured for test env in beforeEach
		expect(getAuth).not.toHaveBeenCalled()
	})
})
