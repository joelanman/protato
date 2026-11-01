import fs from 'node:fs'
import path from 'node:path'

import crossSpawn from 'cross-spawn'

// The starter depends on protato with a file: link. npm records protato's whole
// dependency tree inside starter/package-lock.json, so that lockfile goes stale
// whenever the root dependencies change. npm audit reads the lockfile, not the
// installed packages, so the starter then reports vulnerabilities that were
// fixed in the root. npm install reuses the old lockfile entries, so the lock
// has to be deleted first to make npm resolve against the installed root.

const __dirname = import.meta.dirname
const starterPath = path.join(__dirname, '../starter')
const starterLockPath = path.join(starterPath, 'package-lock.json')

fs.rmSync(starterLockPath, { force: true })

const result = crossSpawn.sync('npm', ['install'], {
	cwd: starterPath,
	stdio: 'inherit'
})

if (result.status !== 0) {
	process.exit(result.status ?? 1)
}
