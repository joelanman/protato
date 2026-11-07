import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sessionRoutes, { getSafeReturnURL } from './session.js'

vi.mock('../../lib/config.js', () => ({
	getConfig: vi.fn(() => ({ passwords: ['secret'] }))
}))

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

describe('manage prototype session routes', () => {
	let app
	let session

	const createApp = () => {
		const testApp = express()

		testApp.use(express.urlencoded({ extended: true }))
		testApp.use((req, res, next) => {
			req.session = session
			res.render = (view, model) => res.send(renderToString(view, model))
			next()
		})
		testApp.use('/manage-prototype', sessionRoutes)

		return testApp
	}

	beforeEach(() => {
		vi.clearAllMocks()
		session = { data: { name: 'Ada' } }
		app = createApp()
	})

	describe('getSafeReturnURL', () => {
		it.each(['/', '/page?a=1', '/manage-prototype/plugins'])('allows the relative path %s', (returnURL) => {
			expect(getSafeReturnURL(returnURL)).toBe(returnURL)
		})

		it.each([
			{ description: 'a protocol-relative URL', returnURL: '//evil.com' },
			{ description: 'an external URL', returnURL: 'https://evil.com' },
			{ description: 'a password page redirect', returnURL: '/manage-prototype/password?error=wrong-password' },
			{ description: 'a number', returnURL: 123 },
			{ description: 'an array of submitted values', returnURL: ['/', '//evil.com'] }
		])('falls back to / for $description', ({ returnURL }) => {
			expect(getSafeReturnURL(returnURL)).toBe('/')
		})

		it('falls back to / when no return URL is given', () => {
			expect(getSafeReturnURL()).toBe('/')
		})
	})

	describe('GET /password', () => {
		it('renders the password page with the error and return URL', async () => {
			const response = await request(app).get(
				'/manage-prototype/password?error=wrong-password&returnURL=%2Fpage%3Fa%3D1'
			)

			const { view, model } = readRender(response)
			expect(view).toBe('password')
			expect(model).toEqual({ error: 'wrong-password', returnURL: '/page?a=1' })
		})
	})

	describe('POST /password', () => {
		const postPassword = (password, returnURL) =>
			request(app).post('/manage-prototype/password').type('form').send({ password, returnURL })

		it('stores the password and returns to the safe return URL', async () => {
			const response = await postPassword('secret', '/page?a=1')

			expect(session.password).toBe('secret')
			expect(response.status).toBe(302)
			expect(response.headers.location).toBe('/page?a=1')
		})

		it('ignores an unsafe return URL', async () => {
			const response = await postPassword('secret', '//evil.com')

			expect(response.status).toBe(302)
			expect(response.headers.location).toBe('/')
		})

		it('returns to the password page with an error when the password is wrong', async () => {
			const response = await postPassword('wrong', '/page?a=1')

			expect(session.password).toBeUndefined()
			expect(response.status).toBe(302)
			expect(response.headers.location).toBe(
				'/manage-prototype/password?error=wrong-password&returnURL=' + encodeURIComponent('/page?a=1')
			)
		})
	})

	describe('clear data', () => {
		it('renders the clear data confirmation page', async () => {
			const response = await request(app).get('/manage-prototype/clear-data')

			expect(response.status).toBe(200)
			expect(readRender(response).view).toBe('clear-data')
		})

		it('clears the stored session data after a POST', async () => {
			const response = await request(app).post('/manage-prototype/clear-data').type('form')

			expect(session.data).toEqual({})
			expect(readRender(response).view).toBe('clear-data-success')
		})
	})
})
