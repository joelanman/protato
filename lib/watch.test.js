import { EventEmitter } from 'node:events'
import { join, sep } from 'node:path'
import chokidar from 'chokidar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock side-effectful dependencies so importing watch.js doesn't start
// servers or register process handlers.
vi.mock('chokidar', () => ({ default: { watch: vi.fn() } }))
vi.mock('./build.js', () => ({ processSass: vi.fn() }))
vi.mock('./livereload.js', () => ({ default: { reload: vi.fn() } }))
vi.mock('./dev-server.js', () => ({
	default: { restartPrototype: vi.fn(), updatingPlugins: false }
}))

import { processSass } from './build.js'
import devServer from './dev-server.js'
import livereload from './livereload.js'
import { getBackendIgnored, setBuildResult, watch } from './watch.js'

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

describe('watch during plugin updates', () => {
	let watchers

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		devServer.updatingPlugins = false
		watchers = []

		vi.mocked(chokidar.watch).mockImplementation(() => {
			const watcher = new EventEmitter()
			watchers.push(watcher)
			return watcher
		})

		vi.mocked(processSass).mockReturnValue({ state: 'ok' })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

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
