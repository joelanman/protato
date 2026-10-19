const { views } = require('govuk-prototype-kit')
const config = require('govuk-prototype-kit/lib/config')

const { serviceName } = config.getConfig()

views.addFilter('shout', (s) => String(s).toUpperCase())
views.addFilter('configuredServiceName', () => serviceName)
