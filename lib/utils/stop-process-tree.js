import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const CLEANUP_TIMEOUT_MS = 2000
const POLL_INTERVAL_MS = 25

class ProcessTreeError extends Error {
	constructor(message, options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined)
		this.name = 'ProcessTreeError'
		this.code = options.code ?? 'CLEANUP_FAILED'
	}
}

function isChildRunning(child) {
	return child.exitCode === null && child.signalCode === null
}

// A zombie still counts as alive. In containers without an init reaper this can
// turn a successful kill into a cleanup failure, which fails safe.
function isGroupAlive(pgid) {
	try {
		process.kill(-pgid, 0)
		return true
	} catch (error) {
		return error.code !== 'ESRCH'
	}
}

function signalGroup(pgid, signal) {
	try {
		process.kill(-pgid, signal)
		return true
	} catch (error) {
		// only ESRCH means the group is gone; anything else (for example EPERM)
		// means cleanup could not be established
		if (error.code === 'ESRCH') {
			return false
		}

		throw new ProcessTreeError(`Could not signal process group ${pgid}: ${error.message}`, {
			cause: error
		})
	}
}

async function waitUntilStopped(isAlive, errorMessage) {
	const deadline = Date.now() + CLEANUP_TIMEOUT_MS

	while (isAlive()) {
		if (Date.now() >= deadline) {
			throw new ProcessTreeError(errorMessage)
		}

		await delay(POLL_INTERVAL_MS)
	}
}

// POSIX: the child must have been spawned detached, so its pid is also its
// process group id. npm has no rollback, so force-kill the group immediately
// and handle descendants even when the parent exits first.
async function stopPosixProcessTree(child) {
	const pgid = child.pid

	if (!signalGroup(pgid, 'SIGKILL')) {
		// no such group: either everything has exited, or the caller did not spawn
		// the child detached. Killing only the parent is not tree cleanup.
		if (isChildRunning(child)) {
			throw new ProcessTreeError('Could not signal the process group. POSIX children must be spawned detached.', {
				code: 'INVALID_PROCESS_GROUP'
			})
		}

		return
	}

	await waitUntilStopped(() => isGroupAlive(pgid), `Process group ${pgid} still had processes after SIGKILL`)
}

function runTaskkill(pid) {
	return new Promise((resolve) => {
		let killer

		try {
			killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
				stdio: 'ignore',
				windowsHide: true
			})
		} catch {
			resolve(false)
			return
		}

		killer.on('error', () => resolve(false))
		killer.on('close', (exitCode) => resolve(exitCode === 0))
	})
}

async function stopWindowsProcessTree(child) {
	if (!isChildRunning(child)) {
		// taskkill can only find the tree through a live parent pid, and the pid may
		// already have been reused. Descendants are unknown, not confirmed stopped.
		throw new ProcessTreeError('Could not confirm that npm descendants stopped because npm had already exited', {
			code: 'UNKNOWN_CLEANUP'
		})
	}

	if (!(await runTaskkill(child.pid))) {
		throw new ProcessTreeError('taskkill could not confirm that the process tree stopped')
	}

	await waitUntilStopped(() => isChildRunning(child), 'The process tree did not exit after taskkill')
}

/**
 * Force-stops a child process and its descendants.
 *
 * POSIX: the child must have been spawned detached so it leads its own process
 * group. The group is sent SIGKILL, then watched until it is gone. Windows: the
 * tree is ended with taskkill /T /F.
 *
 * Resolves only when cleanup is established. Rejects with a `ProcessTreeError`
 * when cleanup failed or could not be confirmed, so callers cannot mistake
 * unknown descendants for a stopped tree.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
async function stopProcessTree(child) {
	if (!child?.pid) {
		return
	}

	if (process.platform === 'win32') {
		await stopWindowsProcessTree(child)
		return
	}

	await stopPosixProcessTree(child)
}

export { ProcessTreeError, stopProcessTree }
