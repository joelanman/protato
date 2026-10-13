import { join, sep } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Mock side-effectful dependencies so importing watch.js doesn't start
// servers or register process handlers.
vi.mock('chokidar', () => ({ default: { watch: vi.fn() } }))
vi.mock('./build.js', () => ({ processSass: vi.fn() }))
vi.mock('./livereload.js', () => ({ default: { reload: vi.fn() } }))
vi.mock('./server-manager.js', () => ({
	default: { restart: vi.fn(), getState: vi.fn() }
}))

import { getBackendIgnored } from './watch.js'

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
