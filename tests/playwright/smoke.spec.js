import { openPage } from './helpers/browser.js'
import { expect, test } from './helpers/fixtures.js'

test('renders the home page with GOV.UK Frontend assets', async ({ page, project }) => {
	const fontResponses = []

	page.on('response', (response) => {
		if (response.url().includes('/fonts/')) {
			fontResponses.push(response)
		}
	})

	await openPage(page, project.url)

	const serviceNameHeading = page.getByRole('heading', { name: 'Service name goes here', level: 1 })

	await expect(serviceNameHeading).toBeVisible()
	await expect(serviceNameHeading).toHaveCSS('font-family', /GDS Transport/)

	await page.evaluate(() => document.fonts.ready.then(() => true))

	const loadedFont = fontResponses.find((response) => response.status() === 200)
	expect(loadedFont, 'Expected a GOV.UK Frontend font to load').toBeTruthy()

	const managementLink = page.getByRole('link', { name: 'Manage your prototype' })

	await expect(managementLink).toBeVisible()
	await managementLink.click()

	await expect(page).toHaveURL(project.url + '/manage-prototype')
	await expect(page.getByRole('heading', { name: 'Manage your prototype', level: 1 })).toBeVisible()
})
