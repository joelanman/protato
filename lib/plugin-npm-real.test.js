import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { waitForFile, waitForStableFile } from '../tests/helpers/process-tree.js'
import { stopProcessTree } from './utils/stop-process-tree.js'

const PARENT = path.join(import.meta.dirname, '..', 'tests', 'fixtures', 'process-tree', 'parent.js')
const state = vi.hoisted(() => ({ projectDir: '', stdio: null, child: null }))

vi.mock('./paths.js', () => ({ getPaths: () => ({ project: state.projectDir }) }))
vi.mock('cross-spawn', async (importOriginal) => {
	const actual = await importOriginal()
	const { spawn } = await import('node:child_process')
	return {
		default: (command, args, options) => {
			if (state.stdio === null) return actual.default(command, args, options)
			state.child = spawn(process.execPath, [PARENT], {
				...options,
				env: { ...process.env, FIXTURE_DIR: state.projectDir, FIXTURE_STDIO: state.stdio }
			})
			return state.child
		}
	}
})

import { runPluginNpm } from './plugin-npm.js'

beforeEach(() => {
	state.projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato npm test-'))
	state.stdio = null
	state.child = null
})

afterEach(async () => {
	vi.restoreAllMocks()
	try {
		if (state.child) await stopProcessTree(state.child)
	} finally {
		fs.rmSync(state.projectDir, { recursive: true, force: true })
	}
})

describe('runPluginNpm with real processes', () => {
	it('uninstalls a known package offline from a project path with spaces', async () => {
		const packageDir = path.join(state.projectDir, 'node_modules', 'hmrc-frontend')
		fs.writeFileSync(
			path.join(state.projectDir, 'package.json'),
			JSON.stringify({
				name: 'fixture-project',
				version: '1.0.0',
				private: true,
				dependencies: { 'hmrc-frontend': '7.41.0' }
			})
		)
		fs.writeFileSync(path.join(state.projectDir, '.npmrc'), 'offline=true\nupdate-notifier=false\n')
		fs.mkdirSync(packageDir, { recursive: true })
		fs.writeFileSync(path.join(packageDir, 'package.json'), '{"name":"hmrc-frontend","version":"7.41.0"}')

		const result = await runPluginNpm({ operation: 'uninstall', packages: [{ packageName: 'hmrc-frontend' }] })
		expect(result, result.stderr).toMatchObject({ ok: true, exitCode: 0, timedOut: false })
		expect(
			JSON.parse(fs.readFileSync(path.join(state.projectDir, 'package.json'), 'utf8')).dependencies
		).toBeUndefined()
		expect(fs.existsSync(packageDir)).toBe(false)
	}, 120000)

	it.each(['inherit', 'ignore'])('cleans up real descendants on timeout (%s pipes)', async (stdio) => {
		state.stdio = stdio
		let timeout
		vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((callback) => {
			timeout = callback
			return 0
		})
		const running = runPluginNpm({
			operation: 'install',
			packages: [{ packageName: 'hmrc-frontend', version: '7.41.0' }]
		})
		const heartbeat = path.join(state.projectDir, 'descendant-heartbeat')
		await waitForFile(heartbeat)
		expect(await waitForStableFile(heartbeat, 150)).toBe(false)
		expect(timeout).toBeTypeOf('function')

		// Leave the parent alive here: parent-exits-first cleanup is covered
		// directly in stop-process-tree.test.js. Killing it first can also let
		// close (and normal completion) win the race against the timeout callback.
		timeout()
		expect(await running).toMatchObject({ ok: false, timedOut: true })
		expect(await waitForStableFile(heartbeat, 150)).toBe(true)
		state.child = null
	})
})
