import chokidar from 'chokidar'
import { debounce } from 'radash'

import { getPaths } from './paths.js'
import { restartServer } from './server-manager.js'

// debounce restart so we don't restart many times if many files change at once

const debouncedRestart = debounce({ delay: 200 }, () => {
	restartServer()
})

function ignoreWatchFiles(path, stats) {
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

const watchApp = () => {
	const paths = getPaths()
	const watcher = chokidar.watch(paths.app, {
		ignored: ignoreWatchFiles,
		ignoreInitial: true,
		persistent: true
	})

	watcher.on('all', (event, path) => {
		console.log('server manager - Watch: ' + event + ': ' + path)
		debouncedRestart()
	})
}

export { watchApp }
