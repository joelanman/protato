const { requests } = require('govuk-prototype-kit')

requests.setupRouter().get('/hello-route', (req, res) => res.send('hello from user route'))
