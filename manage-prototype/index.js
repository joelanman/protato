// manage prototype
//
// The /manage-prototype URL space is served by three pieces with different
// lifetimes:
//
//   export            file                    mounted by
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
import { managePath } from './paths.js'
import templatePreview from './routes/preview.js'

// The template preview is a prototype route: it renders with the prototype's
// views so it looks like a real page, and the dev server proxies it here.
const templatePreviewPath = '/templates/view'

const prototypeRoutes = [{ path: managePath(templatePreviewPath), handler: templatePreview }]

// Every manage path the prototype server serves: the session pages, plus the
// prototype routes, which the dev server proxies to it.
const proxyPaths = [...pagePaths.map(managePath), ...prototypeRoutes.map((route) => route.path)]

export default { getSessionApp, prototypeRoutes, proxyPaths }
