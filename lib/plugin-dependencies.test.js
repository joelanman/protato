import { describe, expect, it } from 'vitest'

import {
	isExactVersion,
	isStableVersion,
	isValidPackageName,
	normalisePluginDependencies,
	PluginDependencyError
} from './plugin-dependencies.js'

describe('package and version validation', () => {
	it('recognises package names and exact stable versions', () => {
		expect(isValidPackageName('govuk-frontend')).toBe(true)
		expect(isValidPackageName('@govuk-prototype-kit/step-by-step')).toBe(true)
		expect(isValidPackageName('@scope/plugin.js')).toBe(true)
		expect(isValidPackageName('bad name')).toBe(false)
		expect(isValidPackageName('@scope')).toBe(false)
		expect(isValidPackageName('@scope/extra/name')).toBe(false)
		expect(isValidPackageName('.hidden')).toBe(false)

		expect(isExactVersion('1.2.3')).toBe(true)
		expect(isExactVersion('1.2.3-beta.1')).toBe(true)
		expect(isExactVersion('1.2.3+build.1')).toBe(true)
		expect(isExactVersion('1.2.3-beta.1+build.1')).toBe(true)
		expect(isExactVersion('v1.2.3')).toBe(false)
		expect(isExactVersion('^1.2.3')).toBe(false)
		expect(isExactVersion('1.2')).toBe(false)

		expect(isStableVersion('1.2.3')).toBe(true)
		expect(isStableVersion('1.2.3+build.1')).toBe(true)
		expect(isStableVersion('1.2.3-beta.1')).toBe(false)
	})
})

describe('normalisePluginDependencies', () => {
	it('normalises strings, objects and single values', () => {
		expect(normalisePluginDependencies(undefined)).toEqual([])
		expect(normalisePluginDependencies('dep')).toEqual([{ packageName: 'dep' }])
		expect(normalisePluginDependencies({ packageName: 'dep', minVersion: '1.0.0' })).toEqual([
			{ packageName: 'dep', minVersion: '1.0.0' }
		])
		expect(
			normalisePluginDependencies([
				'dep',
				{ packageName: '@scope/dep', minVersion: '1.0.0', maxVersion: '2.0.0', extra: true }
			])
		).toEqual([{ packageName: 'dep' }, { packageName: '@scope/dep', minVersion: '1.0.0', maxVersion: '2.0.0' }])
	})

	it('keeps duplicate entries for the planner to resolve', () => {
		expect(normalisePluginDependencies(['dep', 'dep'])).toEqual([{ packageName: 'dep' }, { packageName: 'dep' }])
	})

	it.each([
		['a non-string value', [123]],
		['an object without a package name', [{}]],
		['an invalid package name', ['bad name']],
		['an invalid minimum version', [{ packageName: 'dep', minVersion: '^1.0.0' }]],
		['an invalid maximum version', [{ packageName: 'dep', maxVersion: 2 }]],
		['a null minimum version', [{ packageName: 'dep', minVersion: null }]],
		['a minimum above the maximum', [{ packageName: 'dep', minVersion: '2.0.0', maxVersion: '1.0.0' }]]
	])('rejects %s', (_label, dependencies) => {
		expect(() => normalisePluginDependencies(dependencies)).toThrow(
			expect.objectContaining({ name: 'PluginDependencyError' })
		)
	})

	it('uses a dedicated error class', () => {
		expect(() => normalisePluginDependencies([123])).toThrow(PluginDependencyError)
	})
})
