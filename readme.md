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
`/manage-prototype/plugins`. Only packages listed in `known-plugins.json` can
be managed.

### Proxy plugin configs

Some npm packages are used as plugins but do not ship a
`govuk-prototype-kit.config.json`. Protato supplies configs for `jquery` and
`notifications-node-client`.

To add or override a config, create `app/plugin-proxy.json` in the project.
Each key is a package name and each value is the plugin config to use:

```json
{
  "jquery": {
    "scripts": ["/dist/jquery.js"],
    "assets": ["/dist"]
  }
}
```
