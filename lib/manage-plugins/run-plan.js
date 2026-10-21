import crossSpawn from 'cross-spawn'

import { getPaths } from '../paths.js'

const npmFlags = ['--no-audit', '--no-fund']

// The plan comes from makePluginPlan, which has already checked the action,
// package names, versions and protected packages. Only the action, package
// names and install versions are read, so nothing else can become an npm flag.
function buildNpmArguments(plan) {
	const { action, changes } = plan

	if (!['install', 'update', 'uninstall'].includes(action)) {
		throw new Error(`Unsupported npm operation: ${action}`)
	}

	if (!Array.isArray(changes) || changes.length === 0) {
		throw new Error('A plugin plan must include at least one package')
	}

	const args = [action === 'uninstall' ? 'uninstall' : 'install', ...npmFlags]

	if (action !== 'uninstall') {
		// without this npm saves the exact version as a range such as ^1.2.3
		args.push('--save-exact')
	}

	for (const change of changes) {
		args.push(action === 'uninstall' ? change.packageName : `${change.packageName}@${change.version}`)
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
			reject(new Error(`Could not run npm: ${error.message}`, { cause: error }))
		})

		// npm's final output can arrive after exit, so wait for close
		child.on('close', (code) => {
			resolve({ ok: code === 0, exitCode: code, stdout, stderr })
		})
	})
}

/**
 * Runs npm for a plan produced by makePluginPlan. The plan is trusted and is
 * not re-validated here.
 *
 * @param {object} plan
 * @param {'install'|'update'|'uninstall'} plan.action
 * @param {Array<{packageName: string, version?: string}>} plan.changes
 */
async function runPluginPlan(plan) {
	const { project } = getPaths()

	return execute(buildNpmArguments(plan), project)
}

export { runPluginPlan }
