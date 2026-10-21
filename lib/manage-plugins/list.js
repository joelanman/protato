import semver from 'semver'

import knownPlugins from '../../known-plugins.json' with { type: 'json' }
import { fetchPackageMetadata, isExactVersion } from '../npm-registry.js'
import { getPaths } from '../paths.js'
import { formatPackageName, readInstalledPackage, readProjectDependencies, readProxyConfigs } from '../plugins.js'

const protectedPackages = new Set(knownPlugins.protected)
const knownPackageNames = new Set([...knownPlugins.protected, ...knownPlugins.available])

function getInstallSource(declaration) {
	if (declaration === undefined) {
		return
	}

	if (typeof declaration !== 'string' || declaration.trim().length === 0) {
		return 'invalid'
	}

	return semver.validRange(declaration) ? 'registry' : 'other'
}

function buildPluginEntry(packageName, declaration, installed) {
	const diagnostics = [...installed.diagnostics]
	const installSource = getInstallSource(declaration)

	if (installSource === 'invalid') {
		diagnostics.push(`Invalid dependency declaration for ${packageName}: expected a non-empty string`)
	}

	if (installed.installedVersion && !isExactVersion(installed.installedVersion)) {
		diagnostics.push(`Installed version of ${packageName} is not exact: ${installed.installedVersion}`)
	}

	// protato is the tool running the project, so it cannot update or uninstall
	// itself. Anything not installed from the registry is left alone rather
	// than being replaced by a registry version.
	return {
		packageName,
		...formatPackageName(packageName),
		installedVersion: installed.installedVersion,
		protectedPackage: protectedPackages.has(packageName),
		readOnly: packageName === 'protato' || (installSource !== undefined && installSource !== 'registry'),
		pluginDependencies: installed.pluginDependencies,
		configSource: installed.configSource,
		latestVersion: undefined,
		diagnostics
	}
}

// known plugins first (protected, then available), in their defined order, then
// any other project dependencies that behave as plugins. Read from disk on
// every call so edits and npm installs are visible immediately.
function readPluginEntries() {
	const paths = getPaths()
	const diagnostics = []
	const { dependencies, error } = readProjectDependencies(paths.project)

	if (error) {
		diagnostics.push(error)
	}

	const proxyConfigs = readProxyConfigs()
	const entries = []

	for (const packageName of knownPackageNames) {
		const installed = readInstalledPackage(paths.project, packageName, proxyConfigs)
		entries.push(buildPluginEntry(packageName, dependencies[packageName], installed))
	}

	for (const packageName of Object.keys(dependencies).sort()) {
		if (knownPackageNames.has(packageName)) {
			continue
		}

		const installed = readInstalledPackage(paths.project, packageName, proxyConfigs)

		if (installed.hasPluginConfig) {
			entries.push(buildPluginEntry(packageName, dependencies[packageName], installed))
		}
	}

	return { plugins: entries, diagnostics, proxyConfigs }
}

// the page only offers actions the planner will accept, and both read the same
// fields, so the flags are derived in one place
function getActions(plugin) {
	const { installedVersion, latestVersion, readOnly, protectedPackage } = plugin
	const installed = Boolean(installedVersion)
	const writable = !readOnly
	const hasUpdate =
		isExactVersion(installedVersion) && isExactVersion(latestVersion) && semver.gt(latestVersion, installedVersion)

	return {
		install: writable && !installed && Boolean(latestVersion),
		update: writable && installed && hasUpdate,
		uninstall: writable && !protectedPackage && installed
	}
}

// the registry stage: each entry gets the latest version the registry has, or a
// diagnostic if the lookup failed. A failed lookup never fails the page.
async function getLatestVersions(entries) {
	return Promise.all(
		entries.map(async (plugin) => {
			if (plugin.readOnly) {
				return { ...plugin }
			}

			try {
				const metadata = await fetchPackageMetadata(plugin.packageName)
				return { ...plugin, latestVersion: metadata.latestVersion }
			} catch (error) {
				return {
					...plugin,
					diagnostics: [
						...plugin.diagnostics,
						`Could not check for updates for ${plugin.packageName}: ${error.message}`
					]
				}
			}
		})
	)
}

async function listPlugins() {
	const { plugins: entries, diagnostics } = readPluginEntries()
	const withVersions = await getLatestVersions(entries)

	return {
		plugins: withVersions.map((plugin) => ({ ...plugin, actions: getActions(plugin) })),
		diagnostics
	}
}

export { listPlugins, readPluginEntries }
