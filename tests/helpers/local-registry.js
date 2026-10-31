import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { runNpmSync } from './npm.js'

// End to end tests install plugins with real npm, so they need a registry. This
// is a local one: it serves packuments and tarballs for test plugins, which
// keeps the tests offline and away from the real npm registry.
//
// npm reads the registry from npm_config_registry, and so does
// lib/manage-plugins/registry.js, so pointing that variable at the URL this
// returns is enough for both installs and update checks.

function writeFile(dir, filePath, contents) {
	const fullPath = path.join(dir, filePath)
	fs.mkdirSync(path.dirname(fullPath), { recursive: true })
	fs.writeFileSync(fullPath, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`)
}

// Packs a plugin as a .tgz the way npm would publish it, so npm can install it.
function createPluginTarball({ packageName, version, description, stylesheet }) {
	const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-plugin-source-'))
	const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protato-plugin-tarball-'))

	writeFile(sourceDir, 'package.json', {
		name: packageName,
		version,
		description,
		files: ['govuk-prototype-kit.config.json', 'css']
	})

	writeFile(sourceDir, 'govuk-prototype-kit.config.json', {
		meta: { description },
		stylesheets: ['/css/plugin.css']
	})

	writeFile(sourceDir, 'css/plugin.css', stylesheet)

	runNpmSync(['pack', '--pack-destination', packDir], { cwd: sourceDir })

	const tarballName = fs.readdirSync(packDir).find((file) => file.endsWith('.tgz'))

	return {
		version,
		tarballPath: path.join(packDir, tarballName),
		cleanup: () => {
			fs.rmSync(sourceDir, { recursive: true, force: true })
			fs.rmSync(packDir, { recursive: true, force: true })
		}
	}
}

// Serves the tarballs as an npm registry. The last tarball for a package is its
// latest version, which is what npm installs and what an update is offered for.
async function createLocalRegistry({ packages }) {
	const byPackageName = new Map()

	for (const { packageName, tarballs } of packages) {
		const versions = tarballs.map(({ version, tarballPath }) => {
			const contents = fs.readFileSync(tarballPath)

			return {
				version,
				tarballName: path.basename(tarballPath),
				contents,
				shasum: createHash('sha1').update(contents).digest('hex'),
				integrity: 'sha512-' + createHash('sha512').update(contents).digest('base64')
			}
		})

		byPackageName.set(packageName, versions)
	}

	const server = http.createServer((request, response) => {
		const { port } = server.address()
		const tarballUrl = (packageName, tarball) => `http://127.0.0.1:${port}/${packageName}/-/${tarball.tarballName}`

		for (const [packageName, versions] of byPackageName) {
			const latest = versions.at(-1)

			if (request.url === `/${packageName}`) {
				const packument = {
					name: packageName,
					'dist-tags': { latest: latest.version },
					versions: Object.fromEntries(
						versions.map((tarball) => [
							tarball.version,
							{
								name: packageName,
								version: tarball.version,
								dist: {
									tarball: tarballUrl(packageName, tarball),
									shasum: tarball.shasum,
									integrity: tarball.integrity
								}
							}
						])
					)
				}

				response.setHeader('content-type', 'application/json')
				response.end(JSON.stringify(packument))
				return
			}

			if (request.url === `/${packageName}/latest`) {
				response.setHeader('content-type', 'application/json')
				response.end(JSON.stringify({ name: packageName, version: latest.version }))
				return
			}

			const tarball = versions.find(({ tarballName }) => request.url === `/${packageName}/-/${tarballName}`)

			if (tarball) {
				response.setHeader('content-type', 'application/octet-stream')
				response.end(tarball.contents)
				return
			}
		}

		response.statusCode = 404
		response.end('{}')
	})

	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			resolve({
				url: `http://127.0.0.1:${server.address().port}`,
				close: () => new Promise((done) => server.close(done))
			})
		})
	})
}

export { createLocalRegistry, createPluginTarball }
