import getApp from './app.js'
import { getConfig } from './config.js'
import replaceRequire from './replace-require.js'

replaceRequire()
const config = getConfig()
const app = await getApp()
const server = app.listen(config.port)
console.log('Running at http://localhost:' + config.port)
process.on('SIGTERM', () => {
	console.log('server - SIGTERM received, shutting down gracefully...')
	server.close(() => {
		console.log('server - Process terminated')
		process.exit(0)
	})
})
