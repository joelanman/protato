// Paths in the manage prototype URL space, relative to /manage-prototype.
//
// The manage apps mount these. Code outside an app (auth, CSRF, redirects, the
// dev server) builds absolute URLs with managePath, so there is one definition
// instead of literals kept in sync by hand.

const managePrototypePath = '/manage-prototype'

// Paths served by the manage apps and the prototype app
const clearDataPagePath = '/clear-data'
const passwordPagePath = '/password'
const templatesPath = '/templates'
const templatePreviewPath = '/templates/view'
const pluginsPath = '/plugins'
const livereloadPath = '/livereload'
const publicAssetsPath = '/public'
const govukFrontendPath = '/govuk-frontend'

const managePath = (path) => `${managePrototypePath}${path}`

// Requests the prototype server serves without the password: the password page
// itself, and the assets it needs to render. Used by checkAuth.
const publicPaths = [managePath(passwordPagePath)]
const publicPathPrefixes = [managePath(publicAssetsPath), managePath(govukFrontendPath)]

export {
	clearDataPagePath,
	govukFrontendPath,
	livereloadPath,
	managePath,
	managePrototypePath,
	passwordPagePath,
	pluginsPath,
	publicAssetsPath,
	publicPathPrefixes,
	publicPaths,
	templatePreviewPath,
	templatesPath
}
