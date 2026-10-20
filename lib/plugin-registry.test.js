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

function sendJson(response, value, status = 200, headers = {}) {
	const body = JSON.stringify(value)

	response.writeHead(status, {
		'content-type': 'application/json',
		'content-length': Buffer.byteLength(body),
		...headers
	})
	response.end(body)
}

function sendBuffer(response, body, status = 200, headers = {}) {
	response.writeHead(status, {
		'content-length': body.length,
		...headers
	})
	response.end(body)
}

function metadata({
	packageName = 'plugin',
	latest = '1.1.0',
	versions = ['1.0.0', '1.1.0'],
	distTags,
	tarballForVersion
} = {}) {
	const name = packageName.startsWith('@') ? packageName.split('/')[1] : packageName
	const getTarball = tarballForVersion ?? ((version) => `${baseUrl}/${packageName}/-/${name}-${version}.tgz`)
	const versionData = {}

	for (const version of versions) {
		versionData[version] = { version, dist: { tarball: getTarball(version) } }
	}

	return {
		'dist-tags': distTags ?? { latest },
		versions: versionData
	}
}

function metadataPath(packageName) {
	return `/${packageName.replace('/', '%2F')}`
}

function defaultTarballPath(packageName, version) {
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
			archive.entry(
				{
					name: entry.name,
					size: Buffer.byteLength(content),
					type: entry.type ?? 'file',
					linkname: entry.linkname
				},
				content
			)
		}

		archive.finalize()
	})
}

function configEntries(config, { packageName = 'plugin', version = '1.0.0' } = {}) {
	return [
		{ name: 'package/package.json', content: JSON.stringify({ name: packageName, version }) },
		{ name: CONFIG_ENTRY, content: JSON.stringify(config) }
	]
}

async function serveRawArchive(
	archive,
	{ packageName = 'plugin', version = '1.0.0', tarballPath = defaultTarballPath(packageName, version) } = {}
) {
	const tarballUrl = `${baseUrl}${tarballPath}`

	handler = (request, response) => {
		if (request.url === metadataPath(packageName)) {
			sendJson(
				response,
				metadata({
					packageName,
					latest: version,
					versions: [version],
					tarballForVersion: () => tarballUrl
				})
			)
			return
		}

		if (request.url === tarballPath) {
			sendBuffer(response, archive)
			return
		}

		sendJson(response, {}, 404)
	}

	return { archive, tarballPath, tarballUrl }
}

async function serveArchive(entries, options = {}) {
	const archive = await tarball(entries)
	return serveRawArchive(archive, options)
}

async function serveConfig(config, options = {}) {
	return serveArchive(configEntries(config, options), options)
}

function createRegistry(options = {}) {
	return createPluginRegistry({
		allowedPackageNames: ['plugin', '@scope/plugin', 'dep', '@scope/dep'],
		registryUrl: baseUrl,
		requestTimeoutMs: 1000,
		...options
	})
}

async function expectCode(promise, code) {
	await expect(promise).rejects.toMatchObject({ name: 'PluginRegistryError', code })
}

beforeEach(async () => {
	requests = []
	handler = (request, response) => sendJson(response, {}, 404)
	server = http.createServer((request, response) => {
		requests.push(request.url)
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

describe('plugin registry', () => {
	describe('package and version validation', () => {
		it('only fetches allowlisted packages', async () => {
			const registry = createRegistry()

			await expectCode(registry.getPackageMetadata('unknown-plugin'), 'NOT_ALLOWED')

			expect(requests).toEqual([])
		})

		it('rejects invalid package names before fetching', async () => {
			const registry = createRegistry({ allowedPackageNames: ['bad name'] })

			await expectCode(registry.getPackageMetadata('bad name'), 'INVALID_PACKAGE_NAME')
			expect(requests).toEqual([])
		})

		it('rejects unsafe registry URLs', () => {
			expect(() => createRegistry({ registryUrl: 'not a url' })).toThrow(
				expect.objectContaining({ code: 'INVALID_REGISTRY_URL' })
			)
			expect(() => createRegistry({ registryUrl: 'http://example.com' })).toThrow(
				expect.objectContaining({ code: 'UNSAFE_URL' })
			)
			expect(() => createRegistry({ registryUrl: 'ftp://example.com' })).toThrow(
				expect.objectContaining({ code: 'UNSAFE_URL' })
			)
			expect(() => createRegistry({ registryUrl: 'https://user:pass@example.com' })).toThrow(
				expect.objectContaining({ code: 'UNSAFE_URL' })
			)
		})

		it('requires a fetch implementation and exact config versions', async () => {
			expect(() => createRegistry({ fetch: null })).toThrow(expect.objectContaining({ code: 'INVALID_FETCH' }))

			await expectCode(createRegistry().getConfig('plugin', '^1.0.0'), 'INVALID_VERSION')
			await expectCode(createRegistry().getConfig('plugin', 'v1.0.0'), 'INVALID_VERSION')
		})

		it('recognises valid package names and exact versions', () => {
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
	})

	describe('registry metadata', () => {
		it('fetches and returns valid version data', async () => {
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
		})

		it('encodes scoped package names', async () => {
			handler = (request, response) => sendJson(response, metadata())

			await createRegistry().getPackageMetadata('@scope/plugin')

			expect(requests).toEqual(['/@scope%2Fplugin'])
		})

		it('keeps prerelease versions out of the stable list', async () => {
			handler = (request, response) =>
				sendJson(response, metadata({ latest: '2.0.0', versions: ['1.0.0', '2.0.0-beta.1', '2.0.0'] }))

			const result = await createRegistry().getPackageMetadata('plugin')

			expect(result.versions).toEqual(['1.0.0', '2.0.0-beta.1', '2.0.0'])
			expect(result.stableVersions).toEqual(['1.0.0', '2.0.0'])
		})

		it.each([
			['missing', undefined, 'INVALID_LATEST'],
			['invalid', 'not-a-version', 'INVALID_LATEST'],
			['prerelease', '1.1.0-beta.1', 'INVALID_LATEST']
		])('rejects a %s latest tag', async (_label, latest, code) => {
			handler = (request, response) =>
				sendJson(response, {
					'dist-tags': latest === undefined ? {} : { latest },
					versions: { '1.0.0': {}, '1.1.0': {}, '1.1.0-beta.1': {} }
				})

			await expectCode(createRegistry().getPackageMetadata('plugin'), code)
		})

		it('rejects metadata whose latest version is not listed', async () => {
			handler = (request, response) => sendJson(response, metadata({ latest: '2.0.0' }))

			await expectCode(createRegistry().getPackageMetadata('plugin'), 'INVALID_METADATA')
		})

		it('rejects metadata in the wrong shape', async () => {
			handler = (request, response) => sendJson(response, { 'dist-tags': { latest: '1.0.0' }, versions: [] })

			await expectCode(createRegistry().getPackageMetadata('plugin'), 'INVALID_METADATA')
		})

		it('rejects invalid JSON and non-200 responses', async () => {
			handler = (request, response) => sendBuffer(response, Buffer.from('not json'))

			await expectCode(createRegistry().getPackageMetadata('plugin'), 'INVALID_JSON')

			handler = (request, response) => sendJson(response, { error: 'missing' }, 404)

			await expectCode(createRegistry().getPackageMetadata('plugin'), 'HTTP_ERROR')
		})

		it('bounds metadata response size', async () => {
			handler = (request, response) => sendJson(response, metadata())

			await expectCode(createRegistry({ maxMetadataBytes: 10 }).getPackageMetadata('plugin'), 'TOO_LARGE')
		})

		it('times out slow requests', async () => {
			handler = () => {}

			await expectCode(createRegistry({ requestTimeoutMs: 20 }).getPackageMetadata('plugin'), 'TIMEOUT')
		})

		it('reports network failures', async () => {
			const fetch = vi.fn().mockRejectedValue(new Error('offline'))

			await expectCode(createRegistry({ fetch }).getPackageMetadata('plugin'), 'NETWORK_ERROR')
		})

		it('wraps interrupted response bodies as network errors', async () => {
			handler = (request, response) => {
				response.writeHead(200, { 'content-length': '1000', 'content-type': 'application/json' })
				response.write('{"dist-tags":')
				response.destroy()
			}

			await expect(createRegistry().getPackageMetadata('plugin')).rejects.toMatchObject({
				name: 'PluginRegistryError',
				code: 'NETWORK_ERROR',
				packageName: 'plugin'
			})
		})

		it('follows validated loopback redirects', async () => {
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

		it('rejects too many redirects and unsafe redirect destinations', async () => {
			handler = (request, response) => {
				response.writeHead(302, { location: '/plugin' })
				response.end()
			}

			await expectCode(createRegistry({ maxRedirects: 2 }).getPackageMetadata('plugin'), 'TOO_MANY_REDIRECTS')

			handler = (request, response) => {
				response.writeHead(302, { location: 'http://example.com/plugin' })
				response.end()
			}

			await expectCode(createRegistry().getPackageMetadata('plugin'), 'UNSAFE_URL')

			handler = (request, response) => {
				response.writeHead(302, { location: 'http://[' })
				response.end()
			}

			await expectCode(createRegistry().getPackageMetadata('plugin'), 'HTTP_ERROR')
		})
	})

	describe('updates', () => {
		it('offers an update when latest is newer', async () => {
			handler = (request, response) => sendJson(response, metadata())

			expect(await createRegistry().getUpdateInfo('plugin', '1.0.0')).toEqual({
				packageName: 'plugin',
				installedVersion: '1.0.0',
				latestVersion: '1.1.0',
				updateAvailable: true
			})
		})

		it('does not offer an update when latest is the same or older', async () => {
			handler = (request, response) => sendJson(response, metadata())

			expect((await createRegistry().getUpdateInfo('plugin', '1.1.0')).updateAvailable).toBe(false)
			expect((await createRegistry().getUpdateInfo('plugin', '2.0.0')).updateAvailable).toBe(false)
		})

		it('requires an exact installed version', async () => {
			await expectCode(createRegistry().getUpdateInfo('plugin', '^1.0.0'), 'INVALID_INSTALLED_VERSION')
			expect(requests).toEqual([])
		})

		it('reports an unstable latest rather than claiming there is no update', async () => {
			handler = (request, response) =>
				sendJson(response, metadata({ latest: '2.0.0-beta.1', versions: ['1.0.0', '2.0.0-beta.1'] }))

			await expectCode(createRegistry().getUpdateInfo('plugin', '1.0.0'), 'INVALID_LATEST')
		})
	})

	describe('exact-version configs', () => {
		it('uses a built-in proxy config instead of downloading an archive', async () => {
			const registry = createRegistry({ allowedPackageNames: ['jquery'] })

			const result = await registry.getConfig('jquery', '3.7.1')

			expect(result.config.scripts).toEqual(['/dist/jquery.js'])
			expect(result.pluginDependencies).toEqual([])
			expect(requests).toEqual([])
		})

		it('reads the config and normalises dependencies from the archive', async () => {
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
			expect(requests).toEqual([metadataPath('plugin'), defaultTarballPath('plugin', '1.0.0')])
		})

		it('uses the registry archive URL for scoped packages', async () => {
			await serveConfig({}, { packageName: '@scope/plugin' })

			await createRegistry().getConfig('@scope/plugin', '1.0.0')

			expect(requests).toEqual([metadataPath('@scope/plugin'), defaultTarballPath('@scope/plugin', '1.0.0')])
		})

		it('uses a non-conventional archive URL from the metadata', async () => {
			const tarballPath = '/downloads/plugin-custom.tgz'
			await serveConfig({ pluginDependencies: ['dep'] }, { tarballPath })

			const result = await createRegistry().getConfig('plugin', '1.0.0')

			expect(result.pluginDependencies).toEqual([{ packageName: 'dep' }])
			expect(requests).toEqual([metadataPath('plugin'), tarballPath])
		})

		it('rejects metadata without an archive URL for the exact version', async () => {
			handler = (request, response) => sendJson(response, metadata({ tarballForVersion: () => undefined }))

			await expectCode(createRegistry().getConfig('plugin', '1.0.0'), 'INVALID_METADATA')
			expect(requests).toEqual([metadataPath('plugin')])
		})

		it('validates archive URLs from the metadata', async () => {
			handler = (request, response) =>
				sendJson(response, metadata({ tarballForVersion: () => 'http://example.com/plugin.tgz' }))

			await expectCode(createRegistry().getConfig('plugin', '1.0.0'), 'UNSAFE_URL')
		})

		it('does not allow loopback http downloads from an https registry', async () => {
			const fetch = vi.fn(
				async () =>
					new Response(JSON.stringify(metadata({ tarballForVersion: () => 'http://127.0.0.1/plugin.tgz' })), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
			)
			const registry = createRegistry({ fetch, registryUrl: 'https://registry.example' })

			await expectCode(registry.getConfig('plugin', '1.0.0'), 'UNSAFE_URL')

			expect(fetch).toHaveBeenCalledTimes(1)
			expect(requests).toEqual([])
		})

		it('supports exact versions with build metadata', async () => {
			const version = '1.0.0+build.1'
			await serveConfig({}, { version })

			const result = await createRegistry().getConfig('plugin', version)

			expect(result.version).toBe(version)
			expect(requests).toEqual([metadataPath('plugin'), defaultTarballPath('plugin', version)])
		})

		it('returns an empty dependency list for a valid config with none', async () => {
			await serveConfig({ sass: '/sass/plugin.scss' })

			expect((await createRegistry().getConfig('plugin', '1.0.0')).pluginDependencies).toEqual([])
		})

		it('reads configs for the exact version requested', async () => {
			const firstPath = defaultTarballPath('plugin', '1.0.0')
			const secondPath = defaultTarballPath('plugin', '2.0.0')
			const first = await tarball(configEntries({ pluginDependencies: ['dep'] }))
			const second = await tarball(configEntries({ pluginDependencies: ['@scope/dep'] }, { version: '2.0.0' }))

			handler = (request, response) => {
				if (request.url === metadataPath('plugin')) {
					sendJson(
						response,
						metadata({
							latest: '2.0.0',
							versions: ['1.0.0', '2.0.0'],
							tarballForVersion: (version) => `${baseUrl}${defaultTarballPath('plugin', version)}`
						})
					)
					return
				}

				if (request.url === firstPath) {
					sendBuffer(response, first)
					return
				}

				if (request.url === secondPath) {
					sendBuffer(response, second)
					return
				}

				sendJson(response, {}, 404)
			}

			const registry = createRegistry()

			expect((await registry.getConfig('plugin', '1.0.0')).pluginDependencies).toEqual([{ packageName: 'dep' }])
			expect((await registry.getConfig('plugin', '2.0.0')).pluginDependencies).toEqual([{ packageName: '@scope/dep' }])
			expect(requests).toEqual([metadataPath('plugin'), firstPath, secondPath])
		})

		it.each([
			['missing config', [], 'CONFIG_NOT_FOUND'],
			['malformed JSON', [{ name: CONFIG_ENTRY, content: '{ not json' }], 'INVALID_CONFIG'],
			['config that is not an object', [{ name: CONFIG_ENTRY, content: '[]' }], 'INVALID_CONFIG'],
			['config that is a directory', [{ name: CONFIG_ENTRY, type: 'directory' }], 'INVALID_CONFIG'],
			[
				'duplicate config',
				[
					{ name: CONFIG_ENTRY, content: '{}' },
					{ name: CONFIG_ENTRY, content: '{}' }
				],
				'DUPLICATE_CONFIG'
			],
			['unsafe parent path', [{ name: '../evil.txt', content: 'no' }], 'UNSAFE_ARCHIVE_PATH'],
			['unsafe absolute path', [{ name: '/evil.txt', content: 'no' }], 'UNSAFE_ARCHIVE_PATH'],
			['unsafe windows path', [{ name: 'package\\..\\evil.txt', content: 'no' }], 'UNSAFE_ARCHIVE_PATH'],
			[
				'unsafe symlink target',
				[{ name: 'package/link', type: 'symlink', linkname: '../../evil.txt' }],
				'UNSAFE_ARCHIVE_PATH'
			]
		])('rejects a %s', async (_label, entries, code) => {
			await serveArchive(entries)

			await expectCode(createRegistry().getConfig('plugin', '1.0.0'), code)
		})

		it('rejects corrupt and truncated archives', async () => {
			await serveRawArchive(Buffer.from('not a gzip archive'))

			await expectCode(createRegistry().getConfig('plugin', '1.0.0'), 'ARCHIVE_ERROR')

			const archive = await tarball(configEntries({}))
			await serveRawArchive(archive.subarray(0, Math.floor(archive.length / 2)))

			await expectCode(createRegistry().getConfig('plugin', '1.0.0'), 'ARCHIVE_ERROR')
		})

		it('bounds archive downloads, decompressed archives and config size', async () => {
			await serveConfig({})

			await expectCode(createRegistry({ maxArchiveBytes: 10 }).getConfig('plugin', '1.0.0'), 'TOO_LARGE')

			const largeCompressibleArchive = await tarball([
				{ name: 'package/big.txt', content: 'a'.repeat(10_000) },
				{ name: CONFIG_ENTRY, content: '{}' }
			])
			await serveRawArchive(largeCompressibleArchive)

			await expectCode(createRegistry({ maxArchiveBytes: 1000 }).getConfig('plugin', '1.0.0'), 'ARCHIVE_TOO_LARGE')

			await serveConfig({ sass: '/sass/plugin.scss' })

			await expectCode(createRegistry({ maxConfigBytes: 10 }).getConfig('plugin', '1.0.0'), 'CONFIG_TOO_LARGE')
		})

		it('rejects invalid plugin dependency metadata without caching a config', async () => {
			await serveConfig({ pluginDependencies: [{ packageName: 'dep', minVersion: '^1.0.0' }] })

			await expectCode(createRegistry().getConfig('plugin', '1.0.0'), 'INVALID_PLUGIN_DEPENDENCY')
		})
	})

	describe('caching', () => {
		it('caches valid metadata until it expires', async () => {
			handler = (request, response) => sendJson(response, metadata())

			let time = 1000
			const registry = createRegistry({ metadataTtlMs: 100, now: () => time })

			await registry.getPackageMetadata('plugin')
			await registry.getPackageMetadata('plugin')
			expect(requests).toHaveLength(1)

			time += 101
			await registry.getPackageMetadata('plugin')
			expect(requests).toHaveLength(2)
		})

		it('does not cache failed metadata lookups', async () => {
			handler = (request, response) => sendJson(response, { error: 'offline' }, 500)

			const registry = createRegistry()

			await expectCode(registry.getPackageMetadata('plugin'), 'HTTP_ERROR')

			handler = (request, response) => sendJson(response, metadata())

			expect((await registry.getPackageMetadata('plugin')).latestVersion).toBe('1.1.0')
			expect(requests).toHaveLength(2)
		})

		it('caches exact-version configs and clears both caches explicitly', async () => {
			await serveConfig({})

			const registry = createRegistry()

			await registry.getConfig('plugin', '1.0.0')
			await registry.getConfig('plugin', '1.0.0')
			expect(requests).toHaveLength(2)

			registry.clearCache()
			await registry.getConfig('plugin', '1.0.0')
			expect(requests).toHaveLength(4)
		})

		it('does not cache failed config lookups', async () => {
			const tarballPath = defaultTarballPath('plugin', '1.0.0')
			handler = (request, response) => {
				if (request.url === metadataPath('plugin')) {
					sendJson(response, metadata({ tarballForVersion: () => `${baseUrl}${tarballPath}` }))
					return
				}

				sendJson(response, {}, 404)
			}

			const registry = createRegistry()

			await expectCode(registry.getConfig('plugin', '1.0.0'), 'HTTP_ERROR')

			await serveConfig({})

			expect((await registry.getConfig('plugin', '1.0.0')).pluginDependencies).toEqual([])
			expect(requests).toHaveLength(3)
		})
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
			expect.objectContaining({ name: 'PluginRegistryError', code: 'INVALID_PLUGIN_DEPENDENCY' })
		)
	})
})
