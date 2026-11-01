import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { manageApp } = vi.hoisted(() => ({
	// stands in for the manage prototype router mounted on the error app
	manageApp: (request, response, next) => {
		// express removes the mount path, so this sees /password
		if (request.url.startsWith('/password')) {
			response.end('password page')
			return
		}

		next()
	}
}))

vi.mock('../manage-prototype/index.js', () => ({
	default: { getManagePrototypeApp: vi.fn(() => manageApp) }
}))

vi.mock('./build.js', () => ({
	buildPrototype: vi.fn(),
	buildSass: vi.fn(),
	getBuildResult: vi.fn()
}))

vi.mock('./config.js', () => ({ getConfig: vi.fn() }))
vi.mock('./manage-plugins/registry.js', () => ({ startFetchingPluginData: vi.fn() }))

vi.mock('./middleware/errors.js', () => ({ renderErrorPage: vi.fn() }))
vi.mock('./app.js', () => ({ default: vi.fn() }))

// The prototype app is loaded once per process, so every test gets a fresh
// copy of the module rather than the state left by the previous test.
let build
let config
let errors
let registry
let prototypeServer

const servers = []

// a port of 0 means the operating system picks a free one
async function start() {
	const server = await prototypeServer.start({ port: 0 })
	servers.push(server)
	return `http://localhost:${server.address().port}`
}

describe('prototype server', () => {
	beforeEach(async () => {
		vi.resetModules()

		build = await import('./build.js')
		config = await import('./config.js')
		errors = await import('./middleware/errors.js')
		registry = await import('./manage-plugins/registry.js')
		prototypeServer = (await import('./prototype-server.js')).default

		vi.mocked(config.getConfig).mockReturnValue({ env: 'production' })
		vi.mocked(build.getBuildResult).mockReturnValue({ state: 'ok' })
		vi.mocked(errors.renderErrorPage).mockImplementation((error, request, response) => {
			response.end('error page')
		})

		const { default: getApp } = await import('./app.js')
		vi.mocked(getApp).mockResolvedValue((request, response) => {
			response.end('prototype page')
		})
	})

	afterEach(async () => {
		for (const server of servers) {
			await new Promise((resolve) => server.close(resolve))
		}
		servers.length = 0
	})

	it('builds the prototype before it serves it', async () => {
		const root = await start()

		expect(build.buildPrototype).toHaveBeenCalledOnce()
		expect(await (await fetch(root)).text()).toBe('prototype page')
	})

	it('serves the error page when the build fails', async () => {
		const error = new Error('broken sass')
		vi.mocked(build.getBuildResult).mockReturnValue({ state: 'error', error })

		const root = await start()
		const body = await (await fetch(root)).text()

		expect(body).toBe('error page')
		expect(errors.renderErrorPage).toHaveBeenCalledWith(error, expect.anything(), expect.anything())
	})

	it('starts fetching plugin data in development only', async () => {
		await start()

		expect(registry.startFetchingPluginData).not.toHaveBeenCalled()

		vi.mocked(config.getConfig).mockReturnValue({ env: 'development' })
		await start()

		expect(registry.startFetchingPluginData).toHaveBeenCalledOnce()
	})

	it('keeps the manage pages working when the build fails', async () => {
		vi.mocked(build.getBuildResult).mockReturnValue({ state: 'error', error: new Error('broken sass') })

		const root = await start()
		const response = await fetch(`${root}/manage-prototype/password`)

		expect(await response.text()).toBe('password page')
	})
})
