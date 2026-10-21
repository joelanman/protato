import { EventEmitter } from 'node:events'
import path from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import knownPlugins from '../known-plugins.json' with { type: 'json' }
import { isValidPackageName } from './plugin-dependencies.js'

const state = vi.hoisted(() => ({ spawn: null }))
const projectDir = path.resolve('tmp', 'project with spaces')
const plan = { operation: 'install', packages: [{ packageName: 'hmrc-frontend', version: '7.41.0' }] }

vi.mock('./paths.js', () => ({ getPaths: () => ({ project: projectDir }) }))
vi.mock('cross-spawn', () => ({ default: (...args) => state.spawn(...args) }))

let child
let runPluginNpm

function finishChild(code = 0) {
	child.exitCode = code
	child.emit('exit', code)
	child.emit('close', code)
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
			expect.objectContaining({ cwd: projectDir, shell: false })
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
		for (const [invalid, message] of [
			[{ ...plan, operation: 'remove' }, 'Unsupported npm operation: remove'],
			[{ ...plan, packages: [] }, 'A plugin plan must include at least one package'],
			[{ ...plan, packages: 'hmrc-frontend' }, 'A plugin plan must include at least one package'],
			[
				{ ...plan, packages: [plan.packages[0], { ...plan.packages[0], version: '7.42.0' }] },
				'hmrc-frontend appears more than once in the plan'
			]
		]) {
			await expect(runPluginNpm(invalid)).rejects.toMatchObject({ name: 'PluginNpmError', message })
		}
		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('rejects command, URL, path or shell input', async () => {
		for (const packageName of [
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
					name: 'PluginNpmError',
					message: `${packageName} is not a valid package name`
				})
			}
		}
		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('runs packages that are not in the known list', async () => {
		const running = runPluginNpm({
			operation: 'install',
			packages: [{ packageName: 'unknown-plugin', version: '1.0.0' }]
		})
		expect(state.spawn).toHaveBeenCalledWith(
			'npm',
			['install', '--no-audit', '--no-fund', '--save-exact', 'unknown-plugin@1.0.0'],
			expect.objectContaining({ cwd: projectDir, shell: false })
		)
		finishChild()
		await expect(running).resolves.toEqual({ ok: true, exitCode: 0, stdout: '', stderr: '' })
	})

	it('refuses to uninstall protected packages', async () => {
		for (const packageName of knownPlugins.protected) {
			await expect(runPluginNpm({ operation: 'uninstall', packages: [{ packageName }] })).rejects.toMatchObject({
				name: 'PluginNpmError',
				message: `${packageName} is protected and cannot be uninstalled`
			})
		}
		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('requires exact install versions', async () => {
		for (const version of ['^1.0.0', '~1.0.0', 'latest', '1.0', '1', '', null, 1]) {
			await expect(runPluginNpm({ ...plan, packages: [{ ...plan.packages[0], version }] })).rejects.toMatchObject({
				name: 'PluginNpmError',
				message: `hmrc-frontend needs an exact version, got: ${version}`
			})
		}
		expect(state.spawn).not.toHaveBeenCalled()
	})

	it('waits for close so output arriving after exit is included', async () => {
		let resolved = false
		const running = runPluginNpm(plan).then((result) => {
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
		const running = runPluginNpm(plan)
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
		await expect(runPluginNpm(plan)).rejects.toMatchObject({ name: 'Error', message: 'nope' })

		const running = runPluginNpm(plan)
		child.emit('error', new Error('could not spawn'))
		await expect(running).rejects.toMatchObject({
			name: 'PluginNpmError',
			message: 'Could not run npm: could not spawn'
		})
	})
})
