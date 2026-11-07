import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from './create.js'

describe('create', () => {
	let tempDir

	const expectStarterCopy = (target) => {
		expect(fs.existsSync(path.join(target, 'app', 'views'))).toBe(true)
		expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true)
		expect(fs.existsSync(path.join(target, 'node_modules'))).toBe(true)
	}

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-create-'))
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it('copies the starter into a new path', () => {
		const target = path.join(tempDir, 'new-prototype')

		create(target)

		expectStarterCopy(target)
		expect(console.log).toHaveBeenCalledWith('Done')
	})

	it('copies the starter into an existing empty directory', () => {
		const target = path.join(tempDir, 'empty-prototype')
		fs.mkdirSync(target)

		create(target)

		expectStarterCopy(target)
	})

	it('refuses to overwrite a directory that has files in it', () => {
		const target = path.join(tempDir, 'full-prototype')
		fs.mkdirSync(target)
		fs.writeFileSync(path.join(target, 'existing.txt'), 'keep me')

		create(target)

		expect(console.error).toHaveBeenCalledWith('Path is not an empty directory')
		expect(console.error).toHaveBeenCalledWith(target)
		expect(console.log).not.toHaveBeenCalled()
		expect(fs.existsSync(path.join(target, 'app'))).toBe(false)
		expect(fs.readFileSync(path.join(target, 'existing.txt'), 'utf8')).toBe('keep me')
	})

	it('refuses when the path is an existing file', () => {
		const target = path.join(tempDir, 'existing-file')
		fs.writeFileSync(target, 'keep me')

		create(target)

		expect(console.error).toHaveBeenCalledWith('Path is not an empty directory')
		expect(console.log).not.toHaveBeenCalled()
		expect(fs.readFileSync(target, 'utf8')).toBe('keep me')
	})
})
