import fs from 'node:fs'
import path from 'node:path'

// A descendant that ignores SIGTERM and keeps running, so only a force kill of
// the whole process group stops it.
const dir = process.env.FIXTURE_DIR
let heartbeats = 0

fs.writeFileSync(path.join(dir, 'descendant-started'), String(process.pid))

// SIGTERM is ignored, so only a force kill of the whole process group stops it
process.on('SIGTERM', () => {})

setInterval(() => {
	heartbeats++
	fs.writeFileSync(path.join(dir, 'descendant-heartbeat'), String(heartbeats))
}, 25)
