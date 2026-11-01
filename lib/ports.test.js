import net from 'node:net'
import { createInterface } from 'node:readline/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findFreePort, isPortFree } from './ports.js'

vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }))

const originalIsTTY = process.stdin.isTTY

let servers = []

const listen = async () => {
	const server = net.createServer()
	await new Promise((resolve) => server.listen(0, resolve))
	servers.push(server)
	return server.address().port
}

const closeServer = (server) => new Promise((resolve) => server.close(resolve))

const unusedPort = async () => {
	const server = net.createServer()
	await new Promise((resolve) => server.listen(0, resolve))
	const port = server.address().port
	await closeServer(server)
	return port
}

describe('ports', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(async () => {
		for (const server of servers) {
			await closeServer(server)
		}
		servers = []
		process.stdin.isTTY = originalIsTTY
		vi.restoreAllMocks()
	})

	it('knows whether a port is free', async () => {
		const port = await listen()

		expect(await isPortFree(port)).toBe(false)

		await closeServer(servers.pop())

		expect(await isPortFree(port)).toBe(true)
	})

	it('finds the port it was given when it is free', async () => {
		const port = await unusedPort()

		expect(await findFreePort(port)).toBe(port)
	})

	it('finds a later port when the one it was given is taken', async () => {
		const port = await listen()

		const freePort = await findFreePort(port)

		expect(freePort).toBeGreaterThan(port)
		expect(freePort).toBeLessThan(port + 50)
		expect(console.error).not.toHaveBeenCalled()
		expect(console.log).not.toHaveBeenCalled()
	})

	it('does not ask when the configured port is free', async () => {
		const port = await unusedPort()

		expect(await findFreePort(port, { ask: true })).toBe(port)
		expect(console.error).not.toHaveBeenCalled()
		expect(console.log).not.toHaveBeenCalled()
	})

	it('uses a free port without asking when not interactive', async () => {
		process.stdin.isTTY = false
		const port = await listen()

		const freePort = await findFreePort(port, { ask: true })

		expect(freePort).toBeGreaterThan(port)
		expect(console.error).toHaveBeenCalledWith('Port ' + port + ' is in use - you may have another prototype running.')
		expect(console.log).toHaveBeenCalledWith('Changed to port ' + freePort)
		expect(createInterface).not.toHaveBeenCalled()
	})

	it('asks before changing to a free port', async () => {
		process.stdin.isTTY = true
		const port = await listen()
		const question = vi.fn().mockResolvedValue('y')
		const close = vi.fn()
		vi.mocked(createInterface).mockReturnValue({ question, close })

		const freePort = await findFreePort(port, { ask: true })

		expect(question).toHaveBeenCalledWith('Change to an available port? (Y/n) ')
		expect(close).toHaveBeenCalledOnce()
		expect(freePort).toBeGreaterThan(port)
	})

	it('returns null when the user does not want another port', async () => {
		process.stdin.isTTY = true
		const port = await listen()
		vi.mocked(createInterface).mockReturnValue({
			question: vi.fn().mockResolvedValue('n'),
			close: vi.fn()
		})

		expect(await findFreePort(port, { ask: true })).toBe(null)
		expect(console.log).not.toHaveBeenCalled()
	})
})
