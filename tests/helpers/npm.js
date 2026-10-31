import crossSpawn from 'cross-spawn'

// npm is npm.cmd on Windows, which child_process cannot launch directly.
// cross-spawn handles that, so npm runs the same way on every platform.
function spawnNpm(args, options) {
	return crossSpawn('npm', args, options)
}

// Runs npm and resolves with its output. Rejects when npm cannot start or
// exits with an error, like execFile does.
function runNpm(args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawnNpm(args, { ...options, stdio: 'pipe' })
		let stdout = ''
		let stderr = ''

		child.stdout.on('data', (data) => {
			stdout += data
		})

		child.stderr.on('data', (data) => {
			stderr += data
		})

		child.on('error', reject)
		child.on('close', (code) => {
			if (code === 0) {
				resolve({ stdout, stderr })
				return
			}

			reject(new Error(`npm ${args.join(' ')} failed with exit code ${code}\n${stderr}`))
		})
	})
}

// Runs npm and waits for it to finish. Throws when it fails, like execFileSync.
function runNpmSync(args, options = {}) {
	const result = crossSpawn.sync('npm', args, { ...options, stdio: 'pipe' })

	if (result.error) {
		throw result.error
	}

	if (result.status !== 0) {
		throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr}`)
	}

	return result
}

export { runNpm, runNpmSync }
