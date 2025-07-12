import request from 'supertest'
import { describe, expect, test } from 'vitest'

import getApp from './app.js'

process.chdir('starter')

console.log('app.test.js')
console.log(process.cwd())

describe('app', () => {
	test('request /', async () => {
		const app = await getApp()
		const response = await request(app).get('/')
		expect(response.statusCode).toBe(200)
	})
})
