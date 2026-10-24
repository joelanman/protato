// A small fake npm registry for scenarios. It serves package metadata and
// tarballs from fixtures, so a scenario can describe any state of the world,
// such as a govuk-frontend release that no plugin supports yet.
//
// Fixtures map a package name to its versions. Each version can set:
// - pluginDependencies: written to the package's govuk-prototype-kit.config.json
// - peerDependencies: written to the package's package.json, where npm enforces them
//
//   {
//     'govuk-frontend': { versions: { '6.6.0': {}, '7.0.0': {} } },
//     'some-plugin': {
//       versions: {
//         '1.0.0': {
//           pluginDependencies: [{ packageName: 'govuk-frontend', minVersion: '6.0.0' }],
//           peerDependencies: { 'govuk-frontend': '^6.0.0' }
//         }
//       }
//     }
//   }
//
// `latest` defaults to the highest version.
import crypto from 'node:crypto'
import http from 'node:http'
import { gzipSync } from 'node:zlib'

import semver from 'semver'
import { pack } from 'tar-stream'

async function buildTarball(packageName, version, { pluginDependencies, peerDependencies }) {
	const archive = pack()
	const chunks = []

	archive.on('data', (chunk) => chunks.push(chunk))

	const files = {
		'package/package.json': JSON.stringify({ name: packageName, version, peerDependencies }),
		'package/govuk-prototype-kit.config.json': JSON.stringify({ pluginDependencies })
	}

	for (const [name, contents] of Object.entries(files)) {
		archive.entry({ name }, contents)
	}

	archive.finalize()
	await new Promise((resolve) => archive.on('end', resolve))

	return gzipSync(Buffer.concat(chunks))
}

function decodePackageName(urlPath) {
	return decodeURIComponent(urlPath.replace(/^\//, ''))
}

export async function startFakeRegistry(fixtures) {
	const tarballs = new Map()
	let baseUrl = ''

	for (const [packageName, { versions }] of Object.entries(fixtures)) {
		for (const [version, details] of Object.entries(versions)) {
			tarballs.set(`${packageName}/-/${version}.tgz`, await buildTarball(packageName, version, details))
		}
	}

	function getMetadata(packageName) {
		const { versions, latest } = fixtures[packageName]
		const highest = Object.keys(versions).sort(semver.compare).at(-1)

		return {
			name: packageName,
			'dist-tags': { latest: latest ?? highest },
			versions: Object.fromEntries(
				Object.entries(versions).map(([version, details]) => {
					const tarball = tarballs.get(`${packageName}/-/${version}.tgz`)

					return [
						version,
						{
							name: packageName,
							version,
							peerDependencies: details.peerDependencies,
							dist: {
								tarball: `${baseUrl}/${packageName}/-/${version}.tgz`,
								integrity: `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`
							}
						}
					]
				})
			)
		}
	}

	const server = http.createServer((request, response) => {
		const urlPath = decodeURIComponent(request.url.split('?')[0]).replace(/^\//, '')

		if (tarballs.has(urlPath)) {
			response.writeHead(200, { 'content-type': 'application/octet-stream' })
			response.end(tarballs.get(urlPath))
			return
		}

		const packageName = decodePackageName(request.url.split('?')[0])

		if (fixtures[packageName]) {
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify(getMetadata(packageName)))
			return
		}

		response.writeHead(404)
		response.end('{}')
	})

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	baseUrl = `http://127.0.0.1:${server.address().port}`

	return {
		url: baseUrl,
		close: () => new Promise((resolve) => server.close(resolve))
	}
}
