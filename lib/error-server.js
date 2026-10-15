// error server

import express from 'express'
import { getManagePrototypeApp } from '../manage-prototype/app.js'
import nunjucks from '../manage-prototype/nunjucks.js'
import { getErrorModel } from './utils/error-model.js'

// The error is sent over IPC rather than as an argument, so large stack traces
// can't hit the OS argument length limit. The manager sends it immediately after
// forking; IPC is asynchronous (and delivered in chunks for large payloads), so
// this process waits for the error before it starts listening - otherwise the
// first request can be served before the error has arrived.

const error = await new Promise((resolve) => {
	process.on('message', (message) => {
		if (message?.type === 'error') {
			resolve(message.error)
		}
	})
})

const app = express()

// manage-prototype assets

app.use('/manage-prototype', getManagePrototypeApp())

// nunjucks setup

nunjucks.configure(app)

// handle app server start errors

app.get('/{*splat}', (request, response) => {
	console.log('error server request:' + request.path)
	response.render('server-error.njk', getErrorModel(error))
})

app.listen(process.env.PROTOTYPE_PORT)
console.log('error server ready')
process.send('ready')
