import { spawn } from 'node:child_process'

import { getPaths } from '../paths.js'

// npm can be called as npm.cmd on Windows. The argument list is always passed
// to spawn, never through a shell.
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

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

// Runs npm in the project with an argument list. Resolves true when npm
// succeeds.
function runNpm(args) {
	return new Promise((resolve) => {
		const child = spawn(npmCommand, args, {
			cwd: getPaths().project,
			shell: false,
			stdio: 'ignore'
		})

		child.on('error', () => resolve(false))
		child.on('close', (code) => resolve(code === 0))
	})
}

export { isValidPackageName, runNpm }
