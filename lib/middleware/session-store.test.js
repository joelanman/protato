import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FileStore from './session-store.js'

const future = new Date(Date.now() + 60_000).toISOString()
const past = new Date(Date.now() - 60_000).toISOString()

function sessionExpiringAt(expires, data = { name: 'Jo' }) {
	return { data, cookie: { expires } }
}

function promisifyStore(store) {
	return {
		get: (id) =>
			new Promise((resolve, reject) => {
				store.get(id, (error, session) => (error ? reject(error) : resolve(session)))
			}),
		set: (id, session) =>
			new Promise((resolve, reject) => {
				store.set(id, session, (error) => (error ? reject(error) : resolve()))
			}),
		destroy: (id) =>
			new Promise((resolve, reject) => {
				store.destroy(id, (error) => (error ? reject(error) : resolve()))
			})
	}
}

describe('FileStore', () => {
	let directory
	let store
	let api

	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), 'protato-sessions-'))
		store = new FileStore(directory, { reapInterval: 0 })
		api = promisifyStore(store)
	})

	afterEach(async () => {
		store.close()
		await fs.rm(directory, { recursive: true, force: true })
	})

	it('saves and reads a session', async () => {
		const session = sessionExpiringAt(future)

		await api.set('abc', session)

		expect(await api.get('abc')).toEqual(session)
	})

	it('returns null for a session that does not exist', async () => {
		expect(await api.get('missing')).toBe(null)
	})

	it('removes a malformed session file when it is read', async () => {
		await fs.writeFile(path.join(directory, 'abc.json'), 'not json')

		expect(await api.get('abc')).toBe(null)
		expect(await fs.readdir(directory)).toEqual([])
	})

	it('overwrites an existing session', async () => {
		await api.set('abc', sessionExpiringAt(future))
		const updated = sessionExpiringAt(future, { name: 'Sam' })

		await api.set('abc', updated)

		expect(await api.get('abc')).toEqual(updated)
	})

	it('creates the directory if it does not exist', async () => {
		const nestedDirectory = path.join(directory, 'nested', 'sessions')
		await promisifyStore(new FileStore(nestedDirectory, { reapInterval: 0 })).set('abc', sessionExpiringAt(future))

		expect(await fs.readdir(nestedDirectory)).toEqual(['abc.json'])
	})

	it('leaves no temporary file behind', async () => {
		await api.set('abc', sessionExpiringAt(future))

		expect(await fs.readdir(directory)).toEqual(['abc.json'])
	})

	it('removes an expired session when it is read', async () => {
		await api.set('abc', sessionExpiringAt(past))

		expect(await api.get('abc')).toBe(null)
		expect(await fs.readdir(directory)).toEqual([])
	})

	it('destroys a session', async () => {
		await api.set('abc', sessionExpiringAt(future))

		await api.destroy('abc')

		expect(await api.get('abc')).toBe(null)
	})

	it('destroys a session that does not exist without error', async () => {
		await expect(api.destroy('missing')).resolves.toBeUndefined()
	})

	describe('reap', () => {
		it('removes expired sessions and keeps active ones', async () => {
			await api.set('expired', sessionExpiringAt(past))
			await api.set('active', sessionExpiringAt(future))

			await store.reap()

			expect(await fs.readdir(directory)).toEqual(['active.json'])
		})

		it('removes malformed session files', async () => {
			await fs.writeFile(path.join(directory, 'broken.json'), 'not json')

			await store.reap()

			expect(await fs.readdir(directory)).toEqual([])
		})

		it('does nothing when the directory does not exist', async () => {
			await expect(new FileStore(path.join(directory, 'missing'), { reapInterval: 0 }).reap()).resolves.toBeUndefined()
		})
	})

	describe('reap interval', () => {
		afterEach(() => {
			vi.useRealTimers()
		})

		it('reaps periodically', async () => {
			vi.useFakeTimers()
			const intervalStore = new FileStore(directory, { reapInterval: 60_000 })
			const reap = vi.spyOn(intervalStore, 'reap').mockResolvedValue()

			await vi.advanceTimersByTimeAsync(60_000)

			expect(reap).toHaveBeenCalledTimes(1)
			intervalStore.close()
		})

		it('stops reaping when closed', async () => {
			vi.useFakeTimers()
			const intervalStore = new FileStore(directory, { reapInterval: 60_000 })
			const reap = vi.spyOn(intervalStore, 'reap').mockResolvedValue()

			intervalStore.close()
			await vi.advanceTimersByTimeAsync(120_000)

			expect(reap).not.toHaveBeenCalled()
		})
	})
})
