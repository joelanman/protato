import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '../config.js'
import { checkAuth } from './auth.js'

// Mock the config module
vi.mock('../config.js', () => ({
	getConfig: vi.fn()
}))

describe('Auth', () => {
	let request, response, next

	beforeEach(() => {
		vi.clearAllMocks()

		request = {
			path: '',
			originalUrl: '',
			session: {}
		}

		response = {
			send: vi.fn(),
			status: vi.fn(() => response),
			redirect: vi.fn()
		}

		next = vi.fn()

		// mock console.error to avoid noise in tests

		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	describe('when passwords array is empty', () => {
		beforeEach(() => {
			getConfig.mockReturnValue({ passwords: [] })
		})

		it('sends error response', () => {
			request.path = '/some-path'

			checkAuth(request, response, next)

			expect(response.status).toHaveBeenCalledWith(500)
			expect(response.send).toHaveBeenCalledWith('Error: password is not set')
			expect(next).not.toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})

		it('should log error to console', () => {
			request.path = '/some-path'

			checkAuth(request, response, next)

			expect(console.error).toHaveBeenCalled()
		})
	})

	describe('when path is public', () => {
		beforeEach(() => {
			getConfig.mockReturnValue({ passwords: ['test123'] })
		})

		it('allows access to password page', () => {
			request.path = '/manage-prototype/password'

			checkAuth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})

		it('allows access to public assets', () => {
			request.path = '/manage-prototype/public/css/style.css'

			checkAuth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})

		it('allows access to govuk-frontend assets', () => {
			request.path = '/manage-prototype/govuk-frontend/assets/js/govuk.js'

			checkAuth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})
	})

	describe('when user has valid password in session', () => {
		beforeEach(() => {
			getConfig.mockReturnValue({ passwords: ['password123', 'secret456'] })
		})

		it('allows access when password matches', () => {
			request.path = '/protected-page'
			request.session.password = 'password123'

			checkAuth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})

		it('allows access when alternative password matches', () => {
			request.path = '/another-protected-page'
			request.session.password = 'secret456'

			checkAuth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})
	})

	describe('when user needs authentication', () => {
		beforeEach(() => {
			getConfig.mockReturnValue({ passwords: ['validpassword'] })
		})

		it('redirects to password page if no password in session', () => {
			request.path = '/protected-page'
			request.originalUrl = '/protected-page?param=value'

			checkAuth(request, response, next)

			const returnURL = encodeURIComponent(request.originalUrl)
			const redirectURL = '/manage-prototype/password?returnURL=' + returnURL

			expect(response.redirect).toHaveBeenCalledWith(redirectURL)
			expect(next).not.toHaveBeenCalled()
		})

		it('redirects to password page if password is incorrect', () => {
			request.path = '/protected-page'
			request.originalUrl = '/protected-page'
			request.session.password = 'wrongpassword'

			checkAuth(request, response, next)

			const returnURL = encodeURIComponent(request.originalUrl)
			const redirectURL = '/manage-prototype/password?returnURL=' + returnURL

			expect(response.redirect).toHaveBeenCalledWith(redirectURL)
			expect(next).not.toHaveBeenCalled()
		})
	})
})
