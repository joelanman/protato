import knownPlugins from '../known-plugins.json' with { type: 'json' }

const available = knownPlugins.available
const protectedPackages = knownPlugins.protected
const knownPackageNames = new Set([...protectedPackages, ...available])

export { knownPackageNames, protectedPackages }
