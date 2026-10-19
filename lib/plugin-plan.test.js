import { describe, expect, it } from 'vitest'
import { planPluginChanges } from './plugin-plan.js'

const knownPackages = [
	'govuk-frontend',
	'@govuk-prototype-kit/common-templates',
	'@govuk-prototype-kit/step-by-step',
	'@ministryofjustice/frontend',
	'hmrc-frontend'
]

const protectedPackages = ['protato', 'govuk-frontend']
const defaultTarget = 'hmrc-frontend@6.0.0'

function installedPlugin(packageName, installedVersion, pluginDependencies = [], extra = {}) {
	return {
		packageName,
		installedVersion,
		pluginDependencies,
		dependenciesKnown: true,
		...extra
	}
}

// shrink the two shapes tests repeat: version lists and dependency lists
function registry({ packages = {}, configs = {} } = {}) {
	const asPackage = (value) => (Array.isArray(value) ? { stableVersions: value } : value)
	const asConfig = (value) => (Array.isArray(value) ? { pluginDependencies: value } : value)

	return {
		packages: Object.fromEntries(Object.entries(packages).map(([name, value]) => [name, asPackage(value)])),
		configs: Object.fromEntries(Object.entries(configs).map(([key, value]) => [key, asConfig(value)]))
	}
}

function createInput(overrides = {}) {
	return {
		operation: 'install',
		packageName: 'hmrc-frontend',
		version: '6.0.0',
		installed: [],
		knownPackages,
		readOnlyPackages: [],
		protectedPackages,
		registry: registry({ configs: { [defaultTarget]: [] } }),
		...overrides
	}
}

// the default target's config is supplied unless the test overrides it
function planFixture({ packages = {}, configs = {}, ...input } = {}) {
	const targetConfigs = input.operation === 'uninstall' ? configs : { [defaultTarget]: [], ...configs }

	return planPluginChanges(createInput({ ...input, registry: registry({ packages, configs: targetConfigs }) }))
}

function getChange(result, packageName) {
	return result.changes.find((change) => change.packageName === packageName)
}

function getErrors(result) {
	return result.problems.filter((problem) => problem.type === 'error')
}

function getMissing(result) {
	return result.problems.filter((problem) => problem.type === 'missing')
}

function getErrorCodes(result) {
	return getErrors(result).map((error) => error.code)
}

function deepFreeze(value) {
	if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
		return value
	}

	for (const key of Object.keys(value)) {
		deepFreeze(value[key])
	}

	return Object.freeze(value)
}

describe('install and update planning', () => {
	it('installs the requested package and a missing plugin dependency at the highest stable version', () => {
		const result = planFixture({
			packages: { 'govuk-frontend': ['5.10.0', '5.11.2', '6.0.0'] },
			configs: {
				[defaultTarget]: ['govuk-frontend'],
				'govuk-frontend@6.0.0': []
			}
		})

		expect(result.ok).toBe(true)
		expect(result.noop).toBe(false)
		expect(getChange(result, 'hmrc-frontend')).toMatchObject({
			action: 'install',
			version: '6.0.0',
			installedVersion: undefined,
			reason: 'requested',
			requiredBy: []
		})
		expect(getChange(result, 'govuk-frontend')).toMatchObject({
			action: 'install',
			version: '6.0.0',
			reason: 'dependency',
			requiredBy: ['hmrc-frontend']
		})
	})

	it('accepts string and object requirements and treats minimum and maximum versions as inclusive', () => {
		const result = planFixture({
			installed: [installedPlugin('hmrc-frontend', '6.0.0'), installedPlugin('govuk-frontend', '5.11.2')],
			packages: { '@govuk-prototype-kit/step-by-step': ['2.0.0'] },
			configs: {
				[defaultTarget]: [
					'@govuk-prototype-kit/step-by-step',
					{ packageName: 'govuk-frontend', minVersion: '5.11.2', maxVersion: '5.11.2' }
				],
				'@govuk-prototype-kit/step-by-step@2.0.0': []
			}
		})

		// the missing step-by-step dependency is still required, but the
		// installed govuk-frontend is at both inclusive bounds
		expect(result.ok).toBe(true)
		expect(getChange(result, 'govuk-frontend')).toBeUndefined()
		expect(getChange(result, '@govuk-prototype-kit/step-by-step')).toMatchObject({
			action: 'install',
			reason: 'dependency'
		})
	})

	it('updates an installed dependency that does not satisfy the target version constraints', () => {
		const result = planFixture({
			installed: [installedPlugin('govuk-frontend', '5.11.2')],
			packages: { 'govuk-frontend': ['5.11.2', '6.0.0', '6.1.0'] },
			configs: {
				[defaultTarget]: [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }],
				'govuk-frontend@6.1.0': []
			}
		})

		expect(result.ok).toBe(true)
		expect(getChange(result, 'govuk-frontend')).toMatchObject({
			action: 'update',
			version: '6.1.0',
			installedVersion: '5.11.2',
			reason: 'dependency',
			requiredBy: ['hmrc-frontend']
		})
	})

	it('re-resolves an earlier dependency choice when a later plugin requires an older version', () => {
		const result = planFixture({
			packages: {
				'govuk-frontend': ['5.11.2', '6.0.0'],
				'@govuk-prototype-kit/step-by-step': ['2.0.0']
			},
			configs: {
				[defaultTarget]: ['govuk-frontend', '@govuk-prototype-kit/step-by-step'],
				'@govuk-prototype-kit/step-by-step@2.0.0': [{ packageName: 'govuk-frontend', maxVersion: '5.11.2' }],
				'govuk-frontend@5.11.2': [],
				'govuk-frontend@6.0.0': []
			}
		})

		expect(result.ok).toBe(true)
		expect(getChange(result, 'govuk-frontend')).toMatchObject({
			action: 'install',
			version: '5.11.2',
			requiredBy: ['hmrc-frontend', '@govuk-prototype-kit/step-by-step']
		})
	})

	it('drops dependencies that were only required by an earlier version choice', () => {
		const result = planFixture({
			packages: {
				'govuk-frontend': ['5.11.2', '6.0.0'],
				'@govuk-prototype-kit/step-by-step': ['2.0.0']
			},
			configs: {
				[defaultTarget]: ['govuk-frontend', '@govuk-prototype-kit/step-by-step'],
				'govuk-frontend@6.0.0': ['@govuk-prototype-kit/common-templates'],
				'govuk-frontend@5.11.2': [],
				'@govuk-prototype-kit/step-by-step@2.0.0': [{ packageName: 'govuk-frontend', maxVersion: '5.11.2' }]
			}
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual([
			'@govuk-prototype-kit/step-by-step',
			'govuk-frontend',
			'hmrc-frontend'
		])
		expect(getChange(result, '@govuk-prototype-kit/common-templates')).toBeUndefined()
	})

	it('downgrades an installed dependency that is newer than a plugin allows', () => {
		const result = planFixture({
			packageName: '@ministryofjustice/frontend',
			version: '3.0.0',
			installed: [installedPlugin('govuk-frontend', '6.0.0')],
			packages: { 'govuk-frontend': ['5.11.2', '6.0.0'] },
			configs: {
				'@ministryofjustice/frontend@3.0.0': [{ packageName: 'govuk-frontend', maxVersion: '5.11.2' }],
				'govuk-frontend@5.11.2': []
			}
		})

		expect(result.ok).toBe(true)
		expect(getChange(result, 'govuk-frontend')).toMatchObject({
			action: 'downgrade',
			version: '5.11.2',
			installedVersion: '6.0.0',
			reason: 'dependency',
			requiredBy: ['@ministryofjustice/frontend']
		})
	})

	it('blocks a dependency downgrade that would break another installed plugin', () => {
		const result = planFixture({
			packageName: '@ministryofjustice/frontend',
			version: '3.0.0',
			installed: [
				installedPlugin('govuk-frontend', '6.5.0'),
				installedPlugin('hmrc-frontend', '6.0.0', [{ packageName: 'govuk-frontend', minVersion: '6.5.0' }])
			],
			packages: { 'govuk-frontend': ['5.11.2', '6.5.0'] },
			configs: {
				'@ministryofjustice/frontend@3.0.0': [{ packageName: 'govuk-frontend', maxVersion: '5.11.2' }],
				'govuk-frontend@5.11.2': []
			}
		})

		expect(result.ok).toBe(false)
		expect(result.changes).toEqual([])
		expect(getErrorCodes(result)).toEqual(['CONFLICT'])
		expect(getErrors(result)[0].requiredBy).toEqual(
			expect.arrayContaining(['hmrc-frontend', '@ministryofjustice/frontend'])
		)
	})

	it('plans an explicit downgrade of the requested package', () => {
		const result = planFixture({
			operation: 'update',
			version: '5.0.0',
			installed: [installedPlugin('hmrc-frontend', '6.0.0')],
			configs: { 'hmrc-frontend@5.0.0': [] }
		})

		expect(result.ok).toBe(true)
		expect(getChange(result, 'hmrc-frontend')).toMatchObject({
			action: 'downgrade',
			version: '5.0.0',
			installedVersion: '6.0.0',
			reason: 'requested'
		})
	})

	it('uses the config for the exact target version', () => {
		const result = planFixture({
			packages: { 'govuk-frontend': ['5.11.2'] },
			configs: {
				[defaultTarget]: ['govuk-frontend'],
				'hmrc-frontend@7.0.0': ['@govuk-prototype-kit/common-templates'],
				'govuk-frontend@5.11.2': []
			}
		})

		expect(getChange(result, 'govuk-frontend')).toBeDefined()
		expect(getChange(result, '@govuk-prototype-kit/common-templates')).toBeUndefined()
	})

	it('resolves multiple levels of plugin dependencies in one plan', () => {
		const result = planFixture({
			packages: {
				'@govuk-prototype-kit/step-by-step': ['2.0.0'],
				'@govuk-prototype-kit/common-templates': ['1.0.0']
			},
			configs: {
				[defaultTarget]: ['@govuk-prototype-kit/step-by-step'],
				'@govuk-prototype-kit/step-by-step@2.0.0': [
					{ packageName: '@govuk-prototype-kit/common-templates', minVersion: '1.0.0' }
				],
				'@govuk-prototype-kit/common-templates@1.0.0': []
			}
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual([
			'@govuk-prototype-kit/common-templates',
			'@govuk-prototype-kit/step-by-step',
			'hmrc-frontend'
		])
		expect(getChange(result, '@govuk-prototype-kit/common-templates').requiredBy).toEqual([
			'@govuk-prototype-kit/step-by-step'
		])
	})

	it('resolves a deep dependency chain without hitting a pass limit', () => {
		const depth = 12
		const chainPackages = Array.from({ length: depth + 1 }, (_, index) => `chain-${index}`)
		const packages = {}
		const configs = {}

		for (const [index, packageName] of chainPackages.entries()) {
			packages[packageName] = ['1.0.0']
			configs[`${packageName}@1.0.0`] = index < depth ? [chainPackages[index + 1]] : []
		}

		const result = planFixture({
			packageName: 'chain-0',
			version: '1.0.0',
			knownPackages: chainPackages,
			packages,
			configs
		})

		expect(result.ok).toBe(true)
		expect(result.changes).toHaveLength(depth + 1)
		expect(getChange(result, `chain-${depth}`)).toMatchObject({ action: 'install', reason: 'dependency' })
	})

	it('deduplicates a dependency required by more than one package', () => {
		const result = planFixture({
			packages: {
				'@govuk-prototype-kit/step-by-step': ['2.0.0'],
				'@govuk-prototype-kit/common-templates': ['1.0.0']
			},
			configs: {
				[defaultTarget]: ['@govuk-prototype-kit/step-by-step', '@govuk-prototype-kit/common-templates'],
				'@govuk-prototype-kit/step-by-step@2.0.0': ['@govuk-prototype-kit/common-templates'],
				'@govuk-prototype-kit/common-templates@1.0.0': []
			}
		})

		expect(result.ok).toBe(true)
		expect(
			result.changes.filter((change) => change.packageName === '@govuk-prototype-kit/common-templates')
		).toHaveLength(1)
		expect(getChange(result, '@govuk-prototype-kit/common-templates').requiredBy).toEqual([
			'hmrc-frontend',
			'@govuk-prototype-kit/step-by-step'
		])
	})

	it('handles dependency cycles without recursing forever', () => {
		const result = planFixture({
			installed: [installedPlugin('hmrc-frontend', '6.0.0')],
			packages: { '@govuk-prototype-kit/step-by-step': ['2.0.0'] },
			configs: {
				[defaultTarget]: ['@govuk-prototype-kit/step-by-step'],
				'@govuk-prototype-kit/step-by-step@2.0.0': [{ packageName: 'hmrc-frontend', minVersion: '6.0.0' }]
			}
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['@govuk-prototype-kit/step-by-step'])
	})

	it('reports a conflict against constraints from another installed plugin', () => {
		const result = planFixture({
			installed: [
				installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', [
					{ packageName: 'govuk-frontend', minVersion: '6.0.0' }
				])
			],
			packages: { 'govuk-frontend': ['5.11.2', '6.0.0'] },
			configs: {
				[defaultTarget]: [{ packageName: 'govuk-frontend', maxVersion: '5.11.2' }],
				'govuk-frontend@5.11.2': [],
				'govuk-frontend@6.0.0': []
			}
		})

		expect(result.ok).toBe(false)
		expect(result.changes).toEqual([])
		expect(getErrorCodes(result)).toContain('CONFLICT')
		expect(getErrors(result)[0].packageName).toBe('govuk-frontend')
		expect(getErrors(result)[0].requiredBy).toEqual(['@govuk-prototype-kit/step-by-step', 'hmrc-frontend'])
	})

	it('ignores prerelease versions when choosing a dependency version', () => {
		const result = planFixture({
			packages: { 'govuk-frontend': ['5.11.2', '6.0.0-beta.1'] },
			configs: { [defaultTarget]: [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }] }
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['CONFLICT'])
	})

	it('ignores a prerelease latest version when metadata has no stable versions', () => {
		const result = planFixture({
			packages: { 'govuk-frontend': { latestVersion: '6.0.0-beta.1' } },
			configs: { [defaultTarget]: ['govuk-frontend'] }
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['CONFLICT'])
	})

	it('reports an unknown required plugin instead of planning to install it', () => {
		const result = planFixture({ configs: { [defaultTarget]: ['unknown-plugin'] } })

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['UNKNOWN_PACKAGE'])
		expect(getErrors(result)[0].packageName).toBe('unknown-plugin')
	})

	it('uses constraints from installed unknown and read-only plugins', () => {
		const result = planFixture({
			installed: [
				installedPlugin('local-plugin', '1.0.0', [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }]),
				installedPlugin('govuk-frontend', '5.11.2')
			],
			readOnlyPackages: ['local-plugin'],
			packages: { 'govuk-frontend': ['5.11.2', '6.0.0'] },
			configs: {
				[defaultTarget]: ['govuk-frontend'],
				'govuk-frontend@6.0.0': []
			}
		})

		expect(result.ok).toBe(true)
		expect(getChange(result, 'govuk-frontend')).toMatchObject({
			action: 'update',
			version: '6.0.0',
			requiredBy: ['local-plugin', 'hmrc-frontend']
		})
	})

	it('does not install or update unrelated dependencies declared by other installed plugins', () => {
		const result = planFixture({
			packageName: '@govuk-prototype-kit/common-templates',
			version: '1.0.0',
			installed: [
				installedPlugin('local-plugin', '1.0.0', [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }]),
				installedPlugin('govuk-frontend', '5.11.2')
			],
			readOnlyPackages: ['local-plugin'],
			configs: { '@govuk-prototype-kit/common-templates@1.0.0': [] }
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['@govuk-prototype-kit/common-templates'])
	})

	it('blocks an update to a required read-only package', () => {
		const result = planFixture({
			packageName: '@govuk-prototype-kit/common-templates',
			version: '1.0.0',
			installed: [installedPlugin('hmrc-frontend', '5.0.0')],
			readOnlyPackages: ['hmrc-frontend'],
			configs: {
				'@govuk-prototype-kit/common-templates@1.0.0': [{ packageName: 'hmrc-frontend', minVersion: '6.0.0' }]
			}
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toContain('READ_ONLY_PACKAGE')
		expect(getChange(result, 'hmrc-frontend')).toBeUndefined()
	})

	it('blocks a change when an installed plugin dependency config cannot be read', () => {
		const result = planFixture({
			installed: [installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', [], { dependenciesKnown: false })]
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toContain('UNKNOWN_DEPENDENCIES')
	})

	it('reports invalid dependency declarations as blocking errors', () => {
		const result = planFixture({
			installed: [installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', [{ packageName: 123 }])]
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toContain('INVALID_PLUGIN_DEPENDENCY')
	})

	it('asks the caller for missing registry data and plans once it is supplied', () => {
		const missingMetadata = planFixture({ configs: { [defaultTarget]: ['govuk-frontend'] } })

		expect(missingMetadata.ok).toBe(false)
		expect(getMissing(missingMetadata)).toEqual([{ type: 'missing', data: 'metadata', packageName: 'govuk-frontend' }])

		const missingConfig = planFixture({
			packages: { 'govuk-frontend': ['5.11.2'] },
			configs: { [defaultTarget]: ['govuk-frontend'] }
		})

		expect(missingConfig.ok).toBe(false)
		expect(getMissing(missingConfig)).toEqual([
			{ type: 'missing', data: 'config', packageName: 'govuk-frontend', version: '5.11.2' }
		])

		const complete = planFixture({
			packages: { 'govuk-frontend': ['5.11.2'] },
			configs: {
				[defaultTarget]: ['govuk-frontend'],
				'govuk-frontend@5.11.2': []
			}
		})

		expect(complete.ok).toBe(true)
		expect(getChange(complete, 'govuk-frontend').version).toBe('5.11.2')
	})

	it('asks the caller for the target version config', () => {
		const result = planPluginChanges(createInput({ registry: registry() }))

		expect(result.ok).toBe(false)
		expect(getMissing(result)).toEqual([
			{ type: 'missing', data: 'config', packageName: 'hmrc-frontend', version: '6.0.0' }
		])
	})

	it('returns an explicit no-op when the requested state already holds', () => {
		const result = planFixture({
			installed: [
				installedPlugin('hmrc-frontend', '6.0.0', ['govuk-frontend']),
				installedPlugin('govuk-frontend', '5.11.2')
			],
			configs: { [defaultTarget]: ['govuk-frontend'] }
		})

		expect(result.ok).toBe(true)
		expect(result.noop).toBe(true)
		expect(result.changes).toEqual([])
	})

	it('blocks a read-only target and an unknown target', () => {
		const readOnly = planFixture({ readOnlyPackages: ['hmrc-frontend'] })

		expect(readOnly.ok).toBe(false)
		expect(getErrorCodes(readOnly)).toEqual(['READ_ONLY_PACKAGE'])

		const unknown = planFixture({ packageName: 'unknown-plugin', version: '1.0.0' })

		expect(unknown.ok).toBe(false)
		expect(getErrorCodes(unknown)).toEqual(['UNKNOWN_PACKAGE'])
	})

	it('rejects invalid requests without throwing', () => {
		const result = planFixture({ operation: 'remove', version: 'latest' })

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['INVALID_REQUEST', 'INVALID_REQUEST'])

		const prerelease = planFixture({ version: '6.0.0-beta.1' })

		expect(prerelease.ok).toBe(false)
		expect(getErrorCodes(prerelease)).toEqual(['INVALID_REQUEST'])
	})

	it('rejects input without the data the planner needs', () => {
		const result = planPluginChanges({
			operation: 'install',
			packageName: 'hmrc-frontend',
			version: '6.0.0'
		})

		expect(result.ok).toBe(false)
		expect(result.changes).toEqual([])
		expect(getErrorCodes(result)).toEqual([
			'INVALID_REQUEST',
			'INVALID_REQUEST',
			'INVALID_REQUEST',
			'INVALID_REQUEST',
			'INVALID_REQUEST'
		])
	})

	it('rejects malformed planner data instead of throwing', () => {
		const result = planPluginChanges(
			createInput({
				installed: [null],
				registry: { packages: [], configs: {} }
			})
		)

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['INVALID_REQUEST', 'INVALID_REQUEST'])
	})

	it('does not mutate its input data', () => {
		const input = deepFreeze(
			createInput({
				installed: [installedPlugin('govuk-frontend', '5.11.2')],
				registry: registry({
					packages: { 'govuk-frontend': ['5.11.2', '6.0.0'] },
					configs: {
						[defaultTarget]: [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }],
						'govuk-frontend@6.0.0': []
					}
				})
			})
		)
		const before = JSON.stringify(input)

		const result = planPluginChanges(input)

		expect(result.ok).toBe(true)
		expect(JSON.stringify(input)).toBe(before)
	})

	it('returns the same plan for the same input', () => {
		const input = createInput({
			registry: registry({
				packages: { 'govuk-frontend': ['5.10.0', '5.11.2'] },
				configs: {
					[defaultTarget]: ['govuk-frontend'],
					'govuk-frontend@5.11.2': []
				}
			})
		})

		expect(planPluginChanges(input)).toEqual(planPluginChanges(input))
	})
})

describe('uninstall planning', () => {
	it('removes installed dependents recursively and leaves unrelated packages alone', () => {
		const result = planFixture({
			operation: 'uninstall',
			packageName: '@govuk-prototype-kit/common-templates',
			installed: [
				installedPlugin('hmrc-frontend', '6.0.0', ['@govuk-prototype-kit/step-by-step', 'govuk-frontend']),
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

	it('records all removed dependencies on a dependent regardless of installed order', () => {
		const commonTemplates = installedPlugin('@govuk-prototype-kit/common-templates', '1.0.0')
		const stepByStep = installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', [
			'@govuk-prototype-kit/common-templates'
		])
		const hmrcFrontend = installedPlugin('hmrc-frontend', '6.0.0', [
			'@govuk-prototype-kit/step-by-step',
			'@govuk-prototype-kit/common-templates'
		])

		const uninstall = (installed) =>
			planFixture({
				operation: 'uninstall',
				packageName: '@govuk-prototype-kit/common-templates',
				installed
			})

		const firstOrder = uninstall([commonTemplates, stepByStep, hmrcFrontend])
		const secondOrder = uninstall([commonTemplates, hmrcFrontend, stepByStep])

		expect(firstOrder).toEqual(secondOrder)
		expect(getChange(firstOrder, 'hmrc-frontend').requiredBy).toEqual([
			'@govuk-prototype-kit/step-by-step',
			'@govuk-prototype-kit/common-templates'
		])
	})

	it('does not remove newly unused dependencies of a removed package', () => {
		const result = planFixture({
			operation: 'uninstall',
			installed: [
				installedPlugin('hmrc-frontend', '6.0.0', ['govuk-frontend']),
				installedPlugin('govuk-frontend', '5.11.2')
			]
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})

	it('blocks removal of a protected package', () => {
		const result = planFixture({
			operation: 'uninstall',
			packageName: 'govuk-frontend',
			installed: [installedPlugin('govuk-frontend', '5.11.2')]
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['PROTECTED_PACKAGE'])
	})

	it('blocks removal when a dependent is protected', () => {
		const result = planFixture({
			operation: 'uninstall',
			installed: [
				installedPlugin('hmrc-frontend', '6.0.0'),
				installedPlugin('govuk-frontend', '5.11.2', ['hmrc-frontend'])
			]
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['PROTECTED_PACKAGE'])
		expect(getErrors(result)[0].packageName).toBe('govuk-frontend')
	})

	it('blocks removal when a dependent is outside the known list', () => {
		const result = planFixture({
			operation: 'uninstall',
			installed: [
				installedPlugin('hmrc-frontend', '6.0.0'),
				installedPlugin('unknown-plugin', '1.0.0', ['hmrc-frontend'])
			]
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['UNKNOWN_PACKAGE'])
		expect(getErrors(result)[0].packageName).toBe('unknown-plugin')
	})

	it('blocks removal of a read-only package', () => {
		const result = planFixture({
			operation: 'uninstall',
			readOnlyPackages: ['hmrc-frontend'],
			installed: [installedPlugin('hmrc-frontend', '6.0.0')]
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['READ_ONLY_PACKAGE'])
	})

	it('blocks removal when an unrelated installed plugin dependency config cannot be read', () => {
		const result = planFixture({
			operation: 'uninstall',
			installed: [
				installedPlugin('hmrc-frontend', '6.0.0'),
				installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', [], { dependenciesKnown: false })
			]
		})

		expect(result.ok).toBe(false)
		expect(getErrorCodes(result)).toEqual(['UNKNOWN_DEPENDENCIES'])
	})

	it('still allows removal when the package being removed has unreadable dependency metadata', () => {
		const result = planFixture({
			operation: 'uninstall',
			installed: [installedPlugin('hmrc-frontend', '6.0.0', [], { dependenciesKnown: false })]
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})

	it('returns an explicit no-op when the package is not installed', () => {
		const result = planFixture({
			operation: 'uninstall',
			installed: [installedPlugin('govuk-frontend', '5.11.2')]
		})

		expect(result.ok).toBe(true)
		expect(result.noop).toBe(true)
		expect(result.changes).toEqual([])
	})

	it('plans an uninstall without registry data', () => {
		const result = planPluginChanges({
			operation: 'uninstall',
			packageName: 'hmrc-frontend',
			installed: [installedPlugin('hmrc-frontend', '6.0.0')],
			knownPackages,
			readOnlyPackages: [],
			protectedPackages
		})

		expect(result.ok).toBe(true)
		expect(result.changes.map((change) => change.packageName)).toEqual(['hmrc-frontend'])
	})

	it('returns the same plan for the same input', () => {
		const input = createInput({
			operation: 'uninstall',
			installed: [
				installedPlugin('hmrc-frontend', '6.0.0'),
				installedPlugin('@govuk-prototype-kit/step-by-step', '2.0.0', ['hmrc-frontend'])
			]
		})

		expect(planPluginChanges(input)).toEqual(planPluginChanges(input))
	})
})
