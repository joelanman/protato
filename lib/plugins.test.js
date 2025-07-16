import fs from 'node:fs'
import express from 'express'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import './paths.js'
import plugins from './plugins.js'

vi.mock('node:fs')
vi.mock('express', () => ({
	default: {
		static: vi.fn((path) => `STATIC_MIDDLEWARE_FOR[${path}]`)
	}
}))
vi.mock('./paths.js', () => ({
	default: () => ({
		project: '/path/to/project'
	})
}))

describe('serveAssets', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('Serves static assets at the correct paths', () => {
		// When readFileSync is called, return the appropriate mock JSON
		fs.readFileSync.mockImplementation((filePath) => {
			if (filePath.endsWith('package.json')) {
				return `{
					"dependencies": {
						"plugin-one": "1.0.0",
						"plugin-two": "1.0.0"
					}
				}`
			}
			if (filePath.includes('plugin-one')) {
				return `{
					"assets": ["/public", "/images"]
				}`
			}
			return '{}'
		})

		// All plugin configs exist in this test
		fs.existsSync.mockReturnValue(true)

		// Create a mock app object to spy on
		const mockApp = {
			use: vi.fn()
		}

		plugins.serveAssets(mockApp)

		expect(mockApp.use).toHaveBeenCalledTimes(2)
		expect(express.static).toHaveBeenCalledTimes(2)

		// Verify the calls for the first asset in plugin-one
		expect(mockApp.use).toHaveBeenCalledWith('/plugin-assets/plugin-one/public', 'STATIC_MIDDLEWARE_FOR[/path/to/project/node_modules/plugin-one/public]')

		// Verify the calls for the second asset in plugin-one
		expect(mockApp.use).toHaveBeenCalledWith('/plugin-assets/plugin-one/images', 'STATIC_MIDDLEWARE_FOR[/path/to/project/node_modules/plugin-one/images]')
	})
})
