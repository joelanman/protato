// Paths in the manage prototype URL space, relative to /manage-prototype.
//
// Only the paths used by more than one module live here. Code outside an app
// (auth, CSRF, redirects, the dev server) builds absolute URLs with managePath,
// so the password page and the asset mounts cannot drift.

const managePrototypePath = '/manage-prototype'

// Shared paths inside the manage prototype URL space
const passwordPagePath = '/password'
const templatesPath = '/templates'
const publicStaticPath = '/public'
const govukFrontendStaticPath = '/govuk-frontend'

const managePath = (path) => `${managePrototypePath}${path}`

// Requests the prototype server serves before anyone signs in: the password
// page itself, and the assets it needs to render. Used by checkAuth.
const unauthenticatedPaths = [managePath(passwordPagePath)]
const unauthenticatedPathPrefixes = [managePath(publicStaticPath), managePath(govukFrontendStaticPath)]

export {
	govukFrontendStaticPath,
	managePath,
	managePrototypePath,
	passwordPagePath,
	publicStaticPath,
	templatesPath,
	unauthenticatedPathPrefixes,
	unauthenticatedPaths
}
