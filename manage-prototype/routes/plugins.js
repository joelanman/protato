import fs from 'node:fs'
import path from 'node:path'

import express from 'express'
import { getPaths } from '../../lib/paths.js'
import plugins from '../../lib/plugins.js'

const CONFIG_FILE = 'govuk-prototype-kit.config.json'
const KNOWN_PLUGINS_FILE = 'known-plugins.json'

const router = express.Router()

function readJsonFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readKnownPlugins(paths, diagnostics) {
	const filePath = path.join(paths.package, KNOWN_PLUGINS_FILE)

	let knownPlugins

	try {
		knownPlugins = readJsonFile(filePath)

		if (!isObject(knownPlugins) || !Array.isArray(knownPlugins.available) || !Array.isArray(knownPlugins.protected)) {
			throw new Error('expected available and protected lists')
		}
	} catch (error) {
		diagnostics.push(`Could not read ${KNOWN_PLUGINS_FILE}: ${error.message}`)
		return { available: [], protectedPackages: [] }
	}

	return {
		available: knownPlugins.available.filter((packageName) => typeof packageName === 'string'),
		protectedPackages: knownPlugins.protected.filter((packageName) => typeof packageName === 'string')
	}
}

function readProjectDependencies(paths, diagnostics) {
	try {
		const projectPackage = readJsonFile(path.join(paths.project, 'package.json'))

		if (!isObject(projectPackage)) {
			throw new Error('expected an object')
		}

		return isObject(projectPackage.dependencies) ? projectPackage.dependencies : {}
	} catch (error) {
		diagnostics.push(`Could not read project package.json: ${error.message}`)
		return {}
	}
}

// a declaration does not prove a package is installed, so read the installed
// metadata separately and keep any problems with it as diagnostics
function readInstalledPackage(projectDir, packageName) {
	const packageDir = path.join(projectDir, 'node_modules', packageName)
	const diagnostics = []

	if (!fs.existsSync(packageDir)) {
		return { diagnostics }
	}

	let installedVersion

	try {
		const installedPackage = readJsonFile(path.join(packageDir, 'package.json'))

		if (!isObject(installedPackage)) {
			throw new Error('expected an object')
		}

		if (typeof installedPackage.version === 'string') {
			installedVersion = installedPackage.version
		}
	} catch (error) {
		diagnostics.push(`Could not read package.json for ${packageName}: ${error.message}`)
	}

	let config
	let configError
	const configPath = path.join(packageDir, CONFIG_FILE)

	if (fs.existsSync(configPath)) {
		try {
			config = readJsonFile(configPath)

			if (!isObject(config)) {
				throw new Error('expected an object')
			}
		} catch (error) {
			config = undefined
			configError = `Could not read ${CONFIG_FILE} for ${packageName}: ${error.message}`
			diagnostics.push(configError)
		}
	}

	return { installedVersion, config, configError, diagnostics }
}

function getInstallSource(declaration) {
	if (declaration === undefined) {
		return
	}

	if (declaration.startsWith('npm:')) {
		return 'alias'
	}

	if (
		declaration.startsWith('.') ||
		declaration.startsWith('/') ||
		declaration.startsWith('~/') ||
		declaration.startsWith('file:') ||
		declaration.startsWith('link:') ||
		declaration.startsWith('workspace:') ||
		/^[a-zA-Z]:[\\/]/.test(declaration)
	) {
		return 'local'
	}

	if (
		declaration.startsWith('git') ||
		declaration.startsWith('ssh:') ||
		declaration.startsWith('github:') ||
		declaration.startsWith('gitlab:') ||
		declaration.startsWith('bitbucket:') ||
		declaration.startsWith('gist:') ||
		// npm's GitHub shorthand, such as owner/repo or owner/repo#main
		/^[^@/\s][^/\s]*\/[^/\s]+(?:#.*)?$/.test(declaration)
	) {
		return 'git'
	}

	if (declaration.startsWith('http:') || declaration.startsWith('https:')) {
		return 'url'
	}

	// only treat clear version ranges and dist-tags as registry installs;
	// anything else stays read-only rather than replacing a local package
	if (/^(?:[\^~<>=*\d]|v\d)/.test(declaration) || /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(declaration)) {
		return 'registry'
	}

	return 'other'
}

function isValidDeclaration(declaration) {
	return typeof declaration === 'string' && declaration.trim().length > 0
}

router.get('/', (request, response) => {
	const paths = getPaths()
	const diagnostics = []
	const { available, protectedPackages } = readKnownPlugins(paths, diagnostics)
	const dependencies = readProjectDependencies(paths, diagnostics)

	const knownPackageNames = new Set([...protectedPackages, ...available])
	const installedByPackage = new Map()

	for (const packageName of Object.keys(dependencies).sort()) {
		installedByPackage.set(packageName, readInstalledPackage(paths.project, packageName))
	}

	// protected packages first, then the known list order, then installed
	// plugins that are not known (read only, shown so they can be diagnosed).
	// A config that exists but cannot be read still counts as a plugin.
	const packageNames = []

	for (const packageName of [...protectedPackages, ...available]) {
		if (!packageNames.includes(packageName)) {
			packageNames.push(packageName)
		}
	}

	for (const [packageName, installed] of installedByPackage) {
		if (!packageNames.includes(packageName) && (installed.config || installed.configError)) {
			packageNames.push(packageName)
		}
	}

	const pagePlugins = []

	for (const packageName of packageNames) {
		const declaration = dependencies[packageName]
		const installed = installedByPackage.get(packageName) ?? { diagnostics: [] }
		const pluginDiagnostics = [...(installed.diagnostics ?? [])]

		let installSource

		if (declaration !== undefined && !isValidDeclaration(declaration)) {
			pluginDiagnostics.push(`Invalid dependency declaration for ${packageName}: expected a non-empty string`)
			installSource = 'invalid'
		} else {
			installSource = getInstallSource(declaration)
		}

		const known = knownPackageNames.has(packageName)
		const protectedPackage = protectedPackages.includes(packageName)

		// protato is the tool running the project, so it cannot update or uninstall itself
		const readOnly =
			!known || packageName === 'protato' || (installSource !== undefined && installSource !== 'registry')

		pagePlugins.push({
			packageName,
			...plugins.formatPackageName(packageName),
			declaration,
			installedVersion: installed.installedVersion,
			installSource,
			known,
			protectedPackage,
			readOnly,
			// undefined pluginDependencies can mean no dependencies or unreadable
			// config, so say whether the dependency metadata is known at all
			dependenciesKnown: installed.config !== undefined,
			diagnostics: pluginDiagnostics
		})
	}

	response.render('plugins', { pageName: 'Plugins', plugins: pagePlugins, diagnostics })
})

export default router
