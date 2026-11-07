import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { config } = vi.hoisted(() => ({
	config: { env: 'development', csrfSecret: undefined, isSecure: false }
}))

vi.mock('../lib/config.js', () => ({
	getConfig: () => config
}))

import { clearCache, csrf } from './csrf.js'

const cookieFrom = (response) => response.headers['set-cookie'][0].split(';')[0]

const csrfError = (error, request, response, next) => {
	response.status(error.status ?? 500).send(error.message)
}

const createApp = () => {
	const app = express()

	app.use(express.urlencoded({ extended: true }))
	app.all('/manage-prototype/form', csrf, (request, response) => {
		response.send(response.locals.csrfToken)
	})
	app.post('/manage-prototype/submit', csrf, (request, response) => {
		response.send('submitted')
	})
	app.use(csrfError)

	return app
}

describe('csrf protection', () => {
	let app

	beforeEach(() => {
		clearCache()
		config.env = 'development'
		config.isSecure = false
		config.csrfSecret = undefined
		app = createApp()
	})

	afterEach(() => {
		clearCache()
	})

	const getToken = async () => {
		const response = await request(app).get('/manage-prototype/form')

		return { cookie: cookieFrom(response), token: response.text }
	}

	it('sets a token cookie for the manage pages', async () => {
		const response = await request(app).get('/manage-prototype/form')

		expect(response.status).toBe(200)
		expect(response.text).not.toBe('')

		const [cookie] = response.headers['set-cookie']
		expect(cookie).toContain('protato.csrf=')
		expect(cookie).toContain('HttpOnly')
		expect(cookie).toContain('Path=/manage-prototype')
		expect(cookie).toContain('SameSite=Lax')
		expect(cookie).not.toContain('Secure')
	})

	it('marks the cookie secure in production', async () => {
		config.env = 'production'
		config.isSecure = true
		clearCache()

		const response = await request(app).get('/manage-prototype/form')

		expect(response.headers['set-cookie'][0]).toContain('Secure')
	})

	it('does not mark the cookie secure when HTTPS is turned off', async () => {
		config.env = 'production'
		config.isSecure = false
		clearCache()

		const response = await request(app).get('/manage-prototype/form')

		expect(response.headers['set-cookie'][0]).not.toContain('Secure')
	})

	it.each(['GET', 'HEAD', 'OPTIONS'])('gives a token to the view for the safe method %s', async (method) => {
		const response = await request(app)[method.toLowerCase()]('/manage-prototype/form')

		expect(response.status).toBe(200)
		expect(response.headers['set-cookie'][0]).toContain('protato.csrf=')
	})

	it('keeps the same token across requests, so open forms keep working', async () => {
		const agent = request.agent(app)

		const first = await agent.get('/manage-prototype/form')
		const second = await agent.get('/manage-prototype/form')

		expect(second.text).toBe(first.text)
	})

	it('accepts a POST with the token from the form and the cookie', async () => {
		const { cookie, token } = await getToken()

		const response = await request(app)
			.post('/manage-prototype/submit')
			.set('Cookie', cookie)
			.type('form')
			.send({ _csrf: token })

		expect(response.status).toBe(200)
		expect(response.text).toBe('submitted')
	})

	it('rejects a POST without a token', async () => {
		const { cookie } = await getToken()

		const response = await request(app).post('/manage-prototype/submit').set('Cookie', cookie).type('form').send({})

		expect(response.status).toBe(403)
	})

	it('rejects a POST without a cookie', async () => {
		const { token } = await getToken()

		const response = await request(app).post('/manage-prototype/submit').type('form').send({ _csrf: token })

		expect(response.status).toBe(403)
	})

	it('rejects the token when it is sent in a header instead of the body', async () => {
		const { cookie, token } = await getToken()

		const response = await request(app)
			.post('/manage-prototype/submit')
			.set('Cookie', cookie)
			.set('x-csrf-token', token)
			.send()

		expect(response.status).toBe(403)
	})

	it('rejects tokens made with the previous secret', async () => {
		const { cookie, token } = await getToken()

		config.csrfSecret = 'a different secret'
		clearCache()

		const response = await request(app)
			.post('/manage-prototype/submit')
			.set('Cookie', cookie)
			.type('form')
			.send({ _csrf: token })

		expect(response.status).toBe(403)
	})
})
