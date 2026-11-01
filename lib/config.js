import fs from 'node:fs'

import { getPaths } from './paths.js'

function asBoolean(value) {
	if (typeof value === 'string') {
		return value.toLowerCase() === 'true'
	}
	return value
}

// Environment values take precedence over app/config.json values.
function getBooleanSetting(environmentValue, configValue, defaultValue) {
	if (environmentValue !== undefined) {
		return asBoolean(environmentValue)
	}

	if (configValue !== undefined) {
		return asBoolean(configValue)
	}

	return defaultValue
}

let config

function getConfig() {
	if (config !== undefined) {
		return config
	}
	const paths = getPaths()

	if (fs.existsSync(paths.env)) {
		process.loadEnvFile(paths.env)
	}

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
		config.port = Number(process.env.PORT)
	}

	if (!config.port) {
		config.port = 3000
	}

	if (!config.serviceName) {
		config.serviceName = ''
	}

	config.env = (process.env.NODE_ENV || 'development').toLowerCase()

	config.useAuth = getBooleanSetting(process.env.USE_AUTH, config.useAuth, true)

	// HTTPS is on by default in production. It can be turned off where the
	// prototype is served over plain HTTP, which also turns off secure cookies.
	config.useHttps = getBooleanSetting(process.env.USE_HTTPS, config.useHttps, true)

	config.isSecure = config.env === 'production' && config.useHttps

	config.passwords = []

	for (const key in process.env) {
		if (key.startsWith('PASSWORD')) {
			config.passwords.push(process.env[key])
		}
	}

	if (process.env.CSRF_SECRET) {
		config.csrfSecret = process.env.CSRF_SECRET
	}

	return config
}

function clearCache() {
	config = undefined
}

export { clearCache, getConfig }
