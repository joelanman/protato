# Plan: watch package files for manual plugin changes

Gap 2 in `docs/govuk-plugins-compare.md` (and item 1 in "What to fix first").
Today the dev watcher only watches `app/` and `.env` (`lib/dev/watch.js`), so a
plugin installed from a terminal is invisible until the dev server is restarted
by hand: the prototype server keeps its old plugin list, and the plugin cache in
the dev process is stale, so nothing rebuilds.

## Target behaviour

When `package.json` or `package-lock.json` in the project root changes:

1. Clear the plugin cache (`plugins.clearCache()`).
2. Rebuild, not just restart — a new plugin brings stylesheets, macros and base
   layouts, so `buildPrototype()` (not `processSass()`) has to run.
3. Restart the prototype server so the child process re-reads plugin configs.
4. Log which plugins were added or removed.
5. Reload the browser (livereload), so the plugins page and prototype pick up
   the change.

Not in scope: running `npm install` for us. The watcher reacts to package files
changing; if `package.json` lists a package that is not in `node_modules`, the
plugins page already reports it as not installed (`lib/manage-plugins/list.js`).

## How govuk-prototype-kit does it (14.0.2, `3ab8cab9`)

Worth copying, and worth not copying:

- `plugins.watchPlugins` (`lib/plugins/plugins.js:252-283`) watches
  **`package-lock.json` only**, with `ignoreInitial`, `disableGlobbing` and
  `awaitWriteFinish`, on `'change'` events.
- On every event it recomputes the plugin list (`package.json` dependencies
  filtered by the plugin config file existing in `node_modules`) and diffs it
  against a module-level snapshot. The diff is used **for logging only**:
  `afterWatch({ missing, added })` is called unconditionally.
- `lib/dev-server.js:76-84` then logs the same thing again and fires
  `nodemonInstance.emit('restart')`. So the restart is unconditional, and
  duplicate log lines are a kit wart.
- It has no plugin cache to clear, and its restart is a whole-kit nodemon
  restart, so its sass build re-runs on start. Protato keeps the dev server
  alive, which is why this plan has to rebuild explicitly.
- Nodemon gives it restart coalescing for free, and `awaitWriteFinish` avoids
  reading a half-written lockfile.

## 1. Watch the two files — `lib/dev/watch.js`, `lib/paths.js`

- Add `paths.packageJson` and `paths.packageLockFile` to `getPaths()`
  (`path.join(paths.project, 'package.json')` and `package-lock.json`).
  `paths.package` already exists but means the protato package directory, so the
  new names must not reuse it.
- Add `watchPlugins()` alongside `watchSass()` / `watchBackend()` /
  `watchFrontend()`: **one** chokidar watcher on both files, with
  `{ ignoreInitial: true, disableGlobbing: true, awaitWriteFinish: true }`, and a
  **single** debounced action.

One watcher, not two: `npm install` writes both files, and a debounce per file
would mean two rebuilds and two restarts per install. `awaitWriteFinish` (as the
kit uses) covers the rest — npm writes these files non-atomically, and
`readProjectDependencies()` (`lib/manage-plugins/list.js:39`) throws on a
half-written `package.json`.

### Why both files

`package-lock.json` is the file that matters. It is what npm always writes, and
it is the only signal for a change that leaves `package.json` alone:
`npm update`, or `npm install <pkg>@latest` when the declared range already
satisfies the newer version. Those do change the installed version in
`node_modules`, which is precisely when the prototype has to reload plugins and
rebuild. Watching `package.json` instead would miss it.

`package.json` adds little on its own — a hand-edit with no install restarts the
prototype to no effect (see known limits), and if the user then runs
`npm install`, the lock changes anyway. It is watched for two smaller reasons:
the optional "listed but not installed" warning in step 6 needs a `package.json`
event, and it does not depend on npm's choice of which file to rewrite. The kit
watches the lockfile alone, so the minimal version of this work is the same:
watch `package-lock.json` only and drop step 6.

Do not use "did `package.json` change" to decide whether a version changed: npm
rewrites it even when the content is identical (a `^1.2.3` range stays
`^1.2.3`), so the lockfile is the reliable trigger.

## 2. Share the rebuild/restart step — export it from `change.js`

`lib/manage-plugins/change.js` already has exactly this sequence as
`restartWithRebuild()` inside `runChange`. Lift it out and export it, rather
than copying it into `watch.js` or adding a module of its own:

```js
// Clear the plugin cache, rebuild everything a plugin can contribute, then
// restart the prototype so it loads the new plugins.
async function rebuildAndRestart() {
	plugins.clearCache()
	buildPrototype()
	await supervisor.restartPrototypeServer()
}
```

- `change.js`: move the body of `restartWithRebuild` into `rebuildAndRestart`
  and export it; the install/update/uninstall paths call it where they called
  `restartWithRebuild`.
- `watch.js`: `import { isChangeRunning, rebuildAndRestart } from
  '../manage-plugins/change.js'`.

No new file: the watcher needs `isChangeRunning` from this module anyway for the
skip guard, and that guard only works because both the dev manage app and the
watcher see the same module instance. That makes `change.js` the natural home for
the rebuild step too. It also avoids a cycle — `lib/build.js` importing
`supervisor.js` would be circular, since `supervisor.js` already imports
`build.js`.

Keeping it in one place is the point: a change made from the UI and a change made
in a terminal must do the same work.

## 3. Say what changed — `lib/dev/watch.js`

Keep a snapshot of plugin package names (`plugins.getPlugins()` after clearing
the cache is the fresh list) and, when it differs, log once:

```
Added plugin: @x/y
Removed plugin: @x/y, @a/b
```

This is the kit's one genuinely useful behaviour here: without it the prototype
restarts with no explanation, which is exactly the confusion this work is meant
to remove. Log once — the kit logs twice (in `watchPlugins` and again in its
dev-server callback).

## 4. Stop the watcher and the UI change fighting

`npm install` from `/manage-prototype/plugins` also writes these two files, so
without coordination the watcher fires mid-change. Worst case: the watcher's
restart lands while `installMissingDependencies` is still writing
`node_modules`, the prototype comes up with a half-installed plugin, shows an
error page — and then the change flow restarts it again.

Two small guards, both worth having:

- **Skip while a change is running.** `lib/manage-plugins/change.js` already
  holds `changeRunning` for the one-at-a-time lock; export `isChangeRunning()`.
  The plugins action returns early when it is true, because the change flow does
  its own rebuild and restart. A change that finishes just after an event slips
  through and restarts twice — cheap, and correct.
- **Coalesce restarts in the supervisor.** `restartPrototypeServer()` does
  `stop` then `start`, so two overlapping calls can interleave a stop between
  another call's stop and start, leaving no server or an `EADDRINUSE`. Track the
  in-flight restart and, if another is requested while it runs, run **one** more
  when it finishes (the newest `buildResult` wins) — the same coalescing nodemon
  gives the kit, rather than a queue of N restarts. This also fixes the race that
  exists today between `watchSass` and `watchBackend`, which can both restart
  within 200 ms of each other.

## 5. Do not swallow restart failures — `lib/dev/watch.js`

`watchSass` and `watchBackend` both `await supervisor.restartPrototypeServer()`
with no `try/catch`, so a failed start becomes an unhandled rejection in a
debounced callback, where nothing sees it. With the watcher handling more
restarts, wrap the call sites (or just the shared step) so a failure is logged as
`Could not restart the prototype: <message>` and the watcher keeps running.
Same concern already noted for `change.js` in the comparison doc; fix it here
where it is cheapest.

## 6. Optional: tell the user when the dependency is not installed

After a `package.json` change, if a dependency is missing from `node_modules`,
log a line such as `package.json lists <name> but it is not installed - run npm
install`. `lib/manage-plugins/list.js` already knows how to check this
(`isInstalled`); it is a nicer message than a plugin silently not appearing.
Small, and can be dropped if it complicates the watcher.

## Tests — `lib/dev/watch.test.js`, `lib/dev/supervisor.test.js`

Update, rather than add to, what is there:

- `watches sass, backend files and frontend files` → add the fourth watcher
  assertion (both package files, the new watch options).
- New: changing `package.json` clears the plugin cache, rebuilds, restarts and
  reloads (mock `../manage-plugins/change.js` and assert `rebuildAndRestart` was
  called).
- New: changing `package-lock.json` does the same.
- New: logs added and removed plugin names.
- New: no rebuild/restart while `isChangeRunning()` is true.
- New: a rejected restart is logged and does not throw (`settle()` + a spy on
  `console.error`).
- Supervisor: two `restartPrototypeServer()` calls in flight fork twice (not
  three times) and the second start happens only after the first child is up.

## Order of work

1. Export `rebuildAndRestart` + `isChangeRunning` from `change.js` and use them
   there (no behaviour change; existing tests keep passing), then the watcher.
2. Supervisor restart coalescing + its test.
3. `watchPlugins()` with paths, the skip guard, added/removed logging, failure
   logging, tests.
4. Optional missing-dependency log.

Small: roughly 40–60 code lines and about 120 test lines. Verify with
`npm run test:unit`, then by hand: run the starter, `npm install` a plugin in
another terminal, and check the console names the plugin, the prototype
restarts, the plugins page lists it, and installing the same plugin through the
UI does not restart twice.

## Known limits (fine to leave)

- Hand-editing `package.json` to add a plugin without installing it restarts the
  prototype to no effect (beyond the optional warning). The kit behaves the same
  way: its plugin list requires the plugin config file to exist.
- A change to a plugin's own `govuk-prototype-kit.config.json` inside
  `node_modules` is not picked up; `node_modules` is not watched, by design.
- Reinstalling an unrelated dependency restarts the prototype. Harmless, and
  what the kit does too — the alternative is diffing the dependency list to
  decide.
