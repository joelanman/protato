const { views } = require('govuk-prototype-kit')

views.addFilter('shout', (s) => String(s).toUpperCase())
