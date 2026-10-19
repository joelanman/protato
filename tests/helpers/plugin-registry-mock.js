import semver from 'semver'
import { vi } from 'vitest'

/**
 * Builds a stand-in for the npm registry client.
 *
 * `latest` maps package names to the version the registry reports, `configs`
 * maps `package@version` keys to the pluginDependencies that version declares,
 * and `errors` maps either to an error message. Every package defaults to
 * 1.0.0 with no plugin dependencies, so a test only states what it cares about.
 *
 * @param {object} [options]
 * @param {object} [options.latest]
 * @param {object} [options.configs]
 * @param {object} [options.errors]
 * @returns {object} a stand-in for createPluginRegistry()
 */
export function createRegistryMock(options) {
	return resetRegistryMock(
		{
			latest: {},
			configs: {},
			errors: {},
			getPackageMetadata: vi.fn(),
			getUpdateInfo: vi.fn(),
			getConfig: vi.fn()
		},
		options
	)
}

export function resetRegistryMock(mock, { latest = {}, configs = {}, errors = {} } = {}) {
	mock.latest = { ...latest }
	mock.configs = { ...configs }
	mock.errors = { ...errors }

	mock.getPackageMetadata.mockImplementation(async (packageName) => {
		if (mock.errors[packageName]) {
			throw new Error(mock.errors[packageName])
		}

		const version = mock.latest[packageName] ?? '1.0.0'
		return { packageName, latestVersion: version, stableVersions: [version] }
	})

	mock.getUpdateInfo.mockImplementation(async (packageName, installedVersion) => {
		if (mock.errors[packageName]) {
			throw new Error(mock.errors[packageName])
		}

		const version = mock.latest[packageName] ?? '1.0.0'
		return {
			packageName,
			installedVersion,
			latestVersion: version,
			updateAvailable: semver.gt(version, installedVersion)
		}
	})

	mock.getConfig.mockImplementation(async (packageName, version) => {
		const key = `${packageName}@${version}`

		if (mock.errors[key]) {
			throw new Error(mock.errors[key])
		}

		return {
			packageName,
			version,
			config: { pluginDependencies: mock.configs[key] ?? [] }
		}
	})

	return mock
}
