/**
 * Resets a stand-in for the npm registry module.
 *
 * `latest` maps package names to the version the registry reports, `versions`
 * maps package names to the stable versions it can choose from, `configs` maps
 * `package@version` keys to the pluginDependencies that version declares, and
 * `errors` maps either to an error message. Every package defaults to 1.0.0
 * with no plugin dependencies, so a test only states what it cares about.
 *
 * @param {object} mock the mocked registry functions
 * @param {object} [options]
 * @param {object} [options.latest]
 * @param {object} [options.versions]
 * @param {object} [options.configs]
 * @param {object} [options.errors]
 * @returns {object} the mocked registry functions
 */
export function resetRegistryMock(mock, { latest = {}, versions = {}, configs = {}, errors = {} } = {}) {
	mock.latest = { ...latest }
	mock.versions = { ...versions }
	mock.configs = { ...configs }
	mock.errors = { ...errors }

	mock.fetchPackageMetadata.mockImplementation(async (packageName) => {
		if (mock.errors[packageName]) {
			throw new Error(mock.errors[packageName])
		}

		const version = mock.latest[packageName] ?? '1.0.0'
		const stableVersions = mock.versions[packageName] ?? [version]

		return { packageName, latestVersion: version, stableVersions }
	})

	mock.fetchPluginConfig.mockImplementation(async (packageName, version) => {
		const key = `${packageName}@${version}`

		if (mock.errors[key]) {
			throw new Error(mock.errors[key])
		}

		const pluginDependencies = mock.configs[key] ?? []

		return {
			packageName,
			version,
			config: { pluginDependencies },
			pluginDependencies
		}
	})

	return mock
}
