import express from 'express'
import nunjucks from 'nunjucks'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import protato from './index.js'

describe('protato public API', () => {
	let app
	let env

	beforeEach(() => {
		app = express()
		env = nunjucks.configure()
		protato.init(app, env)
	})

	describe('requests.setupRouter', () => {
		it('mounts a router on the given path', async () => {
			protato.requests.setupRouter('/user').get('/hello', (req, res) => res.send('hello from user route'))

			const response = await request(app).get('/user/hello')

			expect(response.text).toBe('hello from user route')
		})

		it('mounts a router at the root by default', async () => {
			protato.requests.setupRouter().get('/hello', (req, res) => res.send('hello'))

			const response = await request(app).get('/hello')

			expect(response.text).toBe('hello')
		})
	})

	describe('views.addFilter and views.getFilter', () => {
		it('adds a filter that templates can use', () => {
			protato.views.addFilter('shout', (value) => String(value).toUpperCase())

			expect(env.renderString('{{ "hello" | shout }}')).toBe('HELLO')
		})

		it('escapes filter output by default', () => {
			protato.views.addFilter('bold', (value) => `<b>${value}</b>`)

			expect(env.renderString('{{ "hello" | bold }}')).toBe('&lt;b&gt;hello&lt;/b&gt;')
		})

		it('returns the filter so it can be called directly', () => {
			protato.views.addFilter('shout', (value) => String(value).toUpperCase())

			expect(protato.views.getFilter('shout')('hello')).toBe('HELLO')
		})

		it('marks renderAsHtml filter output as safe', () => {
			protato.views.addFilter('bold', (value) => `<b>${value}</b>`, { renderAsHtml: true })

			expect(env.renderString('<p>{{ "hello" | bold }}</p>')).toBe('<p><b>hello</b></p>')
		})

		it('passes every argument through a renderAsHtml filter', () => {
			protato.views.addFilter('join', (separator, left, right) => `${left}${separator}${right}`, {
				renderAsHtml: true
			})

			expect(env.renderString('{{ " and " | join("left", "right") }}')).toBe('left and right')
		})
	})

	describe('views.addFunction and views.getFunction', () => {
		it('adds a function that templates can call', () => {
			protato.views.addFunction('double', (value) => value * 2)

			expect(env.renderString('{{ double(21) }}')).toBe('42')
		})

		it('returns the function so it can be called directly', () => {
			protato.views.addFunction('double', (value) => value * 2)

			expect(protato.views.getFunction('double')(21)).toBe(42)
		})
	})
})
