import fs from 'node:fs'

import { getPaths } from './paths.js'

let config

function getConfig() {
	if (config !== undefined) {
		return config
	}
	const paths = getPaths()

	let userConfig = {}

	const userConfigPath = paths.config

	if (fs.existsSync(userConfigPath)) {
		try {
			userConfig = JSON.parse(fs.readFileSync(userConfigPath))
		} catch (error) {
			console.error('Error reading config.json: ' + error.message + '\n')
		}
	} else {
		console.log('app/config.json not found \n')
	}

	config = userConfig

	if (process.env.PORT) {
		config.port = process.env.PORT
	}

	if (!config.port) {
		config.port = 3000
	}

	if (!config.serviceName) {
		config.serviceName = ''
	}

	config.env = (process.env.NODE_ENV || 'development').toLowerCase()

	config.passwords = []

	for (const key in process.env) {
		if (key.startsWith('PASSWORD')) {
			config.passwords.push(process.env[key])
		}
	}

	return config
}

export { getConfig }
