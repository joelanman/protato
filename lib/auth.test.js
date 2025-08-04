import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuth } from './auth.js'
import { getConfig } from './config.js'

// Mock the config module
vi.mock('./config.js', () => ({
	getConfig: vi.fn()
}))

describe('Auth', () => {
	let request, response, next, auth

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
			auth = getAuth()
		})

		it('sends error response', () => {
			request.path = '/some-path'

			auth(request, response, next)

			expect(response.status).toHaveBeenCalledWith(500)
			expect(response.send).toHaveBeenCalledWith('Error: password is not set')
			expect(next).not.toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})

		it('should log error to console', () => {
			request.path = '/some-path'

			auth(request, response, next)

			expect(console.error).toHaveBeenCalled()
		})
	})

	describe('when path is public', () => {
		beforeEach(() => {
			getConfig.mockReturnValue({ passwords: ['test123'] })
			auth = getAuth()
		})

		it('allows access to password page', () => {
			request.path = '/manage-prototype/password'

			auth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})

		it('allows access to public assets', () => {
			request.path = '/manage-prototype/public/css/style.css'

			auth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})

		it('allows access to govuk-frontend assets', () => {
			request.path = '/manage-prototype/govuk-frontend/assets/js/govuk.js'

			auth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})
	})

	describe('when user has valid password in session', () => {
		beforeEach(() => {
			getConfig.mockReturnValue({ passwords: ['password123', 'secret456'] })
			auth = getAuth()
		})

		it('allows access when password matches', () => {
			request.path = '/protected-page'
			request.session.password = 'password123'

			auth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})

		it('allows access when alternative password matches', () => {
			request.path = '/another-protected-page'
			request.session.password = 'secret456'

			auth(request, response, next)

			expect(next).toHaveBeenCalled()
			expect(response.redirect).not.toHaveBeenCalled()
		})
	})

	describe('when user needs authentication', () => {
		beforeEach(() => {
			getConfig.mockReturnValue({ passwords: ['validpassword'] })
			auth = getAuth()
		})

		it('redirects to password page if no password in session', () => {
			request.path = '/protected-page'
			request.originalUrl = '/protected-page?param=value'

			auth(request, response, next)

			const returnURL = encodeURIComponent(request.originalUrl)
			const redirectURL = '/manage-prototype/password?returnURL=' + returnURL

			expect(response.redirect).toHaveBeenCalledWith(redirectURL)
			expect(next).not.toHaveBeenCalled()
		})

		it('redirects to password page if password is incorrect', () => {
			request.path = '/protected-page'
			request.originalUrl = '/protected-page'
			request.session.password = 'wrongpassword'

			auth(request, response, next)

			const returnURL = encodeURIComponent(request.originalUrl)
			const redirectURL = '/manage-prototype/password?returnURL=' + returnURL

			expect(response.redirect).toHaveBeenCalledWith(redirectURL)
			expect(next).not.toHaveBeenCalled()
		})
	})
})
