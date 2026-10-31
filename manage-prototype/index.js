// manage prototype
//
// /manage-prototype is a reserved namespace, so kit pages cannot collide with
// the pages in app/views. Three pieces serve it, with different lifetimes:
//
//   piece             file                    why it is separate
//   sessionApp        apps/session-app.js     needs the session, exists in prod
//   devApp            apps/dev-app.js         must survive prototype restarts
//   templatePreview   routes/preview.js       needs the prototype's views
//
// Both apps start from apps/base-app.js (Express, views, static assets). The dev
// server imports devApp directly, so the plugin manager is never loaded in
// production. proxyPaths is what it proxies to the prototype server.

import { getSessionApp, pagePaths } from './apps/session-app.js'
import { templatePreviewPath } from './routes/preview.js'

const proxyPaths = [...pagePaths.map((path) => `/manage-prototype${path}`), templatePreviewPath]

export default { getSessionApp, proxyPaths }
