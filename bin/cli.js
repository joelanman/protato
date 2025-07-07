#!/usr/bin/env node

const { program } = require('commander')

program
	.command('dev')
	.description('Start development server')
	.action(() => {
		console.log('🥔 Starting protato development server...')
		require('../lib/server')
	})

program.parse(process.argv)
