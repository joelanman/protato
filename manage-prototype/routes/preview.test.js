import { beforeEach, describe, expect, it, vi } from 'vitest'
import plugins from '../../lib/plugins.js'
import templatePreview from './preview.js'

vi.mock('../../lib/plugins.js', () => ({
	default: {
		getTemplateFilePath: vi.fn()
	}
}))

describe('templatePreview', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('renders the template with a Nunjucks path, not a filesystem path', () => {
		plugins.getTemplateFilePath.mockReturnValueOnce('/project/node_modules/test-plugin/templates/start.html')

		const request = { query: { packageName: 'test-plugin', templatePath: '/templates/start.html' } }
		const response = { render: vi.fn() }
		const next = vi.fn()

		templatePreview(request, response, next)

		expect(plugins.getTemplateFilePath).toHaveBeenCalledWith('test-plugin', '/templates/start.html')
		expect(response.render).toHaveBeenCalledWith('test-plugin/templates/start.html')
		expect(next).not.toHaveBeenCalled()
	})

	it('passes a not found error when the template file does not exist', () => {
		plugins.getTemplateFilePath.mockReturnValueOnce(undefined)

		const request = { query: { packageName: 'test-plugin', templatePath: '/templates/missing.html' } }
		const response = { render: vi.fn() }
		const next = vi.fn()

		templatePreview(request, response, next)

		expect(response.render).not.toHaveBeenCalled()
		expect(next).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 404,
				message: 'Template not found: test-plugin /templates/missing.html',
				reason: 'There is no template at /templates/missing.html.'
			})
		)
	})
})
