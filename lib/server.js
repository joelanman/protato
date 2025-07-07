const app = require('./app.js')
const build = require('./build.js')

build()
app.listen(3000)
console.log("Running at http://localhost:3000")
