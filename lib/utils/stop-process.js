function stopProcess(childProcess) {
	return new Promise((resolve) => {
		if (!childProcess || childProcess.exitCode !== null || childProcess.signalCode !== null) {
			console.log('stopProcess - Process already stopped or never started.')
			return resolve()
		}

		let stopped = false

		const forceStopTimeout = setTimeout(() => {
			if (!stopped) {
				console.log(`stopProcess - Graceful stop timed out. Force stopping PID: ${childProcess.pid}...`)
				childProcess.kill('SIGKILL')
			}
		}, 2000)

		childProcess.on('exit', (code, signal) => {
			if (!stopped) {
				stopped = true
				console.log(`stopProcess - Process PID: ${childProcess.pid} exited with code: ${code}, signal: ${signal}`)
				clearTimeout(forceStopTimeout)
				// Also remove the listener to prevent memory leaks
				childProcess.removeAllListeners()
				resolve()
			}
		})

		console.log(`stopProcess - Attempting to gracefully stop PID: ${childProcess.pid} with SIGTERM...`)
		childProcess.kill('SIGTERM')
	})
}

export { stopProcess }
