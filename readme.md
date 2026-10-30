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

In development, plugins can be installed and uninstalled from
`/manage-prototype/plugins`. `known-plugins.json` uses the GOV.UK Prototype Kit
format: `plugins.available` lists the packages Protato suggests, and
`plugins.required` lists packages that cannot be uninstalled. Installing or
uninstalling runs npm in the project, then rebuilds and restarts the prototype.

### Proxy plugin configs

Some npm packages are used as plugins but do not ship a
`govuk-prototype-kit.config.json`. Protato supplies proxy configs for
`accessible-autocomplete`, `jquery` and `notifications-node-client`.

A proxy config is only used when the package does not have its own
`govuk-prototype-kit.config.json`. It cannot override a config supplied by the
package itself.

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
