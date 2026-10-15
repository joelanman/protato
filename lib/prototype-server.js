import express from 'express'
import managePrototype from '../manage-prototype/index.js'
import { getErrorModel } from './utils/error-model.js'
import replaceRequire from './utils/replace-require.js'

replaceRequire()

// The parent builds the prototype and sends the result over IPC immediately
// after forking. We wait for it before deciding what to serve.
const buildResult = await new Promise((resolve) => {
	process.on('message', (message) => {
		if (message?.type === 'buildResult') {
			resolve(message.buildResult)
		}
	})
})

function createErrorApp(error) {
	const app = express()
	app.use('/manage-prototype', managePrototype.getApp())
	managePrototype.nunjucks.configure(app)
	app.all('/{*splat}', (request, response) => {
		response.status(500).render('server-error.njk', getErrorModel(error))
	})
	return app
}

let app

if (buildResult.state === 'error') {
	// the parent's build failed - show its error
	app = createErrorApp(buildResult.error)
} else {
	try {
		// imported here, not statically, so a syntax or import error in
		// app.js is caught below and shown on the error page
		const { default: getApp } = await import('./app.js')
		app = await getApp()
	} catch (err) {
		console.error('Prototype startup error:', err)
		app = createErrorApp(err)
	}
}

const port = process.env.PROTOTYPE_PORT
const server = app.listen(port)
console.log('prototype server ready')
process.send('ready')

process.on('SIGTERM', () => {
	console.log('prototype server - SIGTERM received, shutting down gracefully...')
	server.close(() => {
		console.log('prototype server - Process terminated')
		process.exit(0)
	})
})
