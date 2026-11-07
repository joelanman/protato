# Test changes plan

A unified plan for cleaning up, standardising and completing Protato's test
suite.

This combines an audit of the existing unit, end-to-end and browser suites with
a gap analysis against the GOV.UK Prototype Kit tests.

## Summary

Keep three test layers, with a strict boundary between them:

1. **Vitest unit tests** (`lib/`, `prototype/`, `manage-prototype/`, `plugin/`,
   `scripts/`) for pure logic, config/path rules, and fast Express or Nunjucks
   contracts against temporary directories.
2. **Vitest end-to-end tests** (`tests/*.test.js`) for real server processes,
   HTTP, rendered HTML, file watching/restarts, and local-registry npm changes.
3. **Playwright tests** (`tests/playwright/*.spec.js`) **only** when the browser
   itself is the subject under test.

### Layer decision rule

Use Playwright only when at least one of these is true:

- CSS is applied and computed styles or fonts matter;
- client-side JavaScript or an ES module must execute;
- a real form submission, click, navigation or DOM event is the subject;
- live reload over the browser `EventSource` connection is the subject;
- the risk is in the browser wiring rather than the HTTP response.

Use Vitest end-to-end when the contract is HTTP, HTML, Nunjucks, filesystem
changes, npm or a server restart. Use a unit test when the behaviour is a pure
function, path/config lookup, error formatter or isolated router/middleware
contract.

### Design rules across the suite

1. **Prefer real temporary projects and real Express/Nunjucks instances** over
   top-of-file `vi.mock('node:fs')`, `vi.mock('nunjucks')` and `vi.mock('sass')`
   call-order assertions.
2. **Test Protato's contract, not third-party internals or package contents.**
3. **Assert each rule once, at the cheapest layer that can prove it.**
4. **Share server, port, temporary-project and CSRF helpers**, and use retrying
   assertions (`expect.poll`, `openPage`) rather than fixed sleeps.

---

## Work by phase

Each phase leaves the test suite green on its own. Cleaning up existing tests
and shared helpers first (Phases 1–3) means the new plugin and watcher suites in
Phase 4 can build on clean foundations instead of copying old boilerplate.

### Phase 1: fix test bugs and close unit gaps in Protato code

#### 1a. Fix leaked state in `lib/dev/livereload.test.js`

`lib/dev/livereload.js` stores connected responses in a module-level `clients`
array with no reset helper. The first four tests push five mock responses into
`clients` without emitting `close`, so `handles empty clients array gracefully`
runs with five leaked clients and never exercises the empty-array branch.

- Add a small `clearClients()` export (matching `clearCache()` elsewhere) or use
  `vi.resetModules()` in `beforeEach`.
- Remove leftover boilerplate comments (`// adjust path as needed`).

#### 1b. Add `manage-prototype/routes/session.test.js`

`manage-prototype/routes/session.js` has no unit tests, including the
`getSafeReturnURL` open-redirect check.

Cover:

- `getSafeReturnURL` accepting relative paths (`/page?a=1`) and falling back to
  `/` for protocol-relative URLs (`//evil.com`), external URLs
  (`https://evil.com`), `/manage-prototype/password` redirect loops, and
  non-string values;
- `POST /password` storing the password in session and redirecting to the safe
  return URL when valid;
- `POST /password` redirecting back to
  `/manage-prototype/password?error=wrong-password&returnURL=...` when invalid;
- `GET /clear-data` and `POST /clear-data` clearing `request.session.data` and
  rendering the confirmation view.

#### 1c. Add unit tests for the public API and built-in Nunjucks helpers

The GOV.UK Prototype Kit tests its public view/router API directly; Protato
currently only touches it indirectly through a CommonJS end-to-end fixture.

Add:

- `index.test.js`: `init`, `requests.setupRouter`, `views.addFilter` (including
  `renderAsHtml` wrapping Nunjucks' `safe` filter), `views.getFilter`,
  `views.addFunction` and `views.getFunction` against a real Express app and
  Nunjucks environment;
- `plugin/filters.test.js`: `log` and `formatItems` (single string and array);
- `plugin/functions.test.js`: `checked` (missing `data`, simple value, array,
  and dotted or bracket paths).

#### 1d. Add `scripts/create.test.js`

Test `create()` against real temporary directories:

- copies `starter/` into a new path or an existing empty directory;
- refuses to overwrite a non-empty directory;
- refuses when the target path is an existing file.

---

### Phase 2: remove third-party tests and overlapping assertions

#### 2a. Replace the upstream snapshot in `lib/plugins.test.js`

`lib/__snapshots__/plugins.test.js.snap` snapshots all 39 component macros from
`govuk-frontend` and all 9 templates and Sass paths from
`@govuk-prototype-kit/common-templates` (with a stale `'govuk-frontend':
'5.11.2'` version string in the test). Any minor `govuk-frontend` update that
adds a component breaks Protato's unit tests without any Protato code changing.

- Delete `lib/__snapshots__/plugins.test.js.snap`.
- Replace the snapshot test at the end of `lib/plugins.test.js` with direct
  assertions against Protato's own `govuk-prototype-kit.config.json`: every path
  it declares exists on disk and resolves to the expected
  `/plugin-assets/govuk-prototype-kit/...` URLs and shadow layout paths.

#### 2b. Slim `manage-prototype/csrf.test.js` to Protato's wrapper contract

`manage-prototype/csrf.js` configures `csrf-csrf` in ~30 lines. Keep tests for
Protato's own configuration:

- cookie attributes (`protato.csrf`, `HttpOnly`, `SameSite=Lax`,
  `Path=/manage-prototype`, and `Secure` driven by `config.isSecure`);
- safe methods (`GET`, `HEAD`, `OPTIONS`) setting `response.locals.csrfToken`
  and calling `next()`;
- token stability across requests;
- accepting a valid `_csrf` body field with matching cookie, and rejecting a
  missing token or header-only token (`x-csrf-token`);
- invalidating existing tokens when `CSRF_SECRET` changes.

Remove tests of `csrf-csrf` internals (matching its `hmac.random` hex regex,
splitting on `.` to tamper with the random half, and forging matching
cookie/body HMACs), and update `manage-prototype/app.test.js` to read the token
from rendered HTML rather than `cookie.split('=')[1]`.

#### 2c. Decouple unit tests from curated JSON lists and palette values

- In `lib/manage-plugins/list.test.js` and
  `lib/manage-plugins/registry.test.js`, prefer synthetic fixture plugins over
  hardcoding specific packages from `data/known-plugins.json` (`hmrc-frontend`,
  `accessible-autocomplete`, `notifications-node-client`), keeping one focused
  test that `data/known-plugins.json` and `data/plugin-proxy.json` load cleanly.
- Keep `hasNewVersion` and `isRegistryDependency` tests in
  `lib/manage-plugins/registry.test.js` brief rather than enumerating `semver`
  schemes.
- In `tests/server.test.js`, keep the `pkg:govuk-frontend` Sass test to prove
  `NodePackageImporter` is wired, without coupling to GOV.UK Frontend's exact
  `#0f7a52` green hex code.

#### 2d. Deduplicate plugin precondition tests (`npm` → `plan` → `change` → `routes`)

Invalid package names, protected packages (`protato`, `govuk-frontend`),
`noChange` states and dependent uninstalls are currently tested four times.

Keep one owner per concern:

- `lib/manage-plugins/npm.test.js`: `isValidPackageName` and `runNpm`.
- `lib/manage-plugins/plan.test.js`: all install, uninstall and update
  preconditions (`failed`, `noChange`, `ok`, dependent package lists).
- `lib/manage-plugins/change.test.js`: one test per action proving non-`ok`
  plans short-circuit before `runNpm`, plus orchestration (`runNpm` arguments,
  `installMissingDependencies`, `rebuildAndRestart`, `npmFailure` output, and
  one `runChange` busy-lock test instead of repeating it per action).

#### 2e. Consolidate `manage-prototype` route tests and render real Nunjucks views

`manage-prototype/app.test.js` and `manage-prototype/routes/plugins.test.js`
both stub `res.render` into `"${view} ${JSON.stringify(model)}"`, duplicate
`GET /plugins` and `POST /check-for-updates` tests, and leave `manage-prototype`
`.njk` templates unrendered in unit tests.

- Render real `manage-prototype/views/*.njk` templates in route tests using
  `managePrototypeNunjucks` so template syntax, headings, form actions and
  conditional outcomes (`plugin-result.njk`, `templates/*.njk`, `password.njk`,
  `form-expired.njk`) are exercised directly.
- Split responsibilities cleanly:
  - `manage-prototype/app.test.js`: Nunjucks globals, static mounts, development
    vs production route mounting, 404/error handling, and **one** CSRF rejection
    check (replacing the four per-route repeats).
  - `manage-prototype/routes/session.test.js`: password and clear-data routes.
  - `manage-prototype/routes/templates.test.js`: extracted from `app.test.js`.
  - `manage-prototype/routes/plugins.test.js`: plugin list, action buttons and
    POST outcome pages (deleting `describe('removed confirmation routes')`).

#### 2f. Move HTML-only error checks out of Playwright and trim duplicates

`tests/playwright/errors.spec.js` spins up a browser and dev server to check a
404 page and an `app/routes.js` 500 error page. Neither test exercises client
JavaScript or CSS, and 404 HTML is already tested in `tests/server.test.js`.

- Move the `app/routes.js` 500 error page check into `tests/server.test.js`
  (asserting status 500, `#govuk-prototype-kit-error-message` and the
  `app/routes.js` line reference) and delete `tests/playwright/errors.spec.js`.
- Group compatible `production` assertions in `tests/server.test.js` onto fewer
  `protato start` child processes where single-header cases are already covered
  by `lib/middleware/https.test.js` and `lib/middleware/auth.test.js`.
- Remove duplicate single-string and leading-slash tests inside
  `getStylesheetPaths` and `getTemplatesByPlugin` in `lib/plugins.test.js` that
  repeat `describe('config normalisation')`.

---

### Phase 3: standardise helpers, mocking and readability

#### 3a. Share server, port, temp-directory and CSRF helpers in `tests/helpers/`

`tests/server.test.js`, `tests/plugin-management.test.js` and
`tests/playwright/helpers/server.js` each maintain their own server launcher,
port logic and CSRF form reader.

- Move `findFreePort` and `startServer` from
  `tests/playwright/helpers/server.js` into `tests/helpers/server.js`,
  supporting CLI subcommands (`dev` or `start`) and environment overrides.
- Reuse `tests/helpers/server.js` across `tests/server.test.js`,
  `tests/plugin-management.test.js` and Playwright. This removes hardcoded ports
  (`3030`–`3035`, `3131`), adds startup timeouts everywhere, drops the stale
  `connect.session() MemoryStore` stderr check, and attaches recent server
  output on failure.
- Extract one shared `getCsrf(url, options)` helper in `tests/helpers/csrf.js`
  to replace `getCsrf` in `tests/server.test.js` and `readForm` in
  `tests/plugin-management.test.js`.
- Standardise temporary directories on `fs.mkdtempSync(path.join(os.tmpdir(),
  'protato-...'))` instead of mixing `os.tmpdir()`, `tmp/playwright/` and
  hardcoded `tmp/test*` directories.

#### 3b. Remove repeated `vi.mock('../paths.js')` boilerplate

Six test files repeat `let dir; let projects = []`, `vi.mock('../paths.js',
...)` and manual `afterEach` cleanup loops. Add a test root setter in
`lib/paths.js` or a `useTestProject()` helper in
`tests/helpers/plugin-project.js` that handles path wiring and `afterEach`
cleanup in one place.

#### 3c. Migrate mock-heavy unit tests and relocate misplaced files

- **`lib/build.test.js`**: replace the `node:fs` and `sass` mocks with real
  temporary projects via `createPluginProject`. Run `buildPrototype()` and
  `buildSass()` against small `.scss` files and base layouts, asserting the
  written `.css` files, unbranded CSS output, Windows forward-slash imports,
  shadow layouts in `.tmp/views`, and real Sass syntax error results.
- **`prototype/app.test.js`**: replace the 11 top-level `vi.mock(...)` blocks
  with a minimal temporary project setup (matching `lib/plugin-assets.test.js`),
  exercising locals, view precedence, `noCache`, auth/manage mounting,
  auto-rendering, POST-to-GET redirects and 404s against the real app.
- **Relocate or merge misplaced test files**:
  - move `lib/plugin-assets.test.js` to `prototype/plugin-assets.test.js`;
  - move `lib/layouts.test.js` to `plugin/layouts.test.js` (and add `pageName` /
    `block pageTitle` `<title>` assertions there rather than in Playwright);
  - merge `lib/manage-plugins/registry-start-fetching.test.js` into
    `lib/manage-plugins/registry.test.js` using `vi.stubGlobal('fetch', ...)`
    and `vi.useFakeTimers()`.
- Standardise `console` spies in `beforeEach` paired with `vi.restoreAllMocks()`
  in `afterEach` (fixing un-restored spies in `lib/config.test.js` and
  `lib/build.test.js`).

#### 3d. Improve readability in large and repetitive files

- **Split multi-concern `it()` blocks:** break `responds to requests` and
  `serves templates, previews them and creates pages from them` in
  `tests/server.test.js` into focused `it()` blocks sharing the existing
  `beforeAll` dev server (zero extra startup time), and split the single
  all-in-one build test in `lib/build.test.js` by concern.
- **Use `it.each` tables:** convert repetitive `autoStoreData` input/output
  cases in `lib/middleware/session.test.js` and stack-trace parsing cases in
  `manage-prototype/error-model.test.js` to `it.each` tables.
- **Key mocked watchers by target in `lib/dev/watch.test.js`:** map
  `chokidar.watch` mocks by watched path (`sass`, `backend`, `frontend`,
  `lockfile`) instead of positional `watchers[0..3]` indexing.
- **Keep `lib/plugins.test.js` focused and tidy naming:** split
  `lib/plugins.test.js` into config/discovery vs getter/template suites if still
  over ~600 lines after Phase 2, and use consistent active present-tense test
  descriptions (replacing `should ...` and `works, and clear works`).

---

### Phase 4: add missing integration and browser coverage

Build on the shared helpers from Phase 3 and add one small, reusable fixture
plugin for 4a and 4b:

```text
tests/fixtures/plugin-fixture/
├── package.json
├── govuk-prototype-kit.config.json
├── filters.js
├── functions.js
├── macros/
│   └── field.njk
├── views/
│   ├── plugin-page.njk
│   └── include.njk
├── css/
│   └── plugin.css
└── js/
    └── plugin.js
```

#### 4a. Vitest end-to-end: plugin rendering (`tests/plugin-rendering.test.js`)

Use a temporary project, the shared `startServer` helper and `plugin-fixture` to
assert rendered HTML for:

- a plugin view and relative/plugin include;
- a plugin Nunjucks filter and Nunjucks function;
- a plugin macro automatically imported into a base layout via
  `importNunjucksMacrosInto`;
- project view precedence overriding a plugin view.

#### 4b. Playwright: plugin browser assets (`tests/playwright/plugin-browser.spec.js`)

Install `plugin-fixture` into the Playwright test project and assert browser
wiring that HTTP tests cannot prove:

- the plugin stylesheet changes a computed CSS colour;
- the plugin ES module executes (including `GOVUKPrototypeKit.documentReady`);
- the page has no unexpected console or page errors.

#### 4c. Playwright: checkbox `_unchecked` behaviour

`lib/middleware/session.test.js` tests the server stripping `_unchecked`, but
nothing tests `plugin/assets/javascripts/auto-store-data.js` injecting hidden
`_unchecked` inputs in the browser on submit.

Extend `tests/playwright/session.spec.js` (or add a small `forms.spec.js`) with
checked and unchecked checkboxes to assert:

- checked values are stored and shown after submit;
- unchecking a previously checked box clears the stored value via `_unchecked`;
- `/manage-prototype/clear-data` removes the stored checkbox values.

#### 4d. Vitest end-to-end: backend watching and management session isolation

Use `expect.poll` against the shared dev server (no fixed sleeps):

- **Route, filter and function watching (`tests/dev-watching.test.js`):**
  - adding a route to `app/routes.js` makes it respond after the automatic
    restart, and removing it returns 404 again;
  - adding or changing a filter/function in `app/filters.js` or
    `app/functions.js` updates rendered HTML after the restart;
  - changing `app/assets/sass/settings.scss` updates compiled
    `application.css`.
- **Management storage isolation and footer link (`tests/server.test.js`):**
  - query-string parameters store session data on prototype pages, but visiting
    `/manage-prototype/*` with a query string does **not** pollute prototype
    session data;
  - the prototype footer contains the `/manage-prototype/clear-data` link and
    posting to it clears stored data.

#### 4e. Playwright: application JavaScript live reload

Extend `tests/playwright/live-reload.spec.js` with an edit to
`app/assets/javascripts/application.js`, asserting that live reload runs the
updated script in the browser.

---

## What not to do

- **Keep strong existing suites unchanged:** `lib/dev/proxy.test.js`,
  `lib/dev/server.test.js`, `lib/dev/supervisor.test.js`, `lib/ports.test.js`,
  `lib/middleware/session-store.test.js`, `tests/plugin-management.test.js` and
  `tests/helpers/local-registry.js` (only adopting the shared server/CSRF
  helpers in Phase 3a), plus the five browser-focused Playwright specs
  (`smoke.spec.js`, `components.spec.js`, `config-reload.spec.js`,
  `live-reload.spec.js`, `session.spec.js`).
- **Keep Playwright small (~7–10 tests) and strictly browser-only:** do not put
  plugin HTML output, filters, macros, page titles, 404/500 HTML or npm
  install/update/uninstall flows in Playwright. Only add a browser test for
  production password login if the password UI itself changes meaningfully.
- **Do not port irrelevant GOV.UK Prototype Kit suites:** skip starter-page
  Cypress journeys/branching tests, management task-list/edit-home tests, and
  tests for absent or unbuilt features (migrations, plugin-validator, Heroku,
  Glitch, BrowserSync, backup layouts or backup homepages).
- **Do not add fixed sleeps** or run Playwright across multiple OSes/browsers
  unless a specific cross-browser regression justifies the CI cost.

## Success criteria

- Every module in `index.js`, `plugin/`, `scripts/create.js` and
  `manage-prototype/routes/` has direct coverage of its own contract.
- Updating `govuk-frontend` or `csrf-csrf` without breaking Protato's contract
  does not break unit tests or snapshots.
- Each rule is asserted at the cheapest layer that can prove it: broken plugin
  filters or route watchers fail in Vitest; broken plugin CSS/JS or checkbox
  scripts fail in Playwright.
- `manage-prototype` route tests render the real `.njk` views rather than
  serialising `res.render` arguments.
- All end-to-end and browser suites share one server/port helper with timeouts,
  dynamic ports and no fixed sleeps.
- `npm test` and `npm run test:browser` pass reliably on Linux and Windows CI.
