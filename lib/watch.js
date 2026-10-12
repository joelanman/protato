import chokidar from 'chokidar'
import { debounce } from 'radash'

import { processSass } from './build.js'
import livereload from './livereload.js'
import { getPaths } from './paths.js'
import serverManager from './server-manager.js'

let paths

function watchBackend() {
	const debouncedAction = debounce({ delay: 200 }, () => {
		serverManager.restart()
	})

	const ignoreWatchFiles = (path, stats) => {
		// don't ignore folders or it doesn't work

		if (!stats || !stats.isFile()) {
			return false
		}

		if (path.endsWith('.js') || path.endsWith('.json')) {
			return false
		} else {
			return true
		}
	}
	const watcher = chokidar.watch(paths.app, {
		ignored: ignoreWatchFiles,
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
		// only reload if prototype server is running
		if (serverManager.getState() === 'prototype') {
			livereload.reload()
		}
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
	const debouncedAction = debounce({ delay: 200 }, () => {
		processSass()
	})

	const watcher = chokidar.watch(paths.sass, {
		ignoreInitial: true
	})

	watcher.on('all', (event, path) => {
		console.log('watch sass - ' + event + ':' + path)
		debouncedAction()
	})
}

const watch = () => {
	paths = getPaths()
	watchSass()
	watchBackend()
	watchFrontend()
}

export { watch }
