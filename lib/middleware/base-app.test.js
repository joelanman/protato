import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('body-parser', () => ({
	default: {
		json: vi.fn(() => 'json parser'),
		urlencoded: vi.fn(() => 'urlencoded parser')
	}
}))

vi.mock('../../manage-prototype/index.js', () => ({
	default: {
		getManagePrototypeApp: vi.fn(() => 'manage app')
	}
}))

vi.mock('../config.js', () => ({ getConfig: vi.fn() }))
vi.mock('./auth.js', () => ({ checkAuth: vi.fn(() => 'auth') }))
vi.mock('./session.js', () => ({ default: { init: vi.fn() } }))

import bodyParser from 'body-parser'
import managePrototype from '../../manage-prototype/index.js'
import { getConfig } from '../config.js'
import { checkAuth } from './auth.js'
import { addBaseAppMiddleware } from './base-app.js'
import session from './session.js'

const createApp = () => ({ set: vi.fn(), use: vi.fn() })

describe('base app middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('adds body parsing, the session and manage prototype in development', async () => {
		vi.mocked(getConfig).mockReturnValue({ env: 'development' })
		const app = createApp()

		await addBaseAppMiddleware(app)

		expect(app.set).not.toHaveBeenCalled()
		expect(bodyParser.json).toHaveBeenCalledOnce()
		expect(bodyParser.urlencoded).toHaveBeenCalledWith({ extended: true })
		expect(session.init).toHaveBeenCalledWith(app)
		expect(checkAuth).not.toHaveBeenCalled()
		expect(managePrototype.getManagePrototypeApp).toHaveBeenCalledOnce()
		expect(app.use.mock.calls).toEqual([['json parser'], ['urlencoded parser'], ['/manage-prototype', 'manage app']])
	})

	it('adds auth and trusts the proxy in production', async () => {
		vi.mocked(getConfig).mockReturnValue({ env: 'production' })
		const app = createApp()

		await addBaseAppMiddleware(app)

		expect(app.set).toHaveBeenCalledWith('trust proxy', 1)
		expect(app.use.mock.calls).toEqual([
			['json parser'],
			['urlencoded parser'],
			[checkAuth],
			['/manage-prototype', 'manage app']
		])
	})
})
