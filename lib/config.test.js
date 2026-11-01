import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCache, getConfig } from './config.js'
import { getPaths } from './paths.js'

vi.mock('./paths.js', () => ({
	getPaths: vi.fn()
}))

describe('getConfig', () => {
	let dir
	let originalEnv

	beforeEach(() => {
		vi.clearAllMocks()
		clearCache()
		originalEnv = { ...process.env }
		delete process.env.PORT
		delete process.env.NODE_ENV
		delete process.env.CSRF_SECRET
		delete process.env.USE_HTTPS
		delete process.env.USE_AUTH
		for (const key of Object.keys(process.env)) {
			if (key.startsWith('PASSWORD')) {
				delete process.env[key]
			}
		}

		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-config-'))
		fs.mkdirSync(path.join(dir, 'app'), { recursive: true })
		vi.mocked(getPaths).mockReturnValue({
			env: path.join(dir, '.env'),
			config: path.join(dir, 'app/config.json')
		})
	})

	afterEach(() => {
		for (const key of Object.keys(process.env)) {
			if (!(key in originalEnv)) {
				delete process.env[key]
			}
		}
		Object.assign(process.env, originalEnv)
		fs.rmSync(dir, { recursive: true, force: true })
		clearCache()
	})

	it('returns default values when config.json does not exist', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})

		expect(getConfig()).toEqual({
			port: 3000,
			serviceName: '',
			env: 'development',
			useAuth: true,
			useHttps: true,
			isSecure: false,
			passwords: []
		})
	})

	it('reads serviceName and port from app/config.json', () => {
		fs.writeFileSync(
			path.join(dir, 'app/config.json'),
			JSON.stringify({ serviceName: 'Apply for a juggling licence', port: 4000 })
		)

		expect(getConfig()).toEqual({
			port: 4000,
			serviceName: 'Apply for a juggling licence',
			env: 'development',
			useAuth: true,
			useHttps: true,
			isSecure: false,
			passwords: []
		})
	})

	it('loads values from .env', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		fs.writeFileSync(path.join(dir, '.env'), 'PORT=3030\nPASSWORD=secret')

		expect(getConfig()).toEqual({
			port: 3030,
			serviceName: '',
			env: 'development',
			useAuth: true,
			useHttps: true,
			isSecure: false,
			passwords: ['secret']
		})
	})

	it('turns on authentication by default', () => {
		expect(getConfig().useAuth).toBe(true)
	})

	it('turns off authentication when USE_AUTH is false', () => {
		process.env.USE_AUTH = 'false'

		expect(getConfig().useAuth).toBe(false)
	})

	it('turns on HTTPS by default in production', () => {
		process.env.NODE_ENV = 'production'

		const config = getConfig()

		expect(config.useHttps).toBe(true)
		expect(config.isSecure).toBe(true)
	})

	it('turns off HTTPS and secure cookies when USE_HTTPS is false', () => {
		process.env.NODE_ENV = 'production'
		process.env.USE_HTTPS = 'false'

		const config = getConfig()

		expect(config.useHttps).toBe(false)
		expect(config.isSecure).toBe(false)
	})

	it('lets shell environment variables take precedence over .env', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		fs.writeFileSync(path.join(dir, '.env'), 'PORT=3999')
		process.env.PORT = '3030'

		expect(getConfig().port).toBe(3030)
	})

	it('reads the CSRF secret from the environment', () => {
		process.env.CSRF_SECRET = 'csrf-secret'

		expect(getConfig().csrfSecret).toBe('csrf-secret')
	})

	it('collects all PASSWORD* environment variables', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		process.env.PASSWORD = 'first'
		process.env.PASSWORD_2 = 'second'

		expect(getConfig().passwords).toEqual(['first', 'second'])
	})
})
