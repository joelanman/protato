import crossSpawn from 'cross-spawn'

import { getPaths } from '../paths.js'

// npm is called as npm.cmd on Windows, which child_process cannot launch with
// shell: false. cross-spawn handles that, and still takes an argument list
// rather than a shell string.

// npm can print a lot when it fails. Keep enough to explain the problem without
// putting an unbounded amount on the result page.
const MAX_OUTPUT_LENGTH = 4000

// A valid npm package name, optionally scoped. Package names become npm
// arguments, so anything that is not a name is rejected before spawn runs.
function isValidPackageName(packageName) {
	if (typeof packageName !== 'string') {
		return false
	}

	if (packageName.length === 0 || packageName.length > 214) {
		return false
	}

	if (packageName.startsWith('@')) {
		const parts = packageName.slice(1).split('/')

		if (parts.length !== 2) {
			return false
		}

		return parts.every(isValidNamePart)
	}

	return isValidNamePart(packageName)
}

function isValidNamePart(part) {
	return /^[a-zA-Z0-9][a-zA-Z0-9._~-]*$/.test(part)
}

function runNpm(args) {
	return new Promise((resolve) => {
		const child = crossSpawn('npm', args, {
			cwd: getPaths().project,
			shell: false,
			// npm colours its output for a terminal, but this is shown as text
			env: { ...process.env, npm_config_color: 'false' },
			stdio: ['ignore', 'pipe', 'pipe']
		})

		let output = ''

		function collectOutput(data) {
			if (output.length < MAX_OUTPUT_LENGTH) {
				output += data.toString().slice(0, MAX_OUTPUT_LENGTH - output.length)
			}
		}

		child.stdout.on('data', collectOutput)
		child.stderr.on('data', collectOutput)

		child.on('error', (error) => resolve({ ok: false, output: error.message }))
		child.on('close', (code) => resolve({ ok: code === 0, output: output.trim() }))
	})
}

export { isValidPackageName, runNpm }
