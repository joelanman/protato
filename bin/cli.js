#!/usr/bin/env node

import { program } from 'commander'
import server from '../lib/server.js'
import { create } from '../scripts/create.js'

program
	.command('dev')
	.description('Start development server')
	.action(() => {
		console.log('🥔 Starting protato development server')
		process.env.NODE_ENV = process.env.NODE_ENV || 'development'
		console.log()
		server.start()
	})

program
	.command('start')
	.description('Start production server')
	.action(() => {
		console.log('🥔 Starting protato production server')
		process.env.NODE_ENV = process.env.NODE_ENV || 'production'
		console.log()
		server.start()
	})

program
	.command('create:local')
	.description('Create prototype locally')
	.argument('<path>', 'path to create new prototype in')
	.action((path) => {
		console.log('Creating prototype locally...')
		console.log()
		create(path)
	})

program.parse(process.argv)
