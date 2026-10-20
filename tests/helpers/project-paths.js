import path from 'node:path'

const repoRoot = path.join(import.meta.dirname, '../..')

/**
 * Builds the paths getPaths() would return for a project, so tests can point
 * plugin loading at a temporary project while still serving the real
 * manage-prototype views and the packages Protato ships with.
 *
 * @param {object} options
 * @param {string} options.projectDir the project being read
 * @returns {object} a stand-in for getPaths()
 */
export function mockProjectPaths({ projectDir } = {}) {
	return {
		project: projectDir,
		package: repoRoot,
		app: path.join(projectDir, 'app'),
		managePrototype: {
			views: path.join(repoRoot, 'manage-prototype', 'views'),
			govukFrontend: path.join(repoRoot, 'node_modules', 'govuk-frontend'),
			govukFrontendViews: path.join(repoRoot, 'node_modules', 'govuk-frontend', 'dist'),
			public: path.join(repoRoot, 'manage-prototype', 'public')
		}
	}
}
