import crossSpawn from 'cross-spawn'

import knownPlugins from '../known-plugins.json' with { type: 'json' }
import { getPaths } from './paths.js'
import { isExactVersion } from './plugin-registry.js'
import { stopProcessTree } from './utils/stop-process-tree.js'

const INSTALL = 'install'
const UNINSTALL = 'uninstall'
const KNOWN_PACKAGE_NAMES = new Set([...knownPlugins.available, ...knownPlugins.protected])
const PROTECTED_PACKAGE_NAMES = new Set(knownPlugins.protected)
const NPM_FLAGS = ['--no-audit', '--no-fund']
const OPERATION_TIMEOUT_MS = 10 * 60 * 1000
const MAX_OUTPUT_BYTES = 64 * 1024

class PluginNpmError extends Error {
	constructor(message, options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined)
		this.name = 'PluginNpmError'
		this.code = options.code ?? 'NPM_ERROR'
	}
}

// Only the operation, package name and exact install version are read from the
// plan, so nothing else can become an npm flag, path or URL.
function buildNpmArguments(plan) {
	const { operation, packages } = plan

	if (operation !== INSTALL && operation !== UNINSTALL) {
		throw new PluginNpmError(`Unsupported npm operation: ${operation}`, { code: 'INVALID_OPERATION' })
	}

	if (!Array.isArray(packages) || packages.length === 0) {
		throw new PluginNpmError('A plugin plan must include at least one package', { code: 'INVALID_PLAN' })
	}

	const args = [operation, ...NPM_FLAGS]

	if (operation === INSTALL) {
		// without this npm saves the exact version as a range such as ^1.2.3
		args.push('--save-exact')
	}

	const seen = new Set()

	for (let index = 0; index < packages.length; index++) {
		const entry = packages[index]
		const position = `packages[${index}]`

		const packageName = entry.packageName

		if (!KNOWN_PACKAGE_NAMES.has(packageName)) {
			throw new PluginNpmError(`${packageName} is not in known-plugins.json`, { code: 'NOT_ALLOWED' })
		}

		if (seen.has(packageName)) {
			throw new PluginNpmError(`${packageName} appears more than once in the plan`, { code: 'DUPLICATE_PACKAGE' })
		}

		seen.add(packageName)

		if (operation === INSTALL) {
			if (!isExactVersion(entry.version)) {
				throw new PluginNpmError(`${position} needs an exact version, got: ${entry.version}`, {
					code: 'INVALID_VERSION'
				})
			}

			args.push(`${packageName}@${entry.version}`)
			continue
		}

		// defence in depth: the planner also refuses this, but the execution
		// boundary must not remove a protected package even if a plan asks it to
		if (PROTECTED_PACKAGE_NAMES.has(packageName)) {
			throw new PluginNpmError(`${packageName} is protected and cannot be uninstalled`, {
				code: 'PROTECTED_PACKAGE'
			})
		}

		args.push(packageName)
	}

	return args
}

// Keep a bounded tail of a stream: npm puts its summary and errors at the end.
function createOutputBuffer(maxBytes) {
	let buffer = Buffer.alloc(0)
	let truncated = false

	return {
		push(chunk) {
			buffer = Buffer.concat([buffer, chunk])

			if (buffer.length > maxBytes) {
				buffer = buffer.subarray(buffer.length - maxBytes)
				truncated = true
			}
		},

		get truncated() {
			return truncated
		},

		toString() {
			return buffer.toString('utf8')
		}
	}
}

function execute(args, projectDir) {
	return new Promise((resolve, reject) => {
		const stdout = createOutputBuffer(MAX_OUTPUT_BYTES)
		const stderr = createOutputBuffer(MAX_OUTPUT_BYTES)
		let child
		let settled = false
		let timedOut = false
		let cleanupDone = false
		let exitCode
		let closed = false
		let timeoutTimer

		function buildResult(code) {
			return {
				ok: code === 0 && !timedOut,
				exitCode: code,
				stdout: stdout.toString(),
				stderr: stderr.toString(),
				outputTruncated: stdout.truncated || stderr.truncated,
				timedOut
			}
		}

		function finish(code) {
			if (settled) {
				return
			}

			settled = true
			clearTimeout(timeoutTimer)
			resolve(buildResult(code))
		}

		function fail(error) {
			if (settled) {
				return
			}

			settled = true
			clearTimeout(timeoutTimer)
			reject(error)
		}

		// Normal runs finish only on close: npm's final output can arrive after
		// exit. After a timeout, also wait for cleanup before settling.
		function onClose(code) {
			closed = true
			exitCode = code

			if (!timedOut || cleanupDone) {
				finish(code)
			}
		}

		// A timed-out tree is force-killed. If a process outside the group keeps
		// the pipes open, close may never arrive, so use exit as the fallback.
		function onExit(code) {
			exitCode = code

			if (timedOut && cleanupDone) {
				finish(code)
			}
		}

		function onTimeout() {
			if (settled) {
				return
			}

			timedOut = true

			stopProcessTree(child).then(
				() => {
					cleanupDone = true

					if (closed || exitCode !== undefined) {
						finish(exitCode)
					}
				},
				(error) => {
					if (settled) {
						return
					}

					const failure = new PluginNpmError(`Could not clean up the npm process tree: ${error.message}`, {
						code: 'CLEANUP_FAILED',
						cause: error
					})
					failure.result = buildResult(exitCode ?? null)
					fail(failure)
				}
			)
		}

		try {
			child = crossSpawn('npm', args, {
				cwd: projectDir,
				shell: false,
				windowsHide: true,
				// a detached child leads its own process group on POSIX, so a
				// timeout can stop every process npm started
				detached: process.platform !== 'win32',
				stdio: ['ignore', 'pipe', 'pipe']
			})
		} catch (error) {
			fail(new PluginNpmError(`Could not start npm: ${error.message}`, { code: 'SPAWN_ERROR', cause: error }))
			return
		}

		child.stdout?.on('data', (chunk) => stdout.push(chunk))
		child.stderr?.on('data', (chunk) => stderr.push(chunk))

		child.on('error', (error) => {
			fail(new PluginNpmError(`Could not run npm: ${error.message}`, { code: 'SPAWN_ERROR', cause: error }))
		})

		child.on('exit', onExit)
		child.on('close', onClose)

		timeoutTimer = setTimeout(onTimeout, OPERATION_TIMEOUT_MS)
	})
}

let inFlight = false
// set when a timeout could not establish cleanup: orphaned npm processes may
// still be changing the project, so no further mutation is safe until restart
let locked = false

/**
 * Runs one fixed npm install or uninstall for the current project. Only the
 * structured plan is accepted. If a timed-out process tree cannot be cleaned
 * up, this rejects with `CLEANUP_FAILED` (partial result on `error.result`) and
 * locks the runner until the dev server restarts.
 *
 * @param {object} plan
 * @param {'install'|'uninstall'} plan.operation
 * @param {Array<{packageName: string, version?: string}>} plan.packages
 */
async function runPluginNpm(plan) {
	if (locked) {
		throw new PluginNpmError(
			'A previous npm operation did not confirm process cleanup; restart the dev server before running npm again',
			{ code: 'CLEANUP_REQUIRED' }
		)
	}

	if (inFlight) {
		throw new PluginNpmError('Another npm operation is already running', { code: 'BUSY' })
	}

	const paths = getPaths()
	const args = buildNpmArguments(plan)

	inFlight = true

	try {
		return await execute(args, paths.project)
	} catch (error) {
		if (error?.code === 'CLEANUP_FAILED') {
			locked = true
		}

		throw error
	} finally {
		inFlight = false
	}
}

export { PluginNpmError, runPluginNpm }
