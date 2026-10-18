import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagePrototypeDevApp } from './dev-app.js'

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

describe('manage prototype dev app', () => {
	let app
	let devApp

	beforeEach(() => {
		app = express()
		app.use(express.urlencoded({ extended: true }))
		app.use((req, res, next) => {
			res.render = (view, model) => res.send(`${view} ${JSON.stringify(model)}`)
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
			expect(response.text).toContain('home')
		})
	})

	describe('GET /plugins', () => {
		it('renders the plugins placeholder page with pageName', async () => {
			const response = await request(app).get('/manage-prototype/plugins')

			expect(response.status).toBe(200)
			expect(response.text).toContain('plugins')
			expect(response.text).toContain('"pageName":"Plugins"')
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
