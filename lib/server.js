import getApp from './app.js'
import build from './build.js'
import replaceRequire from './replace-require.js'

let app

const server = {
	start: async () => {
		replaceRequire()
		build()
		app = await getApp()
		app.listen(3000)
		console.log('Running at http://localhost:3000')
	}
}

export default server
