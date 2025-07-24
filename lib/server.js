import getApp from './app.js'
import build from './build.js'
import { getConfig } from './config.js'
import replaceRequire from './replace-require.js'

let app

const server = {
	start: async () => {
		replaceRequire()
		const config = getConfig()
		build()
		app = await getApp()
		const port = config.port
		app.listen(port)
		console.log('Running at http://localhost:' + port)
	}
}

export default server
