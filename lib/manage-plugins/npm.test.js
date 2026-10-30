import { describe, expect, it } from 'vitest'
import { isValidPackageName } from './npm.js'

describe('isValidPackageName', () => {
	it.each(['plugin', 'govuk-frontend', '@govuk-prototype-kit/common-templates', 'plugin.name'])(
		'accepts %s',
		(packageName) => {
			expect(isValidPackageName(packageName)).toBe(true)
		}
	)

	it.each([
		'',
		'plugin; rm -rf /',
		'plugin && npm install evil',
		'plugin name',
		'../../etc/passwd',
		'-g',
		'--save-dev',
		'@scope',
		'@scope/one/two',
		'@/name',
		'@scope/',
		'.hidden',
		'_hidden',
		'a'.repeat(215)
	])('rejects %s', (packageName) => {
		expect(isValidPackageName(packageName)).toBe(false)
	})

	it('rejects values that are not strings', () => {
		expect(isValidPackageName(undefined)).toBe(false)
		expect(isValidPackageName(['plugin'])).toBe(false)
	})
})
