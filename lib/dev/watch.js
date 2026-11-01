// Development only. Watches the project and tells the supervisor and the
// browser what to do about a change. The build functions are passed in from
// lib/start.js, so this file imports nothing from outside lib/dev/. Plugin
// changes are applied with the restart button on the plugins page.

import chokidar from 'chokidar'
import { debounce } from 'radash'

import livereload from './livereload.js'
import supervisor from './supervisor.js'

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

function watchBackend(paths) {
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

function watchFrontend(paths) {
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

// The prototype server shows the build error only if the process is restarted,
// so sass is built here and a restart is only asked for when the error changed.
function watchSass(paths, build) {
	const debouncedAction = debounce({ delay: 200 }, async () => {
		const previousResult = build.getBuildResult()
		const newBuildResult = build.buildSass()

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

function watch(paths, build) {
	watchSass(paths, build)
	watchBackend(paths)
	watchFrontend(paths)
}

export { getBackendIgnored, watch }
