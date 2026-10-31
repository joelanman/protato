# Protato vs GOV.UK Prototype Kit: plugin management

Comparison of Protato's plugin management with `govuk-prototype-kit`
(`lib/plugins/*`, `lib/manage-prototype-handlers.js`, related routes and runtime
loading). Search is out of scope.

## Code size

Measured on the GOV.UK Prototype Kit 14.0.2 checkout (`3ab8cab9`) and Protato at
`4c4268d`. "Code" means physical lines containing code, excluding blank lines
and comment-only lines.

This is a third pass, updated after adding plugin update support (`registry.js`,
update planning, execution and UI) and including the kit's registry/tarball
lookup helpers (`lib/utils/requestHttps.js` and `hasNewVersion` in
`lib/utils/index.js`), which are used exclusively by `lib/plugins/packages.js`.

| Area | Kit | Protato |
| --- | ---: | ---: |
| Management code (direct + shared helpers, wiring and CSS) | 1,314 | 827 |
| Management tests (including plugin-specific helpers and mocks) | 1,852 | 1,505 |
| Remaining core plugin runtime (not management) | 152 | 324 |
| Plugin-author tooling | 225 | 0 |
| Plugin catalogue data (raw lines, not code) | 17 | 15 |

Even after adding update detection and execution, the kit's management code is
about **1.6x** the size of Protato's (1,314 vs 827 code lines, or **1.78x**
excluding the 90 lines of unused kit plugin CSS still present in Protato's
`manage-prototype.scss`). The absolute gap is nearly 500 production code lines
(nearly 600 without the unused CSS) and about 350 test lines (1.23x), because
Protato added comprehensive unit tests for registry lookups, update planning,
update execution and routes while the kit puts much more production code into
tarball extraction, confirmation/polling UI, browser JS and CSS.

The result is not sensitive to the remaining exclusions: adding template
management gives 1,599 vs 1,038 (1.54x), and adding the remaining runtime as
well gives 1,751 vs 1,362 (1.29x). The ratio narrows because Protato's runtime
module and shared support are larger, not because its management code catches
up.

Protato's proxy support is only 7 code lines larger (49 vs 42). Most of that is
the extra `accessible-autocomplete` built-in config (about 8 lines) plus
splitting the loader into `readUserProxyConfig` and `readProxyConfigs` with named
`PROXY_FILE`/`CONFIG_FILE` constants. The kit uses one compact
`getProxyPluginConfig` function with two built-ins. This is a structural
difference, not a meaningful complexity gap.

### Kit files counted

| File or region | Raw lines | Code lines |
| --- | ---: | ---: |
| **Direct management** | | |
| `lib/plugins/packages.js` | 278 | 217 |
| `lib/manage-prototype-handlers.js` plugin handlers (lines 411-754) | 344 | 299 |
| `lib/manage-prototype-handlers.js` plugin imports, kit name/version and `isValidVersion` (lines 19-25, 44-60) | 24 | 21 |
| `lib/manage-prototype-routes.js` plugin imports/routes and `setKitRestarted` (lines 15-26, 65-77, 84) | 26 | 20 |
| `lib/assets/javascripts/manage-prototype/manage-plugins.js` | 172 | 147 |
| `lib/nunjucks/views/manage-prototype/plugins.njk` | 154 | 147 |
| `lib/nunjucks/views/manage-prototype/plugin-install-or-uninstall.njk` | 128 | 111 |
| `lib/assets/sass/manage-prototype.scss` plugin classes (lines 131-230) | 100 | 87 |
| **Direct total** | **1,226** | **1,049** |
| **Shared management support** | | |
| `lib/utils/requestHttps.js` registry JSON and tarball config lookup | 147 | 112 |
| `lib/utils/index.js` `sortByObjectKey` and `hasNewVersion` (lines 279-301) | 23 | 20 |
| `lib/plugins/plugins.js` display-name helper (lines 183-229) | 47 | 40 |
| `lib/plugins/plugins.js` plugin watcher and its constants/exports (lines 30-31, 42-43, 241-282, 350, 359) | 48 | 42 |
| `lib/plugins/plugin-utils.js` proxy configs used for plugin metadata | 45 | 42 |
| `lib/dev-server.js` plugin watcher callback (lines 76-84) | 9 | 9 |
| **Support total** | **319** | **265** |
| **Management total** | **1,545** | **1,314** |
| **Tests** | | |
| `lib/plugins/packages.spec.js` | 306 | 268 |
| `lib/manage-prototype-handlers.test.js` plugin section (lines 473-725) | 253 | 232 |
| `lib/manage-prototype-handlers.test.js` plugin-specific setup and mocks | 57 | 43 |
| `lib/assets/javascripts/manage-prototype/manage-plugins.test.js` | 277 | 231 |
| `cypress/e2e/plugins/**` | 1,246 | 935 |
| `cypress/e2e/utils.js` install/uninstall helpers (lines 45-63) | 19 | 17 |
| `cypress/events/index.js` plugin wait tasks (lines 123-151, 261-268) | 37 | 33 |
| `cypress/scripts/run-starter-prototype.js` fixture plugin setup | 28 | 19 |
| `__tests__/utils/index.js` `installPlugins` (lines 104-113) | 10 | 10 |
| `cypress/e2e/prod/2-management-tests/management-not-available.cypress.js` plugin assertion (lines 21-25) | 5 | 5 |
| `lib/plugins/plugin-utils.spec.js` | 40 | 30 |
| `lib/plugins/plugins.test.js` proxy-config section (lines 346-376) | 31 | 29 |
| **Tests total** | **2,309** | **1,852** |
| **Data** | | |
| `known-plugins.json` (catalogue data) | 17 | n/a |

The Cypress plugin suite includes a few plugin-provided template cases; they stay
in the plugin suite because they use the same fixture plugins.

### Protato files counted

| File or region | Raw lines | Code lines |
| --- | ---: | ---: |
| **Direct management** | | |
| `lib/manage-plugins/list.js` | 222 | 152 |
| `lib/manage-plugins/plan.js` | 86 | 60 |
| `lib/manage-plugins/npm.js` | 52 | 34 |
| `lib/manage-plugins/change.js` | 156 | 107 |
| `lib/manage-plugins/registry.js` | 69 | 45 |
| `manage-prototype/routes/plugins.js` | 77 | 55 |
| `manage-prototype/views/plugins.njk` | 139 | 127 |
| `manage-prototype/views/plugin-result.njk` | 80 | 70 |
| `manage-prototype/assets/sass/manage-prototype.scss` plugin classes (lines 135-237, unused) | 103 | 90 |
| `manage-prototype/dev-app.js` plugin route wiring (lines 11, 42-44) | 4 | 2 |
| **Direct total** | **988** | **742** |
| **Shared management support** | | |
| `lib/plugins.js` config/proxy constants (lines 9-10) | 2 | 2 |
| `lib/plugins.js` built-in proxy configs (lines 12-36) | 25 | 24 |
| `lib/plugins.js` proxy config loaders (lines 69-98) | 30 | 23 |
| `lib/plugins.js` display-name formatting and cache clearing (lines 4, 112-156) | 46 | 36 |
| **Support total** | **103** | **85** |
| **Management total** | **1,091** | **827** |
| **Tests** | | |
| `lib/manage-plugins/change.test.js` | 452 | 371 |
| `lib/manage-plugins/list.test.js` | 368 | 314 |
| `lib/manage-plugins/npm.test.js` | 35 | 32 |
| `lib/manage-plugins/plan.test.js` | 196 | 154 |
| `lib/manage-plugins/registry.test.js` | 173 | 145 |
| `manage-prototype/routes/plugins.test.js` | 300 | 245 |
| `manage-prototype/dev-app.test.js` plugin section (lines 358-467) | 110 | 92 |
| `manage-prototype/dev-app.test.js` plugin-specific mocks (lines 6-7, 58, 72-82) | 14 | 13 |
| `manage-prototype/app.test.js` production-exposure tests (lines 79-93) | 15 | 13 |
| `tests/helpers/plugin-project.js` | 77 | 49 |
| `lib/plugins.test.js` display-name/proxy tests (lines 64-135) | 72 | 60 |
| `lib/plugins.test.js` cache tests (lines 876-903) | 28 | 17 |
| **Tests total** | **1,840** | **1,505** |
| **Data** | | |
| `known-plugins.json` (catalogue data) | 15 | n/a |

Note that the 90 code lines of `.govuk-prototype-kit-manage-prototype-plugin-*`
rules in `manage-prototype/assets/sass/manage-prototype.scss` (lines 135-237) are
leftover kit styles and are not referenced by `plugins.njk` or
`plugin-result.njk`, which use standard GOV.UK Frontend classes. Excluding them
would reduce Protato's direct management total to 652 code lines and its overall
management total to 737 code lines.

### Deliberately outside the totals

- **Plugin-provided template management**, because it creates pages from
  templates rather than installing/removing plugins: kit handler lines 200-409
  plus the three template views (285 code lines); Protato `routes/templates.js`,
  `routes/template-preview.js` and the three template views (211 code lines).
- **The rest of runtime plugin loading**: the remainder of the kit's
  `lib/plugins/plugins.js` plus `lib/plugins/plugins-routes.js` (152 code lines),
  and the remainder of Protato's `lib/plugins.js` (324 code lines). Framework
  wiring in `server.js`, `lib/build.js`, `lib/app.js` and the dev servers is not
  allocated to management.
- **Plugin-author tooling**: the kit's `lib/plugins/plugin-validator.js` (220
  code lines) plus 5 lines of `validate-plugin` CLI wiring. Protato has no
  equivalent.
- **General management and test scaffolding** that merely touches the plugins
  page: password/template handlers, CSRF middleware, home-page navigation,
  Cypress tests that only visit the plugins page, and the kit's other runtime or
  validator tests.
- **Fixtures and generated output**: `cypress/fixtures/plugins/**`,
  `cypress/temp/**`, `tmp/**`, coverage and compiled CSS.

## Verdict

Protato's plugin manager is **smaller, cleaner and in a few places safer than
the kit's**, and with CSRF protection and plugin updates now implemented it is
much closer to parity. For the install/update/uninstall flow we've built, the
core is better.

The remaining gaps are **runtime compatibility differences versus the kit** and
missing end-to-end coverage of a real npm install.

## Where Protato is better

| Area | Protato | Kit |
| --- | --- | --- |
| Running npm | `spawn` with an argument list, no shell, package name validated first (`lib/manage-plugins/npm.js`) | Builds a command string and runs it through `exec`, with package/version coming from the query/body |
| Protected plugins | Enforced in `plan.js`/server code (`protato` cannot be uninstalled or updated; `govuk-frontend` cannot be uninstalled, though it can be updated) | "Required" is mainly a UI restriction; the server only refuses uninstalling the kit itself |
| Concurrent changes | One-at-a-time lock in `change.js` | No equivalent lock |
| Listing & registry lookups | `listInstalledPlugins` is synchronous and local-only; `checkForUpdates` only fetches `/<pkg>/latest` for installed registry plugins (1-minute cache, 5s timeout, failures not cached, no tarball downloads) | Fetches the full registry document for every installed and available plugin, plus streams/untars `.tgz` tarballs into `tmp/caches` |
| Production exposure | Plugin routes aren't mounted at all | Management routes are mounted but gated with a "not available" page |
| Structure | `list` / `plan` / `npm` / `change` / `registry` / routes, easy to test | One very large handlers file plus registry, packages, tarball extractor, validator, routes and browser JS |
| Project view precedence | Project views explicitly first | Plugin views are before project views, so a plugin can override a project view |
| Safety on invalid input | Rejects anything that isn't a valid npm package name before npm runs | Relies on shell quoting; directly reachable URLs can pass versions/paths |
| Reporting a failed build after a change | npm success is reported as success, and a plugin that breaks the build is reported by the prototype's own error page (file, line, code snippet, full stack), with the manage UI still reachable on the dev server to uninstall it | Reports the outcome on its own confirmation/status page inside plugin management |

The npm-invocation difference is significant: the kit's approach is the more
dangerous one.

Post-change verification is deliberately not duplicated in Protato's plugin
flow. After an install or update the prototype rebuilds and restarts; if the
build fails, the prototype shows the error, which is where a developer needs to
see it anyway. A change cannot report success while hiding a build failure.

## Important things Protato has missed

### 1. CSRF protection — done

The kit applies `csrfProtection` to plugin GET/POST routes
(`lib/manage-prototype-routes.js:73,77`) and has a Cypress test for it.

Protato now does the same in the dev manage app, using the kit's library
(`csrf-csrf`, double submit cookie) in `lib/middleware/csrf.js`. Because Protato
renders plain forms rather than posting with `fetch`, the token is a hidden
`_csrf` field instead of the kit's `/csrf-token` endpoint and `X-CSRF-TOKEN`
header. It is mounted on the dev manage app as a whole, so every manage route is
protected by default, and the production 404s are unchanged.

The `/password` and `/clear-data` POSTs are deliberately not covered. A
cross-site POST there can only log someone in with a password the attacker
already knows, or clear data — and in production the session cookie's
`SameSite=Lax` default already stops the browser sending that POST with the
session. The plugin POSTs are the ones that matter, because they run npm and
therefore package install scripts.

While adding this we also fixed a dev server bug: `express.urlencoded` was
mounted on the whole `/manage-prototype` sub-app, so it consumed the body of any
POST that fell through to the prototype server's proxy. The proxy then forwarded
a request with a content length and no body, and the prototype server waited
forever. The visible symptom was the password page hanging in development —
marginal, because dev has no auth, but a proxy should never eat the body it is
forwarding. The dev server now sends the manage pages that the prototype server
owns (password, clear data, template previews) straight to it, before the dev
app sees them, so the dev app can parse bodies freely. Their paths are read from
the routes that register them (`pagePaths` and `templatePreviewPath`) rather
than repeated in a list. An unmatched
`/manage-prototype/*` path now 404s inside the dev app for the same reason:
after its body has been parsed there is nothing left to forward. The end-to-end
test POSTs to a proxied URL to keep that true.

### 2. Package watcher for manual npm changes — done

The kit watches `package-lock.json` and restarts/logs when plugins are added or
removed by hand (`plugins.watchPlugins`, `lib/dev-server.js`). Protato now does
the same, and slightly more:

- `lib/dev/watch.js` watches `package-lock.json`, as the kit does — npm always
  writes it, including for a version change that leaves `package.json` alone,
  and `awaitWriteFinish` avoids reading files mid-write.
- A change clears the plugin cache, rebuilds (a new plugin brings stylesheets,
  macros and base layouts, so a restart alone is not enough) and restarts the
  prototype through the same `rebuildAndRestart` the plugins page uses.
- It reloads the browser, so an open plugins page and prototype pick the change
  up. It logs the file event and the restart rather than diffing the plugin list
  the way the kit does.
- Unlike the kit it does not restart while a change made from the plugins page
  is running, and it no longer swallows a failed restart as an unhandled
  rejection.

Plan and reasoning: `docs/plugins-watcher-plan.md`.

### 3. Updates and version information — done

Protato now matches the kit's core update workflow:

- `lib/manage-plugins/registry.js` checks
  `https://registry.npmjs.org/<packageName>/latest` with a 5-second timeout and
  a 1-minute in-memory cache (`fetchLatestVersion`). Unlike the kit, it only
  queries the `/latest` endpoint for installed registry plugins, does not cache
  failures, and gracefully falls back offline.
- `checkForUpdates` in `lib/manage-plugins/list.js` marks `updateAvailable` and
  `latestVersion` on installed plugins, skipping uninstalled plugins, `protato`
  itself, and any non-registry dependency (`file:`, `github:`, `git+`, `link:`,
  `workspace:`, etc. via `semver.validRange`). `govuk-frontend` remains
  protected against uninstalling, but can be updated when a newer version is
  available.
- `manage-prototype/views/plugins.njk` displays the update count tag
  (`#plugins-updates-available-message`), `(version X.Y.Z available)` alongside
  the installed version, and an **Update** button (`POST /manage-prototype/plugins/update`).
- `planUpdate` and `updatePlugin` validate the request on the server, run
  `npm install <packageName>@<version> --save-exact` under the change lock, read
  the updated package's `govuk-prototype-kit.config.json` from `node_modules` to
  install any newly required `pluginDependencies` (`installMissingDependencies`),
  clear the registry and plugin caches, rebuild, and restart the prototype. Reading
  `pluginDependencies` from `node_modules` after updating avoids the kit's
  `lib/utils/requestHttps.js` tarball download and `tar-stream` extraction.

Remaining minor differences from the kit: Protato updates directly on POST
rather than showing a pre-update confirmation page, and does not have a
`showPrereleases` config option.

### 4. Plugin metadata

Protato uses `pluginConfig.meta.description`, falling back to the npm package's
`package.json` description. This matches the kit's use of `meta.description`,
and the built-in proxy configs now supply descriptions for packages that do not
ship a plugin config.

### 5. Runtime plugin compatibility gaps

These are adjacent to management but matter for running real prototypes:

- **No `/extension-assets` alias — deliberate.** The kit still serves the old
  URL (`lib/plugins/plugins-routes.js`). Nothing in `govuk-plugins` links to it:
  the only reference is hmrc-frontend's `$govuk-extensions-url-context: …
  !default` in `src/_prototype-kit.scss`, and Protato sets that variable to
  `/plugin-assets` in the generated `application.scss` (`lib/build.js`) before
  importing plugin sass, so the default never applies. A plugin that ships
  precompiled CSS with the old URL baked in would break, but none of the
  published plugins do.
- **No URL encoding of plugin paths.** The kit encodes each segment. Protato
  builds raw URLs. Spaces survive because browsers encode them, but `#`, `?` and
  `%` in a filename would silently 404. No plugin in `govuk-plugins` has such a
  path, so this is a latent risk rather than a known breakage.
- **No configurable `basePlugins`.** The kit reads `basePlugins` from config;
  Protato hardcodes `['protato', 'govuk-frontend']`.
- **No `pluginVersionSatisfies` global or legacy GOV.UK Frontend handling.**
  Existing plugins/templates that use these will behave differently.
- **Less forgiving/changed view precedence**, as noted above.

### 6. Likely Windows breakage in the npm runner

`npmCommand` is `npm.cmd` on Windows and is spawned with `shell: false`. Node
does not support launching `.cmd` files directly without a shell on Windows —
this path is likely to fail. The kit avoids this by using a shell/`exec` (with
its own injection trade-off). If Windows support matters, this needs a
`cmd.exe /c` or equivalent, while keeping arguments separate.

### 7. Smaller parity gaps

- No npm output when a change fails: `runNpm` uses `stdio: 'ignore'`
  (`lib/manage-plugins/npm.js`), so a failed install reports "could not be
  installed" with no reason. The kit runs npm through `exec` and shows the
  output.

- Fewer display-name special cases: kit has `moj`, `ho`, `ons` as well.
- No `validate-plugin` CLI for plugin authors (the kit's validator checks keys,
  paths, macros and `meta.urls`).
- Cannot install a specific version. The kit accepts `?version=` on its install
  and update URLs, validated against the registry's version list, but no page
  links to it, so it is only reachable by typing the URL or from automation.
  Pinning by hand with `npm install <package>@<version>` works in both, and the
  watcher picks it up.
- Local `file:` plugins are installed from a terminal in both tools, not the UI.
  Protato already handles the result: it shows the installed version, never
  offers an update for a non-registry dependency, and uninstalls it. The kit
  also carries the local version in its uninstall link.
- Cannot uninstall `govuk-frontend` even with an
  `allowGovukFrontendUninstall`-style option. The kit explicitly supports and
  tests that. This is a deliberate Protato decision, not an accident.
- Only direct dependents are removed on uninstall. The kit is the same, so this
  is parity, not a regression.

### 8. Test coverage

Our unit tests around the plugin internals are good — probably better than the
kit's for pure functions. But we have **no end-to-end test that really
installs/updates/uninstalls a plugin via npm, rebuilds and restarts**. The kit
has an extensive Cypress plugin suite covering install, update, uninstall,
reinstall, dependency installation, CSRF, mismatches and removing GOV.UK
Frontend. Our CSRF protection is covered by unit tests and an end-to-end test of
creating a page from a template, but there is still nothing that installs or
updates a plugin through the UI, so broken route wiring, restart failures and
Windows behaviour are not covered.

## What to fix first

1. Add a real end-to-end install/update/uninstall test.
2. URL-encode plugin asset paths, if a plugin ever ships a filename with `#`,
   `?` or `%` in it.

`..` filtering is now done, in `normaliseConfigPath`. The `/extension-assets`
alias is deliberately not coming back (see above).

So: **Protato is better engineered and safer at the npm boundary, and now covers
install, update and uninstall with CSRF protection and manual package-change
detection. What is left is mostly runtime compatibility with existing plugins,
and end-to-end coverage.**
