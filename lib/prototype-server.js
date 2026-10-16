import express from 'express'
import managePrototype from '../manage-prototype/index.js'
import { getErrorModel } from './utils/error-model.js'
import replaceRequire from './utils/replace-require.js'

function createErrorApp(error) {
	const app = express()
	app.use('/manage-prototype', managePrototype.getApp())
	managePrototype.nunjucks.configure(app)
	app.all('/{*splat}', (request, response) => {
		response.status(500).render('server-error.njk', getErrorModel(error))
	})
	return app
}

async function start(port, buildResult) {
	replaceRequire()

	let app

	if (buildResult.state === 'error') {
		// the build failed - show its error
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

	app.listen(port)
	console.log('prototype server ready')
}

// When forked by dev-server.js, start when instructed over IPC and signal when ready
process.on('message', async (message) => {
	if (message.action === 'start') {
		await start(message.port, message.buildResult)
		process.send('ready')
	}
})

process.on('disconnect', () => {
	process.exit(0)
})

export default { start }
