import fs from 'node:fs'
import * as sass from 'sass'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import build from './build.js'

// Mock fs with default export structure
vi.mock('node:fs', () => ({
	default: {
		rmSync: vi.fn(),
		existsSync: vi.fn(() => false),
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
		readFileSync: vi.fn(() => 'original-base-layout-content') // Add this for reading layout files
	}
}))

vi.mock('./paths.js', () => ({
	getPaths: vi.fn(() => ({
		tmp: '/tmp',
		sass: {
			settings: '/sass/settings.scss',
			legacyPatterns: '/sass/legacyPatterns.scss',
			project: '/sass/project.scss'
		},
		stylesheets: '/stylesheets'
	}))
}))

vi.mock('./plugins.js', () => ({
	default: {
		getSassPaths: vi.fn(() => ['/plugin1.scss', '/plugin2.scss']),
		getMacros: vi.fn(() => [
			{ path: '/macros/macro1.html', name: 'macro1' },
			{ path: '/macros/macro2.html', name: 'macro2' }
		]),
		getBaseLayoutPaths: vi.fn(() => [
			{
				source: '/layouts/base.html',
				destination: '/tmp/layouts/base.html'
			}
		])
	}
}))

// Mock the sass module
vi.mock('sass', () => ({
	compileString: vi.fn(() => ({
		css: 'compiled-css',
		sourceMap: { mapData: 'source-map-data' }
	}))
}))

describe('build function', () => {
	beforeEach(() => {
		// Clear all mocks before each test
		vi.clearAllMocks()
	})

	it('compiles Sass and writes CSS file', async () => {
		await build()

		// Check if fs.rmSync was called with the correct path
		expect(fs.rmSync).toHaveBeenCalledWith('/tmp', { recursive: true, force: true })

		// Check if sass.compileString was called - test the actual string passed
		expect(sass.compileString).toHaveBeenCalledTimes(1)

		// Get the actual call arguments
		const [sassString] = sass.compileString.mock.calls[0]

		// Test that the sass string contains the expected imports
		expect(sassString).toContain('@import "/sass/settings.scss";')
		expect(sassString).toContain('@import "/plugin1.scss";')
		expect(sassString).toContain('@import "/plugin2.scss";')
		expect(sassString).toContain('@import "/sass/project.scss";')

		// Check if fs.mkdirSync was called with the correct path
		expect(fs.mkdirSync).toHaveBeenCalledWith('/stylesheets', { recursive: true })

		// Check if fs.writeFileSync was called with the correct arguments for CSS and source map
		expect(fs.writeFileSync).toHaveBeenCalledWith('/stylesheets/application.css', 'compiled-css')
		const cssMap = JSON.stringify({ mapData: 'source-map-data' })
		expect(fs.writeFileSync).toHaveBeenCalledWith('/stylesheets/application.css.map', cssMap)

		// Check if base layout files with macro imports were written correctly
		const expectedBaseLayoutContent = [
			'{% from "/macros/macro1.html" import macro1 %}',
			'{% from "/macros/macro2.html" import macro2 %}',
			'original-base-layout-content'
		].join('\n')

		expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/layouts/base.html', expectedBaseLayoutContent)
	})
})
