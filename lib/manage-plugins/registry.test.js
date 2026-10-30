import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRegistryCache, fetchLatestVersion, hasNewVersion, isRegistryDependency } from './registry.js'

function registryResponse({ ok = true, status = 200, body = {} } = {}) {
	return {
		ok,
		status,
		json: vi.fn().mockResolvedValue(body)
	}
}

describe('manage plugins registry', () => {
	beforeEach(() => {
		clearRegistryCache()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	describe('fetchLatestVersion', () => {
		it('fetches the latest version from the npm registry', async () => {
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0' } }))
			vi.stubGlobal('fetch', fetch)

			const latestVersion = await fetchLatestVersion('asset-plugin')

			expect(latestVersion).toBe('2.0.0')
			expect(fetch).toHaveBeenCalledWith(
				'https://registry.npmjs.org/asset-plugin/latest',
				expect.objectContaining({ signal: expect.any(AbortSignal) })
			)
		})

		it('fetches a scoped package name', async () => {
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { version: '1.0.0' } }))
			vi.stubGlobal('fetch', fetch)

			await fetchLatestVersion('@govuk-prototype-kit/common-templates')

			expect(fetch).toHaveBeenCalledWith(
				'https://registry.npmjs.org/@govuk-prototype-kit/common-templates/latest',
				expect.any(Object)
			)
		})

		it('caches the latest version for 60 seconds', async () => {
			const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0' } }))
			vi.stubGlobal('fetch', fetch)

			await fetchLatestVersion('asset-plugin')
			await fetchLatestVersion('asset-plugin')

			expect(fetch).toHaveBeenCalledOnce()

			now.mockReturnValue(1000 + 60 * 1000 + 1)
			await fetchLatestVersion('asset-plugin')

			expect(fetch).toHaveBeenCalledTimes(2)
		})

		it('fetches again after the cache is cleared', async () => {
			const fetch = vi.fn().mockResolvedValue(registryResponse({ body: { version: '2.0.0' } }))
			vi.stubGlobal('fetch', fetch)

			await fetchLatestVersion('asset-plugin')
			clearRegistryCache()
			await fetchLatestVersion('asset-plugin')

			expect(fetch).toHaveBeenCalledTimes(2)
		})

		it.each([
			{
				description: 'a non-2xx response',
				response: registryResponse({ ok: false, status: 404 })
			},
			{
				description: 'a response without a version',
				response: registryResponse({ body: {} })
			},
			{
				description: 'a response with an invalid version',
				response: registryResponse({ body: { version: 'not-a-version' } })
			}
		])('returns undefined for $description', async ({ response }) => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

			expect(await fetchLatestVersion('asset-plugin')).toBeUndefined()
		})

		it('returns undefined when the request fails', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

			expect(await fetchLatestVersion('asset-plugin')).toBeUndefined()
		})

		it('returns undefined when the response is not valid JSON', async () => {
			const response = registryResponse()
			response.json.mockRejectedValue(new SyntaxError('invalid json'))
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

			expect(await fetchLatestVersion('asset-plugin')).toBeUndefined()
		})
	})

	describe('hasNewVersion', () => {
		it.each([
			{ installed: '1.0.0', latest: '1.0.1', expected: true },
			{ installed: '1.0.0', latest: '1.1.0', expected: true },
			{ installed: '1.2.0', latest: '1.10.0', expected: true },
			{ installed: '1.0.0', latest: '2.0.0', expected: true },
			{ installed: '1.0.0', latest: '1.0.0', expected: false },
			{ installed: '2.0.0', latest: '1.0.0', expected: false },
			{ installed: '1.0.0', latest: '1.0.0-beta.1', expected: false },
			{ installed: '1.0.0-beta.1', latest: '1.0.0', expected: true },
			{ installed: '1.0.0-beta.1', latest: '1.0.0-beta.2', expected: true },
			{ installed: '1.0.0-beta.2', latest: '1.0.0-beta.10', expected: true }
		])('compares $installed with $latest', ({ installed, latest, expected }) => {
			expect(hasNewVersion(installed, latest)).toBe(expected)
		})

		it.each([
			{ installed: undefined, latest: '2.0.0' },
			{ installed: '1.0.0', latest: undefined },
			{ installed: 'not-a-version', latest: '2.0.0' },
			{ installed: '1.0.0', latest: 'latest' }
		])('returns false for $installed and $latest', ({ installed, latest }) => {
			expect(hasNewVersion(installed, latest)).toBe(false)
		})
	})

	describe('isRegistryDependency', () => {
		it.each([
			'1.2.3',
			'^1.2.3',
			'~1.2.3',
			'>=1.0.0',
			'>1.0.0',
			'<=1.0.0',
			'<1.0.0',
			'=1.0.0',
			'*',
			'1.x',
			'v1.2.3',
			'1.2.3 - 2.0.0'
		])('accepts %s', (version) => {
			expect(isRegistryDependency(version)).toBe(true)
		})

		it.each([
			'file:../plugin',
			'github:owner/repo',
			'git+https://example.com/plugin.git',
			'http://example.com/plugin',
			'link:../plugin',
			'workspace:*',
			'latest',
			'v',
			'version:1',
			'xyz',
			undefined
		])('rejects %s', (version) => {
			expect(isRegistryDependency(version)).toBe(false)
		})

		it.each(['', '   '])('treats %s as any version, like npm does', (version) => {
			expect(isRegistryDependency(version)).toBe(true)
		})
	})
})
