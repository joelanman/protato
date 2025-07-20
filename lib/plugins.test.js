import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import plugins from './plugins.js'

// Mock the getPaths module

vi.mock('./paths.js', () => ({
	default: () => ({ project: '/mock/project/path' })
}))

// Mock fs module

vi.mock('node:fs')

describe('Plugin System', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('getAssetPaths', () => {
		it('returns empty array when there are no plugins', () => {
			// Mock package.json with no dependencies

			fs.readFileSync.mockReturnValueOnce(`{ "dependencies": {} }`)

			const result = plugins.getAssetPaths()

			expect(result).toEqual([])
		})

		it('returns empty array when plugins exist but have no assets config', () => {
			// Mock package.json with dependencies

			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": { "test-plugin": "1.0.0" }
			}`)

			// Mock plugin config exists but has no assets

			fs.existsSync.mockReturnValue(true)
			fs.readFileSync
				.mockReturnValueOnce('{}') // plugin config
				.mockReturnValueOnce('{ "name": "test-plugin" }') // plugin package.json

			const result = plugins.getAssetPaths()

			expect(result).toEqual([])
		})

		it('handles multiple plugins with assets', () => {
			// Mock package.json with multiple dependencies
			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": {
					"plugin-one": "1.0.0",
					"plugin-two": "2.0.0"
				}
			}`)

			// Mock both plugins exist and have assets

			fs.existsSync.mockReturnValue(true)
			fs.readFileSync
				.mockReturnValueOnce('{ "assets": ["/styles"], "scripts": [{"path":"/script.js"}] }') // plugin-one config
				.mockReturnValueOnce('{ "name": "plugin-one" }') // plugin-one package.json
				.mockReturnValueOnce('{ "assets": ["/images"] }') // plugin-two config
				.mockReturnValueOnce('{ "name": "plugin-two" }') // plugin-two package.json

			const result = plugins.getAssetPaths()

			expect(result).toEqual([
				{
					serverPath: '/plugin-assets/plugin-one/styles',
					filePath: path.join('/mock/project/path', 'node_modules', 'plugin-one', '/styles')
				},
				{
					serverPath: '/plugin-assets/plugin-one/script.js',
					filePath: path.join('/mock/project/path', 'node_modules', 'plugin-one', '/script.js')
				},
				{
					serverPath: '/plugin-assets/plugin-two/images',
					filePath: path.join('/mock/project/path', 'node_modules', 'plugin-two', '/images')
				}
			])
		})

		it('skips dependencies without plugin config files', () => {
			// Mock package.json with dependencies

			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": {
					"regular-dependency": "1.0.0",
					"plugin-dependency": "1.0.0"
				}
			}`)

			// Mock only plugin-dependency has config file

			fs.existsSync.mockImplementation((filePath) => {
				return filePath.includes('plugin-dependency')
			})

			fs.readFileSync
				.mockReturnValueOnce('{ "assets": ["/dist"] }') // plugin config
				.mockReturnValueOnce('{ "name": "plugin-dependency" }') // plugin package.json

			const result = plugins.getAssetPaths()

			expect(result).toHaveLength(1)
			expect(result[0].serverPath).toBe('/plugin-assets/plugin-dependency/dist')
		})
	})

	describe('getSassPaths', () => {
		it('returns sass paths when plugins have sass config', () => {
			// Mock package.json with dependencies

			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": {
					"sass-plugin": "1.0.0"
				}
			}`)

			// Mock plugin config with sass

			fs.existsSync.mockReturnValue(true)
			fs.readFileSync
				.mockReturnValueOnce('{ "sass": ["/scss"] }') // plugin config
				.mockReturnValueOnce('{ "name": "sass-plugin" }') // plugin package.json

			const result = plugins.getSassPaths()

			expect(result).toEqual([path.join('/mock/project/path', 'node_modules', 'sass-plugin', '/scss')])
		})

		it('puts govuk-frontend first when present', () => {
			// Mock package.json with dependencies including govuk-frontend

			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": {
					"other-plugin": "1.0.0",
					"govuk-frontend": "4.0.0",
					"another-plugin": "2.0.0"
				}
			}`)

			// Mock all plugins exist and have sass config

			fs.existsSync.mockReturnValue(true)
			fs.readFileSync
				.mockReturnValueOnce('{"sass": ["/sass"]}') // other-plugin config
				.mockReturnValueOnce('{"name": "other-plugin"}') // other-plugin package.json
				.mockReturnValueOnce('{"sass": ["/govuk"]}') // govuk-frontend config
				.mockReturnValueOnce('{"name": "govuk-frontend"}') // govuk-frontend package.json
				.mockReturnValueOnce('{"sass": ["/styles"]}') // another-plugin config
				.mockReturnValueOnce('{"name": "another-plugin"}') // another-plugin package.json

			const result = plugins.getSassPaths()

			expect(result).toHaveLength(3)
			// govuk-frontend should be first
			expect(result[0]).toBe(path.join('/mock/project/path', 'node_modules', 'govuk-frontend', '/govuk'))
			expect(result).toContain(path.join('/mock/project/path', 'node_modules', 'other-plugin', '/sass'))
			expect(result).toContain(path.join('/mock/project/path', 'node_modules', 'another-plugin', '/styles'))
		})

		it('handles multiple sass paths per plugin', () => {
			// Mock package.json with dependencies

			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": {
					"multi-sass-plugin": "1.0.0"
				}
			}`)

			// Mock plugin config with multiple sass paths

			fs.existsSync.mockReturnValue(true)
			fs.readFileSync
				.mockReturnValueOnce('{ "sass": ["/scss", "/sass", "/styles"] }') // plugin config
				.mockReturnValueOnce('{ "name": "multi-sass-plugin" }') // plugin package.json

			const result = plugins.getSassPaths()

			expect(result).toEqual([
				path.join('/mock/project/path', 'node_modules', 'multi-sass-plugin', '/scss'),
				path.join('/mock/project/path', 'node_modules', 'multi-sass-plugin', '/sass'),
				path.join('/mock/project/path', 'node_modules', 'multi-sass-plugin', '/styles')
			])
		})

		it('works when govuk-frontend is already first', () => {
			// Mock package.json with govuk-frontend first

			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": {
					"govuk-frontend": "4.0.0",
					"other-plugin": "1.0.0"
				}
			}`)

			// Mock both plugins exist and have sass config

			fs.existsSync.mockReturnValue(true)
			fs.readFileSync
				.mockReturnValueOnce('{ "sass": ["/govuk"] }') // govuk-frontend config
				.mockReturnValueOnce('{ "name": "govuk-frontend" }') // govuk-frontend package.json
				.mockReturnValueOnce('{ "sass": ["/other"] }') // other-plugin config
				.mockReturnValueOnce('{ "name": "other-plugin" }') // other-plugin package.json

			const result = plugins.getSassPaths()

			expect(result).toHaveLength(2)
			expect(result[0]).toBe(path.join('/mock/project/path', 'node_modules', 'govuk-frontend', '/govuk'))
			expect(result[1]).toBe(path.join('/mock/project/path', 'node_modules', 'other-plugin', '/other'))
		})
	})

	describe('getScriptPaths', () => {
		it('returns script paths when plugins have scripts config', () => {
			// Mock package.json with dependencies

			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": {
					"plugin": "1.0.0"
				}
			}`)

			// Mock plugin config with scripts

			fs.existsSync.mockReturnValue(true)

			fs.readFileSync
				.mockReturnValueOnce('{ "scripts": [{ "path": "/main.js", "type": "module"}] }') // plugin config
				.mockReturnValueOnce('{ "name": "plugin" }') // plugin package.json

			const result = plugins.getScriptPaths()

			expect(result).toEqual([
				{
					src: path.join('/plugin-assets', 'plugin', '/main.js'),
					type: 'module'
				}
			])
		})

		it('supports legacy plugins with no type attribute', () => {
			// Mock package.json with dependencies

			fs.readFileSync.mockReturnValueOnce(`{
				"dependencies": {
					"plugin": "1.0.0"
				}
			}`)

			// Mock plugin config with scripts with no type attribute (legacy)

			fs.existsSync.mockReturnValue(true)

			fs.readFileSync
				.mockReturnValueOnce('{ "scripts": ["/main.js"] }') // plugin config
				.mockReturnValueOnce('{ "name": "plugin" }') // plugin package.json

			const result = plugins.getScriptPaths()

			expect(result).toEqual([
				{
					src: path.join('/plugin-assets', 'plugin', '/main.js')
				}
			])
		})
	})
})
