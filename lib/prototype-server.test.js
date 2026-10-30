import { describe, expect, it, vi } from 'vitest'

vi.mock('./build.js', () => ({ getBuildResult: vi.fn() }))

import prototypeServer from './prototype-server.js'

describe('prototype server', () => {
	it('refuses to serve before the prototype has been built', async () => {
		await expect(prototypeServer.start({ port: 0 })).rejects.toThrow('Build the prototype before starting it')
	})
})
