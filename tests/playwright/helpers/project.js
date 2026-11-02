import fs from 'node:fs'
import path from 'node:path'

import { copyStarter } from '../../helpers/starter.js'
import { findFreePort, startServer } from './server.js'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const testProjectsDir = path.join(repoRoot, 'tmp/playwright')

// Starts a real prototype project in a temporary directory, so tests can
// change files and start the watchers without touching the starter itself.
async function startTestProject() {
	fs.mkdirSync(testProjectsDir, { recursive: true })

	const dir = fs.mkdtempSync(path.join(testProjectsDir, 'project-'))
	copyStarter(dir)

	const readFile = (relativePath) => fs.readFileSync(path.join(dir, relativePath), 'utf8')

	const writeFile = (relativePath, contents) => {
		const filePath = path.join(dir, relativePath)

		fs.mkdirSync(path.dirname(filePath), { recursive: true })
		fs.writeFileSync(filePath, contents)
	}

	let server

	try {
		const port = await findFreePort()
		server = await startServer({ cwd: dir, port })
	} catch (error) {
		fs.rmSync(dir, { recursive: true, force: true })
		throw error
	}

	const cleanup = async () => {
		await server.stop()
		fs.rmSync(dir, { recursive: true, force: true })
	}

	return {
		dir,
		url: server.url,
		readFile,
		writeFile,
		getServerOutput: server.getOutput,
		cleanup
	}
}

export { startTestProject }
