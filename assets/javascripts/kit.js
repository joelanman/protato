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
