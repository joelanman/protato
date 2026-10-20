import semver from 'semver'

import { isObject } from './utils/plugin-config.js'

class PluginDependencyError extends Error {
	constructor(message, options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined)
		this.name = 'PluginDependencyError'
	}
}

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

function normaliseDependency(entry, index) {
	const position = `pluginDependencies[${index}]`
	const raw = typeof entry === 'string' ? { packageName: entry } : entry

	if (!isObject(raw) || !isValidPackageName(raw.packageName)) {
		throw new PluginDependencyError(`${position} had an invalid package name: ${raw?.packageName ?? entry}`)
	}

	const dependency = { packageName: raw.packageName }

	for (const key of ['minVersion', 'maxVersion']) {
		if (raw[key] === undefined) {
			continue
		}

		if (!isExactVersion(raw[key])) {
			throw new PluginDependencyError(`${position} had an invalid ${key}: ${raw[key]}`)
		}

		dependency[key] = raw[key]
	}

	if (dependency.minVersion && dependency.maxVersion && semver.gt(dependency.minVersion, dependency.maxVersion)) {
		throw new PluginDependencyError(
			`${position} had a minVersion greater than its maxVersion: ${dependency.minVersion} > ${dependency.maxVersion}`
		)
	}

	return dependency
}

function normalisePluginDependencies(pluginDependencies) {
	const entries = [].concat(pluginDependencies ?? [])

	return entries.map(normaliseDependency)
}

export { isExactVersion, isStableVersion, isValidPackageName, normalisePluginDependencies, PluginDependencyError }
