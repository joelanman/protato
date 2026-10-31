import { describe, expect, it } from 'vitest'
import managePrototype from './index.js'

describe('manage prototype', () => {
	it('lists the paths the dev server proxies to the prototype server', () => {
		expect(new Set(managePrototype.proxyPaths)).toEqual(
			new Set(['/manage-prototype/clear-data', '/manage-prototype/password', '/manage-prototype/templates/view'])
		)
	})

	it('proxies only paths under the manage prototype path', () => {
		for (const path of managePrototype.proxyPaths) {
			expect(path.startsWith('/manage-prototype')).toBe(true)
		}
	})
})
