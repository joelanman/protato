import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MANIFEST_FILE = 'govuk-prototype-kit.config.json'

function writeFile(dir, filePath, contents) {
	const fullPath = path.join(dir, filePath)
	fs.mkdirSync(path.dirname(fullPath), { recursive: true })
	fs.writeFileSync(fullPath, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`)
}

function writeFiles(dir, files = {}) {
	for (const [filePath, contents] of Object.entries(files)) {
		writeFile(dir, filePath, contents)
	}
}

/**
 * Creates a temporary project with real files on disk, so plugin loading can be
 * tested without mocking node:fs.
 *
 * @param {object} options
 * @param {object} [options.dependencies] project package.json dependencies,
 *   defaults to every plugin at version 1.0.0
 * @param {Array<object>} [options.plugins] plugins installed in node_modules:
 *   { packageName, version?, config?, packageJson?, files? }. A config that is a
 *   string is written as-is (e.g. invalid JSON), an undefined config means no
 *   manifest file is written.
 * @param {object} [options.files] project files, relative to the project root
 * @returns {{ dir: string, cleanup: () => void }}
 */
export function createPluginProject({ dependencies, plugins = [], files = {} } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-plugin-project-'))

	writeFile(dir, 'package.json', {
		dependencies:
			dependencies ?? Object.fromEntries(plugins.map((plugin) => [plugin.packageName, plugin.version ?? '1.0.0']))
	})
	writeFiles(dir, files)

	for (const { packageName, version = '1.0.0', config, packageJson = {}, files: pluginFiles = {} } of plugins) {
		const packageDir = path.join('node_modules', packageName)

		writeFile(dir, path.join(packageDir, 'package.json'), { name: packageName, version, ...packageJson })

		if (config !== undefined) {
			writeFile(dir, path.join(packageDir, MANIFEST_FILE), config)
		}

		writeFiles(path.join(dir, packageDir), pluginFiles)
	}

	return {
		dir,
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
	}
}
