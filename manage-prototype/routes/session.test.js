import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createManagePrototypeApp, readCsrf } from '../../tests/helpers/manage-prototype.js'
import sessionRoutes, { getSafeReturnURL } from './session.js'

vi.mock('../../lib/config.js', () => ({
	getConfig: () => ({
		env: 'development',
		serviceName: 'Test Service',
		isSecure: false,
		passwords: ['secret']
	})
}))

describe('manage prototype session routes', () => {
	let app
	let session

	const createApp = () =>
		createManagePrototypeApp(sessionRoutes, {
			middleware: (request, response, next) => {
				request.session = session
				next()
			}
		})

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
		it('renders the password form with the return URL and a csrf token', async () => {
			const response = await request(app).get(
				'/manage-prototype/password?error=wrong-password&returnURL=%2Fpage%3Fa%3D1'
			)

			expect(response.status).toBe(200)
			expect(response.text).toContain('This is a prototype used for research')
			expect(response.text).toContain('The password is not correct')
			expect(response.text).toContain('<form method="post" action="/manage-prototype/password">')
			expect(response.text).toContain('name="returnURL" value="/page?a=1"')
			expect(response.text).toMatch(/name="_csrf" value="[^"]+"/)
		})
	})

	describe('POST /password', () => {
		const postPassword = async (password, returnURL) => {
			const formPage = await request(app).get('/manage-prototype/password')
			const { token, cookie } = readCsrf(formPage)

			return request(app)
				.post('/manage-prototype/password')
				.set('Cookie', cookie)
				.type('form')
				.send({ password, returnURL, _csrf: token })
		}

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
		it('asks for confirmation before clearing the data', async () => {
			const response = await request(app).get('/manage-prototype/clear-data')

			expect(response.status).toBe(200)
			expect(response.text).toContain('Clear session data')
			expect(response.text).toContain('This will clear all of the data entered in this session')
			expect(response.text).toMatch(/<form method="post">/)
			expect(response.text).toMatch(/name="_csrf" value="[^"]+"/)
		})

		it('clears the stored session data after a POST', async () => {
			const formPage = await request(app).get('/manage-prototype/clear-data')
			const { token, cookie } = readCsrf(formPage)

			const response = await request(app)
				.post('/manage-prototype/clear-data')
				.set('Cookie', cookie)
				.type('form')
				.send({ _csrf: token })

			expect(response.status).toBe(200)
			expect(response.text).toContain('Data cleared')
			expect(session.data).toEqual({})
		})
	})
})
