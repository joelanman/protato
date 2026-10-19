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
- **Phase 2: Complete documented plugin support (T5–T7)** ✅ *(Done locally; Windows CI verification outstanding in this session)*
  - ✅ T5: `stylesheets` config support and plugin CSS in layouts
  - ✅ T6: Correct asset serving for files and directories
  - ✅ T7: Config imports with or without `.js` (replacement logging kept)
- **Phase 3: Plugins management UI (T8–T14)** *(planned below; awaiting review)*
  - T8: Known plugins and read-only `/plugins` page *(initial implementation needs rework after review)*
  - T9: Registry versions and target-version plugin configs
  - T10: Safe Windows-compatible npm runner (lifecycle coordinated in T12)
  - T11: Pure install/update/uninstall planner (`pluginDependencies` and dependents)
  - T12: Background install jobs in the dev server
  - T13: Extend `/plugins` with install/update/uninstall confirmation and progress
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

## 5. Phase 2 tasks: Complete documented plugin support (Done)

T5–T7 are implemented and reviewed. The latest local `npm test` passed: 209 unit tests, 10 end-to-end tests and lint. Windows CI must still be confirmed; this session has not verified its result. Successful require-replacement logging was explicitly retained in review. This phase added no dependencies.

### Scope and approach

The kit's documented config options are the baseline: `assets`, `importNunjucksMacrosInto`, `nunjucksFilters`, `nunjucksMacros`, `nunjucksPaths`, `pluginDependencies`, `sass`, `scripts`, `stylesheets` and `templates`.

Protato now supports the runtime options above, including `stylesheets` and file/directory asset serving. `pluginDependencies` installation planning belongs in Phase 3. The Sass build already supplies `$govuk-plugins-url-context`.

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

All three tasks pass local `npm test`, including lint and real-file rendering/HTTP compatibility tests. Windows CI must pass too; local Unix success alone is not Windows verification. No plugins UI, registry fetching, npm operations or dependency planning was added in this phase.

---

## 6. Phase 3 tasks: Plugins management UI (Proposed)

**Review the remaining choices before implementing the tasks that use them.** T8's route-first approach below is agreed in review. Implement one task at a time, run `npm test`, and stop for review. These tasks add management features, not more speculative kit compatibility.

### Existing structure and kit reference

- `manage-prototype/dev-app.js` already owns the development-only `/plugins` placeholder. Implement management here, not in the prototype child process or production management app.
- `lib/dev-server.js` owns the prototype child and can stop it while keeping management pages alive. `lib/watch.js` currently restarts for app changes and compiles Sass; it does not watch the project package files.
- `lib/plugins.js` remains the runtime loader. Reuse its display-name formatter and cache invalidation; do not turn it into a registry client or job runner.
- Package information for the management page belongs initially in `manage-prototype/routes/plugins.js`. Keep focused file-reading and install-source helpers separate from the handler, but assemble the page model and render it inside `router.get()`. Do not wrap the whole route's data assembly in an exported `getPluginsPage()`/`getPageData()` function. Do not introduce a standalone catalog module before it has a real shared consumer; extract a helper later only when another task needs the same reads.
- The kit's `known-plugins.json` is a useful starting point. Its `lib/plugins/packages.js` mixes installed state, registry data and dependency lookup; its `lib/utils/requestHttps.js` downloads a package archive to find the plugin config. The config is not normally present in npm registry JSON, so version lookup alone cannot support `pluginDependencies` for a new install.
- The kit's management handlers construct command strings and infer completion from installed versions/restarts. Protato should instead use argument arrays and explicit job state. Do not copy the kit's shell-command builder, global restart flag or general-purpose package cache.

### Proposed choices needing review

1. **Initial list:** offer `govuk-frontend`, `@govuk-prototype-kit/common-templates`, `@govuk-prototype-kit/step-by-step`, `@ministryofjustice/frontend` and `hmrc-frontend`. Do not offer jQuery or Notify while proxy configs are deferred. Keep `protato` visible as a protected installed package, with no self-update/uninstall action in this UI. Protect GOV.UK Frontend from uninstall, but allow updates.
2. **Versions:** install/update to the registry's stable `latest` version, pinned exactly in project `dependencies`. No version picker, prereleases, downgrade action or update-all in this phase. If `latest` is older than the installed version, do not offer an update. Local/file/Git/npm-alias declarations are shown read-only rather than silently converted to registry dependencies.
3. **Dependencies:** read `pluginDependencies` from the exact target version's config before changing anything. Show all planned changes on a confirmation page. Add missing plugin dependencies and update incompatible ones only when needed and explicitly confirmed; do not change unrelated plugins automatically. Treat `minVersion`/`maxVersion` as inclusive. Block unresolved/conflicting constraints rather than building a general dependency solver or silently trying older top-level versions.
4. **Uninstall:** include installed plugins that depend on the target, recursively, in the proposed removal plan. Require confirmation of the full list. Block if removal would include a protected package or a package outside the known list; do not silently break or remove an unknown plugin. Do not automatically remove newly unused dependencies.
5. **Unknown packages:** display directly installed plugins with readable kit configs as read-only. Allow UI changes only to known packages, including every dependency added/updated/removed by a plan (D3). Unknown/local plugins still participate in dependency checks so a known-package action cannot silently break them.
6. **Dependencies worth adding:** propose `semver` for version constraints, `tar-stream` to read one config entry from a gzipped npm archive without extracting files, and `cross-spawn` for npm invocation on Windows. Review maintenance/current versions before adding each. Native `fetch`, `node:zlib` and existing Express/Chokidar cover the rest. Do not add a registry SDK, queue library or frontend framework.
7. **Jobs:** one operation at a time, stored in memory in the dev server. Reject another submission as busy rather than queueing it. Jobs do not survive a dev-server restart; report actual filesystem state after restarting. Keep bounded output and a small bounded history, not a persistent job database.
8. **Failure:** npm changes are not transactional. Do not promise rollback. After success or failure, re-read project files, invalidate caches, rebuild and attempt to start the prototype again. Distinguish npm failure, rebuild failure and restart failure; the management UI must stay usable.
9. **Request protection:** mutation routes require a dev-server-generated form token and reject cross-origin requests. No installation via GET, no arbitrary package/version/command fields accepted from the browser. Development-only does not mean a website should be able to trigger local npm commands.

If any choice above is unsuitable, change the plan before implementation rather than guessing inside a task.

### T8 — Known plugins and a read-only management page (Rework after review)

**Files:** `known-plugins.json`, new `manage-prototype/routes/plugins.js` and tests, `manage-prototype/dev-app.js`, `manage-prototype/views/plugins.njk`. Move useful reads/tests out of the initial `lib/plugin-catalog.js` implementation and remove that separate module/test file once covered by the route tests.

**Changes**

- Define the reviewed known list and protected-package policy as simple data, not a second plugin config format.
- Read current project `package.json` and installed package metadata/configs using real filesystem paths. Do not cache project state at module import time.
- Keep declared specifier, installed version and install source separate. A declaration does not prove a package is installed; a transitive package is not a directly installed plugin.
- Keep focused package-reading and install-source helpers in the management route file, separate from the handler. Put page-specific orchestration, ordering, display-name formatting and model assembly directly in `router.get()`, followed by `response.render()`. Do not export a whole-page model builder just for tests or possible future reuse. Build only the data needed for this read-only page; preserve `formatPackageName()`'s `{ name, publisher }` result rather than designing a speculative page/planner model.
- Replace the existing development-only `/plugins` placeholder with a small server-rendered page showing plugin names, installed versions or “Not installed”, protected/read-only explanations and useful diagnostics. Show known-but-uninstalled packages and installed unknown plugins, including those with broken configs.
- No registry calls, latest-version checks, install/update/uninstall buttons or mutation endpoints yet. T13 extends this same route and page once those actions work.
- Resolve the initial review findings: keep unknown plugins with broken configs visible with their diagnostics; classify shorthand Git/non-registry sources conservatively as read-only; diagnose invalid dependency declarations instead of throwing or treating them as registry installs.
- Retain existing runtime loader behaviour; management diagnostics do not prevent prototype startup.

**Acceptance tests**

- Real temporary projects: installed, uninstalled and declared-but-missing known packages; config-less ordinary dependencies; scoped and unknown plugins; local/file/Git/alias dependencies.
- Corrupt project/package/config JSON produces a useful diagnostic. A plugin whose dependency metadata cannot be read must not be treated as having no dependencies when deciding a destructive action.
- Protected and read-only policies; formatter shape unchanged; repeated reads see file edits.
- Test page assembly through the route, capturing the render model where useful rather than exporting a whole-page builder or JSON-serialising the model just to inspect it. Also request `/manage-prototype/plugins` through the development management app and assert rendered names, installed/not-installed state, protected/read-only explanations and escaped diagnostics. The page performs no network calls or npm operations.
- Unknown plugins with malformed configs remain visible with unknown dependency metadata. Use a known package to test shorthand Git and other non-registry declarations, so unknown-package read-only policy cannot mask source-classification bugs. Non-string declarations produce diagnostics without crashing.
- Keep the page in the parent dev server, not the prototype child or production management app. Test that production does not expose the plugin listing route.

### T9 — Fetch registry versions and exact-version configs

**Files:** new `lib/plugin-registry.js` and tests; `package.json`/`package-lock.json` for reviewed `semver` and archive-reader dependencies.

**Changes**

- Fetch metadata from the fixed npm registry for allowlisted package names, encoding scoped names correctly. Return valid version data and stable `latest`; compare against actual installed versions with `semver`, not string comparison or dependency-range coercion.
- Fetch the archive for an exact selected version and read only `package/govuk-prototype-kit.config.json`. Never unpack an archive into the project, execute its code or run lifecycle scripts to inspect it.
- Bound request duration, metadata/archive/config size and redirects; validate HTTPS download destinations. Reject malformed/duplicate config entries and unsafe archive paths. Distinguish unavailable config/registry data from a valid config with no plugin dependencies; do not plan an install from incomplete information.
- Normalise `pluginDependencies` strings/objects into a predictable shape, validating package names and min/max versions. Preserve the original config for descriptions/links if useful; do not duplicate runtime path processing here.
- Use a short-lived in-memory metadata cache and an exact-version config cache, with explicit invalidation. No disk cache or startup network request. Fetch on management requests/planning only.
- If offline, show installed information and an explicit registry error. Do not pretend there are no updates; uninstall can use verified installed configs without a registry lookup.

**Acceptance tests**

- Local HTTP server or injected fetch transport, with no public registry access in tests: valid/scoped metadata, missing/invalid latest, update/no-update/prerelease cases, non-200 responses, invalid JSON, timeout and size limits.
- Real tiny archive fixtures: correct config, version-specific dependencies, missing/malformed/duplicate entries, truncated/corrupt gzip/tar and unsafe paths. No extraction or project writes.
- Cache hits/invalidation; failed lookups do not poison good cached data or become an empty successful config.

### T10 — Run npm safely on Windows and Unix

**Files:** new `lib/plugin-npm.js` and tests, `package.json`/`package-lock.json` for the reviewed process dependency.

**Changes**

- Accept only validated structured plans, never a command string. Generate `npm install --save-exact <package>@<exact-version> …` or `npm uninstall <package> …` argument arrays with a fixed project working directory.
- Validate allowlisted names, exact versions and operation kind again at the execution boundary. No paths, URLs, option-like values or client-supplied npm flags.
- Use the reviewed Windows-capable spawn mechanism, not handwritten shell interpolation or `exec()`. Explicitly document that cross-spawn may use Windows command-shell machinery for `.cmd`; validated fixed arguments are still essential.
- Return exit status and bounded stdout/stderr; handle spawn errors and cancellation/timeout without leaving a second npm operation running. Do not suppress npm failures or claim rollback.
- This helper only runs npm. T12 owns stopping/restarting the prototype and ensures the child has exited before invoking it.

**Acceptance tests**

- Argument/cwd validation and malicious/unknown input rejected before spawning; success, non-zero exit, spawn failure and bounded output.
- Exercise the process seam with a real fixture executable, including a project path containing spaces on Windows CI. Verify cancellation settles only after the child has stopped.
- Add an offline smoke test invoking real npm to uninstall an existing fixture package from a temporary project, without public network access. Test install argument construction separately; do not make CI depend on live npm packages.

### T11 — Plan changes without side effects

**Files:** new `lib/plugin-plan.js` and tests. The planner takes plain data, with no filesystem/network reads. If its caller needs the same package reads as the management route, extract a small shared management helper at this point, based on that actual use; do not restore a general catalog abstraction.

**Changes**

- Return a structured list of exact installs/updates or removals, reasons/dependency relationships, and blocking errors. Producing a plan must not write files, invoke npm or stop the prototype.
- For install/update, inspect the selected target's config and recursively resolve its declared plugin dependencies. Keep an installed dependency if its version satisfies all relevant constraints; otherwise propose the highest stable registry version within the bounds and inspect that exact version's config too.
- Registry reads needed during traversal are orchestrated outside the pure planner. Represent missing package/version-config data explicitly so the caller can fetch it and rerun planning; do not hide async fetches inside the planner.
- Check proposed versions against constraints from other installed plugins as well as the target dependency graph. Deduplicate shared dependencies, detect cycles without infinite recursion, and report conflicts without a general backtracking solver.
- For uninstall, compute recursive installed dependents from installed configs. Apply the reviewed protected/known/read-only policies to every affected package.
- Keep npm's ordinary package dependencies separate: `pluginDependencies` express prototype-level requirements; npm handles the package's own dependency tree.

**Acceptance tests**

- String/object requirements, inclusive minimum/maximum bounds, missing/already-satisfied dependencies, incompatible installed versions, exact target-version configs and multiple levels of requirements.
- Shared dependencies, cycles, conflicting ranges, unknown required plugins, missing metadata/config and constraints from unknown/local installed plugins.
- Direct/recursive dependents on uninstall, protected packages, no orphan cleanup and no mutation of input data.
- Deterministic plans and explicit no-op plans when the requested state already holds.

### T12 — Coordinate background jobs in the dev server

**Files:** new `lib/plugin-jobs.js` and tests, `lib/dev-server.js`, `lib/watch.js`, related tests; small management-app injection changes if needed.

**Changes**

- Own jobs in the dev-server process, where they survive prototype restarts. Pass the service into the management app explicitly; avoid a circular chain of routes importing the dev server importing routes.
- On submission, re-read state and verify the confirmed plan is still current. A changed plan requires a new confirmation; do not silently execute different changes or a newer `latest` version.
- Claim the busy slot synchronously before async work. Record simple states such as stopping, running npm, rebuilding, restarting, succeeded and failed, plus bounded diagnostic output.
- Stop the prototype and await its exit before npm starts, then re-read installed package information, invalidate registry/runtime caches, rebuild Sass and generated macro layouts, and restart using the new build result. Clear stale generated layouts before rebuilding.
- Coordinate existing backend/Sass watcher callbacks so none can restart/build against partially changed packages. Coalesce changes during the job into the single post-job rebuild/restart, including on failure. Do not add a generic scheduling framework.
- The management app and job status remain available while the prototype is stopped or broken. Track npm outcome separately from a prototype build/startup problem, and release the busy slot in every completion path.
- While npm runs, prototype requests receive a clear temporary-unavailable response instead of a raw proxy connection failure.

**Acceptance tests**

- Assert lifecycle order: stop completes → npm → fresh state/cache invalidation → rebuild → restart → reload. No overlapping mutation jobs.
- Stop/spawn/npm/build/restart failures, no-op/stale plans, bounded job history and unknown job IDs.
- Fire backend/Sass/package events during npm and verify no premature restart or duplicate final rebuild; management/status remain accessible.
- Integration with a fake npm executable and real temporary files: the child is stopped before files change, and the restarted prototype sees newly added/removed templates, filters and styles.

### T13 — Add plugin actions, confirmation and progress

**Files:** existing `manage-prototype/routes/plugins.js` and tests, `manage-prototype/dev-app.js`, existing plugin listing view plus confirmation/progress views, a small management JavaScript file only if polling needs it.

**Changes**

- Extend T8's existing list with latest-version/update information and working actions, retaining its installed-state diagnostics and protected/read-only explanations. Preserve `{ name, publisher }` naming and usable offline installed information. Do not rebuild the list or introduce another package-data layer.
- Use a small server-rendered flow: list → confirmation of the exact plan → POST to start a job → progress/result. One shared flow for install/update/uninstall, not separate near-identical handlers.
- Submit package/action identifiers and the server-issued confirmation identifier/token, not trusted change lists or shell arguments. Validate all input on the server, enforce request protection and revalidate plan freshness in T12.
- Show dependencies/dependents and every proposed change before confirmation. Disable inappropriate actions, but enforce the same policies server-side.
- Poll a read-only job-status endpoint while processing, stopping on terminal status. Provide a normal refresh link too; do not require WebSockets or a frontend framework. Escape output/logs and do not present registry metadata as trusted HTML.
- Mount routes only in the development management app. Production has no plugin mutation endpoints. Keep management static assets available while the prototype is stopped.

**Acceptance tests**

- List/confirmation/progress/success/failure rendering; install/update/uninstall; protected, unknown and local packages; offline and stale-plan messages.
- Invalid action/name/job/token, cross-origin POST, duplicate submission/busy state and escaped metadata/npm output. GET requests never mutate.
- Production cannot invoke the endpoints. Real browser-facing flow against fake registry/npm fixtures verifies that the management UI survives the prototype restart and shows the resulting installed state.

### T14 — Refresh after command-line package changes

**Files:** `lib/watch.js`, `lib/dev-server.js`/job coordination as needed, watcher and integration tests.

**Changes**

- Watch project `package.json` and `package-lock.json` outside `node_modules`. Debounce/coalesce changes and handle editor-style replacement, not only a single `change` event.
- React to relevant dependency/installed-version changes, not every formatting or unrelated-script edit. A lockfile change matters when the installed version changes without a declaration change.
- Re-read installed state, clear caches, regenerate layouts and Sass, restart the prototype once and reload. Reuse T12's coordination rather than creating a second restart pipeline.
- During a UI job, absorb its package events into that job's final refresh. For CLI operations, wait for package files to settle and tolerate incomplete/temporarily invalid files with a useful diagnostic and later retry. Do not claim that file watching can determine exactly when an external npm process has finished.
- Do not install/uninstall anything in response to file changes. CLI-installed unknown plugins remain usable at runtime and read-only in the UI.

**Acceptance tests**

- Add/remove/change dependency declarations, lockfile-only version changes, unchanged/format-only edits and package-file replacement.
- Burst events produce one refresh; events from a UI job do not cause an extra restart. Invalid intermediate JSON can recover on a later valid event.
- A fake CLI install changing real project files becomes visible to both prototype rendering and the management list without restarting the dev server. Run Windows CI for path, watcher and process behaviour.

### Phase 3 completion

All tasks pass `npm test` and Windows CI. Exercise install, update and uninstall with controlled registry/npm fixtures, dependency confirmation, an npm failure, a broken prototype and a command-line change. No public npm network dependency in the test suite. The parent management UI remains available throughout, only known packages can be mutated, and production exposes no mutation routes.
