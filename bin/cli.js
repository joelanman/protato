#!/usr/bin/env node

import { program } from 'commander'
import { start } from '../lib/start.js'

program
	.command('dev')
	.description('Start development server')
	.action(async () => {
		console.log('🥔 Starting protato development server')
		process.env.NODE_ENV = 'development'
		console.log()
		start()
	})

program
	.command('start')
	.description('Start production server')
	.action(async () => {
		console.log('🥔 Starting protato production server')
		process.env.NODE_ENV = 'production'
		console.log()
		start()
	})

program
	.command('create:local')
	.description('Create prototype locally')
	.argument('<path>', 'path to create new prototype in')
	.action(async (path) => {
		console.log('Creating prototype locally...')
		console.log()
		const { create } = await import('../scripts/create.js')
		create(path)
	})

program.parse(process.argv)
