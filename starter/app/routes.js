//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const protato = require('protato')
const router = protato.requests.setupRouter()

// Add your routes here
router.get('/', (req, res) => {
	res.render('index')
})
