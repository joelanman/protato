/**
 * Scenarios that use a fake registry (see fake-registry.js), so they can set up
 * situations the real registry cannot be asked for, such as a new
 * govuk-frontend major release that most plugins do not support yet.
 *
 * The packages are made up, but they copy the ways real plugins declare what
 * they need: hmrc-frontend only says "6.5.0 or later" in pluginDependencies,
 * and the MoJ and DWP plugins also set a peerDependencies range.
 *
 * The fields are the same as in scenarios.js, plus:
 * - registry: the fixtures for the fake registry
 * - expect.blocked: the plan is returned but not ok, with a problem matching this pattern
 */

const govukFrontend = (version) => ({ packageName: 'govuk-frontend', minVersion: version })

// govuk-frontend 7.0.0 has just been released and only @example/new supports it
const registry = {
	'govuk-frontend': { versions: { '6.5.0': {}, '6.6.0': {}, '7.0.0': {} } },
	// only a minimum, like hmrc-frontend
	'@example/min-only': {
		versions: { '1.0.0': { pluginDependencies: [govukFrontend('6.5.0')] } }
	},
	// a minimum and an npm peer range, like the MoJ plugin
	'@example/peer-6': {
		versions: {
			'1.0.0': { pluginDependencies: [govukFrontend('6.0.0')], peerDependencies: { 'govuk-frontend': '^6.0.0' } }
		}
	},
	// a plugin that declares an upper limit, which no real plugin does today
	'@example/max-6': {
		versions: { '1.0.0': { pluginDependencies: [{ ...govukFrontend('6.0.0'), maxVersion: '6.99.0' }] } }
	},
	// a plugin that has already moved to govuk-frontend 7
	'@example/new': {
		versions: {
			'1.0.0': { pluginDependencies: [govukFrontend('7.0.0')], peerDependencies: { 'govuk-frontend': '^7.0.0' } }
		}
	}
}

export default [
	{
		name: 'govuk-frontend 7: updating with a plugin that only declares a minimum is planned and applied',
		registry,
		start: ['govuk-frontend@6.6.0', '@example/min-only@1.0.0'],
		action: 'update',
		pkg: 'govuk-frontend',
		expect: { changes: ['update govuk-frontend'], deps: { 'govuk-frontend': '7.0.0' } },
		run: true
	},
	{
		name: 'govuk-frontend 7: updating with a plugin that has a peer range is blocked by the planner',
		registry,
		start: ['govuk-frontend@6.6.0', '@example/peer-6@1.0.0'],
		action: 'update',
		pkg: 'govuk-frontend',
		expect: { blocked: /does not satisfy requirements from @example\/peer-6/ }
	},
	{
		name: 'govuk-frontend 7: updating with a plugin that declares a maxVersion is blocked by the planner',
		registry,
		start: ['govuk-frontend@6.6.0', '@example/max-6@1.0.0'],
		action: 'update',
		pkg: 'govuk-frontend',
		expect: { blocked: /does not satisfy requirements from @example\/max-6/ }
	},
	{
		name: 'govuk-frontend 7: installing a plugin that needs it bumps govuk-frontend',
		registry,
		start: ['govuk-frontend@6.6.0'],
		action: 'install',
		pkg: '@example/new',
		expect: {
			changes: ['install @example/new', 'update govuk-frontend'],
			deps: { 'govuk-frontend': '7.0.0', '@example/new': '1.0.0' }
		},
		run: true
	},
	{
		name: 'govuk-frontend 7: installing a plugin that needs it, with a peer-6 plugin installed, is blocked by the planner',
		registry,
		start: ['govuk-frontend@6.6.0', '@example/peer-6@1.0.0'],
		action: 'install',
		pkg: '@example/new',
		expect: { blocked: /No stable version of govuk-frontend satisfies requirements/ }
	},
	{
		name: 'govuk-frontend 7: installing a peer-6 plugin when govuk-frontend 7 is installed plans a downgrade to 6.6.0',
		registry,
		start: ['govuk-frontend@7.0.0'],
		action: 'install',
		pkg: '@example/peer-6',
		expect: {
			changes: ['install @example/peer-6', 'downgrade govuk-frontend'],
			deps: { 'govuk-frontend': '6.6.0', '@example/peer-6': '1.0.0' }
		},
		run: true
	}
]
