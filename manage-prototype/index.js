// manage prototype
//
// /manage-prototype is a reserved namespace, so kit pages cannot collide with
// the pages in app/views. Three pieces serve it, with different lifetimes:
//
//   export            file                    why it is separate
//   sessionApp        apps/session-app.js     needs the session, exists in prod
//   devApp            apps/dev-app.js         must survive prototype restarts
//   templatePreview   routes/preview.js       needs the prototype's views
//
// The dev server imports devApp directly, so the plugin manager is never loaded
// in production. proxyPaths is what it proxies to the prototype server.

import { getSessionApp, pagePaths } from './apps/session-app.js'

const templatePreviewPath = '/manage-prototype/templates/view'

const proxyPaths = [...pagePaths.map((path) => `/manage-prototype${path}`), templatePreviewPath]

export default { getSessionApp, templatePreviewPath, proxyPaths }
