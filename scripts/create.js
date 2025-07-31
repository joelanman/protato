import fs from 'node:fs'
import path from 'node:path'

const __dirname = import.meta.dirname

function create(createPath) {
	// if the path has files in it, stop and warn

	if (fs.existsSync(createPath)) {
		const stats = fs.statSync(createPath)
		if (!stats.isDirectory()) {
			console.error('Path is not an empty directory')
			console.error(createPath)
			return
		} else if (fs.readdirSync(createPath).length > 0) {
			console.error('Path is not an empty directory')
			console.error(createPath)
			return
		}
	}

	fs.cpSync(path.join(__dirname, '../starter'), createPath, { recursive: true })
	console.log('Done')
}

export { create }
