import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// A process-tree fixture parent. It starts a descendant in the same process
// group and exits on SIGTERM, so the descendant can outlive it. Both keep the
// inherited stdout pipe open, which also covers the case where waiting for the
// parent's stdio `close` event would otherwise hang.
const dir = process.env.FIXTURE_DIR
const write = (name) => fs.writeFileSync(path.join(dir, name), String(process.pid))
let heartbeats = 0

write('parent-started')

// `inherit` keeps the parent's output pipe open in the descendant, so waiting
// for stdio `close` would hang. `ignore` lets the parent's pipes close while the
// descendant survives, which catches settling on an early parent exit.
spawn(process.execPath, [path.join(import.meta.dirname, 'descendant.js')], {
	stdio: process.env.FIXTURE_STDIO === 'ignore' ? 'ignore' : 'inherit',
	env: process.env
})

process.on('SIGTERM', () => {
	write('parent-exit')
	process.exit(0)
})

setInterval(() => {
	heartbeats++
	fs.writeFileSync(path.join(dir, 'parent-heartbeat'), String(heartbeats))
}, 25)
