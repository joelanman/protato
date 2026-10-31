import semver from 'semver'

// npm sets npm_config_registry for the processes it starts, and a project may
// point at a mirror, so use the registry npm itself would use.
const REGISTRY_URL = (process.env.npm_config_registry ?? 'https://registry.npmjs.org').replace(/\/+$/, '')
const REQUEST_TIMEOUT_MS = 5000
const CACHE_DURATION_MS = 60 * 1000

// Only the latest version is cached, so the plugins page does not ask the
// registry again on every request. Failures are not cached, so going back
// online is picked up straight away.
const latestVersionCache = new Map()

function hasNewVersion(installedVersion, latestVersion) {
	if (!semver.valid(installedVersion) || !semver.valid(latestVersion)) {
		return false
	}

	return semver.gt(latestVersion, installedVersion)
}

// A dependency version comes from the registry when it is an exact version or
// a version range. Other values (file:, github:, git+, link:, workspace: and so
// on) cannot be updated by asking npm for a version. semver reads an empty
// version as "*" (any version), which is how npm reads it too.
function isRegistryDependency(version) {
	return semver.validRange(version) !== null
}

async function fetchLatestVersion(packageName) {
	const cached = latestVersionCache.get(packageName)

	if (cached && cached.expiresAt > Date.now()) {
		return cached.version
	}

	const latestVersionUrl = `${REGISTRY_URL}/${packageName}/latest`

	let data

	try {
		const response = await fetch(latestVersionUrl, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		})

		if (!response.ok) {
			return
		}

		data = await response.json()
	} catch {
		return
	}

	if (!semver.valid(data?.version)) {
		return
	}

	latestVersionCache.set(packageName, {
		version: data.version,
		expiresAt: Date.now() + CACHE_DURATION_MS
	})

	return data.version
}

function clearRegistryCache() {
	latestVersionCache.clear()
}

export { clearRegistryCache, fetchLatestVersion, hasNewVersion, isRegistryDependency }
