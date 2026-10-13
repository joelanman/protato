import fs from 'node:fs'
import * as sass from 'sass'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPrototype } from './build.js'

// Mock fs with default export structure
vi.mock('node:fs', () => ({
	default: {
		rmSync: vi.fn(),
		existsSync: vi.fn(() => false),
		mkdirSync: vi.fn(),
		readdirSync: vi.fn(() => ['custom.scss', 'other.scss', '_partial.scss', 'application.scss', 'settings.scss']),
		writeFileSync: vi.fn(),
		readFileSync: vi.fn((filePath) => {
			if (filePath.includes('base.html')) {
				return 'original-base-layout-content'
			}
			if (filePath.includes('application.css')) {
				return 'body { font-family: "GDS Transport", arial, sans-serif; }'
			}
			return 'file-content'
		})
	}
}))

vi.mock('./paths.js', () => ({
	getPaths: vi.fn(() => ({
		app: '/app',
		assets: '/assets',
		tmp: '/tmp',
		project: '/project',
		sass: '/sass',
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
	compile: vi.fn(() => ({
		css: 'compiled-css',
		sourceMap: { mapData: 'source-map-data' }
	})),
	NodePackageImporter: vi.fn()
}))

describe('build function', () => {
	beforeEach(() => {
		// Clear all mocks before each test
		vi.clearAllMocks()
	})

	it('compiles Sass and writes CSS files', async () => {
		expect(buildPrototype()).toEqual({ state: 'ok' })

		// Check if fs.rmSync was called with the correct path
		expect(fs.rmSync).toHaveBeenCalledWith('/stylesheets', { recursive: true, force: true })

		// Check if directories were created
		expect(fs.mkdirSync).toHaveBeenCalledWith('/stylesheets', { recursive: true })

		// Check if the temporary application.scss file was written with correct imports
		const applicationSassCall = fs.writeFileSync.mock.calls.find((call) => call[0].endsWith('application.scss'))
		expect(applicationSassCall).toBeDefined()

		const [, sassContent] = applicationSassCall
		expect(sassContent).toContain('@import "/plugin1.scss";')
		expect(sassContent).toContain('@import "/plugin2.scss";')
		expect(sassContent).toContain('@import "/sass/application.scss";')

		// Check if main CSS file was written
		expect(fs.writeFileSync).toHaveBeenCalledWith('/stylesheets/application.css', 'compiled-css')

		// Check if unbranded CSS was created
		expect(fs.writeFileSync).toHaveBeenCalledWith('/stylesheets/unbranded.css', expect.any(String))

		// Check if other sass files were compiled
		expect(fs.writeFileSync).toHaveBeenCalledWith('/stylesheets/custom.css', 'compiled-css')
		expect(fs.writeFileSync).toHaveBeenCalledWith('/stylesheets/other.css', 'compiled-css')

		// Check if base layout files with macro imports were written correctly
		const expectedBaseLayoutContent =
			'{% from "/macros/macro1.html" import macro1 %}\n{% from "/macros/macro2.html" import macro2 %}\noriginal-base-layout-content'
		expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/layouts/base.html', expectedBaseLayoutContent)
	})

	it('returns the error when Sass fails to compile', () => {
		const error = new Error('Sass failed')
		vi.mocked(sass.compile).mockImplementationOnce(() => {
			throw error
		})
		vi.spyOn(console, 'error').mockImplementation(() => {})

		expect(buildPrototype()).toEqual({ state: 'error', error })
	})
})
