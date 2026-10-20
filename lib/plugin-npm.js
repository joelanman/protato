import crossSpawn from 'cross-spawn'

import { knownPackageNames, protectedPackages } from './known-plugins.js'
import { getPaths } from './paths.js'
import { isExactVersion } from './plugin-registry.js'

const INSTALL = 'install'
const UNINSTALL = 'uninstall'
const PROTECTED_PACKAGE_NAMES = new Set(protectedPackages)
const NPM_FLAGS = ['--no-audit', '--no-fund']

class PluginNpmError extends Error {
	constructor(message, options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined)
		this.name = 'PluginNpmError'
	}
}

// Only the operation, package name and exact install version are read from the
// plan, so nothing else can become an npm flag, path or URL.
function buildNpmArguments(plan) {
	const { operation, packages } = plan

	if (operation !== INSTALL && operation !== UNINSTALL) {
		throw new PluginNpmError(`Unsupported npm operation: ${operation}`)
	}

	if (!Array.isArray(packages) || packages.length === 0) {
		throw new PluginNpmError('A plugin plan must include at least one package')
	}

	const args = [operation, ...NPM_FLAGS]

	if (operation === INSTALL) {
		// without this npm saves the exact version as a range such as ^1.2.3
		args.push('--save-exact')
	}

	const seen = new Set()

	for (const entry of packages) {
		const packageName = entry.packageName

		if (!knownPackageNames.has(packageName)) {
			throw new PluginNpmError(`${packageName} is not in known-plugins.json`)
		}

		if (seen.has(packageName)) {
			throw new PluginNpmError(`${packageName} appears more than once in the plan`)
		}

		seen.add(packageName)

		if (operation === INSTALL) {
			if (!isExactVersion(entry.version)) {
				throw new PluginNpmError(`${packageName} needs an exact version, got: ${entry.version}`)
			}

			args.push(`${packageName}@${entry.version}`)
			continue
		}

		// defence in depth: the planner also refuses this, but the execution
		// boundary must not remove a protected package even if a plan asks it to
		if (PROTECTED_PACKAGE_NAMES.has(packageName)) {
			throw new PluginNpmError(`${packageName} is protected and cannot be uninstalled`)
		}

		args.push(packageName)
	}

	return args
}

function execute(args, projectDir) {
	return new Promise((resolve, reject) => {
		let stdout = ''
		let stderr = ''

		const child = crossSpawn('npm', args, {
			cwd: projectDir,
			shell: false,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		})

		child.stdout?.on('data', (chunk) => {
			stdout += chunk
		})
		child.stderr?.on('data', (chunk) => {
			stderr += chunk
		})

		child.on('error', (error) => {
			reject(new PluginNpmError(`Could not run npm: ${error.message}`, { cause: error }))
		})

		// npm's final output can arrive after exit, so wait for close
		child.on('close', (code) => {
			resolve({ ok: code === 0, exitCode: code, stdout, stderr })
		})
	})
}

/**
 * Runs one fixed npm install or uninstall for the current project. Only the
 * structured plan is accepted.
 *
 * @param {object} plan
 * @param {'install'|'uninstall'} plan.operation
 * @param {Array<{packageName: string, version?: string}>} plan.packages
 */
async function runPluginNpm(plan) {
	const { project } = getPaths()
	const args = buildNpmArguments(plan)

	return execute(args, project)
}

export { runPluginNpm }
