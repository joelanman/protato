import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./build.js', () => ({ buildPrototype: vi.fn(), buildSass: vi.fn(), getBuildResult: vi.fn() }))
vi.mock('./config.js', () => ({ getConfig: vi.fn() }))
vi.mock('./dev/server.js', () => ({ default: { start: vi.fn() } }))
vi.mock('./dev/supervisor.js', () => ({ default: { setBuild: vi.fn(), startPrototypeServer: vi.fn() } }))
vi.mock('./dev/watch.js', () => ({ watch: vi.fn() }))
vi.mock('./paths.js', () => ({ getPaths: vi.fn() }))
vi.mock('./prototype-server.js', () => ({ default: { start: vi.fn() } }))

import * as build from './build.js'
import { getConfig } from './config.js'
import devServer from './dev/server.js'
import supervisor from './dev/supervisor.js'
import { watch } from './dev/watch.js'
import { getPaths } from './paths.js'
import prototypeServer from './prototype-server.js'
import { start } from './start.js'

const calledBefore = (first, second) => first.mock.invocationCallOrder[0] < second.mock.invocationCallOrder[0]

describe('start', () => {
	beforeEach(() => {
		vi.resetAllMocks()

		vi.spyOn(console, 'log').mockImplementation(() => {})

		vi.mocked(getConfig).mockReturnValue({ env: 'development', port: 3000 })
		vi.mocked(getPaths).mockReturnValue({ project: '/project' })
	})

	describe('development', () => {
		it('builds, then starts the prototype server on port + 10, the dev server and the watcher', async () => {
			await start()

			expect(calledBefore(build.buildPrototype, supervisor.startPrototypeServer)).toBe(true)
			expect(supervisor.startPrototypeServer).toHaveBeenCalledWith(3010)
			expect(supervisor.setBuild).toHaveBeenCalledWith(build)
			expect(devServer.start).toHaveBeenCalledWith({ port: 3000, prototypePort: 3010, build })
			expect(watch).toHaveBeenCalledWith({ project: '/project' }, build)
			expect(prototypeServer.start).not.toHaveBeenCalled()
		})

		it('holds the browser port until the prototype server is ready', async () => {
			let finishStarting
			vi.mocked(supervisor.startPrototypeServer).mockReturnValue(
				new Promise((resolve) => {
					finishStarting = resolve
				})
			)

			const startPromise = start()

			expect(devServer.start).not.toHaveBeenCalled()
			expect(watch).not.toHaveBeenCalled()

			finishStarting()
			await startPromise

			expect(devServer.start).toHaveBeenCalledOnce()
			expect(calledBefore(supervisor.startPrototypeServer, devServer.start)).toBe(true)
			expect(calledBefore(devServer.start, watch)).toBe(true)
		})

		it('rejects, without serving the browser port, when the prototype server fails to start', async () => {
			vi.mocked(supervisor.startPrototypeServer).mockRejectedValue(new Error('Server exited with code 1'))

			await expect(start()).rejects.toThrow('Server exited with code 1')

			expect(devServer.start).not.toHaveBeenCalled()
			expect(watch).not.toHaveBeenCalled()
		})
	})

	describe('production', () => {
		it('builds, then starts the prototype server on the browser port and nothing else', async () => {
			vi.mocked(getConfig).mockReturnValue({ env: 'production', port: 3000 })

			await start()

			expect(calledBefore(build.buildPrototype, prototypeServer.start)).toBe(true)
			expect(prototypeServer.start).toHaveBeenCalledWith({ port: 3000 })
			expect(supervisor.startPrototypeServer).not.toHaveBeenCalled()
			expect(devServer.start).not.toHaveBeenCalled()
			expect(watch).not.toHaveBeenCalled()
		})
	})

	it('reports the port it is running on', async () => {
		await start()

		expect(console.log).toHaveBeenCalledWith('Running at http://localhost:3000')
	})
})
