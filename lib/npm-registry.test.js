import { gzipSync } from 'node:zlib'

import { pack } from 'tar-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRegistryCache, fetchPackageMetadata, fetchPluginConfig } from './npm-registry.js'
import { CONFIG_FILE } from './plugins.js'

const CONFIG_ENTRY = `package/${CONFIG_FILE}`
const REGISTRY = 'https://registry.npmjs.org'
const MAX_BYTES = 20 * 1024 * 1024

let routes
let requests

function packageUrl(packageName) {
	if (!packageName.startsWith('@')) {
		return `${REGISTRY}/${packageName}`
	}

	const [scope, name] = packageName.slice(1).split('/')
	return `${REGISTRY}/@${scope}%2F${name}`
}

function tarballUrl(packageName, version) {
	const name = packageName.startsWith('@') ? packageName.split('/')[1] : packageName
	return `${REGISTRY}/${packageName}/-/${name}-${version}.tgz`
}

function setJson(url, value, status = 200) {
	routes.set(
		url,
		() => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
	)
}

function setBuffer(url, body, status = 200) {
	routes.set(url, () => new Response(body, { status }))
}

function createFetch() {
	return vi.fn(async (url) => {
		requests.push(String(url))
		const route = routes.get(String(url))
		return route ? route() : new Response('', { status: 404 })
	})
}

function metadata({ packageName = 'plugin', latest = '1.1.0', versions = ['1.0.0', '1.1.0'], tarball } = {}) {
	const archive = tarball ?? ((version) => tarballUrl(packageName, version))
	const versionData = {}

	for (const version of versions) {
		versionData[version] = { version, dist: { tarball: archive(version) } }
	}

	return { 'dist-tags': { latest }, versions: versionData }
}

function tarball(entries) {
	return new Promise((resolve, reject) => {
		const archive = pack()
		const chunks = []

		archive.on('data', (chunk) => chunks.push(chunk))
		archive.on('error', reject)
		archive.on('end', () => resolve(gzipSync(Buffer.concat(chunks))))

		for (const entry of entries) {
			const content = entry.content ?? ''
			archive.entry({ name: entry.name, size: Buffer.byteLength(content) }, content)
		}

		archive.finalize()
	})
}

async function serveConfig(config, { packageName = 'plugin', version = '1.0.0' } = {}) {
	const archive = await tarball([
		{ name: 'package/package.json', content: JSON.stringify({ name: packageName, version }) },
		{ name: CONFIG_ENTRY, content: JSON.stringify(config) }
	])
	const archiveUrl = tarballUrl(packageName, version)

	setJson(
		packageUrl(packageName),
		metadata({ packageName, latest: version, versions: [version], tarball: () => archiveUrl })
	)
	setBuffer(archiveUrl, archive)
}

beforeEach(() => {
	routes = new Map()
	requests = []
	clearRegistryCache()
	vi.stubGlobal('fetch', createFetch())
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('metadata', () => {
	it('fetches version data with the abbreviated response format', async () => {
		setJson(packageUrl('plugin'), metadata())

		const result = await fetchPackageMetadata('plugin')

		expect(result).toMatchObject({
			packageName: 'plugin',
			latestVersion: '1.1.0',
			stableVersions: ['1.0.0', '1.1.0']
		})
		expect(result.versions['1.1.0'].dist.tarball).toBe(`${REGISTRY}/plugin/-/plugin-1.1.0.tgz`)
		expect(requests).toEqual([packageUrl('plugin')])
		expect(globalThis.fetch).toHaveBeenCalledWith(
			packageUrl('plugin'),
			expect.objectContaining({
				redirect: 'follow',
				headers: { accept: 'application/vnd.npm.install-v1+json' }
			})
		)
	})

	it('encodes scoped package names and keeps prereleases out of the stable list', async () => {
		setJson(packageUrl('@scope/plugin'), metadata({ latest: '2.0.0', versions: ['1.0.0', '2.0.0-beta.1', '2.0.0'] }))

		const result = await fetchPackageMetadata('@scope/plugin')

		expect(requests).toEqual([packageUrl('@scope/plugin')])
		expect(result.stableVersions).toEqual(['1.0.0', '2.0.0'])
	})

	it('rejects unusable metadata', async () => {
		setJson(packageUrl('plugin'), { 'dist-tags': { latest: '1.1.0-beta.1' }, versions: { '1.1.0-beta.1': {} } })
		await expect(fetchPackageMetadata('plugin')).rejects.toThrow(/stable latest version/)

		setJson(packageUrl('plugin'), { 'dist-tags': {}, versions: [] })
		await expect(fetchPackageMetadata('plugin')).rejects.toThrow(/expected shape/)

		setBuffer(packageUrl('plugin'), 'not json')
		await expect(fetchPackageMetadata('plugin')).rejects.toThrow(/not valid JSON/)

		setJson(packageUrl('plugin'), { error: 'missing' }, 404)
		await expect(fetchPackageMetadata('plugin')).rejects.toThrow(/HTTP 404/)
	})

	it('caps response sizes', async () => {
		setBuffer(packageUrl('plugin'), Buffer.alloc(MAX_BYTES + 1))

		await expect(fetchPackageMetadata('plugin')).rejects.toThrow(/larger than/)
	})

	it('reports timeouts and network failures', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				const error = new Error('The operation was aborted')
				error.name = 'TimeoutError'
				throw error
			})
		)
		await expect(fetchPackageMetadata('plugin')).rejects.toThrow(/Timed out/)

		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
		await expect(fetchPackageMetadata('plugin')).rejects.toThrow(/Could not fetch.*offline/)
	})
})

describe('configs', () => {
	it('reads the raw plugin dependencies from the archive', async () => {
		const config = {
			pluginDependencies: [
				'dep',
				{ packageName: '@scope/dep', minVersion: '1.0.0', maxVersion: '2.0.0', description: 'ignored' }
			],
			sass: '/sass/plugin.scss'
		}
		await serveConfig(config)

		const result = await fetchPluginConfig('plugin', '1.0.0')

		expect(result).toEqual({
			packageName: 'plugin',
			version: '1.0.0',
			config,
			pluginDependencies: config.pluginDependencies
		})
		expect(requests).toEqual([packageUrl('plugin'), tarballUrl('plugin', '1.0.0')])
	})

	it('stops reading once the config has been found', async () => {
		const archive = await tarball([
			{ name: CONFIG_ENTRY, content: '{"pluginDependencies":["dep"]}' },
			{ name: 'package/large.js', content: 'x'.repeat(10000) }
		])
		const archiveUrl = tarballUrl('plugin', '1.0.0')

		setJson(packageUrl('plugin'), metadata({ latest: '1.0.0', versions: ['1.0.0'], tarball: () => archiveUrl }))
		setBuffer(archiveUrl, archive)

		await expect(fetchPluginConfig('plugin', '1.0.0')).resolves.toMatchObject({
			pluginDependencies: ['dep']
		})
	})

	it('uses a non-conventional archive URL for scoped packages', async () => {
		const archive = await tarball([{ name: CONFIG_ENTRY, content: '{"pluginDependencies":["dep"]}' }])
		const archiveUrl = `${REGISTRY}/downloads/custom.tgz`

		setJson(
			packageUrl('@scope/plugin'),
			metadata({
				packageName: '@scope/plugin',
				latest: '1.0.0',
				versions: ['1.0.0'],
				tarball: () => archiveUrl
			})
		)
		setBuffer(archiveUrl, archive)

		const result = await fetchPluginConfig('@scope/plugin', '1.0.0')

		expect(result.pluginDependencies).toEqual(['dep'])
		expect(requests).toEqual([packageUrl('@scope/plugin'), archiveUrl])
	})

	it('supports build metadata and returns the raw config', async () => {
		await serveConfig({}, { version: '1.0.0+build.1' })

		const result = await fetchPluginConfig('plugin', '1.0.0+build.1')

		expect(result.version).toBe('1.0.0+build.1')
		expect(result.pluginDependencies).toBeUndefined()
	})

	it('uses the exact config for the requested version', async () => {
		const first = await tarball([{ name: CONFIG_ENTRY, content: '{"pluginDependencies":["dep"]}' }])
		const second = await tarball([{ name: CONFIG_ENTRY, content: '{"pluginDependencies":["@scope/dep"]}' }])
		const firstUrl = tarballUrl('plugin', '1.0.0')
		const secondUrl = tarballUrl('plugin', '2.0.0')

		setJson(
			packageUrl('plugin'),
			metadata({ latest: '2.0.0', versions: ['1.0.0', '2.0.0'], tarball: (version) => tarballUrl('plugin', version) })
		)
		setBuffer(firstUrl, first)
		setBuffer(secondUrl, second)

		expect((await fetchPluginConfig('plugin', '1.0.0')).pluginDependencies).toEqual(['dep'])
		expect((await fetchPluginConfig('plugin', '2.0.0')).pluginDependencies).toEqual(['@scope/dep'])
		expect(requests).toEqual([packageUrl('plugin'), firstUrl, secondUrl])
	})

	it('rejects missing, malformed, oversized and corrupt configs', async () => {
		const archives = [
			await tarball([{ name: 'package/package.json', content: '{}' }]),
			await tarball([{ name: CONFIG_ENTRY, content: '{ not json' }]),
			await tarball([{ name: CONFIG_ENTRY, content: '[]' }])
		]

		for (const archive of archives) {
			setJson(packageUrl('plugin'), metadata({ latest: '1.0.0', versions: ['1.0.0'] }))
			setBuffer(tarballUrl('plugin', '1.0.0'), archive)

			await expect(fetchPluginConfig('plugin', '1.0.0')).rejects.toThrow(/config/)
		}

		await serveConfig({})
		setBuffer(tarballUrl('plugin', '1.0.0'), Buffer.alloc(MAX_BYTES + 1))
		await expect(fetchPluginConfig('plugin', '1.0.0')).rejects.toThrow(/larger than/)

		setJson(packageUrl('plugin'), metadata({ latest: '1.0.0', versions: ['1.0.0'] }))
		setBuffer(tarballUrl('plugin', '1.0.0'), Buffer.from('not a gzip archive'))

		await expect(fetchPluginConfig('plugin', '1.0.0')).rejects.toThrow(/Could not read archive/)
	})

	it('rejects metadata without an archive URL for the version', async () => {
		setJson(packageUrl('plugin'), metadata({ latest: '1.0.0', versions: ['1.0.0'], tarball: () => undefined }))

		await expect(fetchPluginConfig('plugin', '1.0.0')).rejects.toThrow(/archive URL/)
		expect(requests).toEqual([packageUrl('plugin')])
	})
})

describe('caching', () => {
	it('caches metadata until it expires and does not cache failures', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1000)
		setJson(packageUrl('plugin'), metadata())

		await fetchPackageMetadata('plugin')
		await fetchPackageMetadata('plugin')
		expect(requests).toHaveLength(1)

		vi.setSystemTime(1000 + 5 * 60 * 1000 + 1)
		await fetchPackageMetadata('plugin')
		expect(requests).toHaveLength(2)

		clearRegistryCache()
		setJson(packageUrl('plugin'), { error: 'offline' }, 500)
		await expect(fetchPackageMetadata('plugin')).rejects.toThrow(/HTTP 500/)

		setJson(packageUrl('plugin'), metadata())
		expect((await fetchPackageMetadata('plugin')).latestVersion).toBe('1.1.0')
		expect(requests).toHaveLength(4)
	})

	it('caches configs and clears both caches explicitly', async () => {
		await serveConfig({})

		await fetchPluginConfig('plugin', '1.0.0')
		await fetchPluginConfig('plugin', '1.0.0')
		expect(requests).toHaveLength(2)

		clearRegistryCache()
		await fetchPluginConfig('plugin', '1.0.0')
		expect(requests).toHaveLength(4)
	})
})
