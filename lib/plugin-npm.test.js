import { EventEmitter } from 'node:events'
import path from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import knownPlugins from '../known-plugins.json' with { type: 'json' }
import { isValidPackageName } from './plugin-registry.js'

const state = vi.hoisted(() => ({ spawn: null, stopProcessTree: null }))
const projectDir = path.resolve('tmp', 'project with spaces')
const plan = { operation: 'install', packages: [{ packageName: 'hmrc-frontend', version: '7.41.0' }] }

vi.mock('./paths.js', () => ({ getPaths: () => ({ project: projectDir }) }))
vi.mock('cross-spawn', () => ({ default: (...args) => state.spawn(...args) }))
vi.mock('./utils/stop-process-tree.js', () => ({ stopProcessTree: (...args) => state.stopProcessTree(...args) }))

let child
let runPluginNpm

function finishChild(code = 0) {
	child.exitCode = code
	child.emit('exit', code)
	child.emit('close', code)
}

function startTimedOutRun() {
	let timeout
	vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((callback) => {
		timeout = callback
		return 0
	})
	const running = runPluginNpm(plan)
	timeout()
	return running
}

beforeEach(async () => {
	child = Object.assign(new EventEmitter(), {
		pid: 4242,
		exitCode: null,
		signalCode: null,
		stdout: new EventEmitter(),
		stderr: new EventEmitter()
	})
	state.spawn = vi.fn(() => child)
	state.stopProcessTree = vi.fn(async () => {})
	vi.resetModules()
	runPluginNpm = (await import('./plugin-npm.js')).runPluginNpm
})

afterEach(() => vi.restoreAllMocks())

describe('runPluginNpm', () => {
	it('has valid names in the bundled known list', () => {
		for (const name of [...knownPlugins.available, ...knownPlugins.protected]) {
			expect(isValidPackageName(name)).toBe(true)
		}
	})

	it('runs exact installs with fixed arguments, ignoring unrelated plan properties', async () => {
		const running = runPluginNpm({
			operation: 'install',
			packages: [{ ...plan.packages[0], args: ['--registry=https://evil.example'] }],
			flags: ['--ignore-scripts']
		})
		expect(state.spawn).toHaveBeenCalledWith(
			'npm',
			['install', '--no-audit', '--no-fund', '--save-exact', 'hmrc-frontend@7.41.0'],
			expect.objectContaining({ cwd: projectDir, shell: false, detached: process.platform !== 'win32' })
		)
		child.stdout.emit('data', Buffer.from('added 1 package\n'))
		finishChild()
		await expect(running).resolves.toEqual({
			ok: true,
			exitCode: 0,
			stdout: 'added 1 package\n',
			stderr: '',
			outputTruncated: false,
			timedOut: false
		})
	})

	it('uninstalls without versions or --save-exact', async () => {
		const running = runPluginNpm({
			operation: 'uninstall',
			packages: [{ packageName: '@ministryofjustice/frontend', version: 'ignored' }]
		})
		expect(state.spawn.mock.calls[0][1]).toEqual([
			'uninstall',
			'--no-audit',
			'--no-fund',
			'@ministryofjustice/frontend'
		])
		finishChild()
		await running
	})

	it('rejects invalid operations, empty lists and duplicate packages before spawning', async () => {
		for (const [invalid, code] of [
			[{ ...plan, operation: 'remove' }, 'INVALID_OPERATION'],
			[{ ...plan, packages: [] }, 'INVALID_PLAN'],
			[{ ...plan, packages: 'hmrc-frontend' }, 'INVALID_PLAN'],
			[{ ...plan, packages: [plan.packages[0], { ...plan.packages[0], version: '7.42.0' }] }, 'DUPLICATE_PACKAGE']
		]) {
			await expect(runPluginNpm(invalid)).rejects.toMatchObject({ code })
		}
		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('rejects unknown packages and command, URL, path or shell input', async () => {
		for (const packageName of [
			'unknown-plugin',
			'--registry=https://evil.example',
			'-g',
			'../plugin',
			'/tmp/plugin',
			'https://evil.example/plugin',
			'plugin;rm -rf /',
			'plugin && npm publish',
			'@scope',
			'a b'
		]) {
			for (const operation of ['install', 'uninstall']) {
				await expect(runPluginNpm({ operation, packages: [{ packageName, version: '1.0.0' }] })).rejects.toMatchObject({
					code: 'NOT_ALLOWED'
				})
			}
		}
		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('refuses to uninstall protected packages', async () => {
		for (const packageName of knownPlugins.protected) {
			await expect(runPluginNpm({ operation: 'uninstall', packages: [{ packageName }] })).rejects.toMatchObject({
				code: 'PROTECTED_PACKAGE'
			})
		}
		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('requires exact install versions', async () => {
		for (const version of ['^1.0.0', '~1.0.0', 'latest', '1.0', '1', '', null, 1]) {
			await expect(runPluginNpm({ ...plan, packages: [{ ...plan.packages[0], version }] })).rejects.toMatchObject({
				code: 'INVALID_VERSION'
			})
		}
		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('holds the busy slot until close and includes output arriving after exit', async () => {
		const running = runPluginNpm(plan)
		child.emit('exit', 0)
		child.stdout.emit('data', Buffer.from('final output\n'))
		child.stderr.emit('data', Buffer.from('final warning\n'))
		await nextTurn()
		await expect(runPluginNpm(plan)).rejects.toMatchObject({ code: 'BUSY' })
		child.emit('close', 0)
		await expect(running).resolves.toMatchObject({ ok: true, stdout: 'final output\n', stderr: 'final warning\n' })
	})

	it('keeps bounded output tails and reports non-zero exits', async () => {
		const running = runPluginNpm(plan)
		child.stdout.emit('data', Buffer.from(`${'x'.repeat(80 * 1024)}END`))
		child.stderr.emit('data', Buffer.from(`${'y'.repeat(80 * 1024)}ERROR`))
		finishChild(3)
		const result = await running
		expect(result).toMatchObject({ ok: false, exitCode: 3, outputTruncated: true, timedOut: false })
		expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(64 * 1024)
		expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(64 * 1024)
		expect(result.stdout.endsWith('END')).toBe(true)
		expect(result.stderr.endsWith('ERROR')).toBe(true)
	})

	it('reports synchronous and asynchronous spawn errors', async () => {
		state.spawn.mockImplementationOnce(() => {
			throw new Error('nope')
		})
		await expect(runPluginNpm(plan)).rejects.toMatchObject({ name: 'PluginNpmError', code: 'SPAWN_ERROR' })
		const running = runPluginNpm(plan)
		child.emit('error', new Error('could not spawn'))
		await expect(running).rejects.toMatchObject({ code: 'SPAWN_ERROR' })
	})

	it.each(['exit', 'close'])('waits for cleanup after a timed-out signal %s', async (event) => {
		const cleanup = Promise.withResolvers()
		state.stopProcessTree.mockReturnValue(cleanup.promise)
		const running = startTimedOutRun()
		child.emit(event, null, 'SIGKILL')
		await nextTurn()
		await expect(runPluginNpm(plan)).rejects.toMatchObject({ code: 'BUSY' })
		cleanup.resolve()
		await expect(running).resolves.toMatchObject({ ok: false, exitCode: null, timedOut: true })
		const next = runPluginNpm(plan)
		finishChild()
		await expect(next).resolves.toMatchObject({ ok: true })
	})

	it('locks further operations if timeout cleanup fails', async () => {
		state.stopProcessTree.mockRejectedValue(new Error('still running'))
		await expect(startTimedOutRun()).rejects.toMatchObject({
			code: 'CLEANUP_FAILED',
			result: { ok: false, timedOut: true }
		})
		await expect(runPluginNpm(plan)).rejects.toMatchObject({ code: 'CLEANUP_REQUIRED' })
		expect(state.spawn).toHaveBeenCalledTimes(1)
	})
})
