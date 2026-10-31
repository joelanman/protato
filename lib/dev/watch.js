import chokidar from 'chokidar'
import { debounce } from 'radash'

import { buildSass, getBuildResult } from '../build.js'
import { isChangeRunning, rebuildAndRestart } from '../manage-plugins/change.js'
import { getPaths } from '../paths.js'
import livereload from './livereload.js'
import supervisor from './supervisor.js'

let paths

function isSameError(a, b) {
	return a?.message === b?.message && a?.stack === b?.stack
}

// These run in debounced callbacks, where a rejection would go unhandled, so a
// failed restart is logged and watching carries on.
async function restartAndReload(restart) {
	try {
		await restart()
		livereload.reload()
	} catch (error) {
		console.error(`Could not restart the prototype: ${error.message}`)
	}
}

// Frontend assets reload in the browser, so only .js, .json and .env restart
// the backend.
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
	const debouncedAction = debounce({ delay: 200 }, () => restartAndReload(supervisor.restartPrototypeServer))

	const watcher = chokidar.watch([paths.app, paths.env], {
		ignored: getBackendIgnored(paths),
		ignoreInitial: true,
		persistent: true
	})

	watcher.on('all', (event, path) => {
		console.log('watch backend - ' + event + ': ' + path)
		debouncedAction()
	})
}

function watchFrontend() {
	const debouncedAction = debounce({ delay: 200 }, () => {
		livereload.reload()
	})

	// ignore sass - watch the compiled css instead
	const watcher = chokidar.watch([paths.public, paths.views, paths.assets], {
		ignored: { path: paths.sass, recursive: true },
		ignoreInitial: true
	})

	watcher.on('change', (path) => {
		console.log(`watch frontend - change: ${path}`)
		debouncedAction()
	})
}

function watchSass() {
	const debouncedAction = debounce({ delay: 200 }, async () => {
		const previousResult = getBuildResult()
		const newBuildResult = buildSass()

		// restart only if the error changed (ok -> error, error -> ok, or a new error).
		// if sass still compiles, watchFrontend sees the new css and reloads.
		if (!isSameError(previousResult?.error, newBuildResult.error)) {
			console.log('watch sass - build result changed, restart server')
			await restartAndReload(supervisor.restartPrototypeServer)
		}
	})

	const watcher = chokidar.watch(paths.sass, {
		ignoreInitial: true
	})

	watcher.on('all', (event, path) => {
		console.log('watch sass - ' + event + ':' + path)
		debouncedAction()
	})
}

// Plugins installed from a terminal are picked up here. npm always writes the
// lockfile, including for a version change that leaves package.json alone, so
// watching it covers every install, update and uninstall.
function watchPlugins() {
	const debouncedAction = debounce({ delay: 200 }, async () => {
		// a change made from the plugins page rebuilds and restarts itself
		if (isChangeRunning()) {
			return
		}

		await restartAndReload(rebuildAndRestart)
	})

	const watcher = chokidar.watch(paths.packageLockFile, {
		ignoreInitial: true,
		disableGlobbing: true,
		// wait for npm to finish writing before rebuilding. The default 2 second
		// stability threshold would delay every rebuild by that much.
		awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
	})

	watcher.on('all', (event, filePath) => {
		console.log('watch plugins - ' + event + ': ' + filePath)
		debouncedAction()
	})
}

const watch = () => {
	paths = getPaths()
	watchSass()
	watchBackend()
	watchFrontend()
	watchPlugins()
}

export { getBackendIgnored, watch }
