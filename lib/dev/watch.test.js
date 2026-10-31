import { EventEmitter } from 'node:events'
import { join, sep } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('chokidar', () => ({ default: { watch: vi.fn() } }))
vi.mock('radash', () => ({
	debounce: (options, fn) => fn
}))
vi.mock('../build.js', () => ({ getBuildResult: vi.fn(), buildSass: vi.fn() }))
vi.mock('../manage-plugins/change.js', () => ({
	isChangeRunning: vi.fn(),
	rebuildAndRestart: vi.fn()
}))
vi.mock('./livereload.js', () => ({ default: { reload: vi.fn() } }))
vi.mock('../paths.js', () => ({ getPaths: vi.fn() }))
vi.mock('./supervisor.js', () => ({
	default: { restartPrototypeServer: vi.fn() }
}))

import chokidar from 'chokidar'
import { buildSass, getBuildResult } from '../build.js'
import { isChangeRunning, rebuildAndRestart } from '../manage-plugins/change.js'
import { getPaths } from '../paths.js'
import livereload from './livereload.js'
import supervisor from './supervisor.js'
import { getBackendIgnored, watch } from './watch.js'

const project = join(sep, 'project')
const paths = {
	project,
	env: join(project, '.env'),
	packageLockFile: join(project, 'package-lock.json'),
	app: join(project, 'app'),
	assets: join(project, 'app', 'assets'),
	sass: join(project, 'app', 'assets', 'sass'),
	public: join(project, '.tmp', 'public'),
	views: join(project, 'app', 'views')
}

const file = { isFile: () => true }
const dir = { isFile: () => false }

const createWatcher = () => new EventEmitter()

// watchers are created in the order watch() starts them
let watchers

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const startWatching = () => {
	watchers = []
	vi.mocked(chokidar.watch).mockImplementation(() => {
		const watcher = createWatcher()
		watchers.push(watcher)
		return watcher
	})
	watch()
	return { sassWatcher: watchers[0], backendWatcher: watchers[1], pluginWatcher: watchers[3] }
}

describe('watch', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getPaths).mockReturnValue(paths)
		vi.mocked(isChangeRunning).mockReturnValue(false)
	})

	it('watches sass, backend files, frontend files and the lockfile', () => {
		const { sassWatcher, backendWatcher } = startWatching()

		expect(sassWatcher).toBeDefined()
		expect(backendWatcher).toBeDefined()
		expect(chokidar.watch).toHaveBeenNthCalledWith(1, paths.sass, { ignoreInitial: true })
		expect(chokidar.watch).toHaveBeenNthCalledWith(2, [paths.app, paths.env], {
			ignored: expect.any(Function),
			ignoreInitial: true,
			persistent: true
		})
		expect(chokidar.watch).toHaveBeenNthCalledWith(3, [paths.public, paths.views, paths.assets], {
			ignored: { path: paths.sass, recursive: true },
			ignoreInitial: true
		})
		expect(chokidar.watch).toHaveBeenNthCalledWith(4, paths.packageLockFile, {
			ignoreInitial: true,
			disableGlobbing: true,
			awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
		})
	})

	it('restarts the prototype and reloads when a backend file changes', async () => {
		const { backendWatcher } = startWatching()

		backendWatcher.emit('all', 'change', join(paths.app, 'routes.js'))
		await settle()

		expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
		expect(livereload.reload).toHaveBeenCalledOnce()
	})

	it('restarts and reloads when sass stops compiling', async () => {
		const { sassWatcher } = startWatching()
		const previousResult = { state: 'ok' }
		const newResult = { state: 'error', error: new Error('broken sass') }
		vi.mocked(getBuildResult).mockReturnValue(previousResult)
		vi.mocked(buildSass).mockReturnValue(newResult)

		sassWatcher.emit('all', 'change', join(paths.sass, 'application.scss'))
		await settle()

		expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
		expect(livereload.reload).toHaveBeenCalledOnce()
	})

	it('restarts and reloads when sass starts compiling again', async () => {
		const { sassWatcher } = startWatching()
		const error = new Error('broken sass')
		vi.mocked(getBuildResult).mockReturnValue({ state: 'error', error })
		const newResult = { state: 'ok' }
		vi.mocked(buildSass).mockReturnValue(newResult)

		sassWatcher.emit('all', 'change', join(paths.sass, 'application.scss'))
		await settle()

		expect(supervisor.restartPrototypeServer).toHaveBeenCalledOnce()
	})

	it('does not restart when the sass error has not changed', async () => {
		const { sassWatcher } = startWatching()
		const error = new Error('broken sass')
		vi.mocked(getBuildResult).mockReturnValue({ state: 'error', error })
		vi.mocked(buildSass).mockReturnValue({ state: 'error', error })

		sassWatcher.emit('all', 'change', join(paths.sass, 'application.scss'))
		await settle()

		expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
		expect(livereload.reload).not.toHaveBeenCalled()
	})

	it('reloads the browser when a frontend file changes', async () => {
		startWatching()
		const frontendWatcher = watchers[2]

		frontendWatcher.emit('change', join(paths.views, 'index.html'))
		await settle()

		expect(livereload.reload).toHaveBeenCalledOnce()
		expect(supervisor.restartPrototypeServer).not.toHaveBeenCalled()
	})

	it('rebuilds and restarts when the lockfile changes', async () => {
		const { pluginWatcher } = startWatching()

		pluginWatcher.emit('all', 'change', paths.packageLockFile)
		await settle()

		expect(rebuildAndRestart).toHaveBeenCalledOnce()
		expect(livereload.reload).toHaveBeenCalledOnce()
	})

	it('does not rebuild or restart while a plugin change from the plugins page is running', async () => {
		const { pluginWatcher } = startWatching()
		vi.mocked(isChangeRunning).mockReturnValue(true)

		pluginWatcher.emit('all', 'change', paths.packageLockFile)
		await settle()

		expect(rebuildAndRestart).not.toHaveBeenCalled()
		expect(livereload.reload).not.toHaveBeenCalled()
	})

	it('logs a failed restart instead of throwing', async () => {
		const { backendWatcher } = startWatching()
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.mocked(supervisor.restartPrototypeServer).mockRejectedValueOnce(new Error('port in use'))

		backendWatcher.emit('all', 'change', join(paths.app, 'routes.js'))
		await settle()

		expect(errorSpy).toHaveBeenCalledWith('Could not restart the prototype: port in use')
		expect(livereload.reload).not.toHaveBeenCalled()
	})
})

describe('getBackendIgnored', () => {
	const ignored = getBackendIgnored(paths)

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
