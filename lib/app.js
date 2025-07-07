const express = require('express')
const nunjucks = require('nunjucks')

const paths = require('./paths')

const env = (process.env.NODE_ENV || 'development').toLowerCase()

const app = express()

// serve static assets

app.use('/public', express.static(paths.public.root))

// Set up Nunjucks

app.set('view engine', 'html')

var appViews = [paths.views.project, paths.views.govukPrototypeKit, paths.views.govukFrontend]

var nunjucksConfig = { autoescape: true, noCache: true, watch: false }

if (env === 'development') {
	nunjucksConfig.watch = true
}

nunjucksConfig.express = app

// var nunjucksAppEnv = nunjucks.configure(appViews, nunjucksConfig)

nunjucks.configure(appViews, nunjucksConfig)

app.get('/', (req, res) => {
	res.render('index')
})

module.exports = app
