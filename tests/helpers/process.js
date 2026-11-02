import { once } from 'node:events'

// Stops a child process, escalating to SIGKILL if it does not exit in time.
async function stopProcess(childProcess) {
	if (!childProcess || childProcess.exitCode !== null || childProcess.signalCode !== null) {
		return
	}

	childProcess.kill('SIGTERM')

	const forceKillTimeout = setTimeout(() => childProcess.kill('SIGKILL'), 2000)

	try {
		await once(childProcess, 'exit')
	} finally {
		clearTimeout(forceKillTimeout)
	}
}

export { stopProcess }
