// Finds a free port when the configured one is taken, so another running
// prototype does not stop this one from starting.

import net from 'node:net'
import { createInterface } from 'node:readline/promises'

// How many ports after the configured one to try.
const portSearchRange = 50

function isPortFree(port) {
	return new Promise((resolve) => {
		const server = net.createServer()

		server.once('error', () => {
			resolve(false)
		})

		server.once('listening', () => {
			server.close(() => resolve(true))
		})

		server.listen(port)
	})
}

// Finds the first free port from startPort, or throws if there is none.
//
// With ask, a taken startPort is reported and the user can accept the next
// free port or decline, which returns null. Non-interactive runs (tests, CI)
// accept it without asking.
async function findFreePort(startPort, { ask = false } = {}) {
	const endPort = startPort + portSearchRange

	for (let port = startPort; port < endPort; port++) {
		if (await isPortFree(port)) {
			if (port === startPort || !ask) {
				return port
			}

			console.error('Port ' + startPort + ' is in use - you may have another prototype running.')

			const isInteractive = process.stdin.isTTY

			if (isInteractive) {
				const shouldChangePort = await confirmChangePort()

				if (!shouldChangePort) {
					return null
				}
			}

			console.log('Changed to port ' + port)

			return port
		}
	}

	throw new Error('Could not find a free port between ' + startPort + ' and ' + (endPort - 1))
}

async function confirmChangePort() {
	const readline = createInterface({ input: process.stdin, output: process.stdout })
	let changePort = null

	try {
		while (changePort === null) {
			const answer = (await readline.question('Change to an available port? (Y/n) ')).trim().toLowerCase()

			if (answer === '' || answer === 'y' || answer === 'yes') {
				changePort = true
			} else if (answer === 'n' || answer === 'no') {
				changePort = false
			}
		}
	} finally {
		readline.close()
	}

	return changePort
}

export { findFreePort, isPortFree }
