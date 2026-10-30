import fs from 'node:fs'
import path from 'node:path'
import * as sass from 'sass'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPrototype, getBuildResult, processSass } from './build.js'
import { getPaths } from './paths.js'
import plugins from './plugins.js'

const projectPaths = {
	app: '/app',
	assets: '/assets',
	tmp: '/tmp',
	project: '/project',
	sass: '/sass',
	stylesheets: '/stylesheets'
}

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
	getPaths: vi.fn()
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
		vi.mocked(getPaths).mockReturnValue(projectPaths)
	})

	it('compiles Sass and writes CSS files', async () => {
		expect(buildPrototype()).toEqual({ state: 'ok' })

		// Check if fs.rmSync was called with the correct paths
		expect(fs.rmSync).toHaveBeenCalledWith('/stylesheets', { recursive: true, force: true })
		expect(fs.rmSync).toHaveBeenCalledWith(path.join(projectPaths.tmp, 'views'), { recursive: true, force: true })

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
		expect(fs.writeFileSync).toHaveBeenCalledWith(path.join('/stylesheets', 'application.css'), 'compiled-css')

		// Check if unbranded CSS was created
		expect(fs.writeFileSync).toHaveBeenCalledWith(path.join('/stylesheets', 'unbranded.css'), expect.any(String))

		// Check if other sass files were compiled
		expect(fs.writeFileSync).toHaveBeenCalledWith(path.join('/stylesheets', 'custom.css'), 'compiled-css')
		expect(fs.writeFileSync).toHaveBeenCalledWith(path.join('/stylesheets', 'other.css'), 'compiled-css')

		// Check if base layout files with macro imports were written correctly
		const expectedBaseLayoutContent =
			'{% from "/macros/macro1.html" import macro1 %}\n{% from "/macros/macro2.html" import macro2 %}\noriginal-base-layout-content'
		expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/layouts/base.html', expectedBaseLayoutContent)
	})

	it('uses forward slashes in Sass imports on Windows paths', () => {
		vi.mocked(getPaths).mockReturnValue({
			app: 'C:\\app',
			assets: 'C:\\app\\assets',
			tmp: 'C:\\project\\.tmp',
			project: 'C:\\project',
			sass: 'C:\\project\\app\\assets\\sass',
			stylesheets: 'C:\\project\\.tmp\\public\\stylesheets'
		})
		vi.mocked(plugins.getSassPaths).mockReturnValueOnce(['node_modules/plugin/styles.scss'])

		expect(buildPrototype()).toEqual({ state: 'ok' })

		const applicationSassCall = fs.writeFileSync.mock.calls.find((call) => call[0].endsWith('application.scss'))
		const [, sassContent] = applicationSassCall

		expect(sassContent).not.toContain('\\')
		expect(sassContent).toContain('@import "C:/project/app/assets/sass/application.scss";')
		expect(sassContent).toContain('@import "node_modules/plugin/styles.scss";')
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

describe('getBuildResult', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getPaths).mockReturnValue(projectPaths)
	})

	it('returns the result of the last build', () => {
		const result = buildPrototype()

		expect(getBuildResult()).toBe(result)
		expect(getBuildResult()).toEqual({ state: 'ok' })
	})

	it('returns the result of the last Sass build', () => {
		const result = processSass()

		expect(getBuildResult()).toBe(result)
	})

	it('returns a build error after a failed build', () => {
		const error = new Error('Sass failed')
		vi.mocked(sass.compile).mockImplementationOnce(() => {
			throw error
		})
		vi.spyOn(console, 'error').mockImplementation(() => {})

		buildPrototype()

		expect(getBuildResult()).toEqual({ state: 'error', error })
	})
})
