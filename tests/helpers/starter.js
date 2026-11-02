import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const starterDir = path.join(repoRoot, 'starter')
const starterNodeModulesDir = path.join(starterDir, 'node_modules')
const starterTmpDir = path.join(starterDir, '.tmp')

// Copy the starter without node_modules or build output, then point
// node_modules at the installed copy. Copying node_modules is unreliable on
// Windows because it contains symlinks and junctions.
function copyStarter(destinationDir) {
	fs.cpSync(starterDir, destinationDir, {
		recursive: true,
		filter: (source) => {
			if (source === starterNodeModulesDir) {
				return false
			}

			return source !== starterTmpDir && !source.startsWith(starterTmpDir + path.sep)
		}
	})

	fs.symlinkSync(starterNodeModulesDir, path.join(destinationDir, 'node_modules'), 'junction')
}

export { copyStarter }
