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
- **Code:** ESM, tabs and Biome (`npm run lint`). Match surrounding code:
  - Keep logic simple, explicit and flat—prefer plain `for...of` loops over dense functional chains (like `Object.fromEntries(Object.entries(...).map(...))`).
  - Use consistent naming: call `govuk-prototype-kit.config.json` `config` (not `manifest`), and call npm package names `packageName` (not `pluginName` or `dependency`).
  - Warnings use `console.warn` starting with `Plugin <packageName>:`.
- **Tests:** Build temp projects with `createPluginProject()` (`setupProject()` in `lib/plugins.test.js`) and mock `getPaths()` to point at the temp directory. Do not mock `node:fs`.

---

## 3. Phases overview

- **Phase 1: Fix existing plugin loading & Windows support (T1–T4)** *(detailed below)*
  - ✅ T1: Real-file test harness for plugins
  - ✅ T2: Normalise plugin configs on read
  - ⬜ T3: Plugin order and view precedence *(next)*
  - ⬜ T4: Windows CI and Windows-safe paths
- **Phase 2: Missing kit plugin compatibility (T5–T9)** *(to be detailed after Phase 1)*
  - T5: Runtime API gaps (`requests.serveDirectory`, `setupRouter` check, `addFunction` `renderAsHtml`, safe `getFilter`/`getFunction`)
  - T6: Require hook (`govuk-prototype-kit/lib/config` without `.js`, quiet logging, clear error on unsupported subpaths)
  - T7: `stylesheets` config key, `/extension-assets` alias, `pluginConfig`/`extensionConfig` locals, kit Nunjucks includes
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

### ✅ T1 — Real-file test harness for plugins (Done)

**Files:** `tests/helpers/plugin-project.js`, `lib/plugins.test.js`, `lib/__snapshots__/plugins.test.js.snap`

---

### ✅ T2 — Normalise plugin configs on read (Done)

**Files:** `lib/plugins.js`, `lib/plugins.test.js`

---

### T3 — Plugin order and view precedence

**Why:**
- `getPlugins()` currently uses `package.json` key order with `govuk-frontend` moved first, rather than D6 (`protato`, then `govuk-frontend`, then alphabetical by package name).
- `lib/app.js` currently searches plugin views in forward plugin order, so earlier plugins override later plugins (breaking D5), and puts all `.tmp/views` paths before all regular plugin views (`[paths.views, ...plugins.getTmpViewPaths(), ...plugins.getViewPaths()]`) rather than each plugin's shadow layouts immediately preceding its own views.

**Files:** `lib/plugins.js`, `lib/app.js`, tests

**Steps**
1. In `lib/plugins.js`, order plugins by D6: `protato`, `govuk-frontend`, then the rest sorted by `packageName` (code-point order).
2. Build the plugin view search paths in `lib/plugins.js` so that for plugins in **reverse** plugin order, each plugin's `.tmp/views` path(s) (if it has `importNunjucksMacrosInto`) come immediately before its own `nunjucksPaths`. (If `getTmpViewPaths` is no longer needed as a separate export by `lib/app.js`, fold it into `getViewPaths` or keep it clear and simple.)
3. In `lib/app.js`, build the Nunjucks view list as:
   1. `app/views` (project always wins)
   2. Plugin view paths from step 2
   3. In development, the `node_modules` fallback last
4. Document the precedence rule in a comment where the view list is built, citing D5 and D6.

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
