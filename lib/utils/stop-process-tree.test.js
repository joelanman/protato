import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stopProcessTree } from './stop-process-tree.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

let child
let kill
const noGroup = () => {
	throw Object.assign(new Error('no such group'), { code: 'ESRCH' })
}

beforeEach(() => {
	child = { pid: 12345, exitCode: null, signalCode: null }
	kill = vi.spyOn(process, 'kill').mockImplementation(noGroup)
})

afterEach(() => vi.restoreAllMocks())

describe('stopProcessTree', () => {
	it('does nothing without a child pid', async () => {
		await expect(stopProcessTree(undefined)).resolves.toBeUndefined()
		await expect(stopProcessTree({})).resolves.toBeUndefined()
		expect(kill).not.toHaveBeenCalled()
	})

	it.skipIf(process.platform === 'win32')('signals the group and waits until it is gone', async () => {
		let probes = 0
		kill.mockImplementation((pid, signal) => {
			if (signal === 0 && probes++ > 0) noGroup()
			return true
		})
		await stopProcessTree(child)
		expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
		expect(probes).toBe(2)
	})

	it.skipIf(process.platform === 'win32')('accepts a missing group only if the parent exited', async () => {
		await expect(stopProcessTree(child)).rejects.toMatchObject({ code: 'INVALID_PROCESS_GROUP' })
		child.exitCode = 0
		await expect(stopProcessTree(child)).resolves.toBeUndefined()
	})

	it.skipIf(process.platform === 'win32')('does not mistake permission errors for an absent group', async () => {
		kill.mockImplementation(() => {
			throw Object.assign(new Error('permission denied'), { code: 'EPERM' })
		})
		child.exitCode = 0
		await expect(stopProcessTree(child)).rejects.toMatchObject({ name: 'ProcessTreeError', code: 'CLEANUP_FAILED' })
	})

	it.skipIf(process.platform !== 'win32')('reports unknown cleanup after the parent exits', async () => {
		child.exitCode = 0
		await expect(stopProcessTree(child)).rejects.toMatchObject({ code: 'UNKNOWN_CLEANUP' })
		expect(spawn).not.toHaveBeenCalled()
	})

	it.skipIf(process.platform !== 'win32')('runs taskkill and waits for the parent to stop', async () => {
		spawn.mockImplementationOnce(() => {
			const killer = new EventEmitter()
			queueMicrotask(() => {
				child.exitCode = 1
				killer.emit('close', 0)
			})
			return killer
		})
		await stopProcessTree(child)
		expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', String(child.pid), '/T', '/F'], expect.any(Object))
	})

	it.skipIf(process.platform !== 'win32')('reports taskkill failure', async () => {
		spawn.mockImplementationOnce(() => {
			const killer = new EventEmitter()
			queueMicrotask(() => killer.emit('error', new Error('could not start taskkill')))
			return killer
		})
		await expect(stopProcessTree(child)).rejects.toMatchObject({ code: 'CLEANUP_FAILED' })
	})
})
