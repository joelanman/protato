import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CONFIG_FILE } from '../../lib/plugins.js'

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
 *   { packageName, version?, config?, packageJson?, files?, linkFrom? }. A config that is a
 *   string is written as-is (e.g. invalid JSON), an undefined config means no
 *   config file is written. linkFrom links the package directory to a real
 *   package instead of writing files, which is useful for testing the packages
 *   Protato ships with.
 * @param {object} [options.files] project files, relative to the project root
 * @returns {{ dir: string, cleanup: () => void }}
 */
export function createPluginProject({ dependencies, plugins = [], files = {} } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-plugin-project-'))

	if (!dependencies) {
		dependencies = {}
		for (const plugin of plugins) {
			dependencies[plugin.packageName] = plugin.version ?? '1.0.0'
		}
	}

	writeFile(dir, 'package.json', { dependencies })
	writeFiles(dir, files)

	for (const {
		packageName,
		version = '1.0.0',
		config,
		packageJson = {},
		files: pluginFiles = {},
		linkFrom
	} of plugins) {
		const packageDir = path.join('node_modules', packageName)

		if (linkFrom) {
			fs.mkdirSync(path.dirname(path.join(dir, packageDir)), { recursive: true })
			fs.symlinkSync(linkFrom, path.join(dir, packageDir), 'junction')
			continue
		}

		writeFile(dir, path.join(packageDir, 'package.json'), { name: packageName, version, ...packageJson })

		if (config !== undefined) {
			writeFile(dir, path.join(packageDir, CONFIG_FILE), config)
		}

		writeFiles(path.join(dir, packageDir), pluginFiles)
	}

	return {
		dir,
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
	}
}

/**
 * A project with one plugin of each kind the plugin management pages care
 * about: protato itself, a protected registry plugin, an editable registry
 * plugin, a plugin installed from a local source, and an unknown plugin.
 */
export const knownPluginsProject = {
	dependencies: {
		protato: '0.1.0',
		'govuk-frontend': '5.11.2',
		'hmrc-frontend': '6.0.0',
		'local-plugin': 'file:../local-plugin',
		'unknown-plugin': '1.0.0'
	},
	plugins: [
		{ packageName: 'protato', version: '0.1.0', config: {} },
		{ packageName: 'govuk-frontend', version: '5.11.2', config: {} },
		{ packageName: 'hmrc-frontend', version: '6.0.0', config: {} },
		{ packageName: 'local-plugin', version: '1.0.0', config: {} },
		{ packageName: 'unknown-plugin', version: '1.0.0', config: {} }
	]
}
