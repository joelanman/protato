import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { join, sep } from 'node:path'
import chokidar from 'chokidar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginProject } from '../tests/helpers/plugin-project.js'

// Mock side-effectful dependencies so importing watch.js doesn't start
// servers or register process handlers.
vi.mock('chokidar', () => ({ default: { watch: vi.fn() } }))
vi.mock('./build.js', () => ({ processSass: vi.fn() }))
vi.mock('./livereload.js', () => ({ default: { reload: vi.fn() } }))
vi.mock('./paths.js', () => ({ getPaths: vi.fn() }))
vi.mock('./dev-server.js', () => ({
	default: { refreshPlugins: vi.fn(), restartPrototype: vi.fn(), updatingPlugins: false }
}))

import { processSass } from './build.js'
import devServer from './dev-server.js'
import livereload from './livereload.js'
import { getPaths } from './paths.js'
import { getBackendIgnored, setBuildResult, syncPackageState, watch } from './watch.js'

const project = join(sep, 'project')
const paths = {
	project,
	env: join(project, '.env'),
	app: join(project, 'app'),
	assets: join(project, 'app', 'assets')
}

const file = { isFile: () => true }
const dir = { isFile: () => false }
const ignored = getBackendIgnored(paths)

describe('getBackendIgnored', () => {
	it('does not ignore backend js files', () => {
		expect(ignored(join(paths.app, 'routes.js'), file)).toBe(false)
		expect(ignored(join(paths.app, 'data/session-data-defaults.js'), file)).toBe(false)
	})

	it('does not ignore backend json files', () => {
		expect(ignored(join(paths.app, 'config.json'), file)).toBe(false)
	})

	it('ignores other backend file types', () => {
		expect(ignored(join(paths.app, 'notes.txt'), file)).toBe(true)
		expect(ignored(join(paths.app, 'views/index.html'), file)).toBe(true)
	})

	it('does not ignore folders so chokidar can recurse', () => {
		expect(ignored(join(paths.app, 'views'), dir)).toBeFalsy()
		expect(ignored(join(paths.app, 'data'), undefined)).toBeFalsy()
	})

	it('ignores the assets directory so chokidar does not recurse into it', () => {
		expect(ignored(paths.assets, dir)).toBe(true)
		expect(ignored(paths.assets, undefined)).toBe(true)
	})

	it('does not ignore sibling folders with a similar name', () => {
		expect(ignored(join(paths.app, 'assets-other/thing.js'), file)).toBe(false)
	})

	it('does not ignore .env', () => {
		expect(ignored(paths.env, file)).toBe(false)
		expect(ignored(paths.env, undefined)).toBe(false)
	})
})

describe('watch', () => {
	let watchers
	let project
	let projectPaths

	const packageJsonPath = () => join(project.dir, 'package.json')

	const readPackage = () => JSON.parse(fs.readFileSync(packageJsonPath(), 'utf8'))
	const writePackage = (contents) => {
		fs.writeFileSync(packageJsonPath(), typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2))
	}
	const emitPackageEvent = (event = 'change', filePath = packageJsonPath()) => {
		watchers[3].emit('all', event, filePath)
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		devServer.updatingPlugins = false
		watchers = []

		project = createPluginProject({
			dependencies: { 'govuk-frontend': '1.0.0' },
			plugins: [{ packageName: 'govuk-frontend', version: '1.0.0', config: {} }]
		})

		projectPaths = {
			project: project.dir,
			env: join(project.dir, '.env'),
			app: join(project.dir, 'app'),
			assets: join(project.dir, 'app', 'assets'),
			sass: join(project.dir, 'app', 'assets', 'sass'),
			public: join(project.dir, '.tmp', 'public'),
			views: join(project.dir, 'app', 'views')
		}

		vi.mocked(getPaths).mockReturnValue(projectPaths)

		vi.mocked(chokidar.watch).mockImplementation(() => {
			const watcher = new EventEmitter()
			watchers.push(watcher)
			return watcher
		})

		vi.mocked(processSass).mockReturnValue({ state: 'ok' })
	})

	afterEach(() => {
		vi.useRealTimers()
		project.cleanup()
	})

	describe('during plugin updates', () => {
		it('skips watcher refreshes while plugins are updating', async () => {
			watch({ state: 'ok' })
			devServer.updatingPlugins = true

			watchers[0].emit('all', 'change', 'app/assets/sass/application.scss')
			watchers[1].emit('all', 'change', 'app/routes.js')
			watchers[2].emit('change', 'app/views/index.html')
			await vi.advanceTimersByTimeAsync(250)

			expect(processSass).not.toHaveBeenCalled()
			expect(devServer.restartPrototype).not.toHaveBeenCalled()
			expect(livereload.reload).not.toHaveBeenCalled()
		})

		it('does not start a debounce for events that happen during an update', async () => {
			watch({ state: 'ok' })
			devServer.updatingPlugins = true

			watchers[0].emit('all', 'change', 'app/assets/sass/application.scss')
			watchers[1].emit('all', 'change', 'app/routes.js')
			watchers[2].emit('change', 'app/views/index.html')

			// the update finishes before any debounce would have fired
			devServer.updatingPlugins = false
			await vi.advanceTimersByTimeAsync(250)

			expect(processSass).not.toHaveBeenCalled()
			expect(devServer.restartPrototype).not.toHaveBeenCalled()
			expect(livereload.reload).not.toHaveBeenCalled()
		})

		it('passes the updated build result when restarting the backend', async () => {
			watch({ state: 'ok' })
			const errorResult = { state: 'error', error: new Error('broken') }
			setBuildResult(errorResult)

			watchers[1].emit('all', 'change', 'app/routes.js')
			await vi.advanceTimersByTimeAsync(250)

			expect(devServer.restartPrototype).toHaveBeenCalledWith(errorResult)
		})
	})

	describe('package files', () => {
		it('watches the project directory without recursing', () => {
			watch({ state: 'ok' })

			expect(chokidar.watch).toHaveBeenCalledWith(project.dir, {
				depth: 0,
				ignoreInitial: true,
				persistent: true
			})
		})

		it('refreshes once for a burst of package file events', async () => {
			watch({ state: 'ok' })
			const projectPackage = readPackage()
			projectPackage.dependencies['new-plugin'] = '1.0.0'
			writePackage(projectPackage)

			emitPackageEvent('change')
			emitPackageEvent('add')
			emitPackageEvent('change')
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).toHaveBeenCalledOnce()
		})

		it('handles editor-style replacement with unlink then add', async () => {
			watch({ state: 'ok' })
			const projectPackage = readPackage()
			projectPackage.dependencies['new-plugin'] = '1.0.0'
			writePackage(projectPackage)

			emitPackageEvent('unlink')
			emitPackageEvent('add')
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).toHaveBeenCalledOnce()
		})

		it('refreshes when a dependency is added, changed or removed', async () => {
			watch({ state: 'ok' })

			const projectPackage = readPackage()
			projectPackage.dependencies['new-plugin'] = '1.0.0'
			writePackage(projectPackage)
			emitPackageEvent()
			await vi.advanceTimersByTimeAsync(350)

			projectPackage.dependencies['new-plugin'] = '2.0.0'
			writePackage(projectPackage)
			emitPackageEvent()
			await vi.advanceTimersByTimeAsync(350)

			delete projectPackage.dependencies['new-plugin']
			writePackage(projectPackage)
			emitPackageEvent()
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).toHaveBeenCalledTimes(3)
		})

		it('ignores formatting-only and unrelated package edits', async () => {
			watch({ state: 'ok' })

			const projectPackage = readPackage()
			projectPackage.dependencies = Object.fromEntries(Object.entries(projectPackage.dependencies).reverse())
			projectPackage.scripts = { test: 'vitest' }
			fs.writeFileSync(packageJsonPath(), JSON.stringify(projectPackage, null, 4))

			emitPackageEvent()
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).not.toHaveBeenCalled()
		})

		it('ignores package files outside the project root', async () => {
			watch({ state: 'ok' })

			emitPackageEvent('change', join(project.dir, 'app', 'package.json'))
			emitPackageEvent('change', join(project.dir, 'node_modules', 'plugin', 'package.json'))
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).not.toHaveBeenCalled()
		})

		it('ignores package events while plugins are updating and records the new state', async () => {
			watch({ state: 'ok' })

			devServer.updatingPlugins = true
			const projectPackage = readPackage()
			projectPackage.dependencies['new-plugin'] = '1.0.0'
			writePackage(projectPackage)
			emitPackageEvent()
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).not.toHaveBeenCalled()

			// the dev server records the state once its own update has finished
			devServer.updatingPlugins = false
			syncPackageState()

			projectPackage.scripts = { test: 'vitest' }
			writePackage(projectPackage)
			emitPackageEvent()
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).not.toHaveBeenCalled()
		})

		it('warns about invalid JSON and recovers on a later event', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
			watch({ state: 'ok' })
			const projectPackage = readPackage()

			writePackage('{ not valid json')
			emitPackageEvent()
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).not.toHaveBeenCalled()
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read project package.json'))

			projectPackage.dependencies['new-plugin'] = '1.0.0'
			writePackage(projectPackage)
			emitPackageEvent()
			await vi.advanceTimersByTimeAsync(350)

			expect(devServer.refreshPlugins).toHaveBeenCalledOnce()
			warn.mockRestore()
		})
	})
})
