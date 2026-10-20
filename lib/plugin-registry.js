import { gunzipSync } from 'node:zlib'

import semver from 'semver'
import { extract } from 'tar-stream'

import { getProxyPluginConfig } from './plugin-proxy.js'
import { CONFIG_FILE, isObject } from './utils/plugin-config.js'

const REGISTRY_URL = 'https://registry.npmjs.org'
const CONFIG_ENTRY = `package/${CONFIG_FILE}`
const METADATA_ACCEPT = 'application/vnd.npm.install-v1+json'

const DEFAULT_OPTIONS = {
	metadataTtlMs: 5 * 60 * 1000,
	requestTimeoutMs: 15 * 1000,
	maxBytes: 20 * 1024 * 1024
}

class PluginRegistryError extends Error {
	constructor(message, options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined)
		this.name = 'PluginRegistryError'

		if (options.code) {
			this.code = options.code
		}
	}
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

	return parts.every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._~-]*$/.test(part))
}

function isLoopbackHost(hostname) {
	return hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname)
}

// the real registry must use https. A loopback registry may use http so the
// tests can run a local server.
function parseRegistryUrl(registryUrl) {
	let url

	try {
		url = registryUrl instanceof URL ? registryUrl : new URL(registryUrl)
	} catch (error) {
		throw new PluginRegistryError(`Invalid registry URL: ${registryUrl}`, { cause: error })
	}

	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
		throw new PluginRegistryError(`Refusing to use registry at ${url.href}: expected https`)
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

async function readResponseBody(response, maxBytes) {
	const chunks = []
	let total = 0

	for await (const chunk of response.body ?? []) {
		total += chunk.byteLength

		if (total > maxBytes) {
			throw new PluginRegistryError(`Response was larger than ${maxBytes} bytes`)
		}

		chunks.push(Buffer.from(chunk))
	}

	return Buffer.concat(chunks)
}

async function fetchBuffer(fetchImpl, url, { maxBytes, timeoutMs, resource, headers = {} }) {
	const signal = AbortSignal.timeout(timeoutMs)
	let response

	try {
		response = await fetchImpl(url, { redirect: 'follow', signal, headers })
	} catch (error) {
		if (error.name === 'TimeoutError' || signal.aborted) {
			throw new PluginRegistryError(`Timed out while fetching ${resource}`, { cause: error })
		}

		throw new PluginRegistryError(`Could not fetch ${resource}: ${error.message}`, { cause: error })
	}

	if (!response.ok) {
		response.body?.cancel?.().catch?.(() => {})
		throw new PluginRegistryError(`Fetching ${resource} failed with HTTP ${response.status}`)
	}

	try {
		return await readResponseBody(response, maxBytes)
	} catch (error) {
		if (signal.aborted) {
			throw new PluginRegistryError(`Timed out while fetching ${resource}`, { cause: error })
		}

		throw error
	}
}

function parseMetadata(packageName, body) {
	let metadata

	try {
		metadata = JSON.parse(body.toString('utf8'))
	} catch (error) {
		throw new PluginRegistryError(`Registry metadata for ${packageName} was not valid JSON`, { cause: error })
	}

	if (!isObject(metadata) || !isObject(metadata['dist-tags']) || !isObject(metadata.versions)) {
		throw new PluginRegistryError(`Registry metadata for ${packageName} was not in the expected shape`)
	}

	const latestVersion = metadata['dist-tags'].latest

	if (!isStableVersion(latestVersion)) {
		throw new PluginRegistryError(`Registry metadata for ${packageName} did not have a stable latest version`)
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
		throw new PluginRegistryError(`Registry metadata for ${packageName} did not include its latest version`)
	}

	return { packageName, latestVersion, versions, stableVersions, archiveUrls }
}

function parseConfig(packageName, version, configBody) {
	let config

	try {
		config = JSON.parse(configBody.toString('utf8'))
	} catch (error) {
		throw new PluginRegistryError(`Plugin config for ${packageName}@${version} was not valid JSON`, { cause: error })
	}

	if (!isObject(config)) {
		throw new PluginRegistryError(`Plugin config for ${packageName}@${version} was not an object`)
	}

	return config
}

// read one config entry from the archive in memory. Nothing is extracted to
// disk and no code from the package is executed.
async function readConfigFromArchive(packageName, version, archive, maxBytes) {
	let tar

	try {
		tar = gunzipSync(archive, { maxOutputLength: maxBytes })
	} catch (error) {
		throw new PluginRegistryError(`Could not read archive for ${packageName}@${version}: ${error.message}`, {
			cause: error
		})
	}

	const extractor = extract()
	extractor.end(tar)

	try {
		for await (const entry of extractor) {
			if (entry.header.name !== CONFIG_ENTRY) {
				for await (const _chunk of entry) {
					// discard entries we do not need
				}
				continue
			}

			const chunks = []

			for await (const chunk of entry) {
				chunks.push(chunk)
			}

			return parseConfig(packageName, version, Buffer.concat(chunks))
		}
	} catch (error) {
		if (error instanceof PluginRegistryError) {
			throw error
		}

		throw new PluginRegistryError(`Could not read archive for ${packageName}@${version}: ${error.message}`, {
			cause: error
		})
	}

	throw new PluginRegistryError(`Archive for ${packageName}@${version} did not contain ${CONFIG_FILE}`)
}

function normaliseDependency(entry, index) {
	const position = `pluginDependencies[${index}]`
	const raw = typeof entry === 'string' ? { packageName: entry } : entry

	if (!isObject(raw) || !isValidPackageName(raw.packageName)) {
		throw new PluginRegistryError(`${position} had an invalid package name: ${raw?.packageName ?? entry}`, {
			code: 'INVALID_PLUGIN_DEPENDENCY'
		})
	}

	const dependency = { packageName: raw.packageName }

	for (const key of ['minVersion', 'maxVersion']) {
		if (raw[key] === undefined) {
			continue
		}

		if (!isExactVersion(raw[key])) {
			throw new PluginRegistryError(`${position} had an invalid ${key}: ${raw[key]}`, {
				code: 'INVALID_PLUGIN_DEPENDENCY'
			})
		}

		dependency[key] = raw[key]
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
		fetch: fetchImpl = globalThis.fetch,
		now = Date.now,
		registryUrl = REGISTRY_URL,
		metadataTtlMs = DEFAULT_OPTIONS.metadataTtlMs,
		requestTimeoutMs = DEFAULT_OPTIONS.requestTimeoutMs,
		maxBytes = DEFAULT_OPTIONS.maxBytes
	} = options

	if (typeof fetchImpl !== 'function') {
		throw new PluginRegistryError('A fetch implementation is required')
	}

	const registry = parseRegistryUrl(registryUrl)
	const baseUrl = registry.href.replace(/\/+$/, '')
	const metadataCache = new Map()
	const configCache = new Map()

	function assertPackageName(packageName) {
		if (!isValidPackageName(packageName)) {
			throw new PluginRegistryError(`Invalid package name: ${packageName}`)
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
		assertPackageName(packageName)

		const cached = getCachedMetadata(packageName)

		if (cached) {
			return cached
		}

		const body = await fetchBuffer(fetchImpl, `${baseUrl}/${encodePackageName(packageName)}`, {
			maxBytes,
			timeoutMs: requestTimeoutMs,
			resource: `registry metadata for ${packageName}`,
			headers: { accept: METADATA_ACCEPT }
		})
		const metadata = parseMetadata(packageName, body)

		metadataCache.set(packageName, {
			expiresAt: now() + metadataTtlMs,
			metadata
		})

		return metadata
	}

	async function getUpdateInfo(packageName, installedVersion) {
		assertPackageName(packageName)

		if (!isExactVersion(installedVersion)) {
			throw new PluginRegistryError(`Installed version for ${packageName} was not an exact version`)
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
		assertPackageName(packageName)

		if (!isExactVersion(version)) {
			throw new PluginRegistryError(`Plugin config version for ${packageName} was not an exact version`)
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
			throw new PluginRegistryError(`Registry metadata for ${packageName}@${version} did not include an archive URL`)
		}

		const body = await fetchBuffer(fetchImpl, archiveUrl, {
			maxBytes,
			timeoutMs: requestTimeoutMs,
			resource: `archive for ${packageName}@${version}`
		})
		const config = await readConfigFromArchive(packageName, version, body, maxBytes)
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
