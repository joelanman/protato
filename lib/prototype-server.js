import express from 'express'
import managePrototype from '../manage-prototype/index.js'
import { getBuildResult } from './build.js'
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

// Serves the prototype for a build result. Used instead of start when the build
// result comes from somewhere other than this process. Returns the http server.
async function serve({ port, buildResult }) {
	if (!buildResult) {
		throw new Error('Build the prototype before starting it')
	}

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

	const httpServer = app.listen(port)
	console.log('prototype server ready')

	return httpServer
}

// In production the build ran in this process, so use its result.
const start = ({ port }) => serve({ port, buildResult: getBuildResult() })

// Only does anything when forked by lib/dev/supervisor.js, which sends the
// latest build result over IPC because a child process can't see the build
// result held in memory by its parent.
process.on('message', async (message) => {
	if (message.action === 'start') {
		await serve({ port: message.port, buildResult: message.buildResult })
		process.send('ready')
	}
})

process.on('disconnect', () => {
	process.exit(0)
})

export default { start }
