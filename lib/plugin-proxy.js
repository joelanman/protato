import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from './paths.js'

const PROXY_FILE = 'plugin-proxy.json'

// packages that behave like plugins but do not ship a plugin config
const BUILT_IN_CONFIGS = {
	jquery: {
		scripts: ['/dist/jquery.js'],
		assets: ['/dist'],
		meta: {
			description:
				'jQuery is a fast, small, and feature-rich JavaScript library. It makes things like HTML document traversal and manipulation, event handling, animation, and Ajax much simpler with an easy-to-use API that works across a multitude of browsers.'
		}
	},
	'notifications-node-client': {
		meta: {
			description:
				'GOV.UK Notify makes it easy for public sector service teams to send emails, text messages and letters.'
		}
	}
}

let warnedAboutInvalidFile = false

function readUserConfig(appDir) {
	if (!appDir) {
		return
	}

	const filePath = path.join(appDir, PROXY_FILE)

	if (!fs.existsSync(filePath)) {
		return
	}

	try {
		const config = JSON.parse(fs.readFileSync(filePath, 'utf8'))

		if (typeof config !== 'object' || config === null || Array.isArray(config)) {
			throw new Error('expected an object')
		}

		warnedAboutInvalidFile = false
		return config
	} catch (error) {
		if (!warnedAboutInvalidFile) {
			console.warn(`Protato: could not read ${filePath}: ${error.message}`)
			warnedAboutInvalidFile = true
		}
	}
}

function getProxyPluginConfig(packageName) {
	const userConfig = readUserConfig(getPaths().app)
	const configs = userConfig ? { ...BUILT_IN_CONFIGS, ...userConfig } : BUILT_IN_CONFIGS
	const config = configs[packageName]

	return config ? structuredClone(config) : undefined
}

export { getProxyPluginConfig }
