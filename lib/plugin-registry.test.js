import http from 'node:http'
import { gzipSync } from 'node:zlib'

import { pack } from 'tar-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	CONFIG_FILE,
	createPluginRegistry,
	isExactVersion,
	isStableVersion,
	isValidPackageName,
	normalisePluginDependencies
} from './plugin-registry.js'

const CONFIG_ENTRY = `package/${CONFIG_FILE}`

let server
let baseUrl
let handler
let requests
let accepts

function send(response, body, status = 200, headers = {}) {
	response.writeHead(status, {
		'content-length': Buffer.byteLength(body),
		...headers
	})
	response.end(body)
}

function sendJson(response, value, status = 200) {
	send(response, JSON.stringify(value), status, { 'content-type': 'application/json' })
}

function metadata({ packageName = 'plugin', latest = '1.1.0', versions = ['1.0.0', '1.1.0'], tarball } = {}) {
	const name = packageName.startsWith('@') ? packageName.split('/')[1] : packageName
	const archive = tarball ?? ((version) => `${baseUrl}/${packageName}/-/${name}-${version}.tgz`)
	const versionData = {}

	for (const version of versions) {
		versionData[version] = { version, dist: { tarball: archive(version) } }
	}

	return { 'dist-tags': { latest }, versions: versionData }
}

const metadataPath = (packageName) => `/${packageName.replace('/', '%2F')}`

function tarballPath(packageName, version) {
	const name = packageName.startsWith('@') ? packageName.split('/')[1] : packageName
	return `/${packageName}/-/${name}-${version}.tgz`
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
	const archivePath = tarballPath(packageName, version)
	const archiveUrl = `${baseUrl}${archivePath}`

	handler = (request, response) => {
		if (request.url === metadataPath(packageName)) {
			sendJson(response, metadata({ packageName, latest: version, versions: [version], tarball: () => archiveUrl }))
			return
		}

		if (request.url === archivePath) {
			send(response, archive)
			return
		}

		sendJson(response, {}, 404)
	}
}

function createRegistry(options = {}) {
	return createPluginRegistry({
		registryUrl: baseUrl,
		requestTimeoutMs: 1000,
		...options
	})
}

beforeEach(async () => {
	requests = []
	accepts = []
	handler = (request, response) => sendJson(response, {}, 404)
	server = http.createServer((request, response) => {
		requests.push(request.url)
		accepts.push(request.headers.accept)
		return handler(request, response)
	})

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterEach(async () => {
	server.closeAllConnections?.()
	await new Promise((resolve) => server.close(resolve))
	vi.restoreAllMocks()
})

describe('validation', () => {
	it('recognises package names and exact stable versions', () => {
		expect(isValidPackageName('govuk-frontend')).toBe(true)
		expect(isValidPackageName('@govuk-prototype-kit/step-by-step')).toBe(true)
		expect(isValidPackageName('@scope/plugin.js')).toBe(true)
		expect(isValidPackageName('bad name')).toBe(false)
		expect(isValidPackageName('@scope')).toBe(false)
		expect(isValidPackageName('@scope/extra/name')).toBe(false)
		expect(isValidPackageName('.hidden')).toBe(false)

		expect(isExactVersion('1.2.3')).toBe(true)
		expect(isExactVersion('1.2.3-beta.1')).toBe(true)
		expect(isExactVersion('1.2.3+build.1')).toBe(true)
		expect(isExactVersion('1.2.3-beta.1+build.1')).toBe(true)
		expect(isExactVersion('v1.2.3')).toBe(false)
		expect(isExactVersion('^1.2.3')).toBe(false)
		expect(isExactVersion('1.2')).toBe(false)

		expect(isStableVersion('1.2.3')).toBe(true)
		expect(isStableVersion('1.2.3+build.1')).toBe(true)
		expect(isStableVersion('1.2.3-beta.1')).toBe(false)
	})

	it('rejects invalid names, versions and insecure registry URLs before fetching', async () => {
		expect(() => createRegistry({ fetch: null })).toThrow(expect.objectContaining({ name: 'PluginRegistryError' }))
		expect(() => createRegistry({ registryUrl: 'not a url' })).toThrow(/Invalid registry URL/)
		expect(() => createRegistry({ registryUrl: 'http://example.com' })).toThrow(/expected https/)
		expect(() => createRegistry({ registryUrl: 'ftp://example.com' })).toThrow(/expected https/)

		const registry = createRegistry()

		await expect(registry.getPackageMetadata('bad name')).rejects.toThrow(/Invalid package name/)
		await expect(registry.getConfig('plugin', '^1.0.0')).rejects.toThrow(/not an exact version/)
		await expect(registry.getUpdateInfo('plugin', '^1.0.0')).rejects.toThrow(/not an exact version/)
		expect(requests).toEqual([])
	})
})

describe('metadata', () => {
	it('fetches version data with the abbreviated response format', async () => {
		handler = (request, response) => sendJson(response, metadata())

		const result = await createRegistry().getPackageMetadata('plugin')

		expect(result).toEqual({
			packageName: 'plugin',
			latestVersion: '1.1.0',
			versions: ['1.0.0', '1.1.0'],
			stableVersions: ['1.0.0', '1.1.0'],
			archiveUrls: {
				'1.0.0': `${baseUrl}/plugin/-/plugin-1.0.0.tgz`,
				'1.1.0': `${baseUrl}/plugin/-/plugin-1.1.0.tgz`
			}
		})
		expect(requests).toEqual(['/plugin'])
		expect(accepts).toEqual(['application/vnd.npm.install-v1+json'])
	})

	it('encodes scoped package names and keeps prereleases out of the stable list', async () => {
		handler = (request, response) =>
			sendJson(response, metadata({ latest: '2.0.0', versions: ['1.0.0', '2.0.0-beta.1', '2.0.0'] }))

		const result = await createRegistry().getPackageMetadata('@scope/plugin')

		expect(requests).toEqual(['/@scope%2Fplugin'])
		expect(result.versions).toEqual(['1.0.0', '2.0.0-beta.1', '2.0.0'])
		expect(result.stableVersions).toEqual(['1.0.0', '2.0.0'])
	})

	it('rejects unusable metadata', async () => {
		handler = (request, response) =>
			sendJson(response, { 'dist-tags': { latest: '1.1.0-beta.1' }, versions: { '1.1.0-beta.1': {} } })
		await expect(createRegistry().getPackageMetadata('plugin')).rejects.toThrow(/stable latest version/)

		handler = (request, response) => sendJson(response, metadata({ latest: '2.0.0' }))
		await expect(createRegistry().getPackageMetadata('plugin')).rejects.toThrow(/did not include its latest/)

		handler = (request, response) => sendJson(response, { 'dist-tags': {}, versions: [] })
		await expect(createRegistry().getPackageMetadata('plugin')).rejects.toThrow(/expected shape/)

		handler = (request, response) => send(response, 'not json')
		await expect(createRegistry().getPackageMetadata('plugin')).rejects.toThrow(/not valid JSON/)

		handler = (request, response) => sendJson(response, { error: 'missing' }, 404)
		await expect(createRegistry().getPackageMetadata('plugin')).rejects.toThrow(/HTTP 404/)
	})

	it('follows redirects', async () => {
		handler = (request, response) => {
			if (request.url === '/plugin') {
				response.writeHead(302, { location: '/metadata/plugin' })
				response.end()
				return
			}

			sendJson(response, metadata())
		}

		const result = await createRegistry().getPackageMetadata('plugin')

		expect(result.latestVersion).toBe('1.1.0')
		expect(requests).toEqual(['/plugin', '/metadata/plugin'])
	})

	it('caps responses, times out slow requests and reports network failures', async () => {
		handler = (request, response) => sendJson(response, metadata())
		await expect(createRegistry({ maxBytes: 10 }).getPackageMetadata('plugin')).rejects.toThrow(/larger than 10/)

		handler = () => {}
		await expect(createRegistry({ requestTimeoutMs: 20 }).getPackageMetadata('plugin')).rejects.toThrow(/Timed out/)

		const fetch = vi.fn().mockRejectedValue(new Error('offline'))
		await expect(createRegistry({ fetch }).getPackageMetadata('plugin')).rejects.toThrow(/Could not fetch.*offline/)
	})

	it('reports an update when latest is newer', async () => {
		handler = (request, response) => sendJson(response, metadata())

		expect(await createRegistry().getUpdateInfo('plugin', '1.0.0')).toEqual({
			packageName: 'plugin',
			installedVersion: '1.0.0',
			latestVersion: '1.1.0',
			updateAvailable: true
		})
		expect((await createRegistry().getUpdateInfo('plugin', '1.1.0')).updateAvailable).toBe(false)
		expect((await createRegistry().getUpdateInfo('plugin', '2.0.0')).updateAvailable).toBe(false)
	})
})

describe('configs', () => {
	it('reads plugin dependencies from the archive and normalises them', async () => {
		const config = {
			pluginDependencies: [
				'dep',
				{ packageName: '@scope/dep', minVersion: '1.0.0', maxVersion: '2.0.0', description: 'ignored' }
			],
			sass: '/sass/plugin.scss'
		}
		await serveConfig(config)

		const result = await createRegistry().getConfig('plugin', '1.0.0')

		expect(result).toEqual({
			packageName: 'plugin',
			version: '1.0.0',
			config,
			pluginDependencies: [
				{ packageName: 'dep' },
				{ packageName: '@scope/dep', minVersion: '1.0.0', maxVersion: '2.0.0' }
			]
		})
		expect(requests).toEqual([metadataPath('plugin'), tarballPath('plugin', '1.0.0')])
	})

	it('uses a non-conventional archive URL for scoped packages', async () => {
		const archive = await tarball([{ name: CONFIG_ENTRY, content: '{"pluginDependencies":["dep"]}' }])
		const archiveUrl = `${baseUrl}/downloads/custom.tgz`

		handler = (request, response) => {
			if (request.url === metadataPath('@scope/plugin')) {
				sendJson(
					response,
					metadata({ packageName: '@scope/plugin', latest: '1.0.0', versions: ['1.0.0'], tarball: () => archiveUrl })
				)
				return
			}

			if (request.url === '/downloads/custom.tgz') {
				send(response, archive)
				return
			}

			sendJson(response, {}, 404)
		}

		const result = await createRegistry().getConfig('@scope/plugin', '1.0.0')

		expect(result.pluginDependencies).toEqual([{ packageName: 'dep' }])
		expect(requests).toEqual([metadataPath('@scope/plugin'), '/downloads/custom.tgz'])
	})

	it('supports build metadata and returns no dependencies for an empty config', async () => {
		await serveConfig({}, { version: '1.0.0+build.1' })

		const result = await createRegistry().getConfig('plugin', '1.0.0+build.1')

		expect(result.version).toBe('1.0.0+build.1')
		expect(result.pluginDependencies).toEqual([])
	})

	it('uses the exact config for the requested version', async () => {
		const first = await tarball([{ name: CONFIG_ENTRY, content: '{"pluginDependencies":["dep"]}' }])
		const second = await tarball([{ name: CONFIG_ENTRY, content: '{"pluginDependencies":["@scope/dep"]}' }])
		const firstPath = tarballPath('plugin', '1.0.0')
		const secondPath = tarballPath('plugin', '2.0.0')

		handler = (request, response) => {
			if (request.url === metadataPath('plugin')) {
				sendJson(
					response,
					metadata({
						latest: '2.0.0',
						versions: ['1.0.0', '2.0.0'],
						tarball: (version) => `${baseUrl}${tarballPath('plugin', version)}`
					})
				)
				return
			}

			send(response, request.url === firstPath ? first : second)
		}

		const registry = createRegistry()

		expect((await registry.getConfig('plugin', '1.0.0')).pluginDependencies).toEqual([{ packageName: 'dep' }])
		expect((await registry.getConfig('plugin', '2.0.0')).pluginDependencies).toEqual([{ packageName: '@scope/dep' }])
		expect(requests).toEqual([metadataPath('plugin'), firstPath, secondPath])
	})

	it('rejects missing, malformed, oversized and corrupt configs', async () => {
		const missingArchive = await tarball([{ name: 'package/package.json', content: '{}' }])
		const malformedArchive = await tarball([{ name: CONFIG_ENTRY, content: '{ not json' }])
		const arrayArchive = await tarball([{ name: CONFIG_ENTRY, content: '[]' }])
		const archives = [missingArchive, malformedArchive, arrayArchive]

		for (const archive of archives) {
			handler = (request, response) => {
				if (request.url === metadataPath('plugin')) {
					sendJson(response, metadata({ latest: '1.0.0', versions: ['1.0.0'] }))
					return
				}

				send(response, archive)
			}

			await expect(createRegistry().getConfig('plugin', '1.0.0')).rejects.toThrow(/config/)
		}

		await serveConfig({}, { version: '1.0.0' })
		await expect(createRegistry({ maxBytes: 10 }).getConfig('plugin', '1.0.0')).rejects.toThrow(/larger than 10/)

		const corrupt = Buffer.from('not a gzip archive')
		handler = (request, response) => {
			if (request.url === metadataPath('plugin')) {
				sendJson(response, metadata({ latest: '1.0.0', versions: ['1.0.0'] }))
				return
			}

			send(response, corrupt)
		}

		await expect(createRegistry().getConfig('plugin', '1.0.0')).rejects.toThrow(/Could not read archive/)
	})

	it('rejects metadata without an archive URL for the version', async () => {
		handler = (request, response) =>
			sendJson(response, metadata({ latest: '1.0.0', versions: ['1.0.0'], tarball: () => undefined }))

		await expect(createRegistry().getConfig('plugin', '1.0.0')).rejects.toThrow(/archive URL/)
		expect(requests).toEqual([metadataPath('plugin')])
	})

	it('rejects invalid plugin dependency metadata without caching a config', async () => {
		await serveConfig({ pluginDependencies: [{ packageName: 'dep', minVersion: '^1.0.0' }] })

		await expect(createRegistry().getConfig('plugin', '1.0.0')).rejects.toThrow(/invalid minVersion/)
	})
})

describe('caching', () => {
	it('caches metadata until it expires and does not cache failures', async () => {
		handler = (request, response) => sendJson(response, metadata())

		let time = 1000
		const registry = createRegistry({ metadataTtlMs: 100, now: () => time })

		await registry.getPackageMetadata('plugin')
		await registry.getPackageMetadata('plugin')
		expect(requests).toHaveLength(1)

		time += 101
		await registry.getPackageMetadata('plugin')
		expect(requests).toHaveLength(2)

		registry.clearCache()
		handler = (request, response) => sendJson(response, { error: 'offline' }, 500)
		await expect(registry.getPackageMetadata('plugin')).rejects.toThrow(/HTTP 500/)

		handler = (request, response) => sendJson(response, metadata())
		expect((await registry.getPackageMetadata('plugin')).latestVersion).toBe('1.1.0')
		expect(requests).toHaveLength(4)
	})

	it('caches configs and clears both caches explicitly', async () => {
		await serveConfig({})

		const registry = createRegistry()

		await registry.getConfig('plugin', '1.0.0')
		await registry.getConfig('plugin', '1.0.0')
		expect(requests).toHaveLength(2)

		registry.clearCache()
		await registry.getConfig('plugin', '1.0.0')
		expect(requests).toHaveLength(4)
	})
})

describe('normalisePluginDependencies', () => {
	it('normalises strings, objects and single values', () => {
		expect(normalisePluginDependencies(undefined)).toEqual([])
		expect(normalisePluginDependencies('dep')).toEqual([{ packageName: 'dep' }])
		expect(normalisePluginDependencies({ packageName: 'dep', minVersion: '1.0.0' })).toEqual([
			{ packageName: 'dep', minVersion: '1.0.0' }
		])
		expect(
			normalisePluginDependencies([
				'dep',
				{ packageName: '@scope/dep', minVersion: '1.0.0', maxVersion: '2.0.0', extra: true }
			])
		).toEqual([{ packageName: 'dep' }, { packageName: '@scope/dep', minVersion: '1.0.0', maxVersion: '2.0.0' }])
	})

	it('keeps duplicate entries for the planner to resolve', () => {
		expect(normalisePluginDependencies(['dep', 'dep'])).toEqual([{ packageName: 'dep' }, { packageName: 'dep' }])
	})

	it.each([
		['a non-string value', [123]],
		['an object without a package name', [{}]],
		['an invalid package name', ['bad name']],
		['an invalid minimum version', [{ packageName: 'dep', minVersion: '^1.0.0' }]],
		['an invalid maximum version', [{ packageName: 'dep', maxVersion: 2 }]],
		['a null minimum version', [{ packageName: 'dep', minVersion: null }]],
		['a minimum above the maximum', [{ packageName: 'dep', minVersion: '2.0.0', maxVersion: '1.0.0' }]]
	])('rejects %s', (_label, dependencies) => {
		expect(() => normalisePluginDependencies(dependencies)).toThrow(
			expect.objectContaining({ name: 'PluginRegistryError' })
		)
	})
})
