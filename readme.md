# Protato

A quick and easy prototype kit.

## Developing

Requires Node.

Run `npm install` in the root folder, and the `starter` folder.

Run `npm run build` to build the manage-prototype assets.

The `starter` folder is a base project that depends on `protato`,
useful for testing and in the future to create base apps for users.

Run `npm link` to be able to run the `protato` command.

Run `npm run dev`.

## Plugins

In development, plugins can be installed, updated and uninstalled from
`/manage-prototype/plugins`. `known-plugins.json` uses the GOV.UK Prototype Kit
format: `plugins.available` lists the packages Protato suggests, and
`plugins.required` lists packages that cannot be uninstalled. Installing,
updating or uninstalling runs npm in the project. The result page then has a
**Restart prototype** button; the plugin is not active until the prototype
restarts. The same button on the plugins page picks up packages installed from a
terminal.

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
`accessible-autocomplete`, `jquery` and `notifications-node-client`.

A proxy config is only used when the package does not have its own
`govuk-prototype-kit.config.json`. It cannot override a config supplied by the
package itself.

Proxy configs declare paths only. Descriptions and homepages come from the
package's `package.json`, or from npm when the package is not installed, so they
stay current without a Protato release and do not change when a plugin is
installed.

To add a proxy config for another package, create `app/plugin-proxy.json` in the
project. Each key is a package name and each value is the plugin config to use.
Paths are relative to the package directory and start with `/`:

```json
{
  "some-plugin": {
    "scripts": ["/dist/some-plugin.js"],
    "stylesheets": ["/dist/some-plugin.css"],
    "assets": ["/dist"]
  }
}
```

Entries in `app/plugin-proxy.json` override Protato's built-in proxy configs for
the same package. If the file contains invalid JSON, Protato warns once and
continues with the built-in configs.
