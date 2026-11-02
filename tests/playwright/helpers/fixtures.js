import { test as base, expect } from '@playwright/test'

import { startTestProject } from './project.js'

// Every test gets its own project and server. That keeps file edits and the
// restarts they trigger from leaking into the next test, which matters more
// than the extra second it takes to start another server.
const test = base.extend({
	project: async (
		// biome-ignore lint/correctness/noEmptyPattern: Playwright requires the fixture argument to destructure
		{},
		use,
		testInfo
	) => {
		const project = await startTestProject()

		try {
			await use(project)
		} finally {
			if (testInfo.status !== testInfo.expectedStatus) {
				await testInfo.attach('server-output', {
					body: project.getServerOutput(),
					contentType: 'text/plain'
				})
			}

			await project.cleanup()
		}
	}
})

export { expect, test }
