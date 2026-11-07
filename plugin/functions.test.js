import express from 'express'
import nunjucks from 'nunjucks'
import { beforeAll, describe, expect, it } from 'vitest'
import protato from '../index.js'

let env

beforeAll(async () => {
	env = nunjucks.configure()
	protato.init(express(), env)

	// function files register themselves as a side effect
	await import('./functions.js')
})

describe('checked function', () => {
	const renderChecked = (expression, data) => env.renderString(`{{ ${expression} }}`, { data })

	it('returns nothing when there is no session data', () => {
		expect(renderChecked('checked("name", "yes")')).toBe('')
	})

	it('returns nothing when the requested data does not exist', () => {
		expect(renderChecked('checked("name", "yes")', { other: 'yes' })).toBe('')
	})

	it('checks a simple value that matches', () => {
		expect(renderChecked('checked("name", "yes")', { name: 'yes' })).toBe('checked')
	})

	it('does not check a simple value that does not match', () => {
		expect(renderChecked('checked("name", "no")', { name: 'yes' })).toBe('')
	})

	it('checks a value that is in an array', () => {
		expect(renderChecked('checked("waste", "oil")', { waste: ['rubble', 'oil'] })).toBe('checked')
	})

	it('does not check a value that is not in an array', () => {
		expect(renderChecked('checked("waste", "card")', { waste: ['rubble', 'oil'] })).toBe('')
	})

	it('reads a dotted path', () => {
		expect(renderChecked('checked("parent.name", "yes")', { parent: { name: 'yes' } })).toBe('checked')
	})

	it('reads a bracketed path', () => {
		expect(renderChecked(`checked("['field-name']", "yes")`, { 'field-name': 'yes' })).toBe('checked')
	})

	it('reads a nested bracketed path', () => {
		expect(renderChecked(`checked("['parent']['field-name']", "yes")`, { parent: { 'field-name': 'yes' } })).toBe(
			'checked'
		)
	})
})
