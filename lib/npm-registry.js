import { gunzipSync } from 'node:zlib'

import semver from 'semver'
import { extract } from 'tar-stream'

import { CONFIG_FILE, isObject } from './plugins.js'

const REGISTRY_URL = 'https://registry.npmjs.org'
const CONFIG_ENTRY = `package/${CONFIG_FILE}`
const METADATA_ACCEPT = 'application/vnd.npm.install-v1+json'
const METADATA_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15 * 1000
const MAX_BYTES = 20 * 1024 * 1024

const metadataCache = new Map()
const configCache = new Map()

// semver.valid() strips build metadata, so it cannot tell an exact version
// string from its normalised form. The regex keeps that distinction.
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

function encodePackageName(packageName) {
	if (!packageName.startsWith('@')) {
		return encodeURIComponent(packageName)
	}

	const [scope, name] = packageName.slice(1).split('/')
	return `@${encodeURIComponent(scope)}%2F${encodeURIComponent(name)}`
}

async function readResponseBody(response) {
	const chunks = []
	let total = 0

	for await (const chunk of response.body ?? []) {
		total += chunk.byteLength

		if (total > MAX_BYTES) {
			throw new Error(`Response was larger than ${MAX_BYTES} bytes`)
		}

		chunks.push(Buffer.from(chunk))
	}

	return Buffer.concat(chunks)
}

async function fetchBuffer(url, { resource, headers = {} }) {
	const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	let response

	try {
		response = await globalThis.fetch(url, { redirect: 'follow', signal, headers })
	} catch (error) {
		if (error.name === 'TimeoutError' || signal.aborted) {
			throw new Error(`Timed out while fetching ${resource}`, { cause: error })
		}

		throw new Error(`Could not fetch ${resource}: ${error.message}`, { cause: error })
	}

	if (!response.ok) {
		response.body?.cancel?.().catch?.(() => {})
		throw new Error(`Fetching ${resource} failed with HTTP ${response.status}`)
	}

	try {
		return await readResponseBody(response)
	} catch (error) {
		if (signal.aborted) {
			throw new Error(`Timed out while fetching ${resource}`, { cause: error })
		}

		throw error
	}
}

function parseMetadata(packageName, body) {
	let metadata

	try {
		metadata = JSON.parse(body.toString('utf8'))
	} catch (error) {
		throw new Error(`Registry metadata for ${packageName} was not valid JSON`, { cause: error })
	}

	if (!isObject(metadata) || !isObject(metadata['dist-tags']) || !isObject(metadata.versions)) {
		throw new Error(`Registry metadata for ${packageName} was not in the expected shape`)
	}

	const latestVersion = metadata['dist-tags'].latest

	if (!isStableVersion(latestVersion)) {
		throw new Error(`Registry metadata for ${packageName} did not have a stable latest version`)
	}

	const stableVersions = Object.keys(metadata.versions).filter(isStableVersion).sort(semver.compare)

	return { packageName, latestVersion, stableVersions, versions: metadata.versions }
}

// read one config entry from the archive in memory. Nothing is extracted to
// disk and no code from the package is executed.
async function readConfigFromArchive(packageName, version, archive) {
	let tar

	try {
		tar = gunzipSync(archive, { maxOutputLength: MAX_BYTES })
	} catch (error) {
		throw new Error(`Could not read archive for ${packageName}@${version}: ${error.message}`, { cause: error })
	}

	const extractor = extract()
	extractor.end(tar)

	let configChunks

	try {
		for await (const entry of extractor) {
			if (entry.header.name !== CONFIG_ENTRY) {
				for await (const _chunk of entry) {
					// discard entries we do not need
				}
				continue
			}

			configChunks = []

			for await (const chunk of entry) {
				configChunks.push(chunk)
			}

			// nothing else in the archive is needed
			break
		}
	} catch (error) {
		throw new Error(`Could not read archive for ${packageName}@${version}: ${error.message}`, { cause: error })
	}

	if (!configChunks) {
		throw new Error(`Archive for ${packageName}@${version} did not contain ${CONFIG_FILE}`)
	}

	let config

	try {
		config = JSON.parse(Buffer.concat(configChunks).toString('utf8'))
	} catch (error) {
		throw new Error(`Plugin config for ${packageName}@${version} was not valid JSON`, { cause: error })
	}

	if (!isObject(config)) {
		throw new Error(`Plugin config for ${packageName}@${version} was not an object`)
	}

	return config
}

async function fetchPackageMetadata(packageName) {
	const cached = metadataCache.get(packageName)

	if (cached) {
		if (cached.expiresAt > Date.now()) {
			return cached.metadata
		}

		metadataCache.delete(packageName)
	}

	const body = await fetchBuffer(`${REGISTRY_URL}/${encodePackageName(packageName)}`, {
		resource: `registry metadata for ${packageName}`,
		headers: { accept: METADATA_ACCEPT }
	})
	const metadata = parseMetadata(packageName, body)

	metadataCache.set(packageName, { expiresAt: Date.now() + METADATA_TTL_MS, metadata })

	return metadata
}

async function fetchPluginConfig(packageName, version) {
	if (!isExactVersion(version)) {
		throw new Error(`Plugin config version for ${packageName} was not an exact version`)
	}

	const cacheKey = `${packageName}@${version}`
	const cached = configCache.get(cacheKey)

	if (cached) {
		return cached
	}

	const metadata = await fetchPackageMetadata(packageName)
	const archiveUrl = metadata.versions[version]?.dist?.tarball

	if (typeof archiveUrl !== 'string') {
		throw new Error(`Registry metadata for ${packageName}@${version} did not include an archive URL`)
	}

	const body = await fetchBuffer(archiveUrl, { resource: `archive for ${packageName}@${version}` })
	const config = await readConfigFromArchive(packageName, version, body)
	const result = { packageName, version, config, pluginDependencies: config.pluginDependencies }

	configCache.set(cacheKey, result)

	return result
}

function clearRegistryCache() {
	metadataCache.clear()
	configCache.clear()
}

export { clearRegistryCache, fetchPackageMetadata, fetchPluginConfig, isExactVersion, isStableVersion }
