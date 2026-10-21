import semver from 'semver'

import knownPlugins from '../../known-plugins.json' with { type: 'json' }
import { fetchPackageMetadata, isExactVersion } from '../npm-registry.js'
import { formatPackageName, readProjectPlugins } from '../plugins.js'

const protectedPackages = new Set(knownPlugins.protected)

function getInstallSource(declaration) {
	if (typeof declaration !== 'string' || declaration.trim().length === 0) {
		return 'invalid'
	}

	return semver.validRange(declaration) ? 'registry' : 'other'
}

function buildInstalledPlugin({ packageName, declaration, ...installed }) {
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
		readOnly: packageName === 'protato' || installSource !== 'registry',
		pluginDependencies: installed.pluginDependencies,
		configSource: installed.configSource,
		diagnostics
	}
}

// the declared dependencies that behave as plugins, or that came from outside
// the registry. This is the same read the runtime uses, plus management policy,
// and it runs on every request so edits and npm installs are visible at once.
function readInstalledPlugins() {
	const { plugins: declared, error, proxyConfigs } = readProjectPlugins()

	// a read-only package stays in the list even before npm has installed it, so
	// the planner still knows not to replace it with a registry version
	const plugins = declared
		.filter((plugin) => plugin.hasPluginConfig || getInstallSource(plugin.declaration) !== 'registry')
		.map(buildInstalledPlugin)

	return { plugins, diagnostics: error ? [error] : [], proxyConfigs }
}

// the plugins the kit offers to install. Installed plugins are left out, so the
// page never offers to install something already in the project.
function readAvailablePlugins(installedPlugins) {
	const installedNames = new Set(installedPlugins.map((plugin) => plugin.packageName))

	return knownPlugins.available
		.filter((packageName) => !installedNames.has(packageName))
		.map((packageName) => ({ packageName, ...formatPackageName(packageName), diagnostics: [] }))
}

// the registry stage: each entry gets the latest version the registry has, or a
// diagnostic if the lookup failed. A failed lookup never fails the page.
async function getLatestVersion(plugin) {
	if (plugin.readOnly) {
		return plugin
	}

	try {
		const metadata = await fetchPackageMetadata(plugin.packageName)
		return { ...plugin, latestVersion: metadata.latestVersion }
	} catch (error) {
		return {
			...plugin,
			diagnostics: [...plugin.diagnostics, `Could not check for updates for ${plugin.packageName}: ${error.message}`]
		}
	}
}

// the page only offers actions the planner will accept, and both read the same
// fields, so the flags are derived in one place
function getInstalledActions({ installedVersion, latestVersion, readOnly, protectedPackage }) {
	const hasUpdate =
		!readOnly &&
		isExactVersion(installedVersion) &&
		isExactVersion(latestVersion) &&
		semver.gt(latestVersion, installedVersion)

	return { update: hasUpdate, uninstall: Boolean(installedVersion) && !readOnly && !protectedPackage }
}

async function listPlugins() {
	const { plugins, diagnostics } = readInstalledPlugins()

	const [installed, available] = await Promise.all([
		Promise.all(plugins.map(getLatestVersion)),
		Promise.all(readAvailablePlugins(plugins).map(getLatestVersion))
	])

	return {
		installed: installed.map((plugin) => ({ ...plugin, actions: getInstalledActions(plugin) })),
		available: available.map((plugin) => ({ ...plugin, actions: { install: Boolean(plugin.latestVersion) } })),
		diagnostics
	}
}

export { listPlugins, readInstalledPlugins }
