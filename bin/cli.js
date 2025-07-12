#!/usr/bin/env node

import { program } from 'commander'
import server from '../lib/server.js'

program
	.command('dev')
	.description('Start development server')
	.action(() => {
		console.log('🥔 Starting protato development server...')
		server.start()
	})

program.parse(process.argv)
