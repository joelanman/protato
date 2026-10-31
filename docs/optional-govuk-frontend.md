# Making GOV.UK Frontend optional

An analysis of how GOV.UK Frontend is currently tied to the prototyping side of
Protato, and a plan for moving it into an optional plugin.

The manage-prototype UI is out of scope. It can keep depending on GOV.UK
Frontend for now.

## Summary

GOV.UK Frontend is already loaded as a plugin on the prototyping side. Protato
reads it from the project's `node_modules`, using the same plugin system as
HMRC Frontend or the Ministry of Justice Frontend.

What is baked in is the **GOV.UK base layout plugin** and a handful of
GOV.UK-specific assumptions in the core:

1. The `govukFrontend` Nunjucks local in `lib/app.js`.
2. The `$govuk-*` Sass variables in `lib/build.js`.
3. The `unbranded.css` generation in `lib/build.js`.
4. The forced `govuk-frontend` plugin order in `lib/plugins.js`.
5. The built-in GOV.UK layouts in `plugin/views/govuk-prototype-kit/layouts/`.

The plan is to split the built-in `protato` plugin into:

- a generic core plugin, which keeps filters, functions, `kit.js` and
  `auto-store-data.js`;
- an optional `@protato/govuk-frontend` plugin, which owns the GOV.UK layouts,
  Sass settings, unbranded variant and asset path logic.

A project that does not install the optional plugin would still have a working
prototype server, but no GOV.UK layout or styling.

## What is special-cased today

| Concern | Current location |
| --- | --- |
| `govukFrontend.assetPath` local, including `rebrand` | `lib/app.js` |
| `$govuk-extensions-url-context`, `$govuk-plugins-url-context`, `$govuk-prototype-kit-major-version` | `lib/build.js` |
| `unbranded.css` created by replacing the GDS Transport font and adding a background rule | `lib/build.js` |
| `govuk-frontend` always loads before other plugins | `lib/plugins.js` |
| `protato` assets served under `/plugin-assets/govuk-prototype-kit/...` | `lib/plugins.js` |
| `govuk-branded.njk` and `unbranded.html` | `plugin/views/govuk-prototype-kit/layouts/` |
| Layout registration | root `govuk-prototype-kit.config.json` |
| Unbranded icon | `plugin/assets/images/unbranded.ico` |
| GOV.UK starter dependencies and views | `starter/` |

`lib/paths.js`, `lib/middleware/auth.js` and `manage-prototype/` are manage-UI
concerns. They can stay as they are.

## Compatibility rules

The current plugin API must keep working. These rules apply to the whole plan:

- Continue reading `govuk-prototype-kit.config.json`.
- Keep every existing config key working as it does now.
- Make all new config keys optional.
- Keep existing template paths, such as
  `govuk-prototype-kit/layouts/govuk-branded.njk`.
- Keep existing plugin asset URLs, such as
  `/plugin-assets/govuk-prototype-kit/...`.
- Keep `importNunjucksMacrosInto` behaviour.
- Keep the `require('govuk-prototype-kit')` shim in `lib/utils/replace-require.js`.
- Keep `GOVUKPrototypeKit` and `protato` Nunjucks locals.
- Do not change the manage-prototype UI in this work.

The new plugin can use new features, but existing plugins must not need to
change.

## Proposed package split

Create a new first-party package, for example `@protato/govuk-frontend`:

```
@protato/govuk-frontend/
├── package.json
├── govuk-prototype-kit.config.json
├── functions.js
├── sass/
│   ├── _settings.scss
│   └── _unbranded.scss
└── views/govuk-prototype-kit/layouts/
    ├── govuk-branded.njk
    └── unbranded.html
```

The package would depend on `govuk-frontend`, rather than shipping a copy of
it.

Its config could look like this:

```json
{
  "pluginDependencies": [
    { "packageName": "govuk-frontend", "minVersion": "6.0.0" }
  ],
  "sassSettings": ["/sass/_settings.scss"],
  "sassVariants": {
    "unbranded": ["/sass/_unbranded.scss"]
  },
  "importNunjucksMacrosInto": [
    "/views/govuk-prototype-kit/layouts/govuk-branded.njk",
    "/views/govuk-prototype-kit/layouts/unbranded.html"
  ],
  "nunjucksPaths": ["/views"],
  "nunjucksFunctions": ["/functions.js"]
}
```

The core `protato` plugin config would keep only generic entries:

```json
{
  "assets": ["/plugin/assets/images"],
  "scripts": [
    "/plugin/assets/javascripts/kit.js",
    "/plugin/assets/javascripts/auto-store-data.js"
  ],
  "nunjucksFilters": ["/plugin/filters.js"],
  "nunjucksFunctions": ["/plugin/functions.js"],
  "nunjucksPaths": ["/plugin/views"]
}
```

The unbranded icon can stay in the core plugin for now. That keeps the existing
asset URL working and avoids a needless break.

## New plugin API additions

All of these are additive and optional.

### `sassSettings`

A list of Sass files to import before any plugin `sass` imports. It fits the
existing config normalisation as a new list key and path key.

Build order would be:

1. The project's `app/assets/sass/settings.scss`.
2. Each plugin's `sassSettings`, in plugin order.
3. Variant `sassSettings`, when building a variant.
4. Each plugin's `sass` imports, in dependency order.
5. The project's `app/assets/sass/application.scss`.

This lets the GOV.UK plugin set its compatibility variables before GOV.UK
Frontend's own Sass is imported:

```scss
$govuk-extensions-url-context: "/plugin-assets" !default;
$govuk-plugins-url-context: "/plugin-assets" !default;
$govuk-prototype-kit-major-version: 13 !default;
```

This replaces the hardcoded values in `lib/build.js`.

### `sassVariants`

An object of extra Sass settings to use when building alternative stylesheets.

```json
{
  "sassVariants": {
    "unbranded": ["/sass/_unbranded.scss"]
  }
}
```

For each variant, the build would compile the same application Sass again and
write `<variant>.css` next to `application.css`.

Variant names come from plugin config keys, so treat them as untrusted input.
Validate them against a simple pattern such as `^[a-z0-9][a-z0-9-]*$` and reject
reserved names such as `application` and `settings`. This stops path traversal
and stops a variant overwriting the main stylesheet.

`normaliseConfig` will need custom handling for this key. Each variant value
should accept a single path or a list, and each path should go through
`normaliseConfigPath`. Invalid values should throw so the existing warning and
skip behaviour in `getPlugins()` still applies.

The GOV.UK `_unbranded.scss` would contain:

```scss
$govuk-font-family: "HelveticaNeue", "Helvetica Neue", "Arial", "Helvetica", sans-serif;
$govuk-functional-colours: (template-background: #ffffff);
```

This was checked against GOV.UK Frontend 6.6.0. It produces the same font stack
and the same `.govuk-template` background colour as the current string
replacement in `lib/build.js`.

If more than one plugin declares the same variant, their settings are combined.
If no plugin declares a variant, no extra stylesheet is built.

### `assetPathVariable` (optional cleanup)

A plugin could declare the URL segment used for its assets:

```json
{
  "assetPathVariable": "govuk-prototype-kit"
}
```

`lib/plugins.js` would use this value instead of the current special case that
maps the `protato` package name to `govuk-prototype-kit`.

This is not required for the GOV.UK extraction, but it removes another
hardcoded package name from core.

### `protato.config.get()`

Add a small public API so a plugin can read project config without using the
old `require('govuk-prototype-kit/lib/config.js')` shim:

```js
import protato from 'protato'

const config = protato.config.get()
```

This is additive. Existing plugins can keep using the old API.

The GOV.UK plugin's `functions.js` would use it to add the existing
`govukFrontend` global:

```js
import protato from 'protato'

const config = protato.config.get()
const rebrand = config?.plugins?.['govuk-frontend']?.rebrand

protato.views.addFunction('govukFrontend', {
  assetPath: '/dist/govuk/' + (rebrand ? 'assets/rebrand' : 'assets')
})
```

`lib/app.js` would then stop setting the `govukFrontend` local.

GOV.UK Frontend 6 no longer ships the `assets/rebrand` folder or the old
`functions.js`. Keep the small rebrand check anyway. It costs little, keeps
existing `plugins.govuk-frontend.rebrand` config valid, and defaults to
`/dist/govuk/assets` when rebrand is false or absent. The plugin can still
declare `govuk-frontend` 6 as its minimum supported version.

Moving `govukFrontend` from `app.locals` to a Nunjucks global behaves the same
for templates. The difference is that `app.locals.govukFrontend` will no longer
exist on the Express app object. Update the app tests to match.

## Core changes

### `lib/app.js`

- Remove the `govukFrontend` local.
- Remove the `rebrand` config read.
- Keep `GOVUKPrototypeKit` and `protato` locals.

### `lib/build.js`

- Remove the hardcoded `$govuk-*` variables.
- Remove `writeUnbranded()`.
- Add `sassSettings` imports.
- Add variant builds using `sassVariants`.
- Pass an explicit output filename instead of deriving it from the temporary
  input path.

Generated application Sass should still be written under `.tmp/sass/`.

Today `compileSass` derives the output name from the input filename:

```js
const outputFilename = path.basename(inputPath).replace('.scss', '.css')
```

If a variant input is `.tmp/sass/application-unbranded.scss`, that would create
`application-unbranded.css` rather than `unbranded.css`, and the unbranded
layout would break. Either name temporary files `.tmp/sass/<variant>.scss`, or
change `compileSass` to accept an explicit output name. The explicit output
name is clearer and easier to test.

Also add a guard for a missing `app/assets/sass` directory. `buildSass()`
currently calls `fs.readdirSync(paths.sass)` unconditionally, so a project with
no Sass folder fails to build.

Keep `application.scss` as the entry point for plugin Sass for now. If it is
missing, plugin Sass is not compiled. The blank starter should include an empty
`app/assets/sass/application.scss` if it may use plugins that provide Sass. If
we want plugin-only Sass to work without that file, make it a separate change
with its own tests so it does not get mixed up with the GOV.UK extraction.

### `lib/plugins.js`

- Remove `govuk-frontend` from the hardcoded base plugin list.
- Add getters for `sassSettings` and `sassVariants`.
- Add `sassSettings` to `listKeys` and `pathKeys`.
- Add custom normalisation for `sassVariants`.
- Optionally use `assetPathVariable` instead of the `protato` special case.
- Reuse the existing `normalisePluginDependencies` logic for ordering. It
already accepts strings, objects and lists. Prefer moving that function into a
small shared utility so the prototype runtime does not need to import the whole
plugin registry module.

### `index.js`

- Expose `config: { get: getConfig }`.

## Plugin order

The current order is:

1. `protato`
2. `govuk-frontend`
3. all other dependencies, alphabetically

The GOV.UK position exists because other plugins, such as common templates and
HMRC Frontend, depend on GOV.UK Frontend and use its Sass variables.

Simply removing `govuk-frontend` from the base list would break that order,
because `@govuk-prototype-kit/common-templates` sorts before `govuk-frontend`.

The safer change is to sort plugins so declared dependencies come before the
plugins that depend on them. Keep `protato` first as the base plugin. Use
alphabetical order for ties and for dependency cycles.

This preserves the useful part of the current order without naming
`govuk-frontend` in core.

One subtlety: the other GOV.UK plugins depend on `govuk-frontend`, not on the
new `@protato/govuk-frontend` package. With alphabetical tie-breaking,
`@protato/govuk-frontend` will load after `@govuk-prototype-kit/*` and
`@ministryofjustice/frontend`. Because view paths are reversed so later
plugins win, its views will be searched before those plugins' views. That
should be safe because it only provides `govuk-prototype-kit/layouts/*`, but it
is a behaviour change worth testing.

The other effects should be safe:

- `sassSettings` is a separate phase, so the GOV.UK settings still load before
  GOV.UK Frontend's Sass.
- Base layouts collect macros from all plugins, so HMRC and MOJ macros still
  appear in the GOV.UK layout.

Use the existing `normalisePluginDependencies` behaviour for parsing. It already
handles strings, objects and lists, so plugin authors do not have to learn a
second format.

## Starter changes

There are two options.

### Option A: keep one GOV.UK starter

Keep the current `starter/` as the GOV.UK starter and add
`@protato/govuk-frontend` to its dependencies. Projects that do not want
GOV.UK would install the core and a different plugin manually.

This is the smallest change, but it makes GOV.UK the default.

### Option B: add a blank starter

Make the current starter the GOV.UK starter, and add a blank starter with:

- no GOV.UK dependencies;
- a simple `app/views/layouts/main.html`;
- no `govuk-frontend` config entry;
- an empty `app/assets/sass/application.scss` so plugin Sass still builds;
- plain HTML and CSS.

`scripts/create.js` currently copies one starter. It would need a template
choice, such as `protato create --template govuk` or a prompt.

This is the clearer long-term shape if the goal is for GOV.UK to be optional.

Recommendation: Option B, but it can come after the plugin split works.

## Compatibility and migration

These things must keep working for existing projects:

- `{% extends "govuk-prototype-kit/layouts/govuk-branded.njk" %}`.
- `{% extends "govuk-prototype-kit/layouts/unbranded.html" %}`.
- `/plugin-assets/govuk-prototype-kit/...` URLs.
- `app/config.json` with `plugins.govuk-frontend.rebrand`.
- The old `protato` plugin's filters, functions and scripts.
- Existing third-party plugin configs.

Because the new plugin keeps the same view paths and asset URL namespace, an
existing project should only need to add the new plugin dependency. Its
templates and config should not need to change.

If the unbranded icon moves to the new package, its URL changes. Keeping it in
the core plugin avoids that. The new layout can keep using the existing core
asset URL.

## Test plan

Add or update tests for:

- A project with no GOV.UK plugin builds and serves pages.
- A project with no `app/assets/sass` directory builds without crashing.
- A project with the GOV.UK plugin renders the branded and unbranded layouts.
- Unbranded CSS contains the Helvetica font stack and white template
  background.
- `sassSettings` imports happen before plugin `sass` imports.
- Variant builds write the correct output name, such as `unbranded.css`, not a
  name derived from the temporary input file.
- Variant names with path separators, reserved names or unexpected characters
  are rejected.
- `sassVariants` accepts a single path and a list of paths.
- Plugins are ordered dependency-first, with `protato` first and alphabetical
  ties.
- Scoped plugins with base layouts still resolve views as expected.
- Existing plugin config files work unchanged.
- Existing layout paths and asset URLs still resolve.

The current tests that will need changes:

- `lib/app.test.js` for the removed `govukFrontend` local.
- `lib/build.test.js` for the new Sass settings and variant behaviour.
- `lib/layouts.test.js` for the new location of the layouts.
- `lib/plugins.test.js` and its snapshot for the changed plugin order and new
  getters.
- `tests/server.test.js` for the starter and layout setup.

## Risks

- **Plugin order changes can affect other plugins.** Dependency-aware ordering
  is safer than alphabetical-only, but it still changes behaviour for any
  plugin that relied on the old implicit order without declaring a dependency.
- **Sass variant output must match the current unbranded CSS.** Compare the
  generated files before and after.
- **GOV.UK Frontend v5 and v6 differ.** The rebrand folder and `functions.js`
  only exist in v5. Keep the small rebrand check in the new plugin for
  backwards compatibility, but target v6 as the supported version.
- **The manage UI still needs GOV.UK.** That is fine, but it means the `protato`
  package will still have a GOV.UK dependency until the UI is extracted too.
- **Publishing the new package.** It needs to be installable as its own npm
  package, or live in a workspace. The current `protato: "file:.."` dev setup
  already has this kind of local dependency.

## Suggested sequence

### Phase 1: move the layouts

- Create the new plugin package.
- Move the GOV.UK layouts into it.
- Move the `importNunjucksMacrosInto` entries out of the core plugin config.
- Add the new plugin to the GOV.UK starter.
- Keep the old `govukFrontend` local and hardcoded Sass for now.

This makes the layouts optional without changing build behaviour.

### Phase 2: move the Nunjucks local

- Add `protato.config.get()`.
- Move the `govukFrontend.assetPath` setup into the plugin's `functions.js`.
- Remove the local from `lib/app.js`.

### Phase 3: generalise Sass

- Add `sassSettings`.
- Add `sassVariants`, with name validation and explicit output filenames.
- Guard against a missing `app/assets/sass` directory.
- Move the `$govuk-*` variables into the plugin.
- Replace `writeUnbranded()` with the unbranded variant.
- Remove the GOV.UK code from `lib/build.js`.

### Phase 4: generalise plugin order

- Add dependency-aware plugin ordering, reusing the existing
  `normalisePluginDependencies` parsing.
- Remove `govuk-frontend` from the hardcoded base list.
- Check the scoped plugin view precedence case.
- Optionally add `assetPathVariable` and remove the `protato` asset special case.

### Phase 5: starters, tests and docs

- Add a blank starter if wanted, including an empty `application.scss`.
- Update tests and snapshots.
- Document the new plugin config keys.

## Changes we are not making

These would break compatibility and are not needed for this work:

- Renaming `govuk-prototype-kit.config.json` to `protato.config.json`.
- Removing `GOVUKPrototypeKit` locals.
- Removing the `replace-require` shim.
- Changing the meaning of existing `sass`, `assets`, `nunjucksPaths` or
  `importNunjucksMacrosInto` keys.

If the project later wants a cleaner identity, a `protato.config.json` file
could be added while still reading the old filename for a long transition. That
is a separate decision, not part of making GOV.UK Frontend optional.

## Effort

Roughly 3 to 5 focused days for a careful implementation with tests:

- Phase 1: low risk.
- Phase 2: low risk.
- Phase 3: medium risk, mostly build logic and output comparison.
- Phase 4: medium risk, because plugin order touches many tests.
- Phase 5: mostly test and documentation work.

A smaller version is possible: do phases 1 and 2 only. That makes the GOV.UK
layouts optional, but core still has GOV.UK-specific Sass and unbranded CSS.
Phases 3 and 4 are what make the core genuinely design-system agnostic.
