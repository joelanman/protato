import Module, { createRequire } from 'node:module'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import replaceRequire from './replace-require.js'

// require() bypasses Vite's module graph, so compare against the module the
// shim itself loads rather than the ESM import of protato.
const require = createRequire(import.meta.url)
const protato = require('../../index.js').default

describe('replaceRequire', () => {
	const originalRequire = Module.prototype.require
	const fakeModule = { filename: '/tmp/prototype/app/filters.js' }

	beforeAll(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		replaceRequire()
	})

	afterAll(() => {
		Module.prototype.require = originalRequire
		vi.restoreAllMocks()
	})

	it('replaces require("govuk-prototype-kit") with protato', () => {
		const kit = Module.prototype.require.call(fakeModule, 'govuk-prototype-kit')
		expect(kit).toBe(protato)
	})

	it('replaces require("govuk-prototype-kit/lib/config.js")', () => {
		const config = Module.prototype.require.call(fakeModule, 'govuk-prototype-kit/lib/config.js')
		expect(config.getConfig).toBeTypeOf('function')
	})

	it('passes other requires through', () => {
		const path = Module.prototype.require.call(fakeModule, 'node:path')
		expect(path.join).toBeTypeOf('function')
	})
})
