import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.js']
	},
	poolOptions: {
		forks: {
			singleFork: true
		}
	}
})
