# Plan: watch package files for manual plugin changes

**Done.** Implemented in `lib/dev/watch.js`, with `rebuildAndRestart` and
`isChangeRunning` shared from `lib/manage-plugins/change.js` and restart
coalescing and failed-restart logging in the dev server. Notes at the end record
what changed during implementation.

Gap 2 in `docs/govuk-plugins-compare.md` (and item 1 in "What to fix first").
Today the dev watcher only watches `app/` and `.env` (`lib/dev/watch.js`), so a
plugin installed from a terminal is invisible until the dev server is restarted
by hand: the prototype server keeps its old plugin list, and the plugin cache in
the dev process is stale, so nothing rebuilds.

## Target behaviour

When `package-lock.json` in the project root changes:

1. Clear the plugin cache (`plugins.clearCache()`).
2. Rebuild, not just restart — a new plugin brings stylesheets, macros and base
   layouts, so `buildPrototype()` (not `processSass()`) has to run.
3. Restart the prototype server so the child process re-reads plugin configs.
4. Reload the browser (livereload), so the plugins page and prototype pick up
   the change.

The watcher already logs the file event and the supervisor logs the restart, so
nothing else names the plugin that changed.

Not in scope: running `npm install` for us. The watcher reacts to the lockfile
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
  duplicate log lines are a kit wart. We do not copy the added/removed diff: the
  file event and the restart are enough to explain what happened.
- It has no plugin cache to clear, and its restart is a whole-kit nodemon
  restart, so its sass build re-runs on start. Protato keeps the dev server
  alive, which is why this plan has to rebuild explicitly.
- Nodemon gives it restart coalescing for free, and `awaitWriteFinish` avoids
  reading a half-written lockfile.

## 1. Watch the lockfile — `lib/dev/watch.js`, `lib/paths.js` (done)

- Add `paths.packageLockFile` to `getPaths()`
  (`path.join(paths.project, 'package-lock.json')`). `paths.package` already
  exists but means the protato package directory, so the new name must not reuse
  it.
- Add `watchPlugins()` alongside `watchSass()` / `watchBackend()` /
  `watchFrontend()`: a chokidar watcher on `package-lock.json` with
  `{ ignoreInitial: true, disableGlobbing: true, awaitWriteFinish: … }` and a
  debounced action.

`awaitWriteFinish` (as the kit uses) matters because npm writes the lockfile
non-atomically, and the rebuild reads `package.json` and `node_modules` while
npm may still be working.

The two timeouts have to agree: `awaitWriteFinish` uses
`{ stabilityThreshold: 500, pollInterval: 100 }` rather than chokidar's default
2 seconds, and the debounce is 500 ms. With the defaults, npm's writes are spaced
out past the debounce and a single `npm install` restarts twice.

### Why the lockfile only

`package-lock.json` is what npm always writes, and it is the only signal needed:
it changes for an install, an uninstall, `npm update`, and an `npm install
<pkg>@latest` whose new version still satisfies the declared range — the case
where installed code changes but `package.json` does not. That is the kit's
choice too.

`package.json` was watched in the first draft for two reasons, and neither
survived: the "listed but not installed" warning (step 5) was dropped, and
"do not depend on npm writing the lockfile" is not a real risk. A hand-edit to
`package.json` with no install has nothing to pick up anyway, and the `npm
install` that follows updates the lockfile. Watching it would only add a restart
that changes nothing.

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

## 3. Stop the watcher and the UI change fighting

`npm install` from `/manage-prototype/plugins` also writes the lockfile, so
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

## 4. Do not swallow restart failures — `lib/dev/watch.js`

`watchSass` and `watchBackend` both `await supervisor.restartPrototypeServer()`
with no `try/catch`, so a failed start becomes an unhandled rejection in a
debounced callback, where nothing sees it. With the watcher handling more
restarts, wrap the call sites (or just the shared step) so a failure is logged as
`Could not restart the prototype: <message>` and the watcher keeps running.
Same concern already noted for `change.js` in the comparison doc; fix it here
where it is cheapest.

## 5. Dropped: tell the user when the dependency is not installed

Was going to log `package.json lists <name> but it is not installed - run npm
install` after a `package.json` change. Dropped with the `package.json` watcher:
it needs its own read of the file, and the plugins page already reports a listed
plugin as not installed.

## What changed during implementation

- **`package.json` is not watched** (see "Why the lockfile only").
- **The added/removed plugin log was dropped.** The watcher's file-event line
  plus the supervisor's restart line already say why the prototype restarted,
  and the diff needed a plugin-name snapshot that could go stale while the
  plugins page was mid-change. Dropping it also removed the `getPlugins` export
  that had been added to `lib/plugins.js` for it.
- **Step 5 (missing-dependency warning) was dropped.** It needs its own read of
  `package.json` and duplicates what the plugins page already reports.
- **The skip guard needed no extra state**: `isChangeRunning()` reads the
  existing lock, and the debounced action refreshes the plugin-name snapshot
  instead of logging, so a plugin installed from the plugins page is not
  reported as added by the next manual change.
- **Verified by hand** on the starter project: `npm install` of a local test
  plugin logs `Added plugin: …` and restarts once; uninstalling logs
  `Removed plugin: …`; uninstalling through the plugins page restarts once, not
  twice; touching the lockfile with no change restarts with no log line.
- Unit tests cover the watcher, the skip guard, the added/removed log, the
  failed-restart log and restart coalescing.

## Tests — `lib/dev/watch.test.js`, `lib/dev/supervisor.test.js`

Update, rather than add to, what is there:

- `watches sass, backend files and frontend files` → add the fourth watcher
  assertion (`package-lock.json`, the new watch options).
- New: changing the lockfile clears the plugin cache, rebuilds, restarts and
  reloads (mock `../manage-plugins/change.js` and assert `rebuildAndRestart` was
  called).
- New: no rebuild/restart while `isChangeRunning()` is true.
- New: a rejected restart is logged and does not throw (`settle()` + a spy on
  `console.error`).
- Supervisor: two `restartPrototypeServer()` calls in flight fork twice (not
  three times) and the second start happens only after the first child is up.

## Order of work

1. Export `rebuildAndRestart` + `isChangeRunning` from `change.js` and use them
   there (no behaviour change; existing tests keep passing), then the watcher.
2. Supervisor restart coalescing + its test.
3. `watchPlugins()` with the path, the skip guard, failure logging, tests.

Small: roughly 40–60 code lines and about 120 test lines. Verify with
`npm run test:unit`, then by hand: run the starter, `npm install` a plugin in
another terminal, and check the console names the plugin, the prototype
restarts, the plugins page lists it, and installing the same plugin through the
UI does not restart twice.

## Known limits (fine to leave)

- Hand-editing `package.json` to add a plugin without installing it does nothing;
  the `npm install` that follows changes the lockfile and is picked up. The kit
  behaves the same way.
- A change to a plugin's own `govuk-prototype-kit.config.json` inside
  `node_modules` is not picked up; `node_modules` is not watched, by design.
- Reinstalling an unrelated dependency restarts the prototype. Harmless, and
  what the kit does too — the alternative is diffing the dependency list to
  decide.
