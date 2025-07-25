function getAuth() {
	return (request, response, next) => {
		console.log('auth')
		next()
	}
}

function useAuth() {
	return process.env.NODE_ENV === 'production'
}

export { getAuth, useAuth }
