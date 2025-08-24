// error server

import express from 'express'

import { getInternalNunjucksEnv } from '../lib/internal-renderer.js'
import { getErrorModel } from '../lib/utils/error-model.js'
import { getPaths } from './paths.js'

const error = { message: process.argv[2] }

const paths = getPaths()
const app = express()

// serve internal assets

app.use('/manage-prototype/public', express.static(paths.internal.public))
app.use('/manage-prototype/govuk-frontend', express.static(paths.internal.govukFrontend))

// nunjucks setup

const internalNunjucksEnv = getInternalNunjucksEnv()

app.set('view engine', 'njk')
internalNunjucksEnv.express(app)

// handle app server start errors

app.get('/{*splat}', (request, response) => {
	console.log('error server request:' + request.path)
	response.render('server-error.njk', getErrorModel(error))
})

app.listen(process.env.PROTOTYPE_PORT)
console.log('Running at http://localhost:' + process.env.PROTOTYPE_PORT)
