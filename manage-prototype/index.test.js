import { describe, expect, it } from 'vitest'
import managePrototype from './index.js'
import { managePrototypePath } from './paths.js'

describe('manage prototype', () => {
	it('lists the paths the dev server proxies to the prototype server', () => {
		expect(managePrototype.proxyPaths).toEqual([
			'/manage-prototype/clear-data',
			'/manage-prototype/password',
			'/manage-prototype/templates/view'
		])
	})

	it('mounts every proxied path under the manage prototype path', () => {
		for (const path of managePrototype.proxyPaths) {
			expect(path.startsWith(managePrototypePath)).toBe(true)
		}
	})

	it('proxies every prototype route', () => {
		for (const route of managePrototype.prototypeRoutes) {
			expect(managePrototype.proxyPaths).toContain(route.path)
		}
	})
})
