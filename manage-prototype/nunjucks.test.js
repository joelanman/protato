import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getConfig } from '../lib/config.js'

const { configure } = vi.hoisted(() => ({ configure: vi.fn() }))

vi.mock('nunjucks', () => ({
	default: { configure }
}))

vi.mock('../lib/config.js', () => ({
	getConfig: vi.fn()
}))

vi.mock('../lib/paths.js', () => ({
	getPaths: vi.fn(() => ({
		managePrototype: {
			views: '/manage/views',
			govukFrontendViews: '/govuk/views'
		}
	}))
}))

// the environment is created once per module load, so each case needs a fresh
// copy of the module
async function getNunjucksConfig({ env = 'development' } = {}) {
	vi.resetModules()
	vi.mocked(getConfig).mockReturnValue({ env, serviceName: 'Test service' })
	configure.mockReturnValue({ addGlobal: vi.fn(), express: vi.fn() })

	const { default: managePrototypeNunjucks } = await import('./nunjucks.js')
	managePrototypeNunjucks.configure({ set: vi.fn() })

	const [, nunjucksConfig] = configure.mock.calls[0]

	return nunjucksConfig
}

describe('manage prototype Nunjucks environment', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		delete process.env.PROTATO_DEV
	})

	it('re-reads templates while working on Protato, because PROTATO_DEV is set', async () => {
		process.env.PROTATO_DEV = 'true'

		const config = await getNunjucksConfig()

		expect(config.noCache).toBe(true)
	})

	it('caches templates in a project using Protato', async () => {
		const config = await getNunjucksConfig()

		expect(config.noCache).toBe(false)
	})

	it('caches templates in production', async () => {
		const config = await getNunjucksConfig({ env: 'production' })

		expect(config.noCache).toBe(false)
	})
})
