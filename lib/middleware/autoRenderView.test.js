import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
	default: {
		existsSync: vi.fn()
	}
}))

vi.mock('../paths.js', () => ({
	getPaths: () => ({
		views: '/app/views'
	})
}))

import fs from 'node:fs'
import autoRenderView, { isAppView } from './autoRenderView.js'

describe('isAppView', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('allows a view file in app/views', () => {
		fs.existsSync.mockImplementation((filePath) => filePath === '/app/views/index.html')

		expect(isAppView('index')).toBe(true)
	})

	it('allows the index of a folder in app/views', () => {
		fs.existsSync.mockImplementation((filePath) => filePath === '/app/views/folder/index.html')

		expect(isAppView('folder/index')).toBe(true)
	})

	it('rejects paths outside app/views even if they exist', () => {
		fs.existsSync.mockReturnValue(true)

		expect(isAppView('../../package')).toBe(false)
		expect(isAppView('/etc/passwd')).toBe(false)
		expect(isAppView('../views-evil/page')).toBe(false)
	})

	it('rejects files that do not exist', () => {
		fs.existsSync.mockReturnValue(false)

		expect(isAppView('missing')).toBe(false)
	})
})

describe('autoRenderView', () => {
	let response
	let next

	beforeEach(() => {
		vi.clearAllMocks()
		response = {
			render: vi.fn(),
			set: vi.fn(),
			end: vi.fn()
		}
		next = vi.fn()
	})

	it('renders index for /', () => {
		fs.existsSync.mockImplementation((filePath) => filePath === '/app/views/index.html')
		response.render.mockImplementation((view, callback) => callback(null, '<html>Home</html>'))

		autoRenderView({ path: '/' }, response, next)

		expect(response.render).toHaveBeenCalledWith('index', expect.any(Function))
		expect(response.set).toHaveBeenCalledWith({ 'Content-type': 'text/html; charset=utf-8' })
		expect(response.end).toHaveBeenCalledWith('<html>Home</html>')
		expect(next).not.toHaveBeenCalled()
	})

	it('renders a folder index when the page file does not exist', () => {
		fs.existsSync.mockImplementation((filePath) => filePath === '/app/views/about/index.html')
		response.render.mockImplementation((view, callback) => callback(null, '<html>About</html>'))

		autoRenderView({ path: '/about' }, response, next)

		expect(response.render).toHaveBeenCalledTimes(1)
		expect(response.render).toHaveBeenCalledWith('about/index', expect.any(Function))
		expect(response.end).toHaveBeenCalledWith('<html>About</html>')
		expect(next).not.toHaveBeenCalled()
	})

	it('calls next when the path is not an app view', () => {
		fs.existsSync.mockReturnValue(false)

		autoRenderView({ path: '/nonexistent' }, response, next)

		expect(response.render).not.toHaveBeenCalled()
		expect(next).toHaveBeenCalledWith()
	})

	it('passes render errors to next', () => {
		fs.existsSync.mockImplementation((filePath) => filePath === '/app/views/about.html')
		const error = new Error('boom')
		response.render.mockImplementation((view, callback) => callback(error))

		autoRenderView({ path: '/about' }, response, next)

		expect(next).toHaveBeenCalledWith(error)
		expect(response.end).not.toHaveBeenCalled()
	})

	it('does not auto-render paths outside app/views', () => {
		fs.existsSync.mockReturnValue(true)

		autoRenderView({ path: '/../../package' }, response, next)

		expect(response.render).not.toHaveBeenCalled()
		expect(next).toHaveBeenCalled()
	})
})
