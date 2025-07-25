#!/usr/bin/env node

import { program } from 'commander'
import server from '../lib/server.js'

program
	.command('dev')
	.description('Start development server')
	.action(() => {
		console.log('🥔 Starting protato development server')
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

program.parse(process.argv)
