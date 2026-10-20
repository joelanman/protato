import knownPlugins from '../known-plugins.json' with { type: 'json' }

const available = knownPlugins.available
const protectedPackages = knownPlugins.protected
const allPackageNames = [...new Set([...protectedPackages, ...available])]
const knownPackageNames = new Set(allPackageNames)

function isKnown(packageName) {
	return knownPackageNames.has(packageName)
}

export { allPackageNames, available, isKnown, knownPackageNames, protectedPackages }
