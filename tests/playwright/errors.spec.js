import fs from 'node:fs'
import path from 'node:path'

import { openPage } from './helpers/browser.js'
import { expect, test } from './helpers/fixtures.js'

test('shows the page not found page for a missing page', async ({ page, project }) => {
	await openPage(page, project.url + '/missing-page', { status: 404 })

	await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible()
	await expect(page.locator('#main-content')).toContainText('There is no page at')
	await expect(page.locator('#main-content strong')).toHaveText('/missing-page')
})

test('shows the error page for an error in project routes', async ({ page, project }) => {
	const routesError = fs.readFileSync(path.join(import.meta.dirname, '../fixtures/routes-error.js'), 'utf8')

	project.writeFile('app/routes.js', routesError)

	await openPage(page, project.url, {
		status: 500,
		check: () =>
			expect(page.locator('#govuk-prototype-kit-error-message')).toContainText('boom in user routes', {
				timeout: 2_000
			})
	})

	await expect(page.getByRole('heading', { name: 'There is an error', level: 1 })).toBeVisible()
	await expect(page.locator('#govuk-prototype-kit-error-file')).toContainText('app/routes.js (line 4)')
})
