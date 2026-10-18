# Plugins: plan

The plan for plugin support in Protato and the plugins management UI.

## How we work through this plan

1. **One task at a time.** Do a single task, run `npm test`, and **stop for Joe to review** before starting the next task.
2. **Detail one phase at a time.** Only the current phase is specified in detail below. Later phases are listed as high-level summaries and will be fleshed out and reviewed when we reach them.
3. **Ask, don't guess.** If a task hits a design question not covered by the decisions below, stop and ask.

---

## 1. Decisions

| # | Decision |
| --- | --- |
| D1 | **Compatibility means "existing plugins and prototypes work unchanged"**, not "behaves exactly like the kit". Where the kit's behaviour is surprising and nothing depends on it, Protato may differ (D5). |
| D2 | **Kit plugin manifests only** (`govuk-prototype-kit.config.json`). No Protato-specific manifest format. |
| D3 | **The UI installs, updates and uninstalls plugins from a known list.** No npm search, no installing arbitrary packages. |
| D4 | **The known list lives in Protato** and changes with Protato releases. |
| D5 | **The project always wins.** `app/views`, `app/filters.js` and `app/functions.js` override anything from a plugin. Between plugins, later in plugin order wins. |
| D6 | **Plugin order:** `protato`, then `govuk-frontend`, then other plugins sorted by package name. |
| D7 | **Plugin problems warn and carry on.** A broken or invalid manifest logs a warning naming the package and file, and that plugin (or that key) is skipped. The prototype still starts. |
| D8 | **Windows is a first-class platform.** Every task must work on Windows, and CI runs on Windows. |
| D9 | **Internal code first.** Add a dependency only if it is clearly worth it and well maintained. |
| D10 | **Incremental, not a rewrite.** Fix `lib/plugins.js` in place behind real tests. |
| D11 | **Plugin tests use real files**: temporary project directories, not mocked `node:fs`. |

## 2. Conventions

- **Paths (Windows):**
  - Use `path.join` only for filesystem paths passed to `fs`, `require`, `import()` or `express.static`.
  - Keep `/` for URLs (`/plugin-assets/<pkg>/<path>`), Nunjucks template names, and manifest comparisons.
  - For Sass `@import` strings, backslashes break CSS parsing: use `pathToFileURL(absolutePath).href` for absolute paths and `/` for plugin paths.
- **Code:** ESM, tabs and Biome (`npm run lint`). Match surrounding code. Warnings use `console.warn` starting with `Plugin <packageName>:`.
- **Tests:** Build temp projects with `createPluginProject()` (T1) and mock `getPaths()` to point at the temp directory. Do not mock `node:fs`.

---

## 3. Phases overview

- **Phase 1: Fix existing plugin loading & Windows support (T1–T4)** *(detailed below)*
- **Phase 2: Missing kit plugin compatibility (T5–T9)** *(to be detailed after Phase 1)*
  - T5: Runtime API gaps (`requests.serveDirectory`, `setupRouter` check, `addFunction` `renderAsHtml`, safe `getFilter`/`getFunction`)
  - T6: Require hook (`govuk-prototype-kit/lib/config` without `.js`, quiet logging, clear error on unsupported subpaths)
  - T7: `stylesheets` manifest key, `/extension-assets` alias, `pluginConfig`/`extensionConfig` locals, kit Nunjucks includes
  - T8: Proxy plugins (`jquery`, `notifications-node-client`, `app/plugin-proxy.json`)
  - T9: `pluginVersionSatisfies` in `app.locals`
- **Phase 3: Plugins management UI (T10–T16)** *(to be detailed after Phase 2)*
  - T10: Known plugins list
  - T11: Fetching latest versions from the npm registry
  - T12: Safe npm runner (Windows-compatible, stops prototype first)
  - T13: Pure install/update/uninstall planner (`pluginDependencies` and dependents)
  - T14: Background install jobs in the dev server
  - T15: Manage-prototype `/plugins` UI routes and views (retaining `formatPackageName`'s `{ name, publisher }` shape)
  - T16: Watching `package.json` for CLI installs

---

## 4. Phase 1 tasks: Fix existing plugin loading & Windows support

Work through T1 to T4 one at a time, stopping for review after each task.

### T1 — Real-file test harness for plugins

**Why:** `lib/plugins.test.js` currently mocks `node:fs` with 69 `mockReturnValueOnce` calls tied to the exact order files are read. Any change to `lib/plugins.js` breaks the tests.

**Files:** `tests/helpers/plugin-project.js` (new), `lib/plugins.test.js` (rewrite)

**Steps**
1. Write `createPluginProject({ dependencies, plugins, files })`. It creates a temp directory with `package.json`, `node_modules/<pkg>/{package.json,govuk-prototype-kit.config.json,...files}` and any project files, and returns `{ dir, cleanup }`. It must support scoped names (`@scope/name`).
2. Rewrite `lib/plugins.test.js` to use `createPluginProject`, mocking only `getPaths()` to point at `dir`. Keep every behaviour the current tests check.
3. Add a snapshot test for a project with Protato's own manifest plus `govuk-frontend` and `@govuk-prototype-kit/common-templates` (copying manifests from `starter/node_modules`). Snapshot the output of every getter, with paths normalised relative to `dir` using `/`.

**Done when:** `lib/plugins.test.js` does not mock `node:fs`, `npm test` passes, and no production code has changed. **Stop for review.**

---

### T2 — Normalise manifests on read

**Why:** Currently:
- Iterating over a string manifest value (e.g. `"scripts": "/foo.js"`) iterates its characters.
- A `{ path }` script object without `type` produces `src: "/plugin-assets/pkg[object Object]"`.
- Manifest paths without a leading `/` produce malformed URLs.
- `getTmpViewPaths` crashes if a plugin has `importNunjucksMacrosInto` without `nunjucksPaths`.
- Invalid JSON in a manifest crashes startup instead of warning and skipping (D7).

**Files:** `lib/plugins.js`, `lib/plugins.test.js`

**Steps**
1. In `getPlugins()`, read each manifest once into a normalised shape:
   - Every list key becomes an array (`[].concat(value ?? [])`).
   - `scripts` entries become `{ path, type? }`.
   - Ensure manifest paths have a leading `/`.
   - Getters only read the normalised shape.
2. Wrap the manifest and `package.json` reads in `try/catch`. On failure, `console.warn('Plugin <pkg>: could not read <file>: <message>')` and skip the plugin.
3. Guard `getTmpViewPaths` so plugins without `nunjucksPaths` return no tmp view paths instead of crashing.
4. Share a helper between `getAssetPaths` and `getScriptPaths` for converting scripts into asset paths.

**Done when:** Tests pass for string manifest values, `{ path }` script objects, paths without leading `/`, `importNunjucksMacrosInto` without `nunjucksPaths`, and invalid JSON manifests. The T1 snapshot remains unchanged. **Stop for review.**

---

### T3 — Plugin order and view precedence

**Why:**
- `getPlugins()` currently uses `package.json` key order with `govuk-frontend` moved first, rather than D6 (`protato`, then `govuk-frontend`, then alphabetical by package name).
- `lib/app.js` currently searches plugin views in forward plugin order, so earlier plugins override later plugins (breaking D5), and all tmp views come before all regular plugin views rather than each plugin's shadow layouts immediately preceding its own views.

**Files:** `lib/plugins.js`, `lib/app.js`, tests

**Steps**
1. In `lib/plugins.js`, order plugins by D6: `protato`, `govuk-frontend`, then the rest sorted by package name (code-point order).
2. Build the Nunjucks view search path list so the order is:
   1. `app/views` (project always wins)
   2. Plugins in **reverse** plugin order, with each plugin's tmp shadow layout path(s) immediately before its own `nunjucksPaths`
   3. In development, the `node_modules` fallback last
3. Document the precedence rule in a comment where the view list is built, citing D5 and D6.

**Done when:** Tests verify that project views beat plugin views, later plugins beat earlier plugins, and shadow layouts beat originals. Update the T1 snapshot for the new ordering. **Stop for review.**

---

### T4 — Windows CI and Windows-safe paths

**Why:** Sass `@import` strings and some URLs/test assertions currently use `path.join`, which produces backslashes on Windows and breaks Sass compilation.

**Files:** `.github/workflows/node.js.yml`, `lib/build.js`, `lib/plugins.js`, tests

**Steps**
1. Add `windows-latest` to the GitHub Actions CI matrix.
2. In `lib/build.js` and `lib/plugins.js`, build Sass `@import` strings for absolute paths with `pathToFileURL(p).href` and for plugin paths with `/`.
3. Ensure no URL, Sass import, or Nunjucks template name is built with `path.join`.
4. Fix any existing tests that fail on Windows path separators.

**Done when:** `npm test` passes, a unit test verifies generated `application.scss` has no backslashes, and CI is configured for both Ubuntu and Windows. **Stop for review.**
