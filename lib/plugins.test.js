import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginProject } from '../tests/helpers/plugin-project.js'
import { getPaths } from './paths.js'
import plugins from './plugins.js'

vi.mock('./paths.js', () => ({
	getPaths: vi.fn()
}))

const startPage = { name: 'Start page', path: '/templates/start.html', type: 'nunjucks' }

let dir
let projects = []

// create a real temporary project on disk and point getPaths at it
function useProject(options, { clearCache = true } = {}) {
	const project = createPluginProject(options)
	projects.push(project)
	dir = project.dir
	getPaths.mockReturnValue({ project: dir, tmp: path.join(dir, '.tmp') })
	if (clearCache) {
		plugins.clearCache()
	}
	return project
}

const projectPath = (...parts) => path.join(dir, ...parts)
const packagePath = (packageName, ...parts) => projectPath('node_modules', packageName, ...parts)
const tmpPath = (...parts) => projectPath('.tmp', ...parts)

// replace the temp directory with <dir> and use / so snapshots match on every platform
function normalisePaths(value) {
	if (typeof value === 'string') {
		return value.split(dir).join('<dir>').split('\\').join('/')
	}
	if (Array.isArray(value)) {
		return value.map(normalisePaths)
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalisePaths(entry)]))
	}
	return value
}

describe('Plugins', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		for (const project of projects) {
			project.cleanup()
		}
		projects = []
		plugins.clearCache()
		vi.restoreAllMocks()
	})

	describe('formatPackageName', () => {
		it('formats a scoped package name', () => {
			expect(plugins.formatPackageName('@govuk-prototype-kit/common-templates')).toEqual({
				name: 'Common Templates',
				publisher: 'GOV.UK Prototype Kit'
			})
		})

		it('formats an unscoped package name', () => {
			expect(plugins.formatPackageName('govuk-frontend')).toEqual({
				name: 'GOV.UK Frontend'
			})
		})

		it('formats known words and capitalises the rest', () => {
			expect(plugins.formatPackageName('@hmcts/my-TEST-plugin')).toEqual({
				name: 'My Test Plugin',
				publisher: 'HMCTS'
			})
		})
	})

	describe('getAssetPaths', () => {
		it('returns empty array when there are no plugins', () => {
			useProject({})

			expect(plugins.getAssetPaths()).toEqual([])
		})

		it('returns empty array when plugins exist but have no assets config', () => {
			useProject({ plugins: [{ packageName: 'test-plugin', config: {} }] })

			expect(plugins.getAssetPaths()).toEqual([])
		})

		it('handles multiple plugins with assets', () => {
			useProject({
				plugins: [
					{ packageName: 'plugin-one', config: { assets: ['/styles'], scripts: [{ path: '/script.js' }] } },
					{ packageName: 'plugin-two', config: { assets: ['/images'] } }
				]
			})

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/plugin-one/styles',
					filePath: packagePath('plugin-one', '/styles')
				},
				{
					serverPath: '/plugin-assets/plugin-one/script.js',
					filePath: packagePath('plugin-one', '/script.js')
				},
				{
					serverPath: '/plugin-assets/plugin-two/images',
					filePath: packagePath('plugin-two', '/images')
				}
			])
		})

		it('skips dependencies without plugin config files', () => {
			useProject({
				plugins: [
					{ packageName: 'regular-dependency' },
					{ packageName: 'plugin-dependency', config: { assets: ['/dist'] } }
				]
			})

			const result = plugins.getAssetPaths()

			expect(result).toHaveLength(1)
			expect(result[0].serverPath).toBe('/plugin-assets/plugin-dependency/dist')
		})

		it('serves the protato plugin under the govuk-prototype-kit namespace', () => {
			useProject({ plugins: [{ packageName: 'protato', config: { assets: ['/plugin/assets/images'] } }] })

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/govuk-prototype-kit/plugin/assets/images',
					filePath: packagePath('protato', '/plugin/assets/images')
				}
			])
		})
	})

	describe('getSassPaths', () => {
		it('returns sass paths when plugins have sass config', () => {
			useProject({ plugins: [{ packageName: 'sass-plugin', config: { sass: ['/scss'] } }] })

			expect(plugins.getSassPaths()).toEqual([path.join('node_modules', 'sass-plugin', '/scss')])
		})

		it('puts govuk-frontend first when present', () => {
			useProject({
				dependencies: {
					'other-plugin': '1.0.0',
					'govuk-frontend': '4.0.0',
					'another-plugin': '2.0.0'
				},
				plugins: [
					{ packageName: 'other-plugin', config: { sass: ['/sass'] } },
					{ packageName: 'govuk-frontend', config: { sass: ['/govuk'] } },
					{ packageName: 'another-plugin', config: { sass: ['/styles'] } }
				]
			})

			const result = plugins.getSassPaths()

			expect(result).toHaveLength(3)
			// govuk-frontend should be first
			expect(result[0]).toBe(path.join('node_modules', 'govuk-frontend', '/govuk'))
			expect(result).toContain(path.join('node_modules', 'other-plugin', '/sass'))
			expect(result).toContain(path.join('node_modules', 'another-plugin', '/styles'))
		})

		it('handles multiple sass paths per plugin', () => {
			useProject({ plugins: [{ packageName: 'multi-sass-plugin', config: { sass: ['/scss', '/sass', '/styles'] } }] })

			expect(plugins.getSassPaths()).toEqual([
				path.join('node_modules', 'multi-sass-plugin', '/scss'),
				path.join('node_modules', 'multi-sass-plugin', '/sass'),
				path.join('node_modules', 'multi-sass-plugin', '/styles')
			])
		})

		it('works when govuk-frontend is already first', () => {
			useProject({
				dependencies: {
					'govuk-frontend': '4.0.0',
					'other-plugin': '1.0.0'
				},
				plugins: [
					{ packageName: 'govuk-frontend', config: { sass: ['/govuk'] } },
					{ packageName: 'other-plugin', config: { sass: ['/other'] } }
				]
			})

			const result = plugins.getSassPaths()

			expect(result).toHaveLength(2)
			expect(result[0]).toBe(path.join('node_modules', 'govuk-frontend', '/govuk'))
			expect(result[1]).toBe(path.join('node_modules', 'other-plugin', '/other'))
		})
	})

	describe('getScriptPaths', () => {
		it('returns script paths when plugins have scripts config', () => {
			useProject({
				plugins: [{ packageName: 'plugin', config: { scripts: [{ path: '/main.js', type: 'module' }] } }]
			})

			expect(plugins.getScriptPaths()).toEqual([
				{
					src: '/plugin-assets/plugin/main.js',
					type: 'module'
				}
			])
		})

		it('supports legacy plugins with no type attribute', () => {
			useProject({ plugins: [{ packageName: 'plugin', config: { scripts: ['/main.js'] } }] })

			expect(plugins.getScriptPaths()).toEqual([
				{
					src: '/plugin-assets/plugin/main.js'
				}
			])
		})

		it('serves the protato plugin under the govuk-prototype-kit namespace', () => {
			useProject({
				plugins: [
					{
						packageName: 'protato',
						config: { scripts: [{ path: '/plugin/assets/javascripts/kit.js', type: 'module' }] }
					}
				]
			})

			expect(plugins.getScriptPaths()).toEqual([
				{
					src: '/plugin-assets/govuk-prototype-kit/plugin/assets/javascripts/kit.js',
					type: 'module'
				}
			])
		})
	})

	describe('getMacros', () => {
		it('returns import paths and names', () => {
			useProject({
				plugins: [
					{ packageName: 'plugin', config: { nunjucksMacros: [{ importFrom: '/macro.njk', macroName: 'macro' }] } }
				]
			})

			expect(plugins.getMacros()).toEqual([
				{
					path: '/macro.njk',
					name: 'macro'
				}
			])
		})
	})

	describe('getViewPaths', () => {
		it('returns view paths', () => {
			useProject({ plugins: [{ packageName: 'plugin', config: { nunjucksPaths: ['/views'] } }] })

			expect(plugins.getViewPaths()).toEqual([packagePath('plugin', '/views')])
		})
	})

	describe('getBaseLayoutPaths', () => {
		it('returns base layout paths (importNunjucksMacrosInto)', () => {
			useProject({
				plugins: [{ packageName: 'plugin', config: { importNunjucksMacrosInto: ['/views/base-layout.njk'] } }]
			})

			expect(plugins.getBaseLayoutPaths()).toEqual([
				{
					source: packagePath('plugin', 'views', 'base-layout.njk'),
					destination: tmpPath('views', 'plugin', 'views', 'base-layout.njk')
				}
			])
		})
	})

	describe('getTmpViewPaths', () => {
		it('returns tmp view paths (for base layouts)', () => {
			useProject({
				plugins: [
					{
						packageName: 'plugin',
						config: {
							nunjucksPaths: ['/views'],
							importNunjucksMacrosInto: ['/base-layout.njk']
						}
					}
				]
			})

			expect(plugins.getTmpViewPaths()).toEqual([tmpPath('views', 'plugin', 'views')])
		})
	})

	describe('getFilterPaths', () => {
		it('returns nunjucks filter paths', () => {
			useProject({ plugins: [{ packageName: 'plugin', config: { nunjucksFilters: ['/filters.js'] } }] })

			expect(plugins.getFilterPaths()).toEqual([packagePath('plugin', 'filters.js')])
		})
	})

	describe('getFunctionPaths', () => {
		it('returns nunjucks function paths', () => {
			useProject({ plugins: [{ packageName: 'plugin', config: { nunjucksFunctions: ['/functions.js'] } }] })

			expect(plugins.getFunctionPaths()).toEqual([packagePath('plugin', 'functions.js')])
		})
	})

	describe('cache', () => {
		it('works, and clear works', () => {
			useProject({ plugins: [{ packageName: 'plugin', config: { nunjucksFunctions: ['/functions.js'] } }] })

			const result = plugins.getFunctionPaths()

			expect(result).toEqual([packagePath('plugin', 'functions.js')])

			useProject(
				{ plugins: [{ packageName: 'plugin-2', config: { nunjucksFunctions: ['/functions-2.js'] } }] },
				{ clearCache: false }
			)

			// expect cached
			const result2 = plugins.getFunctionPaths()

			expect(result2).toEqual([projectPath('node_modules', 'plugin', 'functions.js')])

			plugins.clearCache()

			// expect changes
			const result3 = plugins.getFunctionPaths()

			expect(result3).toEqual([packagePath('plugin-2', 'functions-2.js')])
		})
	})

	describe('getTemplatesByPlugin', () => {
		it('skips plugins without templates', () => {
			useProject({ plugins: [{ packageName: 'test-plugin', config: {} }] })

			expect(plugins.getTemplatesByPlugin()).toEqual([])
		})

		it('returns templates from plugin config', () => {
			useProject({
				plugins: [{ packageName: '@govuk-prototype-kit/common-templates', config: { templates: [startPage] } }]
			})

			expect(plugins.getTemplatesByPlugin()).toEqual([
				{
					packageName: '@govuk-prototype-kit/common-templates',
					name: 'Common Templates',
					publisher: 'GOV.UK Prototype Kit',
					templates: [startPage]
				}
			])
		})

		it('groups templates by plugin', () => {
			const blankPage = { name: 'Blank page', path: '/templates/blank.html', type: 'nunjucks' }

			useProject({
				plugins: [
					{ packageName: '@govuk-prototype-kit/common-templates', config: { templates: [startPage] } },
					{ packageName: 'test-plugin', config: { templates: [blankPage] } }
				]
			})

			expect(plugins.getTemplatesByPlugin()).toEqual([
				{
					packageName: '@govuk-prototype-kit/common-templates',
					name: 'Common Templates',
					publisher: 'GOV.UK Prototype Kit',
					templates: [startPage]
				},
				{
					packageName: 'test-plugin',
					name: 'Test Plugin',
					templates: [blankPage]
				}
			])
		})

		it('accepts a single template object instead of an array', () => {
			useProject({ plugins: [{ packageName: 'test-plugin', config: { templates: startPage } }] })

			expect(plugins.getTemplatesByPlugin()).toEqual([
				{
					packageName: 'test-plugin',
					name: 'Test Plugin',
					templates: [startPage]
				}
			])
		})

		it('omits templates that are not nunjucks and warns', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

			useProject({
				plugins: [
					{
						packageName: 'test-plugin',
						config: {
							templates: [
								{ name: 'Missing type page', path: '/templates/missing.html' },
								{ name: 'Other type page', path: '/templates/other.md', type: 'markdown' }
							]
						}
					}
				]
			})

			const result = plugins.getTemplatesByPlugin()

			expect(result).toEqual([])
			expect(warnSpy).toHaveBeenCalledTimes(2)
			expect(warnSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('Omitting Missing type page from test-plugin'))
			expect(warnSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('Omitting Other type page from test-plugin'))
		})
	})

	describe('getTemplate', () => {
		it.each([
			{
				description: 'a matching package and path',
				packageName: 'test-plugin',
				templatePath: startPage.path,
				expected: startPage
			},
			{
				description: 'an unknown package',
				packageName: 'other-plugin',
				templatePath: startPage.path,
				expected: undefined
			},
			{
				description: 'an unknown path',
				packageName: 'test-plugin',
				templatePath: '/templates/other.html',
				expected: undefined
			}
		])('returns the template config for $description', ({ packageName, templatePath, expected }) => {
			useProject({ plugins: [{ packageName: 'test-plugin', config: { templates: [startPage] } }] })

			expect(plugins.getTemplate(packageName, templatePath)).toEqual(expected)
		})
	})

	describe('getTemplateFilePath', () => {
		it('returns the file path for a template inside its package', () => {
			useProject({
				plugins: [
					{
						packageName: 'test-plugin',
						config: { templates: [startPage] },
						files: { [startPage.path]: '<h1>Start page</h1>' }
					}
				]
			})

			expect(plugins.getTemplateFilePath('test-plugin', startPage.path)).toBe(
				packagePath('test-plugin', 'templates', 'start.html')
			)
		})

		it('returns undefined when the template is not in the config', () => {
			useProject({
				plugins: [
					{
						packageName: 'test-plugin',
						config: { templates: [startPage] },
						files: { [startPage.path]: '<h1>Start page</h1>' }
					}
				]
			})

			expect(plugins.getTemplateFilePath('test-plugin', '/templates/other.html')).toBeUndefined()
		})

		it('returns undefined when the file does not exist', () => {
			useProject({ plugins: [{ packageName: 'test-plugin', config: { templates: [startPage] } }] })

			expect(plugins.getTemplateFilePath('test-plugin', startPage.path)).toBeUndefined()
		})
	})

	describe('a real project with protato, govuk-frontend and common templates', () => {
		it('loads every plugin getter', () => {
			const repoRoot = path.join(import.meta.dirname, '..')
			const nodeModules = path.join(repoRoot, 'starter', 'node_modules')
			const readManifest = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts), 'utf8'))

			useProject({
				dependencies: {
					protato: '0.1.0',
					'govuk-frontend': '5.11.2',
					'@govuk-prototype-kit/common-templates': '2.0.1'
				},
				plugins: [
					{
						packageName: 'protato',
						config: readManifest(repoRoot, 'govuk-prototype-kit.config.json')
					},
					{
						packageName: 'govuk-frontend',
						config: readManifest(nodeModules, 'govuk-frontend', 'govuk-prototype-kit.config.json')
					},
					{
						packageName: '@govuk-prototype-kit/common-templates',
						config: readManifest(
							nodeModules,
							'@govuk-prototype-kit',
							'common-templates',
							'govuk-prototype-kit.config.json'
						)
					}
				]
			})

			const actual = {
				assetPaths: plugins.getAssetPaths(),
				baseLayoutPaths: plugins.getBaseLayoutPaths(),
				filterPaths: plugins.getFilterPaths(),
				functionPaths: plugins.getFunctionPaths(),
				macros: plugins.getMacros(),
				sassPaths: plugins.getSassPaths(),
				scriptPaths: plugins.getScriptPaths(),
				templatesByPlugin: plugins.getTemplatesByPlugin(),
				tmpViewPaths: plugins.getTmpViewPaths(),
				viewPaths: plugins.getViewPaths()
			}

			expect(normalisePaths(actual)).toMatchSnapshot()
		})
	})
})
