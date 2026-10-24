/**
 * Scenarios for tests/scenarios/run.js.
 *
 * Each scenario builds a temp project with real npm installs, plans an action
 * against the real npm registry and, when `run` is true, runs the plan with
 * real npm. Versions below are the real ones at the time of writing, so a
 * scenario may need updating when a plugin publishes a new major version.
 *
 * - start: npm specs installed into the project first
 * - exact: false saves the starting specs as ^ ranges, as a hand-edited project would
 * - setup(dir): create extra files before the starting specs are installed
 * - action, pkg: passed to makePluginPlan
 * - plan: a hand-written plan to give to runPluginPlan, skipping makePluginPlan
 * - expect.changes: 'action package' strings, in any order
 * - expect.refused: the plan is refused with an error matching this pattern
 * - expect.runFails: running the plan fails and leaves package.json untouched
 * - expect.deps: entries that must be in package.json dependencies after the run
 * - run: run the plan and check a follow-up plan has nothing left to do
 */

import fs from 'node:fs'
import path from 'node:path'

function writeLocalPlugin(dir, name = 'local-plugin') {
	const pluginDir = path.join(dir, name)
	fs.mkdirSync(pluginDir, { recursive: true })
	fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
	fs.writeFileSync(path.join(pluginDir, 'govuk-prototype-kit.config.json'), '{}')
}

export default [
	{
		name: 'install step-by-step on an empty project pulls in govuk-frontend',
		start: [],
		action: 'install',
		pkg: '@govuk-prototype-kit/step-by-step',
		expect: {
			changes: ['install @govuk-prototype-kit/step-by-step', 'install govuk-frontend'],
			deps: { 'govuk-frontend': '6.6.0' }
		},
		run: true
	},
	{
		name: 'update hmrc-frontend with govuk-frontend 6.6.0 changes only hmrc',
		start: ['hmrc-frontend@7.41.0', 'govuk-frontend@6.6.0'],
		action: 'update',
		pkg: 'hmrc-frontend',
		expect: { changes: ['update hmrc-frontend'], deps: { 'hmrc-frontend': '7.43.0' } },
		run: true
	},
	{
		name: 'update hmrc-frontend on govuk-frontend 5.11.2 forces a govuk-frontend major bump',
		start: ['hmrc-frontend@7.31.0', 'govuk-frontend@5.11.2'],
		action: 'update',
		pkg: 'hmrc-frontend',
		expect: {
			changes: ['update hmrc-frontend', 'update govuk-frontend'],
			deps: { 'hmrc-frontend': '7.43.0', 'govuk-frontend': '6.6.0' }
		},
		run: true
	},
	{
		name: 'install common-templates on govuk-frontend 5.11.2 forces a govuk-frontend bump',
		start: ['govuk-frontend@5.11.2'],
		action: 'install',
		pkg: '@govuk-prototype-kit/common-templates',
		expect: { changes: ['install @govuk-prototype-kit/common-templates', 'update govuk-frontend'] }
	},
	{
		name: 'install moj on govuk-frontend 6.6.0 changes only moj',
		start: ['govuk-frontend@6.6.0'],
		action: 'install',
		pkg: '@ministryofjustice/frontend',
		expect: { changes: ['install @ministryofjustice/frontend'] }
	},
	{
		name: 'install dwp-frontend, which has no plugin dependencies, changes only dwp',
		start: ['govuk-frontend@6.6.0'],
		action: 'install',
		pkg: '@dwp/dwp-frontend',
		expect: { changes: ['install @dwp/dwp-frontend'] }
	},
	{
		name: 'uninstall govuk-frontend is refused (protected)',
		start: ['govuk-frontend@6.6.0', 'hmrc-frontend@7.43.0'],
		action: 'uninstall',
		pkg: 'govuk-frontend',
		expect: { refused: /protected/ }
	},
	{
		name: 'uninstall hmrc-frontend leaves govuk-frontend',
		start: ['govuk-frontend@6.6.0', 'hmrc-frontend@7.43.0'],
		action: 'uninstall',
		pkg: 'hmrc-frontend',
		expect: { changes: ['uninstall hmrc-frontend'], deps: { 'govuk-frontend': '6.6.0' } },
		run: true
	},
	{
		name: 'install scottish templates pulls in @scottish-government/design-system',
		start: ['govuk-frontend@6.6.0'],
		action: 'install',
		pkg: '@scottish-government-design-system/prototype-templates',
		expect: {
			changes: [
				'install @scottish-government-design-system/prototype-templates',
				'install @scottish-government/design-system'
			],
			deps: { '@scottish-government/design-system': '4.3.0' }
		},
		run: true
	},
	{
		name: 'uninstall design-system also removes the templates plugin that needs it',
		start: ['@scottish-government-design-system/prototype-templates@0.7.0', '@scottish-government/design-system@4.3.0'],
		action: 'uninstall',
		pkg: '@scottish-government/design-system',
		expect: {
			changes: [
				'uninstall @scottish-government-design-system/prototype-templates',
				'uninstall @scottish-government/design-system'
			]
		},
		run: true
	},
	{
		name: 'install of an already-installed plugin is refused',
		start: ['govuk-frontend@6.6.0'],
		action: 'install',
		pkg: 'govuk-frontend',
		expect: { refused: /already installed/ }
	},
	{
		name: 'update of an up to date plugin is refused',
		start: ['govuk-frontend@6.6.0'],
		action: 'update',
		pkg: 'govuk-frontend',
		expect: { refused: /no newer/ }
	},
	{
		name: 'update of a plugin that is not installed is refused',
		start: [],
		action: 'update',
		pkg: 'hmrc-frontend',
		expect: { refused: /not installed/ }
	},
	{
		name: 'install of a package that does not exist is refused',
		start: [],
		action: 'install',
		pkg: 'protato-no-such-package-xyz',
		expect: { refused: /./ }
	},
	{
		name: 'caret ranges in package.json: update works and pins the exact version',
		start: ['hmrc-frontend@7.41.0', 'govuk-frontend@6.6.0'],
		exact: false,
		action: 'update',
		pkg: 'hmrc-frontend',
		expect: { changes: ['update hmrc-frontend'], deps: { 'hmrc-frontend': '7.43.0' } },
		run: true
	},
	{
		name: 'caret ranges in package.json: a dependency bump is also pinned exactly',
		start: ['hmrc-frontend@7.31.0', 'govuk-frontend@5.11.2'],
		exact: false,
		action: 'update',
		pkg: 'hmrc-frontend',
		expect: {
			changes: ['update hmrc-frontend', 'update govuk-frontend'],
			deps: { 'hmrc-frontend': '7.43.0', 'govuk-frontend': '6.6.0' }
		},
		run: true
	},
	{
		name: 'a local file: plugin cannot be updated',
		setup: (dir) => writeLocalPlugin(dir),
		start: ['file:./local-plugin'],
		action: 'update',
		pkg: 'local-plugin',
		expect: { refused: /read-only/ }
	},
	{
		name: 'a local file: plugin cannot be uninstalled',
		setup: (dir) => writeLocalPlugin(dir),
		start: ['file:./local-plugin'],
		action: 'uninstall',
		pkg: 'local-plugin',
		expect: { refused: /read-only/ }
	},
	// Plugins declare peerDependencies (e.g. on govuk-frontend). The planner
	// enforces these so plans do not violate npm requirements or create broken trees.
	{
		name: 'govuk-frontend update that violates an installed plugin peerDependency is blocked by the planner',
		start: ['govuk-frontend@5.11.2', '@ministryofjustice/frontend@8.0.0'],
		action: 'update',
		pkg: 'govuk-frontend',
		expect: { blocked: /does not satisfy requirements from @ministryofjustice\/frontend/ }
	},
	{
		name: 'installing a plugin whose peer govuk-frontend is newer than the installed one plans a govuk-frontend update',
		start: ['govuk-frontend@5.11.2'],
		action: 'install',
		pkg: '@ministryofjustice/frontend',
		expect: {
			changes: ['install @ministryofjustice/frontend', 'update govuk-frontend'],
			deps: { '@ministryofjustice/frontend': '11.1.0', 'govuk-frontend': '6.6.0' }
		},
		run: true
	},
	{
		name: 'a failing npm install leaves package.json untouched',
		start: ['govuk-frontend@6.6.0'],
		plan: {
			action: 'install',
			changes: [
				{ packageName: 'hmrc-frontend', version: '7.43.0' },
				{ packageName: 'hmrc-frontend-no-such-package-xyz', version: '1.0.0' }
			]
		},
		expect: { runFails: true }
	}
]
