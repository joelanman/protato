import { openPageWithLiveReload } from './helpers/browser.js'
import { expect, test } from './helpers/fixtures.js'

const viewPath = 'app/views/live-reload.html'
const sassPath = 'app/assets/sass/application.scss'

const renderView = (heading) => `{% extends "layouts/main.html" %}

{% block content %}
  <h1 class="govuk-heading-l">${heading}</h1>
  <p class="live-reload-colour" id="live-reload-colour">Colour</p>
{% endblock %}
`

const renderSass = (colour) => `.live-reload-colour {
  color: ${colour};
}
`

// Waits for the Sass watcher to write the expected rule, so the first page
// load already has the style the test is about to change.
async function waitForStylesheet(project, expectedText) {
	await expect
		.poll(
			async () => {
				const response = await fetch(project.url + '/public/stylesheets/application.css')

				if (!response.ok) {
					return ''
				}

				return response.text()
			},
			{ timeout: 30_000 }
		)
		.toContain(expectedText)
}

test('reloads the page when a view changes', async ({ page, project }) => {
	project.writeFile(viewPath, renderView('Original view content'))

	await openPageWithLiveReload(page, project.url + '/live-reload')
	await expect(page.getByRole('heading', { name: 'Original view content', level: 1 })).toBeVisible()

	project.writeFile(viewPath, renderView('Updated view content'))

	await expect(page.getByRole('heading', { name: 'Updated view content', level: 1 })).toBeVisible({ timeout: 20_000 })
})

test('reloads the page when Sass changes', async ({ page, project }) => {
	const originalSass = project.readFile(sassPath)
	const sassWithColour = (colour) => `${originalSass}\n${renderSass(colour)}`

	project.writeFile(viewPath, renderView('Live reload styles'))
	project.writeFile(sassPath, sassWithColour('#123456'))

	await waitForStylesheet(project, '#123456')

	await openPageWithLiveReload(page, project.url + '/live-reload')
	await expect(page.locator('#live-reload-colour')).toHaveCSS('color', 'rgb(18, 52, 86)')

	project.writeFile(sassPath, sassWithColour('#654321'))

	await expect(page.locator('#live-reload-colour')).toHaveCSS('color', 'rgb(101, 67, 33)', {
		timeout: 30_000
	})
})
