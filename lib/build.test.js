import fs from 'node:fs'
import path from 'node:path'
import * as sass from 'sass'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import build from './build.js'
import getPaths from './paths.js'

// Only mock fs and sass - use real paths
vi.mock('node:fs')
vi.mock('sass')

describe('Build', () => {
	const paths = getPaths()

	beforeEach(() => {
		vi.clearAllMocks()

		vi.mocked(fs.readFileSync).mockImplementation((path) => {
			if (path === paths.sass.project) return 'project sass content'
			if (path === paths.sass.govukFrontend) return 'govuk sass content'
			return 'default content'
		})

		vi.mocked(fs.existsSync).mockReturnValue(true)
		vi.mocked(fs.mkdirSync).mockReturnValue()
		vi.mocked(fs.writeFileSync).mockReturnValue()

		vi.mocked(sass.compileString).mockReturnValue({
			css: 'compiled css content',
			sourceMap: { version: 3, sources: [] }
		})
	})

	test('Write CSS', () => {
		build()

		const expectedCssPath = path.join(paths.public.stylesheets, 'application.css')
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			expectedCssPath,
			expect.stringMatching(/.+/) // Non-empty string
		)
	})

	test('Create directories if they do not exist', () => {
		vi.mocked(fs.existsSync).mockReturnValue(false)

		build()

		expect(fs.mkdirSync).toHaveBeenCalledWith(paths.tmp)
		expect(fs.mkdirSync).toHaveBeenCalledWith(paths.public.root)
		expect(fs.mkdirSync).toHaveBeenCalledWith(paths.public.stylesheets)
	})
})
