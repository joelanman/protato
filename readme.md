# Protato

A quick and easy prototype kit.

## Developing

Requires Node.

Run `npm install` in the root folder, and the `starter` folder.

`npm run install:starter` does the starter install for you. It deletes
`starter/package-lock.json` first, because the starter depends on protato with a
`file:` link: npm copies protato's dependency tree into that lockfile, so it goes
stale when the root dependencies change and then reports vulnerabilities that
are already fixed. Run it after changing root dependencies.

Run `npm run build` to build the manage-prototype assets.

The `starter` folder is a base project that depends on `protato`,
useful for testing and in the future to create base apps for users.

Run `npm link` to be able to run the `protato` command.

Run `npm run dev`.

While working on Protato itself, put `PROTATO_DEV=true` in a `.env` file at the
repo root. Protato reads the package's own `.env` as well as the project's, and
`PROTATO_DEV` makes the manage prototype templates re-read on every render, so
edits to them show up without a restart. A project using Protato caches those
templates. The root `.env` is ignored by git and is not published.

The port comes from the `PORT` environment variable, then `app/config.json`,
and defaults to 3000. If it is in use, Protato offers to use the next free port.
In development the prototype itself runs on a second port 10 above the browser
port, so the dev server can keep proxying during restarts.

## Tests

Run `npm test` for the unit, end-to-end and lint suite.

Browser tests need Chromium, installed once with:

```sh
npx playwright install chromium
```

Then run `npm run test:browser`. Use `npm run test:browser:headed` to watch the
browser, or `npm run test:browser:ui` for Playwright's interactive runner. Run
`npm run test:all` to run the unit, end-to-end, lint and browser tests together.

## Plugins

In development, plugins can be installed, updated and uninstalled from
`/manage-prototype/plugins`. `data/known-plugins.json` uses the GOV.UK Prototype
Kit format: `plugins.available` lists the packages Protato suggests, and
`plugins.required` lists packages that cannot be uninstalled. Installing,
updating or uninstalling runs npm in the project, then rebuilds and restarts the
prototype.

Installed registry plugins are checked against the npm registry for newer
versions. The check runs in the background when the server starts and every 15
minutes, so opening the plugins page never waits for the network, and an
unreachable registry leaves the last known versions in place. The "Check for
updates" button on that page refreshes them on demand. Updating installs the
latest version with npm, installs any new plugin dependencies it declares, then
rebuilds and restarts the prototype. Protato itself cannot be updated from the
plugins page.

### Proxy plugin configs

Some npm packages are used as plugins but do not ship a
`govuk-prototype-kit.config.json`. Protato supplies proxy configs for
`accessible-autocomplete`, `jquery` and `notifications-node-client` in
`data/plugin-proxy.json`.

A proxy config is only used when the package does not have its own
`govuk-prototype-kit.config.json`. It cannot override a config supplied by the
package itself.

Proxy configs declare paths only. Descriptions and homepages come from the
package's `package.json`, or from npm when the package is not installed, so they
stay current without a Protato release and do not change when a plugin is
installed.

To add a proxy config for another package, create `app/plugin-proxy.json` in the
project. It takes the same format as Protato's own file: each key is a package
name and each value is the plugin config to use. Paths are relative to the
package directory and start with `/`:

```json
{
  "some-plugin": {
    "scripts": ["/dist/some-plugin.js"],
    "stylesheets": ["/dist/some-plugin.css"],
    "assets": ["/dist"]
  }
}
```

Entries in `app/plugin-proxy.json` override Protato's own proxy configs for the
same package. If the file contains invalid JSON, Protato warns and continues
with its own configs.
