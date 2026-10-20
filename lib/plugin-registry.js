import { gunzipSync } from 'node:zlib'
import semver from 'semver'
import { extract } from 'tar-stream'

import { getProxyPluginConfig } from './plugin-proxy.js'

const REGISTRY_URL = 'https://registry.npmjs.org'
const CONFIG_FILE = 'govuk-prototype-kit.config.json'
const CONFIG_ENTRY = `package/${CONFIG_FILE}`

const DEFAULT_OPTIONS = {
	metadataTtlMs: 5 * 60 * 1000,
	requestTimeoutMs: 15 * 1000,
	maxMetadataBytes: 2 * 1024 * 1024,
	maxArchiveBytes: 20 * 1024 * 1024,
	maxConfigBytes: 1024 * 1024,
	maxRedirects: 5
}

class PluginRegistryError extends Error {
	constructor(message, options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined)
		this.name = 'PluginRegistryError'
		this.code = options.code ?? 'REGISTRY_ERROR'

		if (options.packageName) {
			this.packageName = options.packageName
		}

		if (options.version) {
			this.version = options.version
		}
	}
}

function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExactVersion(version) {
	if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
		return false
	}

	try {
		new semver.SemVer(version)
		return true
	} catch {
		return false
	}
}

function isStableVersion(version) {
	return isExactVersion(version) && semver.prerelease(version) === null
}

function isValidPackageName(packageName) {
	if (typeof packageName !== 'string' || packageName.length === 0 || packageName.length > 214) {
		return false
	}

	const parts = packageName.startsWith('@') ? packageName.slice(1).split('/') : [packageName]

	if (packageName.startsWith('@') && parts.length !== 2) {
		return false
	}

	for (const part of parts) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._~-]*$/.test(part)) {
			return false
		}
	}

	return true
}

function isLoopbackHost(hostname) {
	return hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname)
}

// only https downloads are allowed in normal use. A loopback registry may use
// http so tests and local proxies work, but then only loopback downloads are
// allowed too.
function validateDownloadUrl(urlString, { allowLoopbackHttp = false } = {}) {
	let url

	try {
		url = urlString instanceof URL ? urlString : new URL(urlString)
	} catch (error) {
		throw new PluginRegistryError(`Invalid URL: ${urlString}`, {
			code: 'INVALID_REGISTRY_URL',
			cause: error
		})
	}

	if (url.username || url.password) {
		throw new PluginRegistryError('Download URLs must not contain credentials', {
			code: 'UNSAFE_URL'
		})
	}

	const allowedProtocol =
		url.protocol === 'https:' || (allowLoopbackHttp && url.protocol === 'http:' && isLoopbackHost(url.hostname))

	if (!allowedProtocol) {
		throw new PluginRegistryError(`Refusing to download from ${url.href}: expected https`, {
			code: 'UNSAFE_URL'
		})
	}

	return url
}

function encodePackageName(packageName) {
	if (!packageName.startsWith('@')) {
		return encodeURIComponent(packageName)
	}

	const [scope, name] = packageName.slice(1).split('/')
	return `@${encodeURIComponent(scope)}%2F${encodeURIComponent(name)}`
}

function isSafeArchivePath(filePath) {
	if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0')) {
		return false
	}

	if (filePath.includes('\\') || filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath)) {
		return false
	}

	const parts = filePath.split('/')
	return !parts.includes('..')
}

function readErrorBody(response) {
	if (!response.body) {
		return
	}

	const cancelled = response.body.cancel?.()
	cancelled?.catch?.(() => {})
}

async function readResponseBody(response, maxBytes) {
	if (!response.body) {
		const body = Buffer.from(await response.arrayBuffer())

		if (body.length > maxBytes) {
			throw new PluginRegistryError(`Response was larger than ${maxBytes} bytes`, { code: 'TOO_LARGE' })
		}

		return body
	}

	const reader = response.body.getReader()
	const chunks = []
	let total = 0

	try {
		while (true) {
			const { done, value } = await reader.read()

			if (done) {
				break
			}

			total += value.byteLength

			if (total > maxBytes) {
				await reader.cancel().catch(() => {})
				throw new PluginRegistryError(`Response was larger than ${maxBytes} bytes`, { code: 'TOO_LARGE' })
			}

			chunks.push(Buffer.from(value))
		}
	} finally {
		reader.releaseLock?.()
	}

	return Buffer.concat(chunks)
}

function getTimeoutError(resource, context = {}) {
	return new PluginRegistryError(`Timed out while fetching ${resource}`, {
		code: 'TIMEOUT',
		packageName: context.packageName,
		version: context.version
	})
}

function getNetworkError(resource, error, context = {}) {
	return new PluginRegistryError(`Could not fetch ${resource}: ${error.message}`, {
		code: 'NETWORK_ERROR',
		cause: error,
		packageName: context.packageName,
		version: context.version
	})
}

async function fetchBuffer(
	fetchImpl,
	url,
	{ maxBytes, timeoutMs, maxRedirects, resource, packageName, version, allowLoopbackHttp }
) {
	const context = { packageName, version }
	const controller = new AbortController()
	let currentUrl = validateDownloadUrl(url, { allowLoopbackHttp })
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	let redirects = 0

	try {
		while (true) {
			let response

			try {
				response = await fetchImpl(currentUrl.href, {
					redirect: 'manual',
					signal: controller.signal
				})
			} catch (error) {
				if (controller.signal.aborted) {
					throw getTimeoutError(resource, context)
				}

				throw getNetworkError(resource, error, context)
			}

			if (response.status >= 300 && response.status < 400) {
				readErrorBody(response)

				if (redirects >= maxRedirects) {
					throw new PluginRegistryError(`Too many redirects while fetching ${resource}`, {
						code: 'TOO_MANY_REDIRECTS'
					})
				}

				const location = response.headers.get('location')

				if (!location) {
					throw new PluginRegistryError(`Redirect from ${currentUrl.href} had no location`, {
						code: 'HTTP_ERROR'
					})
				}

				let nextUrl

				try {
					nextUrl = new URL(location, currentUrl)
				} catch (error) {
					throw new PluginRegistryError(`Redirect from ${currentUrl.href} had an invalid location`, {
						code: 'HTTP_ERROR',
						cause: error
					})
				}

				currentUrl = validateDownloadUrl(nextUrl, { allowLoopbackHttp })
				redirects++
				continue
			}

			if (!response.ok) {
				readErrorBody(response)
				throw new PluginRegistryError(`Fetching ${resource} failed with HTTP ${response.status}`, {
					code: 'HTTP_ERROR'
				})
			}

			const contentLength = Number(response.headers.get('content-length'))

			if (Number.isFinite(contentLength) && contentLength > maxBytes) {
				readErrorBody(response)
				throw new PluginRegistryError(`Response was larger than ${maxBytes} bytes`, { code: 'TOO_LARGE' })
			}

			try {
				return await readResponseBody(response, maxBytes)
			} catch (error) {
				if (controller.signal.aborted) {
					throw getTimeoutError(resource, context)
				}

				if (error instanceof PluginRegistryError) {
					throw error
				}

				throw getNetworkError(resource, error, context)
			}
		}
	} finally {
		clearTimeout(timeout)
	}
}

function parseMetadata(packageName, body) {
	let metadata

	try {
		metadata = JSON.parse(body.toString('utf8'))
	} catch (error) {
		throw new PluginRegistryError(`Registry metadata for ${packageName} was not valid JSON`, {
			code: 'INVALID_JSON',
			cause: error,
			packageName
		})
	}

	if (!isObject(metadata) || !isObject(metadata['dist-tags']) || !isObject(metadata.versions)) {
		throw new PluginRegistryError(`Registry metadata for ${packageName} was not in the expected shape`, {
			code: 'INVALID_METADATA',
			packageName
		})
	}

	const latestVersion = metadata['dist-tags'].latest

	if (!isStableVersion(latestVersion)) {
		throw new PluginRegistryError(`Registry metadata for ${packageName} did not have a stable latest version`, {
			code: 'INVALID_LATEST',
			packageName
		})
	}

	const versions = []
	const stableVersions = []
	const archiveUrls = {}

	for (const [version, versionMetadata] of Object.entries(metadata.versions)) {
		if (!isExactVersion(version)) {
			continue
		}

		versions.push(version)

		if (isStableVersion(version)) {
			stableVersions.push(version)
		}

		if (isObject(versionMetadata?.dist) && typeof versionMetadata.dist.tarball === 'string') {
			archiveUrls[version] = versionMetadata.dist.tarball
		}
	}

	versions.sort(semver.compare)
	stableVersions.sort(semver.compare)

	if (!versions.includes(latestVersion)) {
		throw new PluginRegistryError(`Registry metadata for ${packageName} did not include its latest version`, {
			code: 'INVALID_METADATA',
			packageName
		})
	}

	return { packageName, latestVersion, versions, stableVersions, archiveUrls }
}

function parseConfig(packageName, version, configBody) {
	let config

	try {
		config = JSON.parse(configBody.toString('utf8'))
	} catch (error) {
		throw new PluginRegistryError(`Plugin config for ${packageName}@${version} was not valid JSON`, {
			code: 'INVALID_CONFIG',
			cause: error,
			packageName,
			version
		})
	}

	if (!isObject(config)) {
		throw new PluginRegistryError(`Plugin config for ${packageName}@${version} was not an object`, {
			code: 'INVALID_CONFIG',
			packageName,
			version
		})
	}

	return config
}

// read one config entry from the archive in memory. Nothing is extracted to
// disk and no code from the package is executed.
async function drainEntry(entry) {
	for await (const _chunk of entry) {
		// discard entries we do not need
	}
}

async function readConfigEntry(entry, packageName, version, maxConfigBytes) {
	const chunks = []
	let total = 0

	for await (const chunk of entry) {
		total += chunk.byteLength

		if (total > maxConfigBytes) {
			throw new PluginRegistryError(`${CONFIG_FILE} for ${packageName}@${version} was too large`, {
				code: 'CONFIG_TOO_LARGE',
				packageName,
				version
			})
		}

		chunks.push(chunk)
	}

	return Buffer.concat(chunks)
}

// read one config entry from the archive in memory. Nothing is extracted to
// disk and no code from the package is executed.
async function readConfigFromArchive(packageName, version, archive, maxArchiveBytes, maxConfigBytes) {
	let tar

	try {
		tar = gunzipSync(archive, { maxOutputLength: maxArchiveBytes })
	} catch (error) {
		if (error.code === 'ERR_BUFFER_TOO_LARGE') {
			throw new PluginRegistryError(`Archive for ${packageName}@${version} was too large to read`, {
				code: 'ARCHIVE_TOO_LARGE',
				cause: error,
				packageName,
				version
			})
		}

		throw new PluginRegistryError(`Could not read archive for ${packageName}@${version}: ${error.message}`, {
			code: 'ARCHIVE_ERROR',
			cause: error,
			packageName,
			version
		})
	}

	const extractor = extract()
	let configBody
	let found = false

	try {
		const entries = extractor[Symbol.asyncIterator]()
		extractor.end(tar)

		for await (const entry of entries) {
			const header = entry.header
			const unsafePath = !isSafeArchivePath(header.name) || (header.linkname && !isSafeArchivePath(header.linkname))

			if (unsafePath) {
				throw new PluginRegistryError(
					`Archive for ${packageName}@${version} contained an unsafe path: ${header.name}`,
					{ code: 'UNSAFE_ARCHIVE_PATH', packageName, version }
				)
			}

			if (header.name !== CONFIG_ENTRY) {
				await drainEntry(entry)
				continue
			}

			if (found) {
				throw new PluginRegistryError(`Archive for ${packageName}@${version} contained more than one ${CONFIG_FILE}`, {
					code: 'DUPLICATE_CONFIG',
					packageName,
					version
				})
			}

			found = true

			if (header.type !== 'file') {
				await drainEntry(entry)
				throw new PluginRegistryError(`${CONFIG_FILE} for ${packageName}@${version} was not a regular file`, {
					code: 'INVALID_CONFIG',
					packageName,
					version
				})
			}

			if (header.size > maxConfigBytes) {
				await drainEntry(entry)
				throw new PluginRegistryError(`${CONFIG_FILE} for ${packageName}@${version} was too large`, {
					code: 'CONFIG_TOO_LARGE',
					packageName,
					version
				})
			}

			configBody = await readConfigEntry(entry, packageName, version, maxConfigBytes)
		}
	} catch (error) {
		if (error instanceof PluginRegistryError) {
			throw error
		}

		throw new PluginRegistryError(`Could not read archive for ${packageName}@${version}: ${error.message}`, {
			code: 'ARCHIVE_ERROR',
			cause: error,
			packageName,
			version
		})
	}

	if (!found || !configBody) {
		throw new PluginRegistryError(`Archive for ${packageName}@${version} did not contain ${CONFIG_FILE}`, {
			code: 'CONFIG_NOT_FOUND',
			packageName,
			version
		})
	}

	return parseConfig(packageName, version, configBody)
}

function normaliseDependency(entry, index) {
	const position = `pluginDependencies[${index}]`

	if (typeof entry === 'string') {
		if (!isValidPackageName(entry)) {
			throw new PluginRegistryError(`${position} had an invalid package name: ${entry}`, {
				code: 'INVALID_PLUGIN_DEPENDENCY'
			})
		}

		return { packageName: entry }
	}

	if (!isObject(entry)) {
		throw new PluginRegistryError(`${position} must be a package name or an object`, {
			code: 'INVALID_PLUGIN_DEPENDENCY'
		})
	}

	if (!isValidPackageName(entry.packageName)) {
		throw new PluginRegistryError(`${position} had an invalid package name: ${entry.packageName}`, {
			code: 'INVALID_PLUGIN_DEPENDENCY'
		})
	}

	const dependency = { packageName: entry.packageName }

	for (const key of ['minVersion', 'maxVersion']) {
		if (entry[key] === undefined) {
			continue
		}

		if (!isExactVersion(entry[key])) {
			throw new PluginRegistryError(`${position} had an invalid ${key}: ${entry[key]}`, {
				code: 'INVALID_PLUGIN_DEPENDENCY'
			})
		}

		dependency[key] = entry[key]
	}

	if (dependency.minVersion && dependency.maxVersion && semver.gt(dependency.minVersion, dependency.maxVersion)) {
		throw new PluginRegistryError(
			`${position} had a minVersion greater than its maxVersion: ${dependency.minVersion} > ${dependency.maxVersion}`,
			{ code: 'INVALID_PLUGIN_DEPENDENCY' }
		)
	}

	return dependency
}

function normalisePluginDependencies(pluginDependencies) {
	const entries = [].concat(pluginDependencies ?? [])

	return entries.map(normaliseDependency)
}

function createPluginRegistry(options = {}) {
	const {
		allowedPackageNames = [],
		fetch: fetchImpl = globalThis.fetch,
		now = Date.now,
		registryUrl = REGISTRY_URL,
		metadataTtlMs = DEFAULT_OPTIONS.metadataTtlMs,
		requestTimeoutMs = DEFAULT_OPTIONS.requestTimeoutMs,
		maxMetadataBytes = DEFAULT_OPTIONS.maxMetadataBytes,
		maxArchiveBytes = DEFAULT_OPTIONS.maxArchiveBytes,
		maxConfigBytes = DEFAULT_OPTIONS.maxConfigBytes,
		maxRedirects = DEFAULT_OPTIONS.maxRedirects
	} = options

	if (typeof fetchImpl !== 'function') {
		throw new PluginRegistryError('A fetch implementation is required', { code: 'INVALID_FETCH' })
	}

	const registry = validateDownloadUrl(registryUrl, { allowLoopbackHttp: true })
	const baseUrl = registry.href.replace(/\/+$/, '')
	const allowLoopbackHttp = registry.protocol === 'http:'
	const allowed = new Set(allowedPackageNames)

	const metadataCache = new Map()
	const configCache = new Map()

	function assertAllowed(packageName) {
		if (!isValidPackageName(packageName)) {
			throw new PluginRegistryError(`Invalid package name: ${packageName}`, {
				code: 'INVALID_PACKAGE_NAME',
				packageName
			})
		}

		if (!allowed.has(packageName)) {
			throw new PluginRegistryError(`${packageName} is not in the plugin allowlist`, {
				code: 'NOT_ALLOWED',
				packageName
			})
		}
	}

	function getCachedMetadata(packageName) {
		const cached = metadataCache.get(packageName)

		if (!cached) {
			return
		}

		if (cached.expiresAt <= now()) {
			metadataCache.delete(packageName)
			return
		}

		return cached.metadata
	}

	async function getPackageMetadata(packageName) {
		assertAllowed(packageName)

		const cached = getCachedMetadata(packageName)

		if (cached) {
			return cached
		}

		const body = await fetchBuffer(fetchImpl, `${baseUrl}/${encodePackageName(packageName)}`, {
			maxBytes: maxMetadataBytes,
			timeoutMs: requestTimeoutMs,
			maxRedirects,
			resource: `registry metadata for ${packageName}`,
			packageName,
			allowLoopbackHttp
		})
		const metadata = parseMetadata(packageName, body)

		metadataCache.set(packageName, {
			expiresAt: now() + metadataTtlMs,
			metadata
		})

		return metadata
	}

	async function getUpdateInfo(packageName, installedVersion) {
		assertAllowed(packageName)

		if (!isExactVersion(installedVersion)) {
			throw new PluginRegistryError(`Installed version for ${packageName} was not an exact version`, {
				code: 'INVALID_INSTALLED_VERSION',
				packageName,
				version: installedVersion
			})
		}

		const metadata = await getPackageMetadata(packageName)

		return {
			packageName,
			installedVersion,
			latestVersion: metadata.latestVersion,
			updateAvailable: semver.gt(metadata.latestVersion, installedVersion)
		}
	}

	async function getConfig(packageName, version) {
		assertAllowed(packageName)

		if (!isExactVersion(version)) {
			throw new PluginRegistryError(`Plugin config version for ${packageName} was not an exact version`, {
				code: 'INVALID_VERSION',
				packageName,
				version
			})
		}

		const cacheKey = `${packageName}@${version}`
		const cached = configCache.get(cacheKey)

		if (cached) {
			return cached
		}

		// some packages are plugins without shipping a config, so use the proxy
		// config instead of downloading the package archive
		const proxyConfig = getProxyPluginConfig(packageName)

		if (proxyConfig) {
			const pluginDependencies = normalisePluginDependencies(proxyConfig.pluginDependencies)
			const result = { packageName, version, config: proxyConfig, pluginDependencies }

			configCache.set(cacheKey, result)

			return result
		}

		const metadata = await getPackageMetadata(packageName)
		const archiveUrl = metadata.archiveUrls[version]

		if (!archiveUrl) {
			throw new PluginRegistryError(`Registry metadata for ${packageName}@${version} did not include an archive URL`, {
				code: 'INVALID_METADATA',
				packageName,
				version
			})
		}

		const body = await fetchBuffer(fetchImpl, archiveUrl, {
			maxBytes: maxArchiveBytes,
			timeoutMs: requestTimeoutMs,
			maxRedirects,
			resource: `archive for ${packageName}@${version}`,
			packageName,
			version,
			allowLoopbackHttp
		})
		const config = await readConfigFromArchive(packageName, version, body, maxArchiveBytes, maxConfigBytes)
		const pluginDependencies = normalisePluginDependencies(config.pluginDependencies)
		const result = { packageName, version, config, pluginDependencies }

		configCache.set(cacheKey, result)

		return result
	}

	function clearCache() {
		metadataCache.clear()
		configCache.clear()
	}

	return {
		clearCache,
		getConfig,
		getPackageMetadata,
		getUpdateInfo
	}
}

export {
	CONFIG_FILE,
	createPluginRegistry,
	isExactVersion,
	isStableVersion,
	isValidPackageName,
	normalisePluginDependencies,
	PluginRegistryError,
	REGISTRY_URL
}
