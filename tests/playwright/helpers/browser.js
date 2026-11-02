import { expect } from '@playwright/test'

// Loads a page, retrying while the dev server or prototype restarts. The
// optional check runs after the status matches, so a transient error page with
// the same status is retried as well.
async function openPage(page, url, { status = 200, timeout = 20_000, check } = {}) {
	await expect(async () => {
		const response = await page.goto(url, { waitUntil: 'domcontentloaded' })

		expect(response, `Expected a response from ${url}`).not.toBeNull()
		expect(response.status()).toBe(status)

		if (check) {
			await check()
		}
	}).toPass({ timeout })
}

// Loads a page and waits for its live reload connection. Changes made before
// the browser connects would not trigger a reload.
async function openPageWithLiveReload(page, url) {
	const connected = page.waitForEvent('console', {
		predicate: (message) => message.text() === 'Live reload connected',
		timeout: 20_000
	})

	await openPage(page, url)
	await connected
}

export { openPage, openPageWithLiveReload }
