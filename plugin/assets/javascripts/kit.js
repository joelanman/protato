window.GOVUKPrototypeKit = {
	majorVersion: 13,
	documentReady: (fn) => {
		if (document.readyState !== 'loading') {
			// IE9 support
			fn()
		} else {
			// Everything else
			document.addEventListener('DOMContentLoaded', fn)
		}
	},
	internal: {}
}

if (location.hostname === 'localhost') {
	const eventSource = new EventSource('http://localhost:35729/livereload')
	eventSource.onmessage = () => window.location.reload()
	eventSource.onopen = () => console.log('Live reload connected')
	eventSource.onerror = () => console.log('Live reload disconnected')
}
