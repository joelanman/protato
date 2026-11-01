import express from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../manage-prototype/index.js', async () => {
	const { default: express } = await import('express')

	return {
		getManagePrototypeApp: vi.fn(async () => {
			const app = express()
			app.get('/password', (request, response) => response.end('password page'))
			return app
		})
	}
})

vi.mock('./middleware/session.js', () => ({
	default: {
		addSessionMiddleware: vi.fn(async () => {})
	}
}))

vi.mock('./middleware/auth.js', () => ({
	checkAuth: (request, response, next) => next()
}))

vi.mock('./build.js', () => ({ getBuildResult: vi.fn() }))
vi.mock('./config.js', () => ({ getConfig: vi.fn() }))
vi.mock('./middleware/errors.js', () => ({ renderErrorPage: vi.fn() }))
vi.mock('./app.js', () => ({ default: vi.fn() }))

let build
let config
let errors
let managePrototype
let prototypeServer

const servers = []

// a port of 0 means the operating system picks a free one
async function start(options = {}) {
	const server = await prototypeServer.start({ port: 0, ...options })
	servers.push(server)
	return `http://localhost:${server.address().port}`
}

describe('prototype server', () => {
	beforeEach(async () => {
		vi.resetModules()
		vi.clearAllMocks()

		build = await import('./build.js')
		config = await import('./config.js')
		errors = await import('./middleware/errors.js')
		managePrototype = await import('../manage-prototype/index.js')
		prototypeServer = (await import('./prototype-server.js')).default

		vi.mocked(config.getConfig).mockReturnValue({ env: 'production' })
		vi.mocked(build.getBuildResult).mockReturnValue({ state: 'ok' })
		vi.mocked(errors.renderErrorPage).mockImplementation((error, request, response) => {
			response.end('error page')
		})

		const { default: getApp } = await import('./app.js')
		const prototypeApp = express()

		prototypeApp.use((request, response) => {
			response.end('prototype page')
		})

		vi.mocked(getApp).mockResolvedValue(prototypeApp)
	})

	afterEach(async () => {
		for (const server of servers) {
			await new Promise((resolve) => server.close(resolve))
		}
		servers.length = 0
	})

	it('serves the prototype for the build result in this process', async () => {
		const root = await start()

		expect(await (await fetch(root)).text()).toBe('prototype page')
	})

	it('serves the build result it is given instead', async () => {
		const error = new Error('broken sass')

		const root = await start({ buildResult: { state: 'error', error } })

		expect(await (await fetch(root)).text()).toBe('error page')
	})

	it('refuses to serve before the prototype has been built', async () => {
		vi.mocked(build.getBuildResult).mockReturnValue(undefined)

		await expect(prototypeServer.start({ port: 0 })).rejects.toThrow('Build the prototype before starting it')
	})

	it('serves the error page when the build fails', async () => {
		const error = new Error('broken sass')
		vi.mocked(build.getBuildResult).mockReturnValue({ state: 'error', error })

		const root = await start()
		const body = await (await fetch(root)).text()

		expect(body).toBe('error page')
		expect(errors.renderErrorPage).toHaveBeenCalledWith(error, expect.anything(), expect.anything())
	})

	it('keeps the manage pages working when the build fails in production', async () => {
		vi.mocked(build.getBuildResult).mockReturnValue({ state: 'error', error: new Error('broken sass') })

		const root = await start()
		const response = await fetch(`${root}/manage-prototype/password`)

		expect(await response.text()).toBe('password page')
	})

	it('leaves manage prototype to the dev server in development', async () => {
		vi.mocked(config.getConfig).mockReturnValue({ env: 'development' })
		vi.mocked(build.getBuildResult).mockReturnValue({ state: 'error', error: new Error('broken sass') })

		const root = await start()
		const response = await fetch(`${root}/manage-prototype/password`)

		expect(await response.text()).toBe('error page')
		expect(managePrototype.getManagePrototypeApp).not.toHaveBeenCalled()
	})
})
