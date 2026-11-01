// Development only. Watches the project and tells the supervisor and the
// prototype process what to do about a change. It never builds: the prototype
// process builds sass and builds everything else when it starts. Plugin changes
// are applied with the restart button on the plugins page.

import chokidar from 'chokidar'
import { debounce } from 'radash'

import livereload from './livereload.js'
import supervisor from './supervisor.js'

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

// The prototype process compiles sass and decides what to show, so it can report
// a build error without being restarted.
function watchSass(paths) {
	const debouncedAction = debounce({ delay: 200 }, () => {
		supervisor.sendMessage({ action: 'build-sass' })
	})

	const watcher = chokidar.watch(paths.sass, {
		ignoreInitial: true
	})

	watcher.on('all', (event, path) => {
		console.log('watch sass - ' + event + ':' + path)
		debouncedAction()
	})
}

function watch(paths) {
	watchSass(paths)
	watchBackend(paths)
	watchFrontend(paths)
}

export { getBackendIgnored, watch }
