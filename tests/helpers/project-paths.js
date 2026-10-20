import path from 'node:path'

const repoRoot = path.join(import.meta.dirname, '../..')

/**
 * Builds the paths getPaths() would return for a project, so tests can point
 * plugin loading at a temporary project while still serving the real
 * manage-prototype views and the packages Protato ships with.
 *
 * @param {object} options
 * @param {string} options.projectDir the project being read
 * @param {string} [options.packageDir] the directory known-plugins.json is read
 *   from, defaults to this repo's root
 * @returns {object} a stand-in for getPaths()
 */
export function mockProjectPaths({ projectDir, packageDir = repoRoot } = {}) {
	return {
		project: projectDir,
		package: packageDir,
		app: path.join(projectDir, 'app'),
		managePrototype: {
			views: path.join(repoRoot, 'manage-prototype', 'views'),
			govukFrontend: path.join(repoRoot, 'node_modules', 'govuk-frontend'),
			govukFrontendViews: path.join(repoRoot, 'node_modules', 'govuk-frontend', 'dist'),
			public: path.join(repoRoot, 'manage-prototype', 'public')
		}
	}
}
