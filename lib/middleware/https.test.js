import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { config } = vi.hoisted(() => ({
	config: { env: 'production', isSecure: true }
}))

vi.mock('../config.js', () => ({
	getConfig: () => config
}))

import { addHttpsMiddleware } from './https.js'

const createApp = () => {
	const app = express()
	addHttpsMiddleware(app)
	app.get('/', (request, response) => response.send('ok'))
	return app
}

describe('HTTPS middleware', () => {
	beforeEach(() => {
		config.env = 'production'
		config.isSecure = true
		vi.spyOn(console, 'log').mockImplementation(() => {})
	})

	it('allows requests that arrived over HTTPS', async () => {
		const response = await request(createApp()).get('/').set('x-forwarded-proto', 'https')

		expect(response.status).toBe(200)
		expect(response.text).toBe('ok')
	})

	it('redirects requests that arrived over HTTP', async () => {
		const response = await request(createApp()).get('/?page=1').set('host', 'example.com')

		expect(response.status).toBe(302)
		expect(response.headers.location).toBe('https://example.com/?page=1')
	})

	it('does not redirect when HTTPS is turned off', async () => {
		config.isSecure = false

		const response = await request(createApp()).get('/')

		expect(response.status).toBe(200)
		expect(response.text).toBe('ok')
	})

	it('does not redirect in development', async () => {
		config.env = 'development'
		config.isSecure = false

		const response = await request(createApp()).get('/')

		expect(response.status).toBe(200)
		expect(response.text).toBe('ok')
	})
})
