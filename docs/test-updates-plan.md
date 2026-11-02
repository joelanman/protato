# Test updates plan

Recommendations after reviewing the Playwright suite and comparing it with the
GOV.UK Prototype Kit test suite.

This refines `docs/playwright-plan.md`. Where the two disagree, this document is
the current recommendation.

## Summary

Keep three test layers:

1. **Vitest unit tests** for pure logic and small contracts.
2. **Vitest end-to-end tests** for real servers, real files, npm, rebuilds,
   rendering and routing.
3. **Playwright tests** only for behaviour that needs a browser.

Playwright is not a general-purpose end-to-end runner. It is the most expensive
and most flaky layer, so use it only when the browser is the subject under test.

The current Playwright suite follows this well. The main correction is to split
the proposed plugin and watcher coverage between Vitest end-to-end tests and
Playwright, instead of putting all of it in Playwright.

## Decision rule

Use Playwright only when at least one of these is true:

- CSS is applied and computed styles matter.
- JavaScript or an ES module must execute.
- A real form, click, navigation or browser event is the subject.
- Live reload over the browser connection is the subject.
- Fonts, images or browser asset loading are the subject.
- The risk is in the browser wiring, not in the server response.

Use Vitest end-to-end instead when the behaviour is HTTP, HTML, Nunjucks,
filesystem, npm, a server restart or plugin registration.

Use a unit test when the behaviour is a pure function, a path calculation, a
config lookup or an error formatter.

## Current state

```text
tests/
├── helpers/                 shared Vitest helpers
├── fixtures/                shared Vitest fixtures
├── server.test.js           Vitest end-to-end: server, dev, production
├── plugin-management.test.js Vitest end-to-end: real npm plugin changes
└── playwright/
    ├── smoke.spec.js
    ├── config-reload.spec.js
    ├── components.spec.js
    ├── session.spec.js
    ├── live-reload.spec.js
    └── errors.spec.js
```

The existing Playwright tests are appropriately browser-focused: assets and
fonts, GOV.UK component JavaScript, live reload, a real form and rendered error
pages. Keep them.

## Work by priority

### Priority 1: plugin coverage, split by layer

#### 1a. Vitest end-to-end: plugin rendering

Add `tests/plugin-rendering.test.js`.

Use a real temporary project, a real server and a fixture plugin. Assert the
rendered HTML for:

- a plugin view and an include;
- a plugin Nunjucks filter;
- a plugin Nunjucks function;
- a plugin macro imported into a base layout;
- plugin view precedence and shadow layout behaviour, if not already clear
  from the unit tests.

The fixture plugin should declare `nunjucksPaths`, `nunjucksFilters`,
`nunjucksFunctions` and `importNunjucksMacrosInto` in its
`govuk-prototype-kit.config.json`.

Why Vitest rather than Playwright:

- The contract is HTML, not browser behaviour.
- It exercises the real wiring between `prototype/app.js`, `lib/plugins.js`, Nunjucks
  and dynamic imports.
- It is faster and easier to diagnose than a browser test.
- The browser adds no useful signal for a filter returning `<strong>abc</strong>`.

Existing tests to reuse or extend:

- `tests/helpers/plugin-project.js` writes fixture plugins and package files.
- `tests/helpers/starter.js` copies the real starter project.
- `tests/server.test.js` already shows the pattern for a real project and
  commonjs filters/functions/routes.

#### 1b. Playwright: plugin browser assets

Add `tests/playwright/plugin-browser.spec.js`.

Use the same or a similar fixture plugin with:

- a stylesheet that changes a computed colour;
- a module script that runs on load or click;
- optionally a plugin image loaded by the browser.

Assert:

- the plugin stylesheet is applied, not just served;
- the plugin module executes;
- the page has no relevant console or page errors;
- multiple plugins do not break each other, if the fixture is cheap to extend.

Why Playwright:

- Computed CSS and JavaScript execution cannot be proved by config or HTML
  assertions.
- It catches broken script URLs, wrong MIME types, module loading failures,
  ordering problems and failures in `GOVUKPrototypeKit.documentReady`.

Do not use Playwright to assert filters, functions, macros or includes. Those
belong in 1a.

#### 1c. Playwright: checkbox `_unchecked` behaviour

Extend `tests/playwright/session.spec.js`, or add a small
`tests/playwright/forms.spec.js` if the session spec grows.

Add a form with checked and unchecked checkboxes and assert:

- unchecked checkboxes result in `_unchecked` being submitted by
  `plugin/assets/javascripts/auto-store-data.js`;
- checked values are stored;
- stored values appear after submit;
- cleared data removes both.

Why Playwright:

- `lib/middleware/session.test.js` already tests the server removing
  `_unchecked`, but not the browser script adding it.
- This is a real client-side behaviour that unit tests cannot cover.

### Priority 2: watcher and API coverage

#### 2a. Vitest end-to-end: route, filter and function watching

Add `tests/dev-watching.test.js`, or extend the development section of
`tests/server.test.js` if that stays readable.

Cover:

- a route added to `app/routes.js` becomes available after the server restart;
- removing it makes the route unavailable again;
- a filter or function added to `app/filters.js` or `app/functions.js` changes
  the rendered page after the restart;
- optionally, a custom Sass file compiles and is served, and a `settings.scss`
  change affects the generated `application.css`.

Use polling with Playwright-style retrying assertions or a small `expect.poll`
helper. Do not add fixed sleeps.

Why Vitest:

- The subject is the watcher, the restart and the HTTP response.
- A browser navigation is not needed to prove that a route or filter changed.
- These tests are faster and less likely to flake than browser versions.

Keep the existing Playwright `live-reload.spec.js` for view and Sass changes:
that is browser behaviour because it depends on the live reload connection.

#### 2b. Playwright: application JavaScript change

Extend `tests/playwright/live-reload.spec.js` or add a small test for
`app/assets/javascripts/application.js`.

Write or change the application script and assert the page changes in the
browser.

Why Playwright:

- The subject is JavaScript execution in the browser and the live reload path.
- An HTTP test cannot prove the script ran.

An image watcher test is optional. Use Playwright only if `naturalWidth` or
actual browser rendering matters; use an HTTP status check if the question is
only whether the asset is served.

#### 2c. Unit: public filter and function API

Add tests for:

- `index.js` `addFilter`, `getFilter`, `addFunction`, `getFunction`;
- `renderAsHtml` wrapping the core safe filter;
- registration before and after the Nunjucks environment is set, if supported;
- `plugin/filters.js` `log` and `formatItems`;
- `plugin/functions.js` `checked`, including arrays, simple values and dotted
  or bracket notation.

Why unit:

- These are pure registration and transformation contracts.
- The GOV.UK Prototype Kit tests its equivalent API directly, and we currently
  do not.
- They are fast, precise and do not need a server.

#### 2d. Vitest end-to-end: management page storage and links

Cover:

- query string data is stored on prototype pages;
- the same query string is not stored when visiting a management page;
- the footer contains the clear-data link and it works;
- the management home, templates and plugin pages still render as expected.

Why Vitest end-to-end:

- This is server routing, session middleware and HTML.
- We already mount management before `autoStoreData`; these tests prove the
  behaviour rather than only the middleware order.

### Priority 3: optional browser coverage

#### 3a. Production authentication

Consider `tests/playwright/production.spec.js` only if the password form UI is
a real risk.

Most of the behaviour is already covered at HTTP and unit level:

- password redirects and secure cookies in `tests/server.test.js`;
- valid, invalid and additional passwords in `lib/middleware/auth.test.js`;
- production management availability in server and app tests.

A browser test would add: real form submission, error summary, return URL and
management pages after login. Add it after the plugin and watcher work, not
before.

#### 3b. Layouts and page titles

Test page titles and backup layouts at the Vitest or Nunjucks layer, not in
Playwright. The output is server-rendered HTML.

- `pageName` and `block pageTitle` can be asserted in a real-server HTML test.
- Backup layout and backup homepage should only be tested once those features
  exist. At the moment they look like feature gaps, not test gaps.

#### 3c. Plugin management UI

Keep npm install, update and uninstall in `tests/plugin-management.test.js`.
Only add browser interaction if the management UI itself becomes interactive
enough that clicking and client-side state are the risk. The current server
form POST flow is already covered.

## What not to do

Do not:

- **Put server-rendered plugin views, filters, functions, macros or includes in
  Playwright.** They belong in a real-server Vitest test.
- **Port the kit journey, branching and change-answer Cypress tests.** They
  mostly exercise starter template pages. Our `autoStoreData` unit tests are
  deeper, and the one browser-specific part worth taking is the checkbox test.
- **Port management task-list or edit-home tests.** Protato does not have that
  UI.
- **Port migration, plugin-validator, Heroku, Glitch, BrowserSync or
  `sync-changes` tests.** Those features are absent or deliberately different.
  Add tests when, and if, the features are built.
- **Test backup layouts or the backup homepage before implementing them.**
- **Run npm install/update/uninstall through Playwright.** Keep the
  deterministic local-registry test in Vitest.
- **Duplicate the same error page assertions in Vitest and Playwright.**
  Playwright owns the browser-facing 404 and project-route error pages. Keep
  the Sass build error at the HTTP level.
- **Use Playwright for page titles, link hrefs, plugin HTML output or other
  contracts that an HTTP response can prove.**
- **Add fixed sleeps or long arbitrary waits.** Use the existing `openPage`
  retry helper, `expect.poll`, or a readiness helper.
- **Grow Playwright into the main test suite.** Keep it at roughly 8–12 tests.
  If it grows beyond that, re-check whether each test is genuinely
  browser-only.
- **Run Playwright on every OS or browser yet.** Add Windows or another browser
  only if a specific browser/OS regression appears.

## Fixture needs

To make the plugin tests cheap and readable, add a reusable fixture plugin with:

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

The Vitest rendering test can use this through a real temporary project. The
Playwright test can install the same files into its temporary starter project.

Keep the fixture small and stable. One fixture plugin that proves every
registration path is better than several realistic-looking plugins.

## Suggested order

1. Plugin rendering in Vitest.
2. Plugin browser assets in Playwright.
3. Checkbox `_unchecked` browser behaviour.
4. Unit tests for the filter/function API and built-in helpers.
5. Route/filter/function watcher tests in Vitest.
6. Application JavaScript change in Playwright.
7. Management page storage and links in Vitest.
8. Production auth browser test only if needed.
9. Layout title test at the server/Nunjucks layer.

## Success criteria

- Every new test sits at the cheapest layer that can prove the behaviour.
- A broken plugin filter fails in Vitest, not in a slow browser test.
- Broken plugin CSS or JavaScript fails in Playwright.
- A broken route watcher fails in Vitest, not in a browser test.
- Playwright stays small, browser-only and reliable in CI.
- No exact duplicate coverage between Vitest and Playwright.
- Feature gaps are tracked as feature work, not hidden as missing tests.
