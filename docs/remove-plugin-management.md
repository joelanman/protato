# Removing plugin management

A plan for removing the plugin management UI, planner, npm runner, registry
client and CLI package watcher from Protato, while keeping runtime plugin
loading and proxy plugin configs working.

## Goal and scope

### Remove

- **Manage Prototype plugin management UI and routes**: installing, updating and
  uninstalling plugins from `/manage-prototype/plugins` and
  `/manage-prototype/plugins/confirm`.
- **Plugin planner, list and npm runner**: `lib/manage-plugins/*`.
- **npm registry client**: `lib/npm-registry.js` and `lib/npm-registry.test.js`.
- **Known plugins catalogue**: `known-plugins.json`.
- **Dev server plugin update / refresh orchestration**: `updatePlugins()`,
  `refreshPlugins()`, `rebuildAndRestart()`, `updatingPlugins` flag and the 503
  in-progress middleware in `lib/dev-server.js`.
- **Package file watcher**: `watchPackages()`, `syncPackageState()`,
  `setBuildResult()` and `updatingPlugins` guards in `lib/watch.js`. Users will
  restart the dev server after changing packages.
- **Scenario test suite and plugin-management test helpers**:
  `tests/scenarios/*`, `tests/helpers/plugin-registry-mock.js`,
  `tests/helpers/project-paths.js`, and `knownPluginsProject` in
  `tests/helpers/plugin-project.js`.
- **Dependencies only used by plugin management**: `cross-spawn`, `semver` and
  `tar-stream` in `package.json`.

### Keep

- **Runtime plugin loading** in `lib/plugins.js` (`getAssetPaths`,
  `getSassPaths`, `getScriptPaths`, `getStylesheetPaths`, `getMacros`,
  `getBaseLayoutPaths`, `getViewPaths`, `getFilterPaths`, `getFunctionPaths`,
  `getTemplatesByPlugin`, `getTemplate`, `getTemplateFilePath`, `clearCache`,
  `formatPackageName`, `CONFIG_FILE`).
- **Proxy plugin configs** in `lib/plugins.js` (`jquery` built-in config and
  `app/plugin-proxy.json`), so non-plugin npm packages can still supply scripts
  and assets at runtime.
- **Placeholder `/manage-prototype/plugins` page** in development ("Plugins
  management is not yet available."), so the existing links in
  `manage-prototype/views/layout.njk` and `manage-prototype/views/home.njk`
  continue to resolve cleanly.

---

## Step 1: Delete plugin management files

Delete these 19 files:

- `known-plugins.json`
- `lib/npm-registry.js`
- `lib/npm-registry.test.js`
- `lib/manage-plugins/list.js`
- `lib/manage-plugins/list.test.js`
- `lib/manage-plugins/make-plan.js`
- `lib/manage-plugins/make-plan.test.js`
- `lib/manage-plugins/run-plan.js`
- `lib/manage-plugins/run-plan.test.js`
- `lib/manage-plugins/run-plan-real.test.js`
- `manage-prototype/routes/plugins.js`
- `manage-prototype/routes/plugins.test.js`
- `manage-prototype/views/plugin-confirm.njk`
- `tests/helpers/plugin-registry-mock.js`
- `tests/helpers/project-paths.js`
- `tests/scenarios/fake-registry.js`
- `tests/scenarios/fixture-scenarios.js`
- `tests/scenarios/run.js`
- `tests/scenarios/scenarios.js`

Remove the empty `lib/manage-plugins/` and `tests/scenarios/` directories once
their files are deleted.

---

## Step 2: Revert the `/manage-prototype/plugins` page to a placeholder

### `manage-prototype/views/plugins.njk`

Replace the management view with the simple placeholder template:

```njk
{% extends "layout.njk" %}

{% block content %}

  <div class="govuk-grid-row">
    <div class="govuk-grid-column-two-thirds">
      <h1 class="govuk-heading-l">Plugins</h1>

      <p class="govuk-body">
        Plugins management is not yet available.
      </p>

      <p class="govuk-body">
        <a href="/manage-prototype">Back to Manage your prototype</a>
      </p>
    </div>
  </div>

{% endblock %}
```

### `manage-prototype/dev-app.js`

- Remove `import pluginRoutes from './routes/plugins.js'`.
- Replace `app.use('/plugins', pluginRoutes)` with:

```js
app.get('/plugins', (request, response) => {
	response.render('plugins', { pageName: 'Plugins' })
})
```

### `manage-prototype/dev-app.test.js`

- In `vi.mock('../lib/plugins.js', ...)`, remove the top-level `...actual`
  spread:

```js
vi.mock('../lib/plugins.js', async (importOriginal) => {
	const actual = await importOriginal()

	return {
		default: {
			...actual.default,
			getTemplatesByPlugin: vi.fn(() => templatesByPlugin),
			getTemplate: vi.fn((requestedPackageName, requestedPath) =>
				requestedPackageName === packageName && requestedPath === template.path ? template : undefined
			),
			getTemplateFilePath: vi.fn((requestedPackageName, requestedPath) =>
				requestedPackageName === packageName && requestedPath === template.path ? templateFilePath : undefined
			)
		}
	}
})
```

- Update the `GET /plugins` test:

```js
describe('GET /plugins', () => {
	it('renders the plugins placeholder page', async () => {
		const response = await request(app).get('/manage-prototype/plugins')

		expect(response.status).toBe(200)
		const { view, model } = readRender(response)
		expect(view).toBe('plugins')
		expect(model).toEqual({ pageName: 'Plugins' })
	})
})
```

---

## Step 3: Simplify `lib/dev-server.js` and `lib/dev-server.test.js`

### `lib/dev-server.js`

Remove all plugin-update and package-refresh state and methods:

- Remove unused imports:
  - `import { buildPrototype } from './build.js'`
  - `import livereload from './livereload.js'`
  - `import { runPluginPlan } from './manage-plugins/run-plan.js'`
  - `import plugins from './plugins.js'`
  - `setBuildResult` and `syncPackageState` from `'./watch.js'` (keep `watch`).
- Remove `updatingPlugins: false` property from `devServer`.
- Remove the 503 middleware in `start()` that checks `this.updatingPlugins`.
- In `restartPrototype(buildResult)`, remove the two `if (this.updatingPlugins)`
  early returns so it simply runs:

```js
async restartPrototype(buildResult) {
	console.log('dev server - Restarting server...')
	await this.stopPrototype()
	await this.startPrototype(buildResult)
}
```

- Remove `updatePlugins(plan)`, `refreshPlugins()` and `rebuildAndRestart()`.

### `lib/dev-server.test.js`

- Remove `vi.mock(...)` and `import` statements for:
  - `./build.js`
  - `./livereload.js`
  - `./manage-plugins/run-plan.js`
  - `./plugins.js`
- Update `vi.mock('./watch.js', ...)` and its import to only mock and import
  `watch` (removing `setBuildResult` and `syncPackageState`).
- Remove `devServer.updatingPlugins = false` in `beforeEach`.
- Remove the test `'returns 503 for prototype requests while plugins are updating'`.
- Remove the two `updatingPlugins` tests from `describe('restartPrototype')`.
- Remove `describe('updatePlugins')` and `describe('refreshPlugins')`.

---

## Step 4: Simplify `lib/watch.js` and `lib/watch.test.js`

### `lib/watch.js`

Remove package watching and `updatingPlugins` checks:

- Remove unused imports:
  - `import path from 'node:path'`
  - `import { isObject, readJsonObject } from './utils/json.js'`
- Remove `PACKAGE_FILES`, `PACKAGE_DEBOUNCE_MS`, `packageState`, `packageTimer`,
  `setBuildResult`, `sortObjectKeys`, `readProjectPackageState`,
  `isPackageFile`, `schedulePackageRefresh`, `refreshAfterPackageChange`,
  `syncPackageState` and `watchPackages`.
- Remove all `if (devServer.updatingPlugins) { return }` guards from
  `watchBackend`, `watchFrontend` and `watchSass`.
- Remove `watchPackages()` from `watch()`.
- Export only `{ getBackendIgnored, watch }`.

### `lib/watch.test.js`

- Remove unused imports (`EventEmitter`, `fs`, `chokidar`, `afterEach`,
  `beforeEach`, `createPluginProject`, `processSass`, `devServer`, `livereload`,
  `getPaths`, `setBuildResult`, `syncPackageState`, `watch`).
- Remove `vi.mock('./paths.js', ...)`.
- Simplify `vi.mock('./dev-server.js', ...)` to:

```js
vi.mock('./dev-server.js', () => ({
	default: { restartPrototype: vi.fn() }
}))
```

- Keep `describe('getBackendIgnored', ...)` and remove `describe('watch', ...)`.

---

## Step 5: Simplify `lib/plugins.js` and `lib/plugins.test.js`

`lib/plugins.js` was split into intermediate functions (`readProjectPlugins`,
`readInstalledPackage`, `readProjectDependencies`, diagnostics arrays,
`configSource`, `pluginDependencies`, `hasPluginConfig`) so the plugin
management UI and planner could inspect uninstalled or broken declarations.

With plugin management removed, `lib/plugins.js` only needs to load installed
plugins and proxy plugin configs for the runtime.

### `lib/plugins.js`

1. **Built-in proxy configs**:
   - In `BUILT_IN_CONFIGS`, keep `jquery: { scripts: ['/dist/jquery.js'], assets: ['/dist'] }`.
   - Remove the `meta` blocks and `'notifications-node-client'` (which only had
     a `meta.description` for the management UI).
2. **Simplify plugin loading**:
   - Remove `readProjectDependencies`, `readInstalledPackage`, and
     `readProjectPlugins`.
   - Keep `readUserProxyConfig`, `readProxyConfigs` and `readPluginConfig` (simplified
     to not track `configSource`):

```js
function readPluginConfig(packageDir, packageName, proxyConfigs) {
	if (!fs.existsSync(packageDir)) {
		return
	}

	const configPath = path.join(packageDir, CONFIG_FILE)

	if (!fs.existsSync(configPath)) {
		const proxyConfig = proxyConfigs[packageName]

		if (!proxyConfig) {
			return
		}

		try {
			return normaliseConfig(proxyConfig)
		} catch (error) {
			console.warn(`Could not read proxy config for ${packageName}: ${error.message}`)
			return
		}
	}

	try {
		return normaliseConfig(readJsonObject(configPath))
	} catch (error) {
		console.warn(`Could not read ${CONFIG_FILE} for ${packageName}: ${error.message}`)
	}
}
```

   - In `getPlugins()`, read `package.json` directly, order dependencies with
     `getPluginOrder(dependencies)`, read each plugin's config with
     `readPluginConfig(packageDir, packageName, proxyConfigs)`, and if a config
     is present, read its `package.json`:

```js
function getPlugins() {
	paths = getPaths()

	if (Array.isArray(plugins)) {
		return plugins
	}

	plugins = []

	let dependencies

	try {
		const projectPackage = readJsonObject(path.join(paths.project, 'package.json'))
		dependencies = isObject(projectPackage.dependencies) ? projectPackage.dependencies : {}
	} catch (error) {
		console.warn(`Protato: Could not read project package.json: ${error.message}`)
		return plugins
	}

	const proxyConfigs = readProxyConfigs()

	for (const packageName of getPluginOrder(dependencies)) {
		const packageDir = path.join(paths.project, 'node_modules', packageName)
		const config = readPluginConfig(packageDir, packageName, proxyConfigs)

		if (!config) {
			continue
		}

		try {
			const pkg = readJsonObject(path.join(packageDir, 'package.json'))
			plugins.push({ config, pkg })
		} catch (error) {
			console.warn(`Could not read package.json for ${packageName}: ${error.message}`)
		}
	}

	return plugins
}
```

   - Export only `{ CONFIG_FILE, formatPackageName, readProxyConfigs }` as named
     exports alongside the existing default export.

### `lib/plugins.test.js`

- Remove `readInstalledPackage` and `readProjectDependencies` from the imports
  at the top of `lib/plugins.test.js`.
- Remove `describe('readProjectDependencies', ...)` and
  `describe('readInstalledPackage', ...)`.
- In `describe('readProxyConfigs', ...)`, remove assertions on `jquery.meta` and
  `configs['notifications-node-client']`.

---

## Step 6: Clean up tests, helpers, dependencies and docs

### `tests/helpers/plugin-project.js`

- Remove `export const knownPluginsProject = { ... }` at the bottom of the file.
- Keep `createPluginProject` (used by `lib/plugins.test.js` and
  `lib/plugin-assets.test.js`).

### `tests/server.test.js`

- Remove `copyStarterWithWritableNodeModules` (only used by the command-line
  plugin refresh test).
- Remove `describe('Server (plugin refresh from command line)', ...)` and
  `waitForResponse` (only used by that describe block).

### `package.json`

- Remove `"test:scenarios": "node tests/scenarios/run.js"` from `scripts`.
- Remove unused dependencies from `dependencies`:
  - `"cross-spawn"`
  - `"semver"`
  - `"tar-stream"`
- Run `npm install` (or `npm uninstall cross-spawn semver tar-stream`) so
  `package-lock.json` is updated cleanly.

### `readme.md`

- Remove the paragraph under `## Plugins` that documents
  `/manage-prototype/plugins` and `known-plugins.json`:

```markdown
In development, plugins can be installed, updated and uninstalled from
`/manage-prototype/plugins`. `known-plugins.json` lists the packages Protato
suggests and shows even when they are not installed; any installed package with
a `govuk-prototype-kit.config.json` can also be updated or uninstalled.
```

- Under `### Proxy plugin configs`, update `Protato supplies configs for jquery and notifications-node-client.` to `Protato supplies a config for jquery.`.

### `docs/optional-govuk-frontend.md` and `todo.md`

- In `todo.md`, remove `, known-plugins.json` from line 22.
- In `docs/optional-govuk-frontend.md`, remove the `## Manage Prototype plugin list`
  section (lines 347–379) and the two bullets in `### Phase 5: starters, tests and docs`
  that mention `known-plugins.json` and the manage UI.

---

## Step 7: Verification

Run the test suite and linter to verify everything passes cleanly:

1. `npm run test:unit`
2. `npm run test:end`
3. `npm run lint`
4. Check `git status` to ensure no untracked files or empty directories
   (`lib/manage-plugins`, `tests/scenarios`) remain.
