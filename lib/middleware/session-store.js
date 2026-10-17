import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Store } from 'express-session'

const noop = () => {}

const HOUR = 60 * 60 * 1000

// Sessions without an expiry never expire
function isExpired(session) {
	const expires = session?.cookie?.expires
	return expires ? new Date(expires).getTime() < Date.now() : false
}

/**
 * Stores each session as its own JSON file.
 */
class FileStore extends Store {
	/**
	 * @param {string} directory - where to store session files
	 * @param {object} [options]
	 * @param {number} [options.reapInterval] - milliseconds between reaps; 0 disables
	 */
	constructor(directory, { reapInterval = HOUR } = {}) {
		super()
		this.directory = directory
		this.reaping = false
		this.reapTimer = null

		if (reapInterval > 0) {
			this.reapTimer = setInterval(() => this.reap().catch(noop), reapInterval)
			this.reapTimer.unref()

			// remove sessions left over from a previous run
			this.reap().catch(noop)
		}
	}

	filePath(id) {
		return path.join(this.directory, `${id}.json`)
	}

	async get(id, callback = noop) {
		try {
			const session = JSON.parse(await fs.readFile(this.filePath(id), 'utf8'))

			if (isExpired(session)) {
				await this.destroy(id)
				callback(null, null)
				return
			}

			callback(null, session)
		} catch (error) {
			if (error.code === 'ENOENT') {
				callback(null, null)
				return
			}

			if (error instanceof SyntaxError) {
				// corrupt: remove it now rather than re-reading it on every request
				await this.destroy(id)
				callback(null, null)
				return
			}

			callback(error)
		}
	}

	async set(id, session, callback = noop) {
		try {
			await fs.mkdir(this.directory, { recursive: true })

			const filePath = this.filePath(id)

			// write to a temporary file then rename it, so an interrupted
			// write can't leave a half-written session behind
			const temporaryPath = `${filePath}.${randomUUID()}.tmp`
			await fs.writeFile(temporaryPath, JSON.stringify(session))
			await fs.rename(temporaryPath, filePath)

			callback(null)
		} catch (error) {
			callback(error)
		}
	}

	async destroy(id, callback = noop) {
		try {
			await fs.rm(this.filePath(id), { force: true })
			callback(null)
		} catch (error) {
			callback(error)
		}
	}

	/**
	 * Remove expired sessions.
	 * Reads files one at a time to avoid opening them all at once.
	 */
	async reap() {
		if (this.reaping) return
		this.reaping = true

		try {
			let filenames

			try {
				filenames = await fs.readdir(this.directory)
			} catch {
				// no sessions directory yet
				return
			}

			for (const filename of filenames) {
				if (!filename.endsWith('.json')) continue

				const id = filename.slice(0, -'.json'.length)

				try {
					const session = JSON.parse(await fs.readFile(path.join(this.directory, filename), 'utf8'))

					if (isExpired(session)) {
						await this.destroy(id)
					}
				} catch {
					// unreadable or malformed - remove it
					await this.destroy(id)
				}
			}
		} finally {
			this.reaping = false
		}
	}

	close() {
		if (this.reapTimer) clearInterval(this.reapTimer)
		this.reapTimer = null
	}
}

export default FileStore
