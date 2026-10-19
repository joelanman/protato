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
  - For Sass `@import` strings, backslashes break CSS parsing: use `.replaceAll('\\', '/')` on filesystem paths and `/` for plugin paths.
- **Code:** ESM, tabs and Biome (`npm run lint`). Match surrounding code:
  - Keep logic simple, explicit and flat—prefer plain `for...of` loops over dense functional chains (like `Object.fromEntries(Object.entries(...).map(...))`).
  - Use consistent naming: call `govuk-prototype-kit.config.json` `config` (not `manifest`), and call npm package names `packageName` (not `pluginName` or `dependency`).
  - Warnings use `console.warn` starting with `Plugin <packageName>:`.
- **Tests:** Build temp projects with `createPluginProject()` (`setupProject()` in `lib/plugins.test.js`) and mock `getPaths()` to point at the temp directory. Do not mock `node:fs`.

---

## 3. Phases overview

- **Phase 1: Fix existing plugin loading & Windows support (T1–T4)** ✅ *(Done)*
  - ✅ T1: Real-file test harness for plugins
  - ✅ T2: Normalise plugin configs on read
  - ✅ T3: Plugin order and view precedence
  - ✅ T4: Windows CI and Windows-safe paths
- **Phase 2: Complete documented plugin support (T5–T7)** *(tasks done, awaiting review)*
  - ✅ T5: `stylesheets` config support and plugin CSS in layouts
  - ✅ T6: Correct asset serving for files and directories
  - ✅ T7: Config imports with or without `.js` (replacement logging kept)
- **Phase 3: Plugins management UI (T8–T14)** *(to be detailed after Phase 2)*
  - T8: Known plugins list
  - T9: Fetching latest versions from the npm registry
  - T10: Safe npm runner (Windows-compatible, stops prototype first)
  - T11: Pure install/update/uninstall planner (`pluginDependencies` and dependents)
  - T12: Background install jobs in the dev server
  - T13: Manage-prototype `/plugins` UI routes and views (retaining `formatPackageName`'s `{ name, publisher }` shape)
  - T14: Watching `package.json` for CLI installs

---

## 4. Phase 1 tasks: Fix existing plugin loading & Windows support (Done)

### ✅ T1 — Real-file test harness for plugins (Done)

**Files:** `tests/helpers/plugin-project.js`, `lib/plugins.test.js`, `lib/__snapshots__/plugins.test.js.snap`

---

### ✅ T2 — Normalise plugin configs on read (Done)

**Files:** `lib/plugins.js`, `lib/plugins.test.js`

---

### ✅ T3 — Plugin order and view precedence (Done)

**Files:** `lib/plugins.js`, `lib/app.js`, `lib/plugins.test.js`, `lib/app.test.js`

---

### ✅ T4 — Windows CI and Windows-safe paths (Done)

**Files:** `.github/workflows/node.js.yml`, `lib/build.js`, `lib/plugins.js`, `lib/utils/error-model.js`, `manage-prototype/routes/template-preview.js`, `manage-prototype/routes/templates.js`, tests

---

## 5. Phase 2 tasks: Complete documented plugin support

**Scope agreed in review.** Implement T5–T7 in order, one task at a time; run `npm test` and stop for review after each task. This phase adds no dependencies.

### Scope and approach

The kit's documented config options are the baseline: `assets`, `importNunjucksMacrosInto`, `nunjucksFilters`, `nunjucksMacros`, `nunjucksPaths`, `pluginDependencies`, `sass`, `scripts`, `stylesheets` and `templates`.

Protato already supports the runtime options above except `stylesheets`; file serving needs verification and correction. `pluginDependencies` installation planning belongs in Phase 3. The Sass build already supplies `$govuk-plugins-url-context`.

Relevant reference code in `../govuk-prototype-kit`:

- `lib/plugins/plugins.js`: collects stylesheet URLs and script descriptors from plugin configs.
- `lib/plugins/plugins-routes.js`: mounts declared assets, scripts and stylesheets.
- `lib/nunjucks/govuk-prototype-kit/includes/`: renders stylesheet links and script tags.

Keep Protato's existing normalised configs, explicit loops, locals and layouts. Do not reproduce the kit's generic grouping helpers or add new template aliases just to match its internal structure.

**Excluded or deferred:**

- No legacy `/extension-assets` alias. Only the documented `/plugin-assets/<packageName>/<asset path>` URLs are required; D1 does not require this legacy alias.
- No early-registration queue. Protato initialises the API before importing plugin filters/functions and project routes. Investigate import order first if a real compatibility issue arises.
- Defer additional runtime API work (`requests.serveDirectory`, router validation, HTML functions and safe getters) until there is a demonstrated need.
- Defer `pluginConfig`/`extensionConfig` locals, kit template includes, proxy configs and `pluginVersionSatisfies`. Do not add `semver` for a helper we do not yet need.
- No require-hook redesign, idempotency work or new rejection of unsupported subpaths. T7 only tidies the existing supported mappings; ESM kit-name imports remain outside this phase.

### ✅ T5 — Support plugin stylesheets (Done)

**Files:** `lib/plugins.js`, `lib/plugins.test.js`, `lib/app.js`, `lib/app.test.js`, `lib/layouts.test.js`, `plugin/views/govuk-prototype-kit/layouts/govuk-branded.njk`, `plugin/views/govuk-prototype-kit/layouts/unbranded.html`

**Changes**

- Normalise `stylesheets` as a list of package-relative paths, accepting a single string or an array consistently with existing config handling. Missing values become an empty list; invalid config warns and skips according to D7.
- Add `getStylesheetPaths()` returning stylesheet URLs in plugin order, using the existing `/plugin-assets` URL construction.
- Include declared stylesheets in `getAssetPaths()` even when not covered by an `assets` directory. T6 addresses serving individual file descriptors correctly for all asset types.
- Expose the stylesheet list alongside scripts in the existing shared `protato` / `GOVUKPrototypeKit` locals. Do not introduce new compatibility locals.
- Render plugin CSS after the application stylesheet in both branded and unbranded layouts. Preserve the existing stylesheet, script and page-script extension blocks; do not duplicate links or change script behaviour.

**Acceptance tests**

- Missing, string and array stylesheet configs; leading-slash normalisation; invalid config warnings; ordered URLs across plugins; scoped package names; no backslashes in URLs.
- Asset descriptors include declared stylesheet files without requiring a separate `assets` entry.
- Real Nunjucks rendering of both layouts includes each declared stylesheet once, in order, after the appropriate application stylesheet. Check URL escaping and unchanged script output.
- Existing locals aliases and project template overrides still work. Use real files for plugin/rendering tests rather than relying only on the mocked app tests.

### ✅ T6 — Serve asset files and directories correctly (Done)

**Files:** `lib/plugins.js`, `lib/plugins.test.js`, `lib/app.js`, real-file HTTP integration/server tests; `tests/helpers/plugin-project.js` only if needed.

**Changes**

- Support both files and directories in `assets`, as documented. Files can be images, PDFs or any other type, not just JS/CSS.
- Serve declared scripts and stylesheets even when not covered by an `assets` directory. Do not assume mounting `express.static(filePath)` serves an individual file correctly.
- Use a small, explicit distinction between file and directory targets: static middleware for directories, exact-URL file serving for files. Determine target type using real filesystem metadata, not filename extensions. Keep the implementation in the existing loader/app structure.
- Warn and skip missing or unreadable declared targets with the package and config file named, rather than failing startup (D7).
- Retain existing `/plugin-assets` URLs, including Protato's historic `govuk-prototype-kit` package-name mapping. Do not add `/extension-assets` mounts.
- Keep assets behind production authentication. Preserve correct missing-file fallthrough and avoid serving siblings of an individually declared file.

**Acceptance tests**

- Fetch a file inside a declared directory, an individually declared image/PDF, a standalone script and a standalone stylesheet, using real temporary files and HTTP requests.
- Include a directory whose name contains a dot and a file without an extension, so target classification cannot rely on filename guessing.
- Test scoped package URLs, trailing slashes on directory config paths and Windows-safe filesystem paths.
- Missing/unreadable declared targets warn and do not stop other plugins from working. Use a portable unreadable-target case or platform-specific coverage rather than Unix permission assumptions on Windows.
- A missing file inside a served directory falls through correctly; individual-file mounts do not expose sibling files or accept extra URL path segments.
- Production authentication protects plugin assets; existing directory asset URLs still work.
- A rendered plugin stylesheet link can be fetched successfully, completing T5's browser-facing coverage.

### ✅ T7 — Config imports with or without `.js` (Done)

**Files:** `lib/utils/replace-require.js`, `lib/utils/replace-require.test.js`, CommonJS server fixture/tests.

**Changes**

- Support both `govuk-prototype-kit/lib/config` and `govuk-prototype-kit/lib/config.js`, returning Protato's existing config module with `getConfig`.
- Keep successful-replacement console logging for now (deferred in review).
- Keep the current root API mapping, return shapes and normal resolution of all unrelated requests. Do not change handling of other kit subpaths in this task.

**Acceptance tests**

- Both config spellings return the same module and expose `getConfig`.
- Built-ins and unrelated package requests still use normal resolution; tests restore global require state.
- A real CommonJS prototype reads config without `.js` while its existing routes, filters and functions continue to work. Use the subprocess/server fixture for startup verification, since Vitest's ESM module graph and Node's `require()` cache differ.

### Phase 2 completion

All three tasks pass `npm test`, including lint and real-file rendering/HTTP compatibility tests. Windows CI must pass too; local Unix success alone is not Windows verification. No plugins UI, registry fetching, npm operations or dependency planning belongs in this phase. Detail Phase 3 only after Phase 2 is reviewed and complete.
