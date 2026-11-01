import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../manage-prototype/app.js', async () => {
	const { default: express } = await import('express')

	return {
		getManagePrototypeApp: vi.fn(async () => {
			const app = express()
			app.get('/', (request, response) => response.end('manage page'))
			app.get('/password', (request, response) => response.end('password page'))
			return app
		})
	}
})

vi.mock('../../manage-prototype/routes/preview.js', () => ({
	templatePreviewPath: '/manage-prototype/templates/view'
}))

vi.mock('../middleware/session.js', () => ({
	default: {
		addSessionMiddleware: vi.fn(async () => {})
	}
}))

vi.mock('../middleware/errors.js', () => ({
	pageNotFound: (request, response) => response.status(404).end('manage not found'),
	errorHandler: (error, request, response, next) => response.status(500).end('manage error')
}))

vi.mock('./livereload.js', () => ({
	default: {
		route: vi.fn((request, response) => response.end('livereload'))
	}
}))

import livereload from './livereload.js'
import devServer from './server.js'

const servers = []

const listen = async (handler) => {
	const server = http.createServer(handler)
	servers.push(server)
	await new Promise((resolve) => server.listen(0, resolve))
	return server
}

describe('devServer', () => {
	let targetRequests
	let prototypeServer

	beforeEach(async () => {
		vi.clearAllMocks()

		targetRequests = []

		prototypeServer = await listen((request, response) => {
			targetRequests.push(request.url)
			response.writeHead(200)
			response.end('prototype page')
		})
	})

	afterEach(async () => {
		for (const server of servers) {
			server.closeAllConnections?.()
			await new Promise((resolve) => server.close(resolve))
		}
		servers.length = 0
	})

	const start = async () => {
		const server = await devServer.start({ port: 0, prototypePort: prototypeServer.address().port })
		servers.push(server)
		return `http://localhost:${server.address().port}`
	}

	it('serves manage prototype from the dev server', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype`)

		expect(await response.text()).toBe('manage page')
		expect(targetRequests).toEqual([])
	})

	it('serves the session pages from the dev server too', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype/password`)

		expect(await response.text()).toBe('password page')
		expect(targetRequests).toEqual([])
	})

	it('proxies the prototype', async () => {
		const root = await start()

		const response = await fetch(`${root}/a-page`)

		expect(await response.text()).toBe('prototype page')
		expect(targetRequests).toEqual(['/a-page'])
	})

	it('proxies the template preview, which needs the prototype views', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype/templates/view`)

		expect(await response.text()).toBe('prototype page')
		expect(targetRequests).toEqual(['/manage-prototype/templates/view'])
	})

	it('serves livereload itself, so it survives a restart', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype/livereload`)

		expect(await response.text()).toBe('livereload')
		expect(livereload.route).toHaveBeenCalledOnce()
		expect(targetRequests).toEqual([])
	})

	it('does not send an unmatched manage path to the prototype', async () => {
		const root = await start()

		const response = await fetch(`${root}/manage-prototype/does-not-exist`)

		expect(response.status).toBe(404)
		expect(await response.text()).toBe('manage not found')
		expect(targetRequests).toEqual([])
	})
})
