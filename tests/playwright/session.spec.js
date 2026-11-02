import fs from 'node:fs'
import path from 'node:path'

import { openPage } from './helpers/browser.js'
import { expect, test } from './helpers/fixtures.js'

const sessionForm = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/session-form.html'), 'utf8')

test('stores session data from a form and clears it', async ({ page, project }) => {
	project.writeFile('app/views/session-form.html', sessionForm)

	await openPage(page, project.url + '/session-form')
	await expect(page.locator('#stored-name')).toHaveText('No name stored')

	await page.getByLabel('Your name').fill('Alice')
	await page.getByRole('button', { name: 'Continue' }).click()

	await expect(page.locator('#stored-name')).toHaveText('Stored name: Alice')

	await openPage(page, project.url + '/manage-prototype/clear-data')
	await page.getByRole('button', { name: 'Clear the data' }).click()

	await expect(page.getByRole('heading', { name: 'Data cleared', level: 1 })).toBeVisible()

	await openPage(page, project.url + '/session-form')
	await expect(page.locator('#stored-name')).toHaveText('No name stored')
})
