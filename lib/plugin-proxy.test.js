import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ appDir: '' }))

vi.mock('./paths.js', () => ({
	getPaths: () => ({ app: state.appDir })
}))

import { getProxyPluginConfig } from './plugin-proxy.js'

let appDir

beforeEach(() => {
	appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-plugin-proxy-'))
	state.appDir = appDir
})

afterEach(() => {
	fs.rmSync(appDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function writeUserConfig(config) {
	fs.mkdirSync(appDir, { recursive: true })
	fs.writeFileSync(path.join(appDir, 'plugin-proxy.json'), typeof config === 'string' ? config : JSON.stringify(config))
}

describe('getProxyPluginConfig', () => {
	it('supplies the built-in jquery and notifications-node-client configs', () => {
		const jquery = getProxyPluginConfig('jquery')

		expect(jquery.scripts).toEqual(['/dist/jquery.js'])
		expect(jquery.assets).toEqual(['/dist'])
		expect(jquery.meta.description).toContain('jQuery')
		expect(getProxyPluginConfig('notifications-node-client').meta.description).toContain('GOV.UK Notify')
		expect(getProxyPluginConfig('unknown-package')).toBeUndefined()
	})

	it('returns a copy so callers cannot change the built-in config', () => {
		const jquery = getProxyPluginConfig('jquery')
		jquery.scripts.push('/changed.js')

		expect(getProxyPluginConfig('jquery').scripts).toEqual(['/dist/jquery.js'])
	})

	it('lets a user config override the built-ins and add packages', () => {
		writeUserConfig({
			jquery: { scripts: ['/custom/jquery.js'] },
			'custom-package': { assets: ['/files'] }
		})

		expect(getProxyPluginConfig('jquery')).toEqual({ scripts: ['/custom/jquery.js'] })
		expect(getProxyPluginConfig('custom-package')).toEqual({ assets: ['/files'] })
		expect(getProxyPluginConfig('notifications-node-client').meta.description).toContain('GOV.UK Notify')
	})

	it('warns once about an invalid user file and keeps the built-in configs', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		writeUserConfig('{ not valid json')

		expect(getProxyPluginConfig('jquery').scripts).toEqual(['/dist/jquery.js'])
		expect(getProxyPluginConfig('jquery').scripts).toEqual(['/dist/jquery.js'])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0][0]).toContain('plugin-proxy.json')
	})
})
