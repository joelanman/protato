import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readProjectDependencies } from '../plugins.js'
import { listAllPlugins } from './list.js'
import { startFetchingPluginData } from './registry.js'

vi.mock('../plugins.js', () => ({
	readProjectDependencies: vi.fn(() => ({}))
}))

vi.mock('./list.js', () => ({
	listAllPlugins: vi.fn(() => [])
}))

describe('start fetching plugin data', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		readProjectDependencies.mockReturnValue({})
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('fetches straight away, then again on the interval', async () => {
		vi.useFakeTimers()

		startFetchingPluginData({ intervalMs: 1000 })

		expect(listAllPlugins).toHaveBeenCalledTimes(1)

		await vi.advanceTimersByTimeAsync(1000)
		expect(listAllPlugins).toHaveBeenCalledTimes(2)

		await vi.advanceTimersByTimeAsync(1000)
		expect(listAllPlugins).toHaveBeenCalledTimes(3)
	})
})
