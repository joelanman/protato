import getApp from './app.js'
import build from './build.js'

const server = {
	start: async () => {
		build()
		const app = await getApp()
		app.listen(3000)
		console.log('Running at http://localhost:3000')
	}
}

export default server
