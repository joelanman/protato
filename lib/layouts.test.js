import path from 'node:path'
import nunjucks from 'nunjucks'
import { describe, expect, it } from 'vitest'

const repoRoot = path.join(import.meta.dirname, '..')
const pluginViews = path.join(repoRoot, 'plugin', 'views')
const govukFrontendViews = path.join(repoRoot, 'starter', 'node_modules', 'govuk-frontend', 'dist')

const brandedLayout = 'govuk-prototype-kit/layouts/govuk-branded.njk'
const unbrandedLayout = 'govuk-prototype-kit/layouts/unbranded.html'

// use real layout and govuk-frontend files, as the prototype server does
function createEnvironment() {
	return nunjucks.configure([pluginViews, govukFrontendViews], {
		autoescape: true,
		noCache: true,
		watch: false
	})
}

function renderLayout(templatePath, { stylesheets = [], ...context } = {}) {
	return createEnvironment().render(templatePath, {
		govukFrontend: { assetPath: '/dist/govuk/assets' },
		GOVUKPrototypeKit: {
			isDevelopment: true,
			scripts: [{ src: '/plugin-assets/plugin/script.js', type: 'module' }, { src: '/plugin-assets/plugin/plain.js' }],
			stylesheets
		},
		serviceName: 'Test service',
		...context
	})
}

function getStylesheetHrefs(html) {
	const hrefs = []
	for (const match of html.matchAll(/<link href="([^"]+\.css[^"]*)"[^>]*rel="stylesheet"[^>]*>/g)) {
		hrefs.push(match[1])
	}
	return hrefs
}

describe('Plugin stylesheets in layouts', () => {
	const stylesheets = [
		'/plugin-assets/plugin/first.css',
		'/plugin-assets/another-plugin/second.css',
		'/plugin-assets/plugin/escaped.css?one=1&two=2'
	]

	it('renders plugin stylesheets after the application stylesheet in the branded layout', () => {
		const html = renderLayout(brandedLayout, { stylesheets })

		expect(getStylesheetHrefs(html)).toEqual([
			'/public/stylesheets/application.css',
			'/plugin-assets/plugin/first.css',
			'/plugin-assets/another-plugin/second.css',
			'/plugin-assets/plugin/escaped.css?one=1&amp;two=2'
		])
	})

	it('renders plugin stylesheets after the unbranded stylesheet in the unbranded layout', () => {
		const html = renderLayout(unbrandedLayout, { stylesheets })

		expect(getStylesheetHrefs(html)).toEqual([
			'/public/stylesheets/unbranded.css',
			'/plugin-assets/plugin/first.css',
			'/plugin-assets/another-plugin/second.css',
			'/plugin-assets/plugin/escaped.css?one=1&amp;two=2'
		])
		expect(html).not.toContain('/public/stylesheets/application.css')
	})

	it('renders each declared stylesheet once', () => {
		const html = renderLayout(brandedLayout, { stylesheets })

		for (const stylesheet of stylesheets) {
			const escapedStylesheet = stylesheet.replaceAll('&', '&amp;')
			expect(html.split(escapedStylesheet)).toHaveLength(2)
		}
	})

	it('renders no plugin stylesheets when none are declared', () => {
		const html = renderLayout(brandedLayout)

		expect(getStylesheetHrefs(html)).toEqual(['/public/stylesheets/application.css'])
	})

	it('keeps the existing script output unchanged', () => {
		const html = renderLayout(brandedLayout, { stylesheets })

		expect(html).toContain('<script type="module" src="/plugin-assets/plugin/script.js"></script>')
		expect(html).toContain('<script src="/plugin-assets/plugin/plain.js"></script>')
	})

	it('keeps the existing pageScripts block', () => {
		const html = createEnvironment().renderString(
			`{% extends "${brandedLayout}" %}
			{% block pageScripts %}<script src="/page.js"></script>{% endblock %}`,
			{
				govukFrontend: { assetPath: '/dist/govuk/assets' },
				GOVUKPrototypeKit: { isDevelopment: true, scripts: [], stylesheets: [] },
				serviceName: 'Test service'
			}
		)

		expect(html).toContain('<script src="/page.js"></script>')
	})
})
