import fs from 'node:fs'

export async function waitForFile(filePath, timeoutMs = 5000) {
	const startedAt = Date.now()

	while (Date.now() - startedAt < timeoutMs) {
		if (fs.existsSync(filePath)) {
			return
		}

		await new Promise((resolve) => setTimeout(resolve, 10))
	}

	throw new Error(`Timed out waiting for ${filePath}`)
}

/**
 * Waits for a file that a fixture rewrites on a timer. Returns true when the
 * file did not change, which shows the process writing it has stopped.
 */
export async function waitForStableFile(filePath, durationMs = 300) {
	const before = fs.readFileSync(filePath, 'utf8')

	await new Promise((resolve) => setTimeout(resolve, durationMs))

	return fs.readFileSync(filePath, 'utf8') === before
}
