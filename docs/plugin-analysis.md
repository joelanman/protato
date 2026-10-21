# Plugin management: Protato vs GOV.UK Prototype Kit

A comparison of Protato's plugin management UI with the equivalent feature in
`../govuk-prototype-kit`. It covers what each one does, how the code is
structured, and where they differ in behaviour.

Line counts are physical line counts from `wc -l`, so comments and blank lines
are included. They measure size, not complexity.

## Bottom line

Both solve the same top-level job: install, update and uninstall plugins from a
local development-only management UI. They do not have the same scope.

- **Protato** implements a registry client, a dependency planner, an npm runner
  and a dev-server coordinator, behind a server-rendered confirm flow.
- **The kit** implements a package cache, a page that renders command strings,
  an `exec()` call and a browser polling loop that infers completion after the
  kit restarts.

Protato is the more trustworthy and more testable design. The kit is easier to
read end to end.

## Plugin management line counts

| Area | Protato | Kit |
| --- | ---: | ---: |
| Listing (`lib/manage-plugins/list.js`) | 151 | handler, 344 |
| Planning (`lib/manage-plugins/make-plan.js`) | 513 | planner, 278 |
| npm execution (`lib/manage-plugins/run-plan.js`) | 109 | inside the handler, via `exec` |
| npm registry client (`lib/npm-registry.js`) | 229 | inside `packages.js` and `lib/utils/requestHttps.js` |
| HTTP route (`manage-prototype/routes/plugins.js`) | 116 | inside the handler |
| Views | 235 | 282 |
| Browser script | 0 | `manage-plugins.js` 172 |
| **Production total** | **1,353** | **1,076** |
| Unit and integration tests | 2,019 | 583 |
| Cypress e2e and fixtures | 0 | 1,468 |
| **Test total** | **2,019** | **2,051** |
| Test lines per production line | 1.49 | 1.91 |

Both figures exclude the runtime plugin loader and validator, which sit next to
but outside the management path. Protato's shared runtime loader is
`lib/plugins.js`; it also reads proxy configs for the management page.

The largest remaining Protato module is the planner. It is larger than the
kit's planner because it does work the kit does not: constraint-based dependency
planning, transitive dependent removal and dependency downgrades. The planner
keeps its install state in one place, resolves dependencies in one pass and
reports a late conflict rather than re-planning to a fixed point. Dependency
declarations are parsed and validated inside the planner, next to the code that
uses them. The registry client is separate and handles bounded HTTPS downloads
and in-memory archive config extraction.

The registry client is npm access only. It returns the raw plugin config and
does not read or validate plugin dependencies. Proxy configs are resolved by
`lib/plugins.js`, read once per request, and only apply when a package ships no
config of its own. The planner uses them for the target and for its
dependencies, so a package such as `jquery` can be planned without an npm
archive. The registry cache therefore cannot go stale when
`app/plugin-proxy.json` changes.

## What each one does

| Capability | Protato | Kit |
| --- | --- | --- |
| Known list | Suggestions only: listed packages are shown uninstalled, plus any installed plugin | Suggestions only in the list/search UI |
| Search and available vs installed | One list, no search | Separate "Find plugins" and "Installed plugins" pages, search box |
| Install / update / uninstall | Yes | Yes |
| `pluginDependencies` | `minVersion`/`maxVersion` checking, missing dependencies, conflicts, cycles, dependency downgrades, recursive uninstall of dependents | Direct missing deps only; installed deps are not checked against constraints; dependents only one level deep |
| Proxy plugin configs | `jquery` and `notifications-node-client` built in, plus `app/plugin-proxy.json` | Built in, plus `app/plugin-proxy.json` |
| Preview before mutation | Exact plan: every version change, reason (`requested`/`dependency`/`dependent`), "needed by", downgrades | Names of dependency/dependent plugins, no versions |
| Execution | Stops the prototype child, runs npm with argv, clears caches, rebuilds, restarts, returns the real result | Builds a shell string, `exec()`, forces `process.exit(1)`, relies on nodemon to restart |
| Progress | Synchronous POST then 303 redirect | AJAX polling on `/plugins/:mode/status`, 30s timeout, restart detection |
| No-JS fallback | Works: plain forms | Shows manual terminal instructions |
| Request protection | Form token | `csrf-csrf` double-submit |
| Version policy | Registry `latest` stable, pinned exactly; no prereleases, no version picker, no downgrade action | Latest, optional prereleases; local, GitHub and proxy plugin configs |
| Metadata shown | Installed/latest versions, protected/read-only diagnostics | Description, scope, help link, update count |
| Unknown/local plugins | Shown with diagnostics | Shown if installed or available |
| Templates integration | No | Templates page links into plugin install/update |

Both list suggested plugins and protect the kit itself from uninstall. Beyond
that the policies diverge.

## Architecture

### Protato

```
manage-prototype/routes/plugins.js
        ├─→ lib/manage-plugins/list.js ──→ lib/npm-registry.js
        │                              └─→ lib/plugins.js
        └─→ lib/manage-plugins/make-plan.js ──→ lib/manage-plugins/list.js

lib/dev-server.js
        └─→ lib/manage-plugins/run-plan.js ──→ lib/manage-plugins/list.js
```

Request flow:

1. `GET /plugins` runs `listPlugins()` in `list.js`, which reads project state
   from disk, fetches registry versions in parallel and computes the actions
   each entry allows.
2. `GET /plugins/confirm` runs `makePluginPlan()` in `make-plan.js` and
   renders the exact plan. The planner reads plugin entries from `list.js`.
3. `POST /plugins/confirm` re-runs `makePluginPlan()` and blocks if the plan
   has problems, then calls `devServer.updatePlugins(plan)`, which runs
   `runPluginPlan(plan)` in `run-plan.js`.

The plan is one `{ action, packageName, pluginName, publisher, version, ok,
noop, changes, problems }` object used by both the confirm view and the runner.
Registry failures become a 503, policy refusals become a 400, and a plan with
blocking problems becomes a 409. An unreadable installed plugin config is
treated as having no dependencies and is reported on the plugin, rather than
blocking every plan. The POST re-plans, so it does not fingerprint the plan the
user saw; a registry change between the two requests can still produce a
different, valid plan.

Dependency planning covers the cases the real plugin data uses: a missing
dependency, a dependency below `minVersion` or above `maxVersion`, conflicts
with constraints from other installed plugins, dependency cycles that terminate
through a visited set, and recursive removal of dependents. There is no
fixed-point re-planning loop.

`devServer.updatePlugins()` stops the prototype child, runs npm, clears the
plugin cache, rebuilds Sass and layouts, starts the child again and reloads. The
management UI runs in the parent process, so it stays up throughout.

### Kit

```
lib/manage-prototype-routes.js
        ↓
lib/manage-prototype-handlers.js (plugin section ~400 lines)
        ↓
lib/plugins/packages.js (278) → packagesCache (module scope, 1 min TTL)
        ↓
lib/plugins/plugins.js (448, display formatting and runtime loader)
        ↓
lib/exec.js → shell command → nodemon restart
```

Request flow:

1. `GET /plugins` or `/plugins-installed` renders a list from a package cache.
2. `GET /plugins/:mode?package=…` renders a confirmation page with dependency
   names and a generated shell command.
3. `POST /plugins/:mode` (JSON, CSRF-protected) runs the command. The response
   is immediate with `status: 'processing'`.
4. The browser polls `POST /plugins/:mode/status` until `kitRestarted` is true
   and the installed version matches the requested target, then shows
   "complete".

Without JavaScript, `postPluginsModeMiddleware` redirects the POST to the GET
page, which shows the manual command to run in a terminal.

## Where Protato is better

- **One module per use case.** `lib/plugins.js` reads configs for the runtime,
  `lib/npm-registry.js` only talks to npm, and `lib/manage-plugins/` splits the
  management path into `list.js`, `make-plan.js` and `run-plan.js`.
- **The planner is testable.** Constraint and cycle handling runs against a
  temporary project of real files and a stubbed registry module, without
  network or npm.
- **No shell strings.** `runPluginPlan` builds argv with package-name
  validation, protected-package checks and exact versions.
- **No module-level reads of project state.** The kit's `packages.js` reads the
  project package once at load time, so its view of installed versions is stale
  until the process restarts. Protato re-reads the project on every request.
- **Diagnostics over exceptions.** A corrupt config becomes a visible message on
  the page instead of a failed request.
- **Eligibility is computed once per entry.** `buildPluginEntry` decides
  `protectedPackage` and `readOnly`, `getActions` turns those into the buttons
  and the action planner reads the same fields, so they cannot disagree.
- **Proxy configs reuse the runtime loader.** The management page and the
  runtime share `readInstalledPackage`, so their view of plugin configs cannot
  drift.

## Where the kit is easier

- **The whole flow is legible in one sitting.** List → confirm → poll is easy to
  hold in your head.
- **Smaller functions and modules.** The kit's package lookup is spread across a
  few short functions, while Protato has a larger planner and registry client.
- **Template macros.** The kit reuses `govukButton`; Protato hand-writes three
  near-identical `<form>` blocks in `plugins.njk`.
- **A real no-JS story.** The kit degrades to manual instructions. Protato is
  server-rendered, so it does not need one, but its "The form has expired"
  message is inaccurate: the token is generated once at module load and never
  expires or rotates.

## Deliberately not copied from the kit

- The shell command builder.
- The process-wide package cache.
- The restart-flag completion model.
- The handler monolith.
