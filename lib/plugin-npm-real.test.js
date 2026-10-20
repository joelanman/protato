import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = { projectDir: '' }

vi.mock('./paths.js', () => ({ getPaths: () => ({ project: state.projectDir }) }))

import { runPluginNpm } from './plugin-npm.js'

beforeEach(() => {
	state.projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato npm test-'))
})

afterEach(() => {
	fs.rmSync(state.projectDir, { recursive: true, force: true })
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
		expect(result, result.stderr).toMatchObject({ ok: true, exitCode: 0 })
		expect(
			JSON.parse(fs.readFileSync(path.join(state.projectDir, 'package.json'), 'utf8')).dependencies
		).toBeUndefined()
		expect(fs.existsSync(packageDir)).toBe(false)
	}, 120000)
})
