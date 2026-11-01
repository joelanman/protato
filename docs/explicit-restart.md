# Explicit restart

An experiment in keeping the small supervisor and the one manage app, while
making plugin changes easy to reason about.

## Flow

A plugin change runs npm in the prototype process and renders the result there:

```
POST /manage-prototype/plugins/install
  npm install
  render plugin-result
  "The plugin is not loaded until the prototype restarts."
  [Restart prototype] -> POST /__protato/restart
```

The restart button is handled by the supervisor, which already owns restarts:

```
POST /__protato/restart
  await supervisor.restartPrototypeServer()
  303 -> /manage-prototype/plugins
```

The supervisor never restarts, so it can hold the button request until the new
prototype is ready and then redirect to the plugins page. The result page was
already rendered by the old process, so the browser always gets it.

## Why

- The plugin result never has to survive a restart: it is shown before one.
- No result file, redirect hand-off or status polling.
- The supervisor stays generic: it knows `ready`, `restart`, `reload` and `down`,
  not plugins.
- Manage prototype stays one app.
- A terminal `npm install` is applied with the restart button on the plugins page.

## Proxy

The proxy no longer buffers request bodies.

- `GET` and `HEAD` wait for the prototype to be ready, because they are safe to
  repeat. This keeps page loads working through a restart.
- Other methods are sent once. If the prototype is restarting, they get a 503 and
  the user tries again. A POST is never replayed.

## Trade-offs

- The plugin is not active until the user restarts.
- A form POST that races a restart must be retried by the user.
- Restart-on-package-lock is gone. Terminal plugin installs need the restart
  button.

## What this does not change

- Manage prototype still lives in the restartable process.
- The error app still shows the error page for prototype requests, but manage
  forms keep working because the error app uses the same body parsing, session,
  auth and manage middleware as the normal app.
- Manage requests are no longer stored in the prototype session data.
