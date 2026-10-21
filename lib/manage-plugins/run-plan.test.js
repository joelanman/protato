import { EventEmitter } from 'node:events'
import path from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ spawn: null }))
const spawnProjectDir = path.resolve('tmp', 'project with spaces')

vi.mock('../paths.js', () => ({ getPaths: vi.fn() }))
vi.mock('cross-spawn', () => ({ default: (...args) => state.spawn(...args) }))

import { getPaths } from '../paths.js'
import { runPluginPlan } from './run-plan.js'

describe('runPluginPlan', () => {
	let child

	const plan = { action: 'install', changes: [{ packageName: 'hmrc-frontend', version: '7.41.0' }] }

	function finishChild(code = 0) {
		child.exitCode = code
		child.emit('exit', code)
		child.emit('close', code)
	}

	beforeEach(() => {
		child = Object.assign(new EventEmitter(), {
			pid: 4242,
			exitCode: null,
			signalCode: null,
			stdout: new EventEmitter(),
			stderr: new EventEmitter()
		})
		state.spawn = vi.fn(() => child)
		getPaths.mockReturnValue({ project: spawnProjectDir })
	})

	afterEach(() => vi.restoreAllMocks())

	it('runs exact installs with fixed arguments, ignoring unrelated plan properties', async () => {
		const running = runPluginPlan({
			...plan,
			changes: [{ ...plan.changes[0], args: ['--registry=https://evil.example'] }],
			flags: ['--ignore-scripts']
		})

		expect(state.spawn).toHaveBeenCalledWith(
			'npm',
			['install', '--no-audit', '--no-fund', '--save-exact', 'hmrc-frontend@7.41.0'],
			expect.objectContaining({ cwd: spawnProjectDir, shell: false })
		)
		expect(state.spawn.mock.calls[0][2]).not.toHaveProperty('detached')

		child.stdout.emit('data', Buffer.from('added 1 package\n'))
		finishChild()

		await expect(running).resolves.toEqual({
			ok: true,
			exitCode: 0,
			stdout: 'added 1 package\n',
			stderr: ''
		})
	})

	it('treats an update plan as an exact install', async () => {
		const running = runPluginPlan({
			action: 'update',
			changes: [{ packageName: 'hmrc-frontend', version: '7.42.0' }]
		})

		expect(state.spawn.mock.calls[0][1]).toEqual([
			'install',
			'--no-audit',
			'--no-fund',
			'--save-exact',
			'hmrc-frontend@7.42.0'
		])

		finishChild()
		await running
	})

	it('uninstalls without versions or --save-exact', async () => {
		const running = runPluginPlan({
			action: 'uninstall',
			changes: [{ packageName: '@ministryofjustice/frontend', version: 'ignored' }]
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

	it('rejects invalid actions and empty plans before spawning', async () => {
		for (const [invalid, message] of [
			[{ ...plan, action: 'remove' }, 'Unsupported npm operation: remove'],
			[{ ...plan, changes: [] }, 'A plugin plan must include at least one package'],
			[{ ...plan, changes: 'hmrc-frontend' }, 'A plugin plan must include at least one package']
		]) {
			await expect(runPluginPlan(invalid)).rejects.toThrow(message)
		}

		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('waits for close so output arriving after exit is included', async () => {
		let resolved = false
		const running = runPluginPlan(plan).then((result) => {
			resolved = true
			return result
		})

		child.emit('exit', 0)
		child.stdout.emit('data', Buffer.from('final output\n'))
		child.stderr.emit('data', Buffer.from('final warning\n'))
		await nextTurn()
		expect(resolved).toBe(false)

		child.emit('close', 0)
		await expect(running).resolves.toMatchObject({
			ok: true,
			stdout: 'final output\n',
			stderr: 'final warning\n'
		})
	})

	it('reports non-zero exits', async () => {
		const running = runPluginPlan(plan)
		child.stdout.emit('data', Buffer.from('some output'))
		child.stderr.emit('data', Buffer.from('ERROR'))
		finishChild(3)

		await expect(running).resolves.toEqual({
			ok: false,
			exitCode: 3,
			stdout: 'some output',
			stderr: 'ERROR'
		})
	})

	it('reports synchronous and asynchronous spawn errors', async () => {
		state.spawn.mockImplementationOnce(() => {
			throw new Error('nope')
		})
		await expect(runPluginPlan(plan)).rejects.toThrow('nope')

		const running = runPluginPlan(plan)
		child.emit('error', new Error('could not spawn'))
		await expect(running).rejects.toThrow('Could not run npm: could not spawn')
	})
})
