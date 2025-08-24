import getApp from './app.js'
import replaceRequire from './utils/replace-require.js'

replaceRequire()

const app = await getApp()
const port = process.env.PROTOTYPE_PORT
const server = app.listen(port)

console.log('Running prototype')

process.on('SIGTERM', () => {
	console.log('prototype server - SIGTERM received, shutting down gracefully...')
	server.close(() => {
		console.log('prototype server - Process terminated')
		process.exit(0)
	})
})
