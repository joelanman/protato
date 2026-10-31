import semver from 'semver'

import { readProjectDependencies } from '../plugins.js'
import { listAllPlugins, listAvailablePlugins, listInstalledPlugins } from './list.js'

// npm sets npm_config_registry for the processes it starts, and a project may
// point at a mirror, so use the registry npm itself would use.
const REGISTRY_URL = (process.env.npm_config_registry ?? 'https://registry.npmjs.org').replace(/\/+$/, '')

// A page load should never wait on a registry that is not answering, and the
// registry either replies in well under a second or the machine is offline.
const REQUEST_TIMEOUT_MS = 1500

// How often to fetch in the background. Long, because the plugins page never
// waits for it and the 'Check for updates' button fetches on demand.
const FETCH_INTERVAL_MS = 15 * 60 * 1000

// The last known registry data for each package that has been asked about: its
// latest version and description. Nothing here expires: out of date data is
// better than an empty page. startFetchingPluginData keeps it current in the
// background, so reading it never waits and never asks the registry.
const pluginData = new Map()

// Requests already running, so two fetches close together share one request
// per plugin instead of making two.
const pendingRequests = new Map()

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

function getPluginData(packageName) {
	return pluginData.get(packageName)
}

// One request. A failure leaves the last known data alone rather than replacing
// it, so the plugins page keeps showing what it already knows.
async function requestPluginData(packageName) {
	try {
		const response = await fetch(`${REGISTRY_URL}/${packageName}/latest`, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		})

		if (!response.ok) {
			return
		}

		const registryPackage = await response.json()
		const latestVersion = semver.valid(registryPackage?.version)
		const description = registryPackage?.description
		const homepage = registryPackage?.homepage

		if (!latestVersion && !description && !homepage) {
			return
		}

		const data = { ...getPluginData(packageName) }

		if (latestVersion) {
			data.latestVersion = latestVersion
		}

		if (description) {
			data.description = description
		}

		if (homepage) {
			data.homepage = homepage
		}

		pluginData.set(packageName, data)

		return data
	} catch {
		// offline, timed out, or not valid JSON: there is nothing to report
	}
}

// Awaits a request to the registry, sharing one that is already running for the
// package. Used when the data is needed now, such as planning an update the
// user has asked for. This never rejects.
function fetchPluginData(packageName) {
	const pending = pendingRequests.get(packageName)

	if (pending) {
		return pending
	}

	const request = requestPluginData(packageName).finally(() => {
		pendingRequests.delete(packageName)
	})

	pendingRequests.set(packageName, request)

	return request
}

function clearRegistryCache() {
	pluginData.clear()
	pendingRequests.clear()
}

// Only registry plugins can be updated. protato runs the update, so it can never
// update itself.
function isUpdatablePlugin(packageName, dependencyVersion) {
	return packageName !== 'protato' && isRegistryDependency(dependencyVersion)
}

// The plugins the registry can answer for: everything the page lists except
// protato, and except a project dependency that is not a semver range. Plugins
// that are not installed yet are included, so their description can be shown
// before the user installs them.
function listRegistryPlugins(plugins) {
	const dependencies = readProjectDependencies()

	return plugins.filter((plugin) => {
		if (plugin.packageName === 'protato') {
			return false
		}

		const dependencyVersion = dependencies[plugin.packageName]

		if (dependencyVersion === undefined) {
			return true
		}

		return isRegistryDependency(dependencyVersion)
	})
}

// The installed plugins the registry can answer for, never protato itself.
function listUpdatablePlugins(plugins) {
	const dependencies = readProjectDependencies()

	return plugins.filter((plugin) => {
		const dependencyVersion = dependencies[plugin.packageName]

		return plugin.installed && isUpdatablePlugin(plugin.packageName, dependencyVersion)
	})
}

// Adds what the registry knows about each plugin: a description and homepage
// when the package has none of its own, and the latest version when the
// installed version can be updated. It reads the cache and never waits, because
// startFetchingPluginData keeps it current. Uninstalled plugins and dependencies
// that do not come from the registry are never offered an update.
function withPluginData(plugins) {
	const updatableNames = listUpdatablePlugins(plugins).map((plugin) => plugin.packageName)

	return plugins.map((plugin) => {
		const data = getPluginData(plugin.packageName)
		const pluginWithData = { ...plugin, updateAvailable: false }

		if (!pluginWithData.description && data?.description) {
			pluginWithData.description = data.description
		}

		if (!pluginWithData.homepage && data?.homepage) {
			pluginWithData.homepage = data.homepage
		}

		if (!updatableNames.includes(plugin.packageName)) {
			return pluginWithData
		}

		if (hasNewVersion(plugin.version, data?.latestVersion)) {
			pluginWithData.latestVersion = data.latestVersion
			pluginWithData.updateAvailable = true
		}

		return pluginWithData
	})
}

// The project's plugin lists with the data the registry knows about, ready for
// the plugins page. Reading is local and never waits for the network.
function getPluginLists() {
	const installedPlugins = listInstalledPlugins()

	return {
		installedPlugins: withPluginData(installedPlugins),
		availablePlugins: withPluginData(listAvailablePlugins(installedPlugins))
	}
}

// Fetches data for every plugin the registry can answer for and waits, so a
// page rendered afterwards has fresh versions and descriptions.
async function fetchAllPluginData() {
	const plugins = listAllPlugins()
	const registryPlugins = listRegistryPlugins(plugins)
	const packageNames = registryPlugins.map((plugin) => plugin.packageName)

	await Promise.all(packageNames.map((packageName) => fetchPluginData(packageName)))
}

// Starts fetching plugin data now, then every FETCH_INTERVAL_MS, so the cache
// stays current without anyone visiting the plugins page.
function startFetchingPluginData({ intervalMs = FETCH_INTERVAL_MS } = {}) {
	fetchAllPluginData()

	// unreferenced, so a dev server left running cannot be held open by it
	setInterval(fetchAllPluginData, intervalMs).unref()
}

export {
	clearRegistryCache,
	fetchAllPluginData,
	fetchPluginData,
	getPluginData,
	getPluginLists,
	hasNewVersion,
	isRegistryDependency,
	isUpdatablePlugin,
	startFetchingPluginData,
	withPluginData
}
