const path = require('node:path')

const express = require('express')
const nunjucks = require('nunjucks')

const env = (process.env.NODE_ENV || 'development').toLowerCase()

const app = express()

const paths = { views: {} }
paths.project = process.cwd()
paths.views.project = path.join(paths.project, 'app', 'views')
paths.views.govukPrototypeKit = path.join(__dirname, '../views')
paths.views.govukFrontend = path.join(paths.project, 'node_modules/govuk-frontend/dist')

// Set up Nunjucks

app.set('view engine', 'html')

var appViews = [
  paths.views.project,
  paths.views.govukPrototypeKit,
  paths.views.govukFrontend
]

var nunjucksConfig = {
  autoescape: true,
  noCache: true,
  watch: false
}

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
