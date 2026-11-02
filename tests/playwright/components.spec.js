import fs from 'node:fs'
import path from 'node:path'

import { openPage } from './helpers/browser.js'
import { expect, test } from './helpers/fixtures.js'

const tabsPage = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/tabs.html'), 'utf8')

test('initialises GOV.UK Frontend JavaScript', async ({ page, project }) => {
	project.writeFile('app/views/tabs.html', tabsPage)

	await openPage(page, project.url + '/tabs')

	// The tabs component only gets tab and tabpanel roles after GOV.UK
	// Frontend JavaScript has initialised.
	const pastWeekPanel = page.getByRole('tabpanel', { name: 'Past week' })

	await expect(pastWeekPanel).toBeHidden()

	await page.getByRole('tab', { name: 'Past week' }).click()

	await expect(pastWeekPanel).toBeVisible()
})
