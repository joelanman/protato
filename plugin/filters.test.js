import express from 'express'
import nunjucks from 'nunjucks'
import { beforeAll, describe, expect, it } from 'vitest'
import protato from '../index.js'

let env

beforeAll(async () => {
	env = nunjucks.configure()
	protato.init(express(), env)

	// filter files register themselves as a side effect
	await import('./filters.js')
})

describe('log filter', () => {
	it('renders a script tag that logs the value', () => {
		expect(env.renderString('{{ "hello" | log }}')).toBe('<script>console.log("hello");</script>')
	})

	it('logs objects as indented JSON', () => {
		expect(env.renderString('{{ value | log }}', { value: { name: 'Ada' } })).toBe(
			'<script>console.log({\n\t"name": "Ada"\n});</script>'
		)
	})
})

describe('formatItems filter', () => {
	it('formats a single string as one item', () => {
		expect(protato.views.getFilter('formatItems')('Rubble')).toEqual([{ text: 'Rubble', value: 'Rubble' }])
	})

	it('formats an array of strings as items', () => {
		expect(protato.views.getFilter('formatItems')(['Rubble', 'Oil'])).toEqual([
			{ text: 'Rubble', value: 'Rubble' },
			{ text: 'Oil', value: 'Oil' }
		])
	})
})
