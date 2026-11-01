# Build in the parent

An experiment in keeping the small supervisor and the one manage app, while
moving the build back out of the prototype process.

## Flow

The supervisor's process builds, then forks the prototype process and sends it
the result:

```
lib/start.js
  buildPrototype()                  <- sass, layouts, plugins
  setBuild(build)                   <- the module, so lib/dev/ imports nothing
  startPrototypeServer(3010)
    getBuildResult()                <- the supervisor never builds
    fork prototype-server.js
    send({ action: 'start', port, buildResult })
      prototype-server.js
        error app, or the prototype app
        send('ready')
```

A restart reuses that build result. The one caller that rebuilds first is the
restart button, because that is what applies a plugin change:

```
POST /__protato/restart             <- the button on the plugins page
  buildPrototype()                  <- npm changed node_modules in the child
  supervisor.restartPrototypeServer()
    stop the child
    fork, send the build result the parent now has
```

Sass changes are built by the watcher, and only restart when the error changed:

```
watch sass
  previousResult = getBuildResult()
  newBuildResult = buildSass()
  if the error changed -> restart (the new process shows the new error page)
  if not               -> the new css triggers a frontend reload, no restart
```

## Why

The move of manage prototype into the prototype process and the move of the
build into the prototype process were two changes that landed together. Only the
first was wanted. This keeps manage prototype as one app in the restartable
process, and puts the build back where it was.

## Why the build is passed in

`lib/dev/` may not import anything outside itself (checked by
`lib/dev/imports.test.js`), so `lib/start.js` passes its `build` module to
`supervisor.setBuild()`, `devServer.start()` and `watch()`. Nothing in `lib/dev/`
imports `lib/build.js`, and the guard test stays as it is. The supervisor only
reads `getBuildResult()`. The three places that build are `lib/start.js` (cold
start), `lib/dev/watch.js` (sass) and the restart route in `lib/dev/server.js`
(plugins).

## Trade-offs

- A sass error, or a fix to one, costs a restart rather than a page refresh.
- The build result exists in two processes: the parent's copy, and a snapshot
  sent to the child when it starts. They are reconciled by restarting, which is
  why the sass watcher compares errors before asking for one.

## What this does not change

- Manage prototype is still one app in the prototype process, in dev and
  production.
- Plugin changes are still applied with the restart button, and the restart
  rebuilds, so the new plugin is loaded.
- Production still builds, then serves, in one process.
