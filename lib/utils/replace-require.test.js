import Module, { createRequire } from 'node:module'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import replaceRequire from './replace-require.js'

// require() bypasses Vite's module graph, so compare against the module the
// shim itself loads rather than the ESM import of protato.
const require = createRequire(import.meta.url)
const protato = require('../../index.js').default

describe('replaceRequire', () => {
	const originalRequire = Module.prototype.require

	beforeAll(() => {
		// replacement logging is kept for now, but silenced in test output
		vi.spyOn(console, 'log').mockImplementation(() => {})
		replaceRequire()
	})

	afterAll(() => {
		Module.prototype.require = originalRequire
		vi.restoreAllMocks()
	})

	it('replaces require("govuk-prototype-kit") with protato', () => {
		const kit = require('govuk-prototype-kit')

		expect(kit).toBe(protato)
	})

	it('replaces both config module spellings', () => {
		const configWithExtension = require('govuk-prototype-kit/lib/config.js')
		const configWithoutExtension = require('govuk-prototype-kit/lib/config')

		expect(configWithoutExtension).toBe(configWithExtension)
		expect(configWithoutExtension.getConfig).toBeTypeOf('function')
	})

	it('passes built-in requires through', () => {
		const path = require('node:path')
		expect(path.join).toBeTypeOf('function')
	})
})
