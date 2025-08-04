function stopProcess(process) {
	return new Promise((resolve) => {
		let forceStopTimeout
		if (process && !process.killed) {
			console.log('stopProcess - Stopping process...')

			process.on('exit', () => {
				console.log('stopProcess - Process exit')
				process = null
				clearTimeout(forceStopTimeout)
				resolve()
			})

			// Try graceful shutdown first
			process.kill('SIGTERM')

			// Force kill after 2 seconds if needed
			forceStopTimeout = setTimeout(() => {
				if (process && !process.killed) {
					console.log('stopProcess - Force stopping process...')
					process.kill('SIGKILL')
				}
			}, 2000)
		} else {
			resolve()
		}
	})
}

export { stopProcess }
