import fs from 'node:fs'
import path from 'node:path'

import chokidar from 'chokidar'
import { debounce } from 'radash'

import { processSass } from './build.js'
import devServer from './dev-server.js'
import livereload from './livereload.js'
import { getPaths } from './paths.js'
import { isObject } from './utils/plugin-config.js'

const PACKAGE_FILES = new Set(['package.json', 'package-lock.json'])
const PACKAGE_DEBOUNCE_MS = 300

let paths

// the latest build result, so a backend restart still shows a broken build's error
let buildResult

// package files are written by the UI and by command-line npm, so remember the
// last dependency state we acted on and only refresh when that state changes
let packageState
let packageTimer

function setBuildResult(result) {
	buildResult = result
}

function isSameError(a, b) {
	return a?.message === b?.message && a?.stack === b?.stack
}

function sortObjectKeys(object) {
	const sorted = {}
	for (const key of Object.keys(object).sort()) {
		sorted[key] = object[key]
	}
	return sorted
}

// Read only what a plugin refresh depends on: declared dependencies and their
// resolved versions. Lockfile versions catch command-line installs where the
// installed version changes without a declaration change.
function readProjectPackageState(projectDir) {
	let projectPackage

	try {
		projectPackage = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
	} catch (error) {
		return { error: `could not read project package.json: ${error.message}` }
	}

	if (!isObject(projectPackage)) {
		return { error: 'could not read project package.json: expected an object' }
	}

	const dependencies = isObject(projectPackage.dependencies) ? projectPackage.dependencies : {}
	const versions = {}
	const packageLockPath = path.join(projectDir, 'package-lock.json')

	if (fs.existsSync(packageLockPath)) {
		let packageLock

		try {
			packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'))
		} catch (error) {
			return { error: `could not read project package-lock.json: ${error.message}` }
		}

		if (!isObject(packageLock)) {
			return { error: 'could not read project package-lock.json: expected an object' }
		}

		const lockedPackages = isObject(packageLock.packages) ? packageLock.packages : {}

		for (const packageName of Object.keys(dependencies)) {
			const version = lockedPackages[`node_modules/${packageName}`]?.version
			if (typeof version === 'string') {
				versions[packageName] = version
			}
		}
	}

	return {
		dependencies: sortObjectKeys(dependencies),
		versions: sortObjectKeys(versions)
	}
}

// Backend restarts only for js/json/.env - ignore frontend assets
function getBackendIgnored(paths) {
	return (path, stats) => {
		if (path === paths.assets) {
			return true
		}
		if (path === paths.env) {
			return false
		}
		return stats?.isFile() && !path.endsWith('.js') && !path.endsWith('.json')
	}
}

function watchBackend() {
	const debouncedAction = debounce({ delay: 200 }, async () => {
		if (devServer.updatingPlugins) {
			return
		}
		await devServer.restartPrototype(buildResult)
		livereload.reload()
	})

	const watcher = chokidar.watch([paths.app, paths.env], {
		ignored: getBackendIgnored(paths),
		ignoreInitial: true,
		persistent: true
	})

	watcher.on('all', (event, path) => {
		console.log('watch backend - ' + event + ': ' + path)
		if (devServer.updatingPlugins) {
			return
		}
		debouncedAction()
	})
}

function watchFrontend() {
	const debouncedAction = debounce({ delay: 200 }, () => {
		if (devServer.updatingPlugins) {
			return
		}
		livereload.reload()
	})

	// ignore sass - watch the compiled css instead
	const watcher = chokidar.watch([paths.public, paths.views, paths.assets], {
		ignored: { path: paths.sass, recursive: true },
		ignoreInitial: true
	})

	watcher.on('change', (path) => {
		console.log(`watch frontend - change: ${path}`)
		if (devServer.updatingPlugins) {
			return
		}
		debouncedAction()
	})
}

function isPackageFile(projectDir, filePath) {
	const resolvedPath = path.resolve(filePath)
	return path.dirname(resolvedPath) === path.resolve(projectDir) && PACKAGE_FILES.has(path.basename(resolvedPath))
}

function schedulePackageRefresh() {
	if (packageTimer) {
		clearTimeout(packageTimer)
	}

	packageTimer = setTimeout(() => {
		packageTimer = undefined
		refreshAfterPackageChange()
	}, PACKAGE_DEBOUNCE_MS)
}

async function refreshAfterPackageChange() {
	if (devServer.updatingPlugins) {
		return
	}

	const state = readProjectPackageState(paths.project)

	if (state.error) {
		// editors and npm may have another write coming, which will trigger us again
		console.warn(`Protato: ${state.error}`)
		return
	}

	const previousPackageState = packageState
	packageState = JSON.stringify(state)

	// ignore formatting, scripts and other unrelated package edits
	if (previousPackageState === packageState) {
		return
	}

	try {
		await devServer.refreshPlugins()
	} catch (error) {
		console.warn(`Protato: could not refresh after package files changed: ${error.message}`)
	}
}

// The plugin UI ignores package events while it updates packages, so record the
// resulting state once it has finished to avoid a second refresh later.
function syncPackageState() {
	if (!paths) {
		return
	}

	const state = readProjectPackageState(paths.project)

	if (!state.error) {
		packageState = JSON.stringify(state)
	}
}

function watchPackages() {
	const projectDir = paths.project
	const initialState = readProjectPackageState(projectDir)

	if (initialState.error) {
		console.warn(`Protato: ${initialState.error}`)
	} else {
		packageState = JSON.stringify(initialState)
	}

	// watch the project directory rather than the two files so editor-style
	// replacement (unlink then add) keeps being noticed
	const watcher = chokidar.watch(projectDir, {
		depth: 0,
		ignoreInitial: true,
		persistent: true
	})

	watcher.on('all', (event, filePath) => {
		if (!isPackageFile(projectDir, filePath)) {
			return
		}

		console.log('watch packages - ' + event + ': ' + filePath)

		if (devServer.updatingPlugins) {
			return
		}

		schedulePackageRefresh()
	})
}

function watchSass() {
	const debouncedAction = debounce({ delay: 200 }, async () => {
		if (devServer.updatingPlugins) {
			return
		}
		const previousResult = buildResult
		buildResult = processSass()

		// restart only if the error changed (ok -> error, error -> ok, or a new error).
		// if sass still compiles, watchFrontend sees the new css and reloads.
		if (!isSameError(previousResult.error, buildResult.error)) {
			console.log('watch sass - build result changed, restart server')
			await devServer.restartPrototype(buildResult)
			livereload.reload()
		}
	})

	const watcher = chokidar.watch(paths.sass, {
		ignoreInitial: true
	})

	watcher.on('all', (event, path) => {
		console.log('watch sass - ' + event + ':' + path)
		if (devServer.updatingPlugins) {
			return
		}
		debouncedAction()
	})
}

const watch = (initialBuildResult) => {
	buildResult = initialBuildResult
	paths = getPaths()
	watchSass()
	watchBackend()
	watchFrontend()
	watchPackages()
}

export { getBackendIgnored, setBuildResult, syncPackageState, watch }
