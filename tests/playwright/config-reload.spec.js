import { openPage } from './helpers/browser.js'
import { expect, test } from './helpers/fixtures.js'

const configPath = 'app/config.json'

test('updates the service name when app/config.json changes', async ({ page, project }) => {
	const originalConfig = project.readFile(configPath)
	const originalServiceName = JSON.parse(originalConfig).serviceName
	const newServiceName = 'Changed service name'

	await openPage(page, project.url)
	await expect(page.getByRole('heading', { name: originalServiceName, level: 1 })).toBeVisible()

	const changedConfig = JSON.parse(originalConfig)
	changedConfig.serviceName = newServiceName

	project.writeFile(configPath, JSON.stringify(changedConfig, null, '\t'))

	await expect(page.getByRole('heading', { name: newServiceName, level: 1 })).toBeVisible({ timeout: 20_000 })

	project.writeFile(configPath, originalConfig)

	await expect(page.getByRole('heading', { name: originalServiceName, level: 1 })).toBeVisible({ timeout: 20_000 })
})
