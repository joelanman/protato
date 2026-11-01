# Supporting file uploads

An analysis of whether Protato should handle file uploads, what the options
are, and how it would work. **Decision: not now.** Nothing here is implemented.
This records the findings so the work can be picked up later without redoing the
investigation.

## Summary

Uploads already *work* in the sense that the bytes arrive. The body parsers in
`lib/middleware/session.js` only handle `application/json` and
`application/x-www-form-urlencoded`, so a `multipart/form-data` POST streams
through untouched, in development and in production.

What is missing is anything that treats an uploaded file as form data. A page
with a file input loses every field on it, and nothing echoes a filename back to
the user. Adding support means deciding how much of that gap to close, and the
answer is not "store the files" on its own — it is "store a reference to the
file in session data" so uploads behave like the text fields around them.

The main risk to design around is not storage or hosting. It is the middleware
order: a global multipart parser breaks the projects that already added their
own parser.

## How uploads behave today

| Concern | Current state |
| --- | --- |
| `multipart/form-data` parsing | Not parsed. `bodyParser.json()` and `bodyParser.urlencoded()` in `lib/middleware/session.js` ignore it |
| Request body in dev | Proxied intact by `lib/dev/proxy.js` |
| `request.body` for a multipart POST | Empty |
| `autoStoreData` for a multipart POST | Stores nothing, including any text inputs in the same form |
| Bounded by | Nothing. No file size limit is enforced anywhere |
| Kit parity | The GOV.UK Prototype Kit behaves in all the same ways |

The practical failure is the last row but one. A page that combines a file input
with text inputs silently drops the whole form between pages, which is hard to
diagnose and will happen to anyone dropping in the GOV.UK Frontend file upload
component.

### Uploads through the development proxy

Verified against `lib/dev/proxy.js` with a real multipart body:

| Case | Result |
| --- | --- |
| 2 MB `curl -F file=@…` (sends `Expect: 100-continue`) | All 2000211 bytes arrive, headers intact |
| `fetch` + `FormData` with `Content-Length` | Intact |
| Chunked upload with no `Content-Length` | Intact |

So the proxy is not a reason to avoid uploads, and the proxy does not need to
change to support them. See "Development proxy warts" below for the failure
modes that are shared with the kit.

### The GOV.UK Prototype Kit does not parse multipart either

Checked against `../govuk-prototype-kit` (v14.0.2). `server.js` has only
`express.json()` and `express.urlencoded()`. There is no `multer`, `busboy` or
`formidable`; the `formidable` in its lockfile is a `superagent` test
dependency. So there is no upstream feature to copy, and no parity argument for
or against.

Kit projects handle uploads by adding their own middleware to `app/routes.js`.

## Options considered

1. **Store files.** Multipart parser, files written under `.tmp`, served at a
   URL, references stored in session data.
2. **Parse fields only.** Multipart parser that keeps text fields and drops
   files, so mixed forms behave like ordinary forms.
3. **Document, and possibly a client-side trick.** No server change.

Option 3 alone is not enough: it leaves the mixed-form papercut and makes
"show the filename on the check your answers page" — the realistic prototype
need — the author's problem. Option 1 is the feature. Option 2 is a subset of it
and is not worth doing separately.

## Design if we do it

### Storage

`.tmp/uploads/<random-id>/<sanitised basename>`, with `paths.uploads` added to
`lib/paths.js` next to `paths.sessions`.

`.tmp` is not wiped by the build: `lib/build.js` only removes `.tmp/views` and
`.tmp/public/stylesheets`. Sessions already depend on that. `.tmp` is gitignored
in the starter.

The random id in the path means the client-supplied filename is never used for
the path, so there is no traversal and no collisions. The original name is kept
for display and download only.

Session data and uploads then have the same lifecycle. On an ephemeral
filesystem (Heroku and similar) both are lost on restart, so a summary page
never points at a file that has gone. That consistency is a reason to put
uploads next to sessions rather than anywhere else.

### Session data

Store a reference in session data, not the bytes:

```js
data['passport-photo'] = {
  filename: 'photo.jpg',
  size: 48213,
  url: '/uploads/8f2c…/photo.jpg'
}
```

A check your answers page then works with no project code, the same way text
fields do, using `{{ data['passport-photo'].filename }}`.

Text fields in the same multipart form are merged into `request.body` so
`autoStoreData` keeps them and the mixed-form papercut goes away.

Open question: a field keeps only the latest upload, or every upload. Keeping
only the latest keeps `data[field]` a plain object and matches what re-posting a
form does.

### Serving

`app.use('/uploads', …)` in `lib/app.js`, mounted after `checkAuth` so uploads
inherit the prototype password, next to the existing static mounts.

### Limits

A per-file limit enforced while streaming (default around 10 MB, overridable in
`app/config.json`). No total disk accounting: prototypes are throwaway, but a
limit matters because the parser ships to production too and a shared prototype
can otherwise fill a dyno's disk.

### Clearing

Add uploads to the existing clear-data POST in
`manage-prototype/routes/session.js` so that page stays truthful.

### Projects with their own parser

This is the main compatibility risk, see below.

## Risk: a project that already parses multipart

A multipart parser would be mounted globally through
`session.addSessionMiddleware`, which runs before `app/routes.js`. A project's
own `multer` would then attach to a stream that has already been consumed, never
receive `finish`, and the POST would **hang** rather than fail with a clear
error. It would only affect projects that already solved uploads themselves.

Mitigations, in order of value:

- At startup, check the project's `package.json` for `multer`, `busboy`,
  `formidable`, `multiparty` or `connect-multiparty`. If one is present, do not
  mount Protato's parser and log one line. This covers essentially everyone
  affected, because they had to install something.
- An `app/config.json` flag to turn the parser off.
- Expose `request.files` and `request.file` in multer's shape (`fieldname`,
  `originalname`, `size`, `mimetype`, `path`), so dropping the project's own
  middleware is a one-line change rather than a route rewrite.
- Say so in the release notes, since it changes behaviour for existing projects.

Mounting the parser after the user's routes, so a project route wins, does not
compose with `autoStoreData` needing the body before rendering. Detect and skip
is simpler and easier to follow.

## Remaining risks

- **Serving uploaded HTML or SVG from the prototype origin** is stored XSS. The
  blast radius is small: the attacker needs the prototype password, the victim
  is another password holder, and the session cookie is `httpOnly`. Cheap
  safeguard anyway: send `X-Content-Type-Options: nosniff` and serve anything
  outside an image allowlist as `Content-Disposition: attachment`.
- **The parser ships to production.** `protato start` uses the same app, so this
  is not a dev-only feature. Acceptable for throwaway prototypes, but it is why
  the size limit is not optional.
- **Session files stay small.** Only the reference object is stored, never the
  bytes.

## Tests to add

- A multipart POST stores the file and the reference appears in session data.
- Text fields in the same multipart form are stored.
- An oversized file gives the kit error page, not a hang.
- Filenames are sanitised, with nothing written outside `.tmp/uploads`.
- A project with `multer` installed is detected and Protato's parser is skipped.

The request body tests for the dev proxy are already in `lib/dev/proxy.test.js`,
for the multipart and chunked cases described above.

## Decisions needed

- Default size limit (10 MB?).
- Latest upload per field, or every upload.
- Whether the mid-form papercut is worth the dependency on its own, or only as
  part of the full feature.

## What to do now

1. Document the current behaviour, so a project author can find out that
   multipart is unparsed and that the proxy is not in the way.
2. Add the dev proxy request body tests, which lock in behaviour that is already
   correct.
3. Wait for evidence that authors want this. If only the filename matters, a
   client-side version exists: `plugin/assets/javascripts/auto-store-data.js`
   already runs on submit, and could swap each file input for a hidden field
   holding the filename, which lets the form post as
   `x-www-form-urlencoded` so `autoStoreData` stores it. That needs no
   dependency and no server change, but it is invisible magic, it means the
   bytes never reach the server, and it would need an opt-out.

## Development proxy warts

Related, but a separate piece of work. These come from `lib/dev/proxy.js` and
were shared with the kit's own dev proxy (`browser-sync` 3.0.4, which uses
`http-proxy` 1.18.1). Every package below was tested directly against the same
scenarios.

### Fixed

- **Server-sent events were held back.** Response headers were only flushed with
  the first byte of the body, so `EventSource` stayed in CONNECTING until the
  prototype sent something. Measured at 1529 ms against a target that flushed
  its headers immediately. `response.flushHeaders()` brings that to 4 ms.
- **The browser hung when the prototype died mid-response.** A restart during a
  response left the request open forever. The response is now destroyed, so the
  browser shows an error, and an `EventSource` reconnects on its own.
- **Cancelled requests leaked.** A cancelled upload, and every navigation away
  from an event stream, left the upstream request open until the prototype
  timed out. The upstream request is now destroyed when the browser goes away.
- **A proxy failure showed express's stack trace.** Requests that arrive while
  the prototype restarts now get the kit error page.

### Still outstanding

| Scenario | `lib/dev/proxy.js` | Kit (`browser-sync` → `http-proxy`) |
| --- | --- | --- |
| WebSockets | Not proxied | Proxied (`ws: true`) |
| HTML snippet injection | None | Yes (`resp-modifier`) |
| `host` header | Rewritten to the prototype port | Browser's `Host` kept |

The `host` rewrite means prototype code that builds absolute URLs from
`req.get('host')` leaks the prototype's port in Protato and not in the kit.

WebSocket proxying is a small amount of work, proven: a 25 line raw socket
tunnel, forwarding the request line, headers and the `head` bytes, with both
sockets destroyed when either closes. It needs a decision about upgrades to
`/manage-prototype` paths, and tests can use `http.request` with
`Connection: Upgrade` rather than adding `ws` as a dependency.

## Should the proxy be an npm package instead

Measured against the same scenarios, with the fixes above applied to the
hand-rolled proxy:

| | hand-rolled | `http-proxy` 1.18.1 | `httpxy` 0.5.6 | `http-proxy-middleware` 4.2.1 |
| --- | --- | --- | --- | --- |
| SSE headers flushed | yes, added | no | no | no |
| Prototype dies mid-response | response destroyed | browser hangs | response terminated | response terminated |
| Prototype unreachable | 500 error page | browser hangs | browser hangs | 504 |
| Cancelled request | upstream destroyed | upstream left open | untested | untested |
| WebSockets | no, ~25 lines | built in | `proxyUpgrade` | built in |
| Dependencies | 0 | 3 | 0 | 11 (4.5 MB, ESM only) |

Decision: keep the hand-rolled proxy. Every defect found was a missing
_behaviour_, not missing plumbing. No package flushes SSE headers, and none of
them answers a request without our own error handling, so adopting one trades
about 70 readable lines we have tests for against a dependency we would still
have to configure.

Reconsider when any of these becomes true:

1. WebSocket upgrades need more than tunnelling: routing, or per-message logic.
2. Livereload is injected into proxied HTML, the way `resp-modifier` does it.
   `http-proxy-middleware`'s `on.proxyRes` and `selfHandleResponse` are exactly
   that hook, so it would become the better choice at that point.
3. More than one target, path routing, auth header injection, TLS to the target,
   or retries.
4. `lib/dev/proxy.js` passes about 150 lines, or starts reimplementing
   hop-by-hop headers, trailers or upgrade edge cases.

If that happens, `httpxy` first (zero dependencies, maintained, `proxyUpgrade`),
then `http-proxy-middleware` if routing or response rewriting is needed. Not
`http-proxy`: it has been in maintenance mode since 2020 and drags
`follow-redirects` through its advisory history.
