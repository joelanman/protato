import chokidar from 'chokidar'
import { debounce } from 'radash'

import { processSass } from './build.js'
import devServer from './dev-server.js'
import livereload from './livereload.js'
import { getPaths } from './paths.js'

let paths

// the latest build result, so a backend restart still shows a broken build's error
let buildResult

function setBuildResult(result) {
	buildResult = result
}

function isSameError(a, b) {
	return a?.message === b?.message && a?.stack === b?.stack
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
}

export { getBackendIgnored, setBuildResult, watch }
