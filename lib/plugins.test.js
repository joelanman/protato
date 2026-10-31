import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginProject } from '../tests/helpers/plugin-project.js'
import { getPaths } from './paths.js'
import plugins, { formatPackageName, readProxyConfigs } from './plugins.js'

vi.mock('./paths.js', () => ({
	getPaths: vi.fn()
}))

const startPage = { name: 'Start page', path: '/templates/start.html', type: 'nunjucks' }

let dir
let projects = []

// create a real temporary project on disk and point getPaths at it
function setupProject(options, { clearCache = true } = {}) {
	const project = createPluginProject(options)
	projects.push(project)
	dir = project.dir
	getPaths.mockReturnValue({ project: dir, app: path.join(dir, 'app'), tmp: path.join(dir, '.tmp') })
	if (clearCache) {
		plugins.clearCache()
	}
	return project
}

const packagePath = (packageName, ...parts) => path.join(dir, 'node_modules', packageName, ...parts)
const tmpPath = (...parts) => path.join(dir, '.tmp', ...parts)

// replace the temp directory with <dir> and use / so snapshots match on every platform
function normalisePaths(value) {
	if (typeof value === 'string') {
		return value.split(dir).join('<dir>').split('\\').join('/')
	}
	if (Array.isArray(value)) {
		return value.map(normalisePaths)
	}
	if (value && typeof value === 'object') {
		const normalised = {}
		for (const [key, entry] of Object.entries(value)) {
			normalised[key] = normalisePaths(entry)
		}
		return normalised
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
			expect(formatPackageName('@govuk-prototype-kit/common-templates')).toEqual({
				packageName: '@govuk-prototype-kit/common-templates',
				name: 'Common Templates',
				publisher: 'GOV.UK Prototype Kit'
			})
		})

		it('formats an unscoped package name', () => {
			expect(formatPackageName('govuk-frontend')).toEqual({
				packageName: 'govuk-frontend',
				name: 'GOV.UK Frontend'
			})
		})

		it('formats known words and capitalises the rest', () => {
			expect(formatPackageName('@hmcts/my-TEST-plugin')).toEqual({
				packageName: '@hmcts/my-TEST-plugin',
				name: 'My Test Plugin',
				publisher: 'HMCTS'
			})
		})
	})

	describe('readProxyConfigs', () => {
		it('supplies the built-in proxy configs', () => {
			setupProject({})

			const configs = readProxyConfigs()
			const accessibleAutocomplete = configs['accessible-autocomplete']
			const jquery = configs.jquery

			expect(accessibleAutocomplete.scripts).toEqual(['/dist/accessible-autocomplete.min.js'])
			expect(accessibleAutocomplete.stylesheets).toEqual(['/dist/accessible-autocomplete.min.css'])
			expect(accessibleAutocomplete.assets).toEqual(['/dist'])
			expect(accessibleAutocomplete.meta.description).toContain('autocomplete')
			expect(jquery.scripts).toEqual(['/dist/jquery.js'])
			expect(jquery.assets).toEqual(['/dist'])
			expect(jquery.meta.description).toContain('jQuery')
			expect(configs['notifications-node-client'].meta.description).toContain('GOV.UK Notify')
			expect(configs['unknown-package']).toBeUndefined()
		})

		it('lets a user config override the built-ins and add packages', () => {
			setupProject({
				files: {
					'app/plugin-proxy.json': {
						jquery: { scripts: ['/custom/jquery.js'] },
						'custom-package': { assets: ['/files'] }
					}
				}
			})

			const configs = readProxyConfigs()

			expect(configs.jquery).toEqual({ scripts: ['/custom/jquery.js'] })
			expect(configs['custom-package']).toEqual({ assets: ['/files'] })
		})

		it('warns once about an invalid user file and keeps the built-in configs', () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({ files: { 'app/plugin-proxy.json': '{ not valid json' } })

			expect(readProxyConfigs().jquery.scripts).toEqual(['/dist/jquery.js'])
			expect(readProxyConfigs().jquery.scripts).toEqual(['/dist/jquery.js'])
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn.mock.calls[0][0]).toContain('plugin-proxy.json')
		})
	})

	describe('config normalisation', () => {
		it('treats a single value as a list', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: { assets: '/files', scripts: '/main.js', stylesheets: '/css/plugin.css', sass: '/scss' },
						files: { 'files/image.png': 'png', 'main.js': 'script', 'css/plugin.css': 'body {}' }
					}
				]
			})

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/plugin/files',
					filePath: packagePath('plugin', '/files'),
					type: 'directory'
				},
				{
					serverPath: '/plugin-assets/plugin/main.js',
					filePath: packagePath('plugin', '/main.js'),
					type: 'file'
				},
				{
					serverPath: '/plugin-assets/plugin/css/plugin.css',
					filePath: packagePath('plugin', '/css/plugin.css'),
					type: 'file'
				}
			])
			expect(plugins.getScriptPaths()).toEqual([{ src: '/plugin-assets/plugin/main.js' }])
			expect(plugins.getStylesheetPaths()).toEqual(['/plugin-assets/plugin/css/plugin.css'])
			expect(plugins.getSassPaths()).toEqual(['node_modules/plugin/scss'])
		})

		it('loads a built-in proxy config for a package without a plugin config', () => {
			setupProject({
				dependencies: { jquery: '3.7.1' },
				plugins: [
					{
						packageName: 'jquery',
						version: '3.7.1',
						files: { 'dist/jquery.js': 'window.jQuery = {}' }
					}
				]
			})

			expect(plugins.getScriptPaths()).toEqual([{ src: '/plugin-assets/jquery/dist/jquery.js' }])
			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/jquery/dist',
					filePath: packagePath('jquery', 'dist'),
					type: 'directory'
				},
				{
					serverPath: '/plugin-assets/jquery/dist/jquery.js',
					filePath: packagePath('jquery', 'dist/jquery.js'),
					type: 'file'
				}
			])
		})

		it('prefers a package config over a user proxy override', () => {
			setupProject({
				dependencies: { 'asset-plugin': '1.0.0' },
				plugins: [
					{
						packageName: 'asset-plugin',
						config: { scripts: ['/shipped.js'] },
						files: { 'shipped.js': 'shipped', 'proxy.js': 'proxy' }
					}
				],
				files: {
					'app/plugin-proxy.json': {
						'asset-plugin': { scripts: ['/proxy.js'] }
					}
				}
			})

			expect(plugins.getScriptPaths()).toEqual([{ src: '/plugin-assets/asset-plugin/shipped.js' }])
		})

		it('drops parent and empty segments so a config path cannot escape its package', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: {
							stylesheets: ['/../css/../plugin.css'],
							scripts: ['css//plugin.js']
						}
					}
				]
			})

			expect(plugins.getStylesheetPaths()).toEqual(['/plugin-assets/plugin/css/plugin.css'])
			expect(plugins.getScriptPaths()).toEqual([{ src: '/plugin-assets/plugin/css/plugin.js' }])
		})

		it('adds a leading slash to config paths', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: {
							assets: 'files',
							scripts: 'main.js',
							stylesheets: 'css/plugin.css',
							sass: 'scss',
							nunjucksPaths: 'views',
							importNunjucksMacrosInto: 'views/layout.njk',
							nunjucksFilters: 'filters.js',
							nunjucksFunctions: 'functions.js',
							templates: { name: 'Start page', path: 'templates/start.html', type: 'nunjucks' }
						},
						files: { 'files/image.png': 'png', 'main.js': 'script', 'css/plugin.css': 'body {}' }
					}
				]
			})

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/plugin/files',
					filePath: packagePath('plugin', 'files'),
					type: 'directory'
				},
				{
					serverPath: '/plugin-assets/plugin/main.js',
					filePath: packagePath('plugin', 'main.js'),
					type: 'file'
				},
				{
					serverPath: '/plugin-assets/plugin/css/plugin.css',
					filePath: packagePath('plugin', 'css/plugin.css'),
					type: 'file'
				}
			])
			expect(plugins.getScriptPaths()).toEqual([{ src: '/plugin-assets/plugin/main.js' }])
			expect(plugins.getStylesheetPaths()).toEqual(['/plugin-assets/plugin/css/plugin.css'])
			expect(plugins.getSassPaths()).toEqual(['node_modules/plugin/scss'])
			expect(plugins.getViewPaths()).toEqual([tmpPath('views', 'plugin', 'views'), packagePath('plugin', 'views')])
			expect(plugins.getBaseLayoutPaths()).toEqual([
				{
					source: packagePath('plugin', 'views', 'layout.njk'),
					destination: tmpPath('views', 'plugin', 'views', 'layout.njk')
				}
			])
			expect(plugins.getFilterPaths()).toEqual([packagePath('plugin', 'filters.js')])
			expect(plugins.getFunctionPaths()).toEqual([packagePath('plugin', 'functions.js')])
			expect(plugins.getTemplatesByPlugin()).toEqual([
				{
					packageName: 'plugin',
					name: 'Plugin',
					templates: [{ name: 'Start page', path: '/templates/start.html', type: 'nunjucks' }]
				}
			])
		})

		it('returns no view paths when there are no nunjucksPaths', () => {
			setupProject({
				plugins: [{ packageName: 'plugin', config: { importNunjucksMacrosInto: ['/views/layout.njk'] } }]
			})

			expect(plugins.getViewPaths()).toEqual([])
		})

		it('warns and skips a plugin with an invalid config file', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({
				plugins: [
					{ packageName: 'bad-plugin', config: '{ not valid json' },
					{ packageName: 'good-plugin', config: { assets: ['/files'] }, files: { 'files/file.txt': 'text' } }
				]
			})

			const result = plugins.getAssetPaths()

			expect(result).toEqual([
				{
					serverPath: '/plugin-assets/good-plugin/files',
					filePath: packagePath('good-plugin', '/files'),
					type: 'directory'
				}
			])
			expect(warnSpy).toHaveBeenCalledTimes(1)
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Could not read govuk-prototype-kit.config.json for bad-plugin')
			)
		})

		it('warns and skips a plugin whose config is not an object', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({ plugins: [{ packageName: 'bad-plugin', config: '"just a string"' }] })

			expect(plugins.getAssetPaths()).toEqual([])
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Could not read govuk-prototype-kit.config.json for bad-plugin')
			)
		})

		it('warns and skips a plugin with a config value that is not a path', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({ plugins: [{ packageName: 'bad-plugin', config: { assets: [123] } }] })

			expect(plugins.getAssetPaths()).toEqual([])
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Could not read govuk-prototype-kit.config.json for bad-plugin')
			)
		})

		it('warns and skips a plugin with an invalid stylesheets config', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({
				plugins: [
					{ packageName: 'bad-plugin', config: { stylesheets: [123] } },
					{ packageName: 'good-plugin', config: { stylesheets: ['/css/plugin.css'] } }
				]
			})

			expect(plugins.getStylesheetPaths()).toEqual(['/plugin-assets/good-plugin/css/plugin.css'])
			expect(warnSpy).toHaveBeenCalledTimes(1)
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Could not read govuk-prototype-kit.config.json for bad-plugin')
			)
		})
	})

	describe('dependencies that are not plugins', () => {
		it('does not read or warn about their package.json', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({
				dependencies: { 'ordinary-dependency': '1.0.0', plugin: '1.0.0' },
				plugins: [{ packageName: 'plugin', config: { assets: ['/files'] }, files: { 'files/file.txt': 'text' } }],
				files: { 'node_modules/ordinary-dependency/package.json': '{ not valid json' }
			})

			expect(plugins.getAssetPaths()).toHaveLength(1)
			expect(warnSpy).not.toHaveBeenCalled()
		})
	})

	describe('plugin order', () => {
		it('orders protato, then govuk-frontend, then other plugins by package name', () => {
			setupProject({
				plugins: [
					{ packageName: 'zebra-plugin', config: { nunjucksPaths: ['/views'] } },
					{ packageName: 'other-plugin', config: { nunjucksPaths: ['/views'] } },
					{ packageName: 'govuk-frontend', config: { nunjucksPaths: ['/views'] } },
					{ packageName: '@scope/alpha-plugin', config: { nunjucksPaths: ['/views'] } },
					{ packageName: 'protato', config: { nunjucksPaths: ['/views'] } }
				]
			})

			// view paths are reversed, so this lists latest first
			expect(plugins.getViewPaths()).toEqual([
				packagePath('zebra-plugin', '/views'),
				packagePath('other-plugin', '/views'),
				packagePath('@scope/alpha-plugin', '/views'),
				packagePath('govuk-frontend', '/views'),
				packagePath('protato', '/views')
			])
		})
	})

	describe('getAssetPaths', () => {
		it('returns empty array when there are no plugins', () => {
			setupProject({})

			expect(plugins.getAssetPaths()).toEqual([])
		})

		it('returns empty array when plugins exist but have no assets config', () => {
			setupProject({ plugins: [{ packageName: 'test-plugin', config: {} }] })

			expect(plugins.getAssetPaths()).toEqual([])
		})

		it('handles multiple plugins with assets', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin-one',
						config: { assets: ['/styles'], scripts: [{ path: '/script.js' }] },
						files: { 'styles/main.css': 'body {}', 'script.js': 'script' }
					},
					{ packageName: 'plugin-two', config: { assets: ['/images'] }, files: { 'images/logo.png': 'png' } }
				]
			})

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/plugin-one/styles',
					filePath: packagePath('plugin-one', '/styles'),
					type: 'directory'
				},
				{
					serverPath: '/plugin-assets/plugin-one/script.js',
					filePath: packagePath('plugin-one', '/script.js'),
					type: 'file'
				},
				{
					serverPath: '/plugin-assets/plugin-two/images',
					filePath: packagePath('plugin-two', '/images'),
					type: 'directory'
				}
			])
		})

		it('tells files and directories apart without guessing from the path', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: { assets: ['/folder.with.dot', '/assets/report.pdf', '/assets/no-extension'] },
						files: {
							'folder.with.dot/file.txt': 'text',
							'assets/report.pdf': 'pdf',
							'assets/no-extension': 'no extension'
						}
					}
				]
			})

			expect(plugins.getAssetPaths().map(({ serverPath, type }) => ({ serverPath, type }))).toEqual([
				{ serverPath: '/plugin-assets/plugin/folder.with.dot', type: 'directory' },
				{ serverPath: '/plugin-assets/plugin/assets/report.pdf', type: 'file' },
				{ serverPath: '/plugin-assets/plugin/assets/no-extension', type: 'file' }
			])
		})

		it('removes trailing slashes from directory paths', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: { assets: ['/files/'] },
						files: { 'files/file.txt': 'text' }
					}
				]
			})

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/plugin/files',
					filePath: packagePath('plugin', '/files'),
					type: 'directory'
				}
			])
		})

		it('skips dependencies without plugin config files', () => {
			setupProject({
				plugins: [
					{ packageName: 'regular-dependency' },
					{
						packageName: 'plugin-dependency',
						config: { assets: ['/dist'] },
						files: { 'dist/file.js': 'script' }
					}
				]
			})

			const result = plugins.getAssetPaths()

			expect(result).toHaveLength(1)
			expect(result[0].serverPath).toBe('/plugin-assets/plugin-dependency/dist')
		})

		it('serves the protato plugin under the govuk-prototype-kit namespace', () => {
			setupProject({
				plugins: [
					{
						packageName: 'protato',
						config: { assets: ['/plugin/assets/images'] },
						files: { 'plugin/assets/images/unbranded.ico': 'icon' }
					}
				]
			})

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/govuk-prototype-kit/plugin/assets/images',
					filePath: packagePath('protato', '/plugin/assets/images'),
					type: 'directory'
				}
			])
		})

		it('includes declared stylesheets without an assets entry', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: { stylesheets: ['/css/plugin.css'] },
						files: { 'css/plugin.css': 'body {}' }
					}
				]
			})

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/plugin/css/plugin.css',
					filePath: packagePath('plugin', '/css/plugin.css'),
					type: 'file'
				}
			])
		})

		it('warns and skips declared targets that do not exist', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

			setupProject({
				plugins: [
					{
						packageName: 'missing-plugin',
						config: {
							assets: ['/missing', '/present'],
							scripts: ['/missing.js'],
							stylesheets: ['/missing.css']
						},
						files: { 'present/file.txt': 'text' }
					},
					{ packageName: 'good-plugin', config: { assets: ['/files'] }, files: { 'files/file.txt': 'text' } }
				]
			})

			expect(plugins.getAssetPaths()).toEqual([
				{
					serverPath: '/plugin-assets/good-plugin/files',
					filePath: packagePath('good-plugin', '/files'),
					type: 'directory'
				},
				{
					serverPath: '/plugin-assets/missing-plugin/present',
					filePath: packagePath('missing-plugin', '/present'),
					type: 'directory'
				}
			])
			expect(warnSpy).toHaveBeenCalledTimes(3)

			for (const missingPath of ['/missing', '/missing.js', '/missing.css']) {
				expect(warnSpy).toHaveBeenCalledWith(
					expect.stringContaining(
						`Plugin missing-plugin: could not read govuk-prototype-kit.config.json asset ${missingPath}`
					)
				)
			}
		})

		it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
			'warns and skips declared targets that cannot be read',
			() => {
				const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

				setupProject({
					plugins: [
						{
							packageName: 'plugin',
							config: { assets: ['/secret'] },
							files: { 'secret/file.txt': 'text' }
						}
					]
				})

				const secretDir = packagePath('plugin', 'secret')
				fs.chmodSync(secretDir, 0o000)

				try {
					expect(plugins.getAssetPaths()).toEqual([])
					expect(warnSpy).toHaveBeenCalledWith(
						expect.stringContaining('Plugin plugin: could not read govuk-prototype-kit.config.json asset /secret')
					)
				} finally {
					fs.chmodSync(secretDir, 0o755)
				}
			}
		)
	})

	describe('getSassPaths', () => {
		it('returns sass paths when plugins have sass config', () => {
			setupProject({ plugins: [{ packageName: 'sass-plugin', config: { sass: ['/scss'] } }] })

			expect(plugins.getSassPaths()).toEqual(['node_modules/sass-plugin/scss'])
		})

		it('returns sass paths in plugin order', () => {
			setupProject({
				plugins: [
					{ packageName: 'other-plugin', config: { sass: ['/sass'] } },
					{ packageName: 'govuk-frontend', config: { sass: ['/govuk'] } },
					{ packageName: 'another-plugin', config: { sass: ['/styles'] } }
				]
			})

			expect(plugins.getSassPaths()).toEqual([
				'node_modules/govuk-frontend/govuk',
				'node_modules/another-plugin/styles',
				'node_modules/other-plugin/sass'
			])
		})

		it('handles multiple sass paths per plugin', () => {
			setupProject({ plugins: [{ packageName: 'multi-sass-plugin', config: { sass: ['/scss', '/sass', '/styles'] } }] })

			expect(plugins.getSassPaths()).toEqual([
				'node_modules/multi-sass-plugin/scss',
				'node_modules/multi-sass-plugin/sass',
				'node_modules/multi-sass-plugin/styles'
			])
		})
	})

	describe('getScriptPaths', () => {
		it('returns script paths when plugins have scripts config', () => {
			setupProject({
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
			setupProject({ plugins: [{ packageName: 'plugin', config: { scripts: ['/main.js'] } }] })

			expect(plugins.getScriptPaths()).toEqual([
				{
					src: '/plugin-assets/plugin/main.js'
				}
			])
		})

		it('supports script objects that only have a path', () => {
			setupProject({ plugins: [{ packageName: 'plugin', config: { scripts: [{ path: '/main.js' }] } }] })

			expect(plugins.getScriptPaths()).toEqual([
				{
					src: '/plugin-assets/plugin/main.js'
				}
			])
		})

		it('normalises backslashes in script paths', () => {
			setupProject({ plugins: [{ packageName: 'plugin', config: { scripts: 'js\\main.js' } }] })

			expect(plugins.getScriptPaths()).toEqual([{ src: '/plugin-assets/plugin/js/main.js' }])
		})

		it('serves the protato plugin under the govuk-prototype-kit namespace', () => {
			setupProject({
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

	describe('getStylesheetPaths', () => {
		it('returns no stylesheets when there are none configured', () => {
			setupProject({ plugins: [{ packageName: 'plugin', config: {} }] })

			expect(plugins.getStylesheetPaths()).toEqual([])
		})

		it('returns a stylesheet configured as a single string', () => {
			setupProject({ plugins: [{ packageName: 'plugin', config: { stylesheets: '/css/plugin.css' } }] })

			expect(plugins.getStylesheetPaths()).toEqual(['/plugin-assets/plugin/css/plugin.css'])
		})

		it('returns stylesheets in config order', () => {
			setupProject({
				plugins: [{ packageName: 'plugin', config: { stylesheets: ['/css/first.css', '/css/second.css'] } }]
			})

			expect(plugins.getStylesheetPaths()).toEqual([
				'/plugin-assets/plugin/css/first.css',
				'/plugin-assets/plugin/css/second.css'
			])
		})

		it('adds a leading slash to stylesheet paths', () => {
			setupProject({ plugins: [{ packageName: 'plugin', config: { stylesheets: 'css/plugin.css' } }] })

			expect(plugins.getStylesheetPaths()).toEqual(['/plugin-assets/plugin/css/plugin.css'])
		})

		it('returns stylesheets in plugin order', () => {
			setupProject({
				plugins: [
					{ packageName: 'zebra-plugin', config: { stylesheets: ['/zebra.css'] } },
					{ packageName: 'protato', config: { stylesheets: ['/protato.css'] } },
					{ packageName: 'govuk-frontend', config: { stylesheets: ['/govuk.css'] } },
					{ packageName: 'alpha-plugin', config: { stylesheets: ['/alpha.css'] } }
				]
			})

			expect(plugins.getStylesheetPaths()).toEqual([
				'/plugin-assets/govuk-prototype-kit/protato.css',
				'/plugin-assets/govuk-frontend/govuk.css',
				'/plugin-assets/alpha-plugin/alpha.css',
				'/plugin-assets/zebra-plugin/zebra.css'
			])
		})

		it('returns URLs for scoped packages', () => {
			setupProject({
				plugins: [{ packageName: '@scope/plugin', config: { stylesheets: ['/css/plugin.css'] } }]
			})

			expect(plugins.getStylesheetPaths()).toEqual(['/plugin-assets/@scope/plugin/css/plugin.css'])
		})

		it('normalises backslashes in stylesheet paths for URLs and files', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: { stylesheets: 'css\\plugin.css' },
						files: { 'css/plugin.css': 'body {}' }
					}
				]
			})

			const [stylesheetPath] = plugins.getStylesheetPaths()

			expect(stylesheetPath).toBe('/plugin-assets/plugin/css/plugin.css')
			expect(stylesheetPath).not.toContain('\\')

			const [asset] = plugins.getAssetPaths()

			expect(asset.filePath).toBe(packagePath('plugin', 'css', 'plugin.css'))
			expect(fs.existsSync(asset.filePath)).toBe(true)
		})
	})

	describe('getMacros', () => {
		it('returns import paths and names', () => {
			setupProject({
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
			setupProject({ plugins: [{ packageName: 'plugin', config: { nunjucksPaths: ['/views'] } }] })

			expect(plugins.getViewPaths()).toEqual([packagePath('plugin', '/views')])
		})

		it('puts shadow layouts before the plugin views', () => {
			setupProject({
				plugins: [
					{
						packageName: 'plugin',
						config: { nunjucksPaths: ['/views'], importNunjucksMacrosInto: ['/views/layout.njk'] }
					}
				]
			})

			expect(plugins.getViewPaths()).toEqual([tmpPath('views', 'plugin', 'views'), packagePath('plugin', '/views')])
		})

		it('puts later plugins before earlier plugins', () => {
			// plugin order is alpha-plugin then zebra-plugin, so zebra-plugin wins
			setupProject({
				plugins: [
					{ packageName: 'alpha-plugin', config: { nunjucksPaths: ['/views'] } },
					{ packageName: 'zebra-plugin', config: { nunjucksPaths: ['/views'] } }
				]
			})

			expect(plugins.getViewPaths()).toEqual([
				packagePath('zebra-plugin', '/views'),
				packagePath('alpha-plugin', '/views')
			])
		})

		it('puts a later plugin before an earlier plugin shadow layout', () => {
			setupProject({
				plugins: [
					{
						packageName: 'alpha-plugin',
						config: { nunjucksPaths: ['/views'], importNunjucksMacrosInto: ['/views/layout.njk'] }
					},
					{ packageName: 'zebra-plugin', config: { nunjucksPaths: ['/views'] } }
				]
			})

			expect(plugins.getViewPaths()).toEqual([
				packagePath('zebra-plugin', '/views'),
				tmpPath('views', 'alpha-plugin', 'views'),
				packagePath('alpha-plugin', '/views')
			])
		})
	})

	describe('getBaseLayoutPaths', () => {
		it('returns base layout paths (importNunjucksMacrosInto)', () => {
			setupProject({
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

	describe('getFilterPaths', () => {
		it('returns nunjucks filter paths', () => {
			setupProject({ plugins: [{ packageName: 'plugin', config: { nunjucksFilters: ['/filters.js'] } }] })

			expect(plugins.getFilterPaths()).toEqual([packagePath('plugin', 'filters.js')])
		})
	})

	describe('getFunctionPaths', () => {
		it('returns nunjucks function paths', () => {
			setupProject({ plugins: [{ packageName: 'plugin', config: { nunjucksFunctions: ['/functions.js'] } }] })

			expect(plugins.getFunctionPaths()).toEqual([packagePath('plugin', 'functions.js')])
		})
	})

	describe('cache', () => {
		it('works, and clear works', () => {
			setupProject({ plugins: [{ packageName: 'plugin', config: { nunjucksFunctions: ['/functions.js'] } }] })

			const result = plugins.getFunctionPaths()

			expect(result).toEqual([packagePath('plugin', 'functions.js')])

			setupProject(
				{ plugins: [{ packageName: 'plugin-2', config: { nunjucksFunctions: ['/functions-2.js'] } }] },
				{ clearCache: false }
			)

			// expect cached
			const result2 = plugins.getFunctionPaths()

			expect(result2).toEqual([packagePath('plugin', 'functions.js')])

			plugins.clearCache()

			// expect changes
			const result3 = plugins.getFunctionPaths()

			expect(result3).toEqual([packagePath('plugin-2', 'functions-2.js')])
		})
	})

	describe('getTemplatesByPlugin', () => {
		it('skips plugins without templates', () => {
			setupProject({ plugins: [{ packageName: 'test-plugin', config: {} }] })

			expect(plugins.getTemplatesByPlugin()).toEqual([])
		})

		it('returns templates from plugin config', () => {
			setupProject({
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

			setupProject({
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
			setupProject({ plugins: [{ packageName: 'test-plugin', config: { templates: startPage } }] })

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

			setupProject({
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
			setupProject({ plugins: [{ packageName: 'test-plugin', config: { templates: [startPage] } }] })

			expect(plugins.getTemplate(packageName, templatePath)).toEqual(expected)
		})
	})

	describe('getTemplateFilePath', () => {
		it('returns the file path for a template inside its package', () => {
			setupProject({
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
			setupProject({
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
			setupProject({ plugins: [{ packageName: 'test-plugin', config: { templates: [startPage] } }] })

			expect(plugins.getTemplateFilePath('test-plugin', startPage.path)).toBeUndefined()
		})
	})

	describe('a real project with protato, govuk-frontend and common templates', () => {
		it('loads every plugin getter', () => {
			const repoRoot = path.join(import.meta.dirname, '..')
			const nodeModules = path.join(repoRoot, 'starter', 'node_modules')

			// link the real packages, so their files exist for asset serving
			setupProject({
				dependencies: {
					protato: '0.1.0',
					'govuk-frontend': '5.11.2',
					'@govuk-prototype-kit/common-templates': '2.0.1'
				},
				plugins: [
					{ packageName: 'protato', linkFrom: repoRoot },
					{ packageName: 'govuk-frontend', linkFrom: path.join(nodeModules, 'govuk-frontend') },
					{
						packageName: '@govuk-prototype-kit/common-templates',
						linkFrom: path.join(nodeModules, '@govuk-prototype-kit', 'common-templates')
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
				stylesheetPaths: plugins.getStylesheetPaths(),
				templatesByPlugin: plugins.getTemplatesByPlugin(),
				viewPaths: plugins.getViewPaths()
			}

			expect(normalisePaths(actual)).toMatchSnapshot()
		})
	})
})
