import fs from 'node:fs'
import path from 'node:path'

import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPluginProject } from '../tests/helpers/plugin-project.js'
import getApp from './app.js'
import plugins from './plugins.js'

const state = vi.hoisted(() => ({
	projectDir: '',
	repoRoot: '',
	env: 'development',
	passwords: []
}))

vi.mock('./config.js', () => ({
	getConfig: () => ({
		env: state.env,
		serviceName: 'Test service',
		useAuth: true,
		passwords: state.passwords,
		plugins: {}
	})
}))

vi.mock('./paths.js', async () => {
	const path = await import('node:path')

	return {
		getPaths: () => ({
			project: state.projectDir,
			app: path.join(state.projectDir, 'app'),
			assets: path.join(state.projectDir, 'app', 'assets'),
			views: path.join(state.projectDir, 'app', 'views'),
			tmp: path.join(state.projectDir, '.tmp'),
			public: path.join(state.projectDir, '.tmp', 'public'),
			stylesheets: path.join(state.projectDir, '.tmp', 'public', 'stylesheets'),
			sessions: path.join(state.projectDir, '.tmp', 'sessions'),
			managePrototype: {
				views: path.join(state.repoRoot, 'manage-prototype', 'views'),
				sass: path.join(state.repoRoot, 'manage-prototype', 'assets', 'sass'),
				govukFrontend: path.join(state.repoRoot, 'node_modules', 'govuk-frontend'),
				govukFrontendViews: path.join(state.repoRoot, 'node_modules', 'govuk-frontend', 'dist'),
				public: path.join(state.repoRoot, 'manage-prototype', 'public')
			}
		})
	}
})

let project
let projects = []

const assetUrl = (urlPath) => `/plugin-assets/asset-plugin${urlPath}`

function setupProject({ env = 'development', passwords = [] } = {}) {
	project = createPluginProject({
		dependencies: {
			'asset-plugin': '1.0.0',
			'@scope/asset-plugin': '1.0.0'
		},
		plugins: [
			{
				packageName: 'asset-plugin',
				config: {
					assets: [
						'/files/',
						'/folder.with.dot',
						'/images/logo.png',
						'/documents/guide.pdf',
						'/odd names',
						'/odd names/hash#name.txt'
					],
					scripts: ['/js/standalone.js', '/js/no-extension'],
					// Windows-style config path
					stylesheets: 'css\\standalone.css'
				},
				files: {
					'files/note.txt': 'note inside a directory',
					'folder.with.dot/served.txt': 'directory with a dot',
					'images/logo.png': 'logo image',
					'images/sibling.png': 'sibling image',
					'documents/guide.pdf': 'pdf document',
					'js/standalone.js': 'console.log("standalone")',
					'js/no-extension': 'no extension',
					'css/standalone.css': 'body { color: red; }',
					'odd names/hash#name.txt': 'hash in the filename',
					'odd names/space name.txt': 'space in the filename'
				}
			},
			{
				packageName: '@scope/asset-plugin',
				config: { assets: ['/assets'] },
				files: { 'assets/scoped.txt': 'scoped asset' }
			}
		],
		files: {
			'app/views/layout.html': [
				'<!doctype html>',
				'<html lang="en">',
				'<head>',
				'{% for stylesheet in protato.stylesheets %}',
				'<link rel="stylesheet" href="{{ stylesheet }}">',
				'{% endfor %}',
				'</head>',
				'<body>{% block content %}{% endblock %}</body>',
				'</html>'
			].join('\n'),
			'app/views/page.html': '{% extends "layout.html" %}{% block content %}Hello{% endblock %}'
		}
	})

	projects.push(project)
	state.projectDir = project.dir
	state.env = env
	state.passwords = passwords
	plugins.clearCache()

	return getApp()
}

describe('plugin asset serving', () => {
	beforeEach(() => {
		state.repoRoot = path.join(import.meta.dirname, '..')
	})

	afterEach(() => {
		for (const createdProject of projects) {
			createdProject.cleanup()
		}
		projects = []
		state.projectDir = ''
		plugins.clearCache()
		vi.restoreAllMocks()
	})

	it('serves files from a declared directory, including a directory with a dot in its name', async () => {
		const app = await setupProject()

		const response = await request(app).get(assetUrl('/files/note.txt'))
		expect(response.status).toBe(200)
		expect(response.text).toBe('note inside a directory')

		const dottedResponse = await request(app).get(assetUrl('/folder.with.dot/served.txt'))
		expect(dottedResponse.status).toBe(200)
		expect(dottedResponse.text).toBe('directory with a dot')
	})

	it('serves files whose name or directory needs URL encoding', async () => {
		const app = await setupProject()

		const directoryResponse = await request(app).get(assetUrl('/odd%20names/space%20name.txt'))
		expect(directoryResponse.status).toBe(200)
		expect(directoryResponse.text).toBe('space in the filename')

		const fileResponse = await request(app).get(assetUrl('/odd%20names/hash%23name.txt'))
		expect(fileResponse.status).toBe(200)
		expect(fileResponse.text).toBe('hash in the filename')
	})

	it('serves individually declared image and PDF files', async () => {
		const app = await setupProject()

		const imageResponse = await request(app).get(assetUrl('/images/logo.png'))
		expect(imageResponse.status).toBe(200)
		expect(imageResponse.headers['content-type']).toBe('image/png')
		expect(imageResponse.body).toEqual(Buffer.from('logo image'))

		const pdfResponse = await request(app).get(assetUrl('/documents/guide.pdf'))
		expect(pdfResponse.status).toBe(200)
		expect(pdfResponse.headers['content-type']).toBe('application/pdf')
		expect(pdfResponse.body).toEqual(Buffer.from('pdf document'))
	})

	it('serves standalone scripts and stylesheets, including a file without an extension', async () => {
		const app = await setupProject()

		const scriptResponse = await request(app).get(assetUrl('/js/standalone.js'))
		expect(scriptResponse.status).toBe(200)
		expect(scriptResponse.text).toBe('console.log("standalone")')

		const noExtensionResponse = await request(app).get(assetUrl('/js/no-extension'))
		expect(noExtensionResponse.status).toBe(200)
		expect(noExtensionResponse.body).toEqual(Buffer.from('no extension'))

		const stylesheetResponse = await request(app).get(assetUrl('/css/standalone.css'))
		expect(stylesheetResponse.status).toBe(200)
		expect(stylesheetResponse.text).toBe('body { color: red; }')
	})

	it('handles HEAD requests for individually declared files', async () => {
		const app = await setupProject()

		const response = await request(app).head(assetUrl('/js/standalone.js'))

		expect(response.status).toBe(200)
		expect(response.headers['content-length']).toBe(String(Buffer.byteLength('console.log("standalone")')))
		expect(response.text).toBeUndefined()
	})

	it.each(['post', 'put', 'delete'])('falls through for %s requests to individually declared files', async (method) => {
		const app = await setupProject()

		const directoryResponse = await request(app)[method](assetUrl('/files/note.txt'))
		const fileResponse = await request(app)[method](assetUrl('/js/standalone.js'))

		expect(fileResponse.status).toBe(method === 'post' ? 302 : 404)
		expect(fileResponse.status).toBe(directoryResponse.status)
	})

	it('falls through when an individually declared file is removed after startup', async () => {
		const app = await setupProject()
		fs.unlinkSync(path.join(project.dir, 'node_modules', 'asset-plugin', 'js', 'standalone.js'))

		const response = await request(app).get(assetUrl('/js/standalone.js'))

		expect(response.status).toBe(404)
	})

	it('serves scoped package assets', async () => {
		const app = await setupProject()

		const response = await request(app).get('/plugin-assets/@scope/asset-plugin/assets/scoped.txt')
		expect(response.status).toBe(200)
		expect(response.text).toBe('scoped asset')
	})

	it('falls through for a missing file inside a served directory', async () => {
		const app = await setupProject()

		const response = await request(app).get(assetUrl('/files/missing.txt'))
		expect(response.status).toBe(404)
	})

	it('does not serve siblings or extra path segments for individually declared files', async () => {
		const app = await setupProject()

		const siblingResponse = await request(app).get(assetUrl('/images/sibling.png'))
		expect(siblingResponse.status).toBe(404)

		const extraSegmentResponse = await request(app).get(assetUrl('/images/logo.png/extra'))
		expect(extraSegmentResponse.status).toBe(404)
	})

	it('renders a plugin stylesheet link that can be fetched', async () => {
		const app = await setupProject()

		const pageResponse = await request(app).get('/page')
		expect(pageResponse.status).toBe(200)

		const link = pageResponse.text.match(/<link rel="stylesheet" href="([^"]+)">/)
		expect(link).not.toBeNull()

		const stylesheetUrl = link[1]
		expect(stylesheetUrl).toBe('/plugin-assets/asset-plugin/css/standalone.css')

		const stylesheetResponse = await request(app).get(stylesheetUrl)
		expect(stylesheetResponse.status).toBe(200)
		expect(stylesheetResponse.text).toBe('body { color: red; }')
	})

	it('serves and renders a proxy plugin without a plugin config', async () => {
		const proxyProject = createPluginProject({
			dependencies: { jquery: '3.7.1' },
			plugins: [
				{
					packageName: 'jquery',
					version: '3.7.1',
					files: { 'dist/jquery.js': 'window.jQuery = {}' }
				}
			],
			files: {
				'app/views/layout.html': [
					'<!doctype html>',
					'<html lang="en">',
					'<body>',
					'{% for script in protato.scripts %}<script src="{{ script.src }}"></script>{% endfor %}',
					'{% block content %}{% endblock %}',
					'</body>',
					'</html>'
				].join('\n'),
				'app/views/page.html': '{% extends "layout.html" %}{% block content %}Hello{% endblock %}'
			}
		})
		projects.push(proxyProject)
		state.projectDir = proxyProject.dir
		plugins.clearCache()

		const app = await getApp()
		const scriptUrl = '/plugin-assets/jquery/dist/jquery.js'

		const scriptResponse = await request(app).get(scriptUrl)
		expect(scriptResponse.status).toBe(200)
		expect(scriptResponse.text).toBe('window.jQuery = {}')

		const pageResponse = await request(app).get('/page')
		expect(pageResponse.status).toBe(200)
		expect(pageResponse.text).toContain(`<script src="${scriptUrl}"></script>`)
	})

	it('protects plugin assets in production', async () => {
		const app = await setupProject({ env: 'production', passwords: ['secret'] })

		const response = await request(app).get(assetUrl('/files/note.txt'))

		expect(response.status).toBe(302)
		expect(response.headers.location).toBe(
			'/manage-prototype/password?returnURL=' + encodeURIComponent(assetUrl('/files/note.txt'))
		)
	})
})
