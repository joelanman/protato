import { describe, expect, it } from 'vitest'

import { planPluginChanges } from './plugin-plan.js'

const knownPackages = [
	'govuk-frontend',
	'@govuk-prototype-kit/common-templates',
	'@govuk-prototype-kit/step-by-step',
	'@ministryofjustice/frontend',
	'hmrc-frontend',
	'dep'
]

const protectedPackages = ['protato', 'govuk-frontend']

function installedPlugin(packageName, installedVersion, pluginDependencies = []) {
	return { packageName, installedVersion, pluginDependencies }
}

function createInput(overrides = {}) {
	return {
		operation: 'install',
		packageName: 'hmrc-frontend',
		version: '2.0.0',
		installed: [],
		knownPackages,
		readOnlyPackages: [],
		protectedPackages,
		...overrides
	}
}

function createRegistry({ metadata = {}, configs = {}, errors = {} } = {}) {
	return {
		async getMetadata(packageName) {
			if (errors[packageName]) {
				throw new Error(errors[packageName])
			}

			return metadata[packageName] ?? { latestVersion: '1.0.0', stableVersions: ['1.0.0'] }
		},

		async getConfig(packageName, version) {
			const key = `${packageName}@${version}`

			if (errors[key]) {
				throw new Error(errors[key])
			}

			const pluginDependencies = configs[key] ?? []

			return { packageName, version, config: { pluginDependencies }, pluginDependencies }
		}
	}
}

function planFixture({ metadata, configs, errors, ...input } = {}) {
	return planPluginChanges(createInput(input), createRegistry({ metadata, configs, errors }))
}

function getChange(result, packageName) {
	return result.changes.find((change) => change.packageName === packageName)
}

describe('install and update planning', () => {
	it('installs the target and a missing dependency at the highest stable version', async () => {
		const result = await planFixture({
			metadata: { dep: { latestVersion: '1.2.0', stableVersions: ['1.0.0', '1.2.0'] } },
			configs: {
				'hmrc-frontend@2.0.0': ['dep'],
				'dep@1.2.0': []
			}
		})

		expect(result.ok).toBe(true)
		expect(result.noop).toBe(false)
		expect(result.changes.map((change) => change.packageName)).toEqual(['dep', 'hmrc-frontend'])
		expect(getChange(result, 'hmrc-frontend')).toMatchObject({
			action: 'install',
			version: '2.0.0',
			reason: 'requested',
			requiredBy: []
		})
		expect(getChange(result, 'dep')).toMatchObject({
			action: 'install',
			version: '1.2.0',
			reason: 'dependency',
			requiredBy: ['hmrc-frontend']
		})
	})

	it('updates an installed dependency that is below minVersion', async () => {
		const result = await planFixture({
			installed: [installedPlugin('govuk-frontend', '5.0.0')],
			metadata: { 'govuk-frontend': { latestVersion: '6.1.0', stableVersions: ['5.0.0', '6.0.0', '6.1.0'] } },
			configs: {
				'hmrc-frontend@2.0.0': [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }],
				'govuk-frontend@6.1.0': []
			}
		})

		expect(result.ok).toBe(true)
		expect(getChange(result, 'govuk-frontend')).toMatchObject({
			action: 'update',
			version: '6.1.0',
			installedVersion: '5.0.0',
			reason: 'dependency',
			requiredBy: ['hmrc-frontend']
		})
	})

	it('reports a maxVersion conflict with another installed plugin', async () => {
		const result = await planFixture({
			installed: [
				installedPlugin('govuk-frontend', '6.0.0'),
				installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', [
					{ packageName: 'govuk-frontend', minVersion: '6.0.0' }
				])
			],
			metadata: { 'govuk-frontend': { latestVersion: '6.0.0', stableVersions: ['5.0.0', '6.0.0'] } },
			configs: {
				'hmrc-frontend@2.0.0': [{ packageName: 'govuk-frontend', maxVersion: '5.0.0' }],
				'govuk-frontend@5.0.0': []
			}
		})

		expect(result.ok).toBe(false)
		expect(result.changes).toEqual([])
		expect(result.problems.join(' ')).toContain('No stable version of govuk-frontend')
	})

	it('reports a requested version that violates an installed plugin constraint', async () => {
		const result = await planFixture({
			installed: [
				installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', [
					{ packageName: 'hmrc-frontend', minVersion: '3.0.0' }
				])
			]
		})

		expect(result.ok).toBe(false)
		expect(result.problems.join(' ')).toContain('hmrc-frontend 2.0.0 does not satisfy requirements')
	})

	it('reports an unknown or read-only dependency', async () => {
		const unknown = await planFixture({ configs: { 'hmrc-frontend@2.0.0': ['unknown-plugin'] } })
		expect(unknown.ok).toBe(false)
		expect(unknown.problems.join(' ')).toContain('unknown-plugin is required by hmrc-frontend')

		const readOnly = await planFixture({
			readOnlyPackages: ['govuk-frontend'],
			configs: { 'hmrc-frontend@2.0.0': ['govuk-frontend'] }
		})
		expect(readOnly.ok).toBe(false)
		expect(readOnly.problems.join(' ')).toContain('govuk-frontend is required by hmrc-frontend but is read-only')
	})

	it('stops at a dependency cycle rather than looping', async () => {
		const result = await planFixture({
			configs: {
				'hmrc-frontend@2.0.0': ['@govuk-prototype-kit/step-by-step'],
				'@govuk-prototype-kit/step-by-step@2.0.0': [{ packageName: 'hmrc-frontend', minVersion: '2.0.0' }]
			},
			metadata: {
				'@govuk-prototype-kit/step-by-step': { latestVersion: '2.0.0', stableVersions: ['2.0.0'] }
			}
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual([
			'@govuk-prototype-kit/step-by-step',
			'hmrc-frontend'
		])
	})

	it('treats an unreadable installed config as having no dependencies', async () => {
		const result = await planFixture({
			installed: [
				installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', undefined),
				installedPlugin('govuk-frontend', '5.0.0')
			]
		})

		expect(result.ok).toBe(true)
		expect(result.noop).toBe(false)
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})

	it('reports invalid dependency declarations as problems instead of throwing', async () => {
		const result = await planFixture({
			configs: { 'hmrc-frontend@2.0.0': [{ packageName: 'dep', minVersion: '^1.0.0' }] }
		})

		expect(result.ok).toBe(false)
		expect(result.problems.join(' ')).toContain('invalid minVersion')
	})

	it('reports a no-op when the requested state already holds', async () => {
		const result = await planFixture({
			installed: [installedPlugin('hmrc-frontend', '2.0.0')]
		})

		expect(result.ok).toBe(true)
		expect(result.noop).toBe(true)
		expect(result.changes).toEqual([])
	})

	it('rejects when the registry cannot be read', async () => {
		const result = planFixture({
			configs: { 'hmrc-frontend@2.0.0': ['dep'] },
			errors: { dep: 'registry unavailable' }
		})

		await expect(result).rejects.toThrow('registry unavailable')
	})

	it('blocks an unknown or read-only target', async () => {
		const unknown = await planFixture({ packageName: 'unknown-plugin', version: '1.0.0' })
		expect(unknown.ok).toBe(false)
		expect(unknown.problems.join(' ')).toContain('unknown-plugin is not a known plugin')

		const readOnly = await planFixture({ readOnlyPackages: ['hmrc-frontend'] })
		expect(readOnly.ok).toBe(false)
		expect(readOnly.problems.join(' ')).toContain('hmrc-frontend is read-only')
	})
})

describe('uninstall planning', () => {
	it('removes installed dependents recursively and leaves unrelated packages alone', async () => {
		const result = await planFixture({
			operation: 'uninstall',
			packageName: '@govuk-prototype-kit/common-templates',
			installed: [
				installedPlugin('hmrc-frontend', '2.0.0', ['@govuk-prototype-kit/step-by-step', 'govuk-frontend']),
				installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', ['@govuk-prototype-kit/common-templates']),
				installedPlugin('@govuk-prototype-kit/common-templates', '1.0.0'),
				installedPlugin('govuk-frontend', '5.11.2')
			]
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual([
			'@govuk-prototype-kit/common-templates',
			'@govuk-prototype-kit/step-by-step',
			'hmrc-frontend'
		])
		expect(getChange(result, '@govuk-prototype-kit/common-templates')).toMatchObject({
			action: 'uninstall',
			installedVersion: '1.0.0',
			reason: 'requested'
		})
		expect(getChange(result, '@govuk-prototype-kit/step-by-step')).toMatchObject({
			reason: 'dependent',
			requiredBy: ['@govuk-prototype-kit/common-templates']
		})
		expect(getChange(result, 'hmrc-frontend')).toMatchObject({
			reason: 'dependent',
			requiredBy: ['@govuk-prototype-kit/step-by-step']
		})
		expect(getChange(result, 'govuk-frontend')).toBeUndefined()
	})

	it('blocks removal of a protected or read-only dependent', async () => {
		const protectedResult = await planFixture({
			operation: 'uninstall',
			installed: [
				installedPlugin('hmrc-frontend', '2.0.0'),
				installedPlugin('govuk-frontend', '5.11.2', ['hmrc-frontend'])
			]
		})

		expect(protectedResult.ok).toBe(false)
		expect(protectedResult.problems.join(' ')).toContain('govuk-frontend is protected')

		const readOnlyResult = await planFixture({
			operation: 'uninstall',
			readOnlyPackages: ['local-plugin'],
			installed: [
				installedPlugin('hmrc-frontend', '2.0.0'),
				installedPlugin('local-plugin', '1.0.0', ['hmrc-frontend'])
			]
		})

		expect(readOnlyResult.ok).toBe(false)
		expect(readOnlyResult.problems.join(' ')).toContain('local-plugin is read-only')
	})

	it('blocks removal of an unknown dependent', async () => {
		const result = await planFixture({
			operation: 'uninstall',
			installed: [
				installedPlugin('hmrc-frontend', '2.0.0'),
				installedPlugin('unknown-plugin', '1.0.0', ['hmrc-frontend'])
			]
		})

		expect(result.ok).toBe(false)
		expect(result.problems.join(' ')).toContain('unknown-plugin is not a known plugin')
	})

	it('blocks removal of a protected or read-only target', async () => {
		const protectedResult = await planFixture({
			operation: 'uninstall',
			packageName: 'govuk-frontend',
			installed: [installedPlugin('govuk-frontend', '5.11.2')]
		})
		expect(protectedResult.ok).toBe(false)
		expect(protectedResult.problems.join(' ')).toContain('protected')

		const readOnlyResult = await planFixture({
			operation: 'uninstall',
			readOnlyPackages: ['hmrc-frontend'],
			installed: [installedPlugin('hmrc-frontend', '2.0.0')]
		})
		expect(readOnlyResult.ok).toBe(false)
		expect(readOnlyResult.problems.join(' ')).toContain('read-only')
	})

	it('returns a no-op when the package is not installed', async () => {
		const result = await planFixture({
			operation: 'uninstall',
			installed: [installedPlugin('govuk-frontend', '5.11.2')]
		})

		expect(result.ok).toBe(true)
		expect(result.noop).toBe(true)
		expect(result.changes).toEqual([])
	})
})
