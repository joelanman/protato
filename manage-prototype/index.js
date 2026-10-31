// manage prototype
//
// Everything under /manage-prototype is served by three apps with different
// lifetimes, so different servers mount different pieces:
//
//   app               file                    mounted by
//   sessionApp        apps/session-app.js     lib/app.js, and the prototype
//                                             server's error app (it needs the
//                                             prototype session)
//   devApp            apps/dev-app.js         lib/dev/server.js (it must survive
//                                             prototype restarts)
//   prototypeRoutes   routes/preview.js       lib/app.js (they need the
//                                             prototype's Nunjucks environment)
//
// This module is the prototype server's view of that. The dev server imports
// devApp itself, so the plugin manager is never loaded in production.

import { getSessionApp, pagePaths } from './apps/session-app.js'
import { managePath, templatePreviewPath } from './paths.js'
import templatePreview from './routes/preview.js'

// Routes the prototype app must render to look like a real page
const prototypeRoutes = [{ path: managePath(templatePreviewPath), handler: templatePreview }]

// Paths the prototype server serves, which the dev server proxies to it
const proxyPaths = [...pagePaths, templatePreviewPath].map(managePath)

export default { getSessionApp, prototypeRoutes, proxyPaths }
