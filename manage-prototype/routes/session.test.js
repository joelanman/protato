import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sessionRoutes from './session.js'

vi.mock('../../lib/config.js', () => ({
	getConfig: vi.fn(() => ({ passwords: ['secret'] }))
}))

describe('manage prototype session routes', () => {
	let app, session

	beforeEach(() => {
		session = {}
		app = express()
		app.use(express.urlencoded({ extended: true }))
		app.use((req, res, next) => {
			res.render = (view, model) => res.send(`${view} ${JSON.stringify(model)}`)
			req.session = session
			next()
		})
		app.use('/manage-prototype', sessionRoutes)
	})

	it('renders the password page with error and return URL', async () => {
		const response = await request(app).get('/manage-prototype/password?error=wrong-password&returnURL=%2Fpage')

		expect(response.status).toBe(200)
		expect(response.text).toBe('password {"error":"wrong-password","returnURL":"/page"}')
	})

	it('stores the password in the session and redirects to the return URL', async () => {
		const response = await request(app)
			.post('/manage-prototype/password')
			.type('form')
			.send({ password: 'secret', returnURL: '/page' })

		expect(session.password).toBe('secret')
		expect(response.status).toBe(302)
		expect(response.headers.location).toBe('/page')
	})

	it('redirects to / when the return URL is unsafe', async () => {
		for (const returnURL of ['//evil.com', 'https://evil.com', '/manage-prototype/password']) {
			const response = await request(app)
				.post('/manage-prototype/password')
				.type('form')
				.send({ password: 'secret', returnURL })

			expect(response.headers.location).toBe('/')
		}
	})

	describe('GET /clear-data', () => {
		it('renders the clear-data page', async () => {
			const response = await request(app).get('/manage-prototype/clear-data')

			expect(response.status).toBe(200)
			expect(response.text).toBe('clear-data undefined')
		})
	})

	describe('POST /clear-data', () => {
		it('clears session data and renders success page', async () => {
			session.data = { name: 'Alice', age: '30' }

			const response = await request(app).post('/manage-prototype/clear-data')

			expect(session.data).toEqual({})
			expect(response.status).toBe(200)
			expect(response.text).toBe('clear-data-success undefined')
		})
	})

	it('does not expose the plugins management page', async () => {
		const response = await request(app).get('/manage-prototype/plugins')

		expect(response.status).toBe(404)
	})

	it('does not expose the plugin changes in production', async () => {
		const installResponse = await request(app)
			.post('/manage-prototype/plugins/install')
			.type('form')
			.send({ packageName: 'jquery' })
		const uninstallResponse = await request(app)
			.post('/manage-prototype/plugins/uninstall')
			.type('form')
			.send({ packageName: 'jquery' })

		expect(installResponse.status).toBe(404)
		expect(uninstallResponse.status).toBe(404)
	})

	it('redirects back to the password page when the password is wrong', async () => {
		const response = await request(app)
			.post('/manage-prototype/password')
			.type('form')
			.send({ password: 'nope', returnURL: '/page' })

		expect(session.password).toBeUndefined()
		expect(response.headers.location).toBe('/manage-prototype/password?error=wrong-password&returnURL=%2Fpage')
	})
})
