// The supervisor stays small by only depending on node, two packages and its
// own files. If it imported the prototype's code it would have to restart
// whenever that code changed, which is the problem it exists to avoid.

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const devDirectory = import.meta.dirname

const allowedPackages = new Set(['chokidar', 'radash'])

function isAllowed(importPath) {
	if (importPath.startsWith('node:')) {
		return true
	}

	if (allowedPackages.has(importPath)) {
		return true
	}

	if (importPath.startsWith('.')) {
		const resolvedPath = path.resolve(devDirectory, importPath)
		return resolvedPath.startsWith(devDirectory + path.sep)
	}

	return false
}

function readImports(fileName) {
	const contents = fs.readFileSync(path.join(devDirectory, fileName), 'utf8')
	const importPaths = []

	for (const pattern of [
		// import ... from 'x', import 'x'
		/\bfrom\s+['"]([^'"]+)['"]/g,
		/\bimport\s+['"]([^'"]+)['"]/g,
		// import('x')
		/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
	]) {
		for (const match of contents.matchAll(pattern)) {
			importPaths.push(match[1])
		}
	}

	return importPaths
}

const supervisorFiles = fs
	.readdirSync(devDirectory)
	.filter((fileName) => fileName.endsWith('.js') && !fileName.endsWith('.test.js'))

describe('supervisor imports', () => {
	it('covers every file in lib/dev', () => {
		expect(supervisorFiles.length).toBeGreaterThan(0)
	})

	it('imports nothing outside lib/dev, node, chokidar and radash', () => {
		const offendingImports = []

		for (const fileName of supervisorFiles) {
			for (const importPath of readImports(fileName)) {
				if (!isAllowed(importPath)) {
					offendingImports.push(`${fileName} imports ${importPath}`)
				}
			}
		}

		expect(offendingImports).toEqual([])
	})
})
