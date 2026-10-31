import { EventEmitter } from 'node:events'
import crossSpawn from 'cross-spawn'
import { describe, expect, it, vi } from 'vitest'
import { isValidPackageName, runNpm } from './npm.js'

vi.mock('cross-spawn', () => ({ default: vi.fn() }))

vi.mock('../paths.js', () => ({
	getPaths: vi.fn(() => ({ project: '/project' }))
}))

function createNpmProcess() {
	const child = new EventEmitter()

	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()

	return child
}

describe('isValidPackageName', () => {
	it.each(['plugin', 'govuk-frontend', '@govuk-prototype-kit/common-templates', 'plugin.name'])(
		'accepts %s',
		(packageName) => {
			expect(isValidPackageName(packageName)).toBe(true)
		}
	)

	it.each([
		'',
		'plugin; rm -rf /',
		'plugin && npm install evil',
		'plugin name',
		'../../etc/passwd',
		'-g',
		'--save-dev',
		'@scope',
		'@scope/one/two',
		'@/name',
		'@scope/',
		'.hidden',
		'_hidden',
		'a'.repeat(215)
	])('rejects %s', (packageName) => {
		expect(isValidPackageName(packageName)).toBe(false)
	})

	it('rejects values that are not strings', () => {
		expect(isValidPackageName(undefined)).toBe(false)
		expect(isValidPackageName(['plugin'])).toBe(false)
	})
})

describe('runNpm', () => {
	it('resolves the output when npm succeeds', async () => {
		const child = createNpmProcess()
		vi.mocked(crossSpawn).mockReturnValue(child)

		const resultPromise = runNpm(['install', 'plugin'])
		child.stdout.emit('data', 'added 1 package')
		child.emit('close', 0)

		expect(await resultPromise).toEqual({ ok: true, output: 'added 1 package' })
		expect(crossSpawn).toHaveBeenCalledWith(
			'npm',
			['install', 'plugin'],
			expect.objectContaining({ shell: false, env: expect.objectContaining({ npm_config_color: 'false' }) })
		)
	})

	it('resolves the output when npm fails', async () => {
		const child = createNpmProcess()
		vi.mocked(crossSpawn).mockReturnValue(child)

		const resultPromise = runNpm(['install', 'missing-plugin'])
		child.stderr.emit('data', 'npm error 404 Not Found')
		child.emit('close', 1)

		expect(await resultPromise).toEqual({ ok: false, output: 'npm error 404 Not Found' })
	})

	it('keeps only the start of a long output', async () => {
		const child = createNpmProcess()
		vi.mocked(crossSpawn).mockReturnValue(child)

		const resultPromise = runNpm(['install', 'noisy-plugin'])
		child.stderr.emit('data', 'a'.repeat(5000))
		child.emit('close', 1)

		const result = await resultPromise
		expect(result.output).toHaveLength(4000)
	})

	it('resolves the error message when npm cannot start', async () => {
		const child = createNpmProcess()
		vi.mocked(crossSpawn).mockReturnValue(child)

		const resultPromise = runNpm(['install', 'plugin'])
		child.emit('error', new Error('spawn npm ENOENT'))

		expect(await resultPromise).toEqual({ ok: false, output: 'spawn npm ENOENT' })
	})
})
