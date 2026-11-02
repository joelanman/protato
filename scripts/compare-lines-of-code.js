#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const protatoDirectory = path.resolve(scriptDirectory, '..')
const defaultKitDirectory = path.resolve(protatoDirectory, '..', 'govuk-prototype-kit')

const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.njk', '.html', '.scss', '.css', '.sh'])

const IGNORED_DIRECTORIES = new Set([
	'node_modules',
	'coverage',
	'tmp',
	'temp',
	'dist',
	'build',
	'screenshots',
	'.git',
	'.nyc_output'
])

const IGNORED_PATH_PREFIXES = [
	// Generated from manage-prototype/assets/sass/manage-prototype.scss
	'manage-prototype/public'
]

const IGNORED_FILE_PATTERNS = [/\.min\.(js|css)$/, /\.map$/, /\.snap$/]

// Migration code in the GOV.UK Prototype Kit.
const KIT_MIGRATION_PATHS = ['migrator', '__tests__/spec/migrate.js', 'scripts/generate-known-version-hashes.js']

const COMMENT_RULES = {
	'.js': {
		lineComment: '//',
		blockComments: [['/*', '*/']],
		quoteCharacters: ["'", '"', '`']
	},
	'.mjs': {
		lineComment: '//',
		blockComments: [['/*', '*/']],
		quoteCharacters: ["'", '"', '`']
	},
	'.cjs': {
		lineComment: '//',
		blockComments: [['/*', '*/']],
		quoteCharacters: ["'", '"', '`']
	},
	'.scss': {
		lineComment: '//',
		blockComments: [['/*', '*/']],
		quoteCharacters: ["'", '"']
	},
	'.css': {
		blockComments: [['/*', '*/']],
		quoteCharacters: ["'", '"']
	},
	'.html': {
		blockComments: [['<!--', '-->']],
		quoteCharacters: []
	},
	'.njk': {
		blockComments: [
			['{#', '#}'],
			['<!--', '-->']
		],
		quoteCharacters: []
	},
	'.sh': {
		lineComment: '#',
		quoteCharacters: ["'", '"']
	}
}

function parseArguments(argv) {
	const options = {
		protatoPath: protatoDirectory,
		kitPath: defaultKitDirectory,
		depth: 2,
		excludeMigration: false
	}

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]

		if (argument === '--exclude-migration') {
			options.excludeMigration = true
			continue
		}

		if (argument === '--depth') {
			options.depth = Number(argv[index + 1])
			index++
			continue
		}

		if (argument.startsWith('--depth=')) {
			options.depth = Number(argument.slice('--depth='.length))
			continue
		}

		if (argument === '--protato') {
			options.protatoPath = path.resolve(argv[index + 1])
			index++
			continue
		}

		if (argument === '--kit') {
			options.kitPath = path.resolve(argv[index + 1])
			index++
			continue
		}

		if (argument === '--help' || argument === '-h') {
			printHelp()
			process.exit(0)
		}

		throw new Error(`Unknown argument: ${argument}`)
	}

	const depthIsValid = Number.isInteger(options.depth) && options.depth >= 0
	if (!depthIsValid) {
		throw new Error('--depth must be a whole number of 0 or more')
	}

	return options
}

function printHelp() {
	console.log(`Compare lines of code between protato and govuk-prototype-kit.

Usage:
  node scripts/compare-lines-of-code.js [options]

Options:
  --exclude-migration   Exclude GOV.UK Prototype Kit migration code
  --depth <number>      Folder levels to show, 0 shows totals only (default: 2)
  --protato <path>      Path to protato (default: this repository)
  --kit <path>          Path to govuk-prototype-kit (default: ../govuk-prototype-kit)
  --help, -h            Show this help

Comments and blank lines are not counted. Difference is protato minus kit.`)
}

function normalisePath(relativePath) {
	return relativePath.split(path.sep).join('/')
}

function isKitMigrationPath(relativePath) {
	const normalisedPath = normalisePath(relativePath)

	return KIT_MIGRATION_PATHS.some((migrationPath) => {
		const isMigrationFolder = normalisedPath.startsWith(migrationPath + '/')
		const isMigrationFile = normalisedPath === migrationPath
		return isMigrationFolder || isMigrationFile
	})
}

function shouldIgnoreDirectory(directoryName) {
	if (IGNORED_DIRECTORIES.has(directoryName)) {
		return true
	}

	return directoryName.startsWith('.')
}

function shouldIgnoreFile(relativePath, fileName) {
	const normalisedPath = normalisePath(relativePath)

	const hasIgnoredPrefix = IGNORED_PATH_PREFIXES.some((prefix) => {
		return normalisedPath === prefix || normalisedPath.startsWith(prefix + '/')
	})
	if (hasIgnoredPrefix) {
		return true
	}

	return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(fileName))
}

function collectCodeFiles(rootDirectory, options) {
	const codeFiles = []

	function walk(directory) {
		const entries = fs.readdirSync(directory, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(directory, entry.name)
			const relativePath = path.relative(rootDirectory, fullPath)

			if (entry.isDirectory()) {
				if (!shouldIgnoreDirectory(entry.name)) {
					walk(fullPath)
				}
				continue
			}

			if (!entry.isFile()) {
				continue
			}

			if (shouldIgnoreFile(relativePath, entry.name)) {
				continue
			}

			if (options.excludeMigration && isKitMigrationPath(relativePath)) {
				continue
			}

			const extension = path.extname(entry.name).toLowerCase()
			if (!CODE_EXTENSIONS.has(extension)) {
				continue
			}

			codeFiles.push({
				fullPath,
				relativePath
			})
		}
	}

	walk(rootDirectory)
	return codeFiles
}

function stripComments(source, extension) {
	const rules = COMMENT_RULES[extension]
	if (!rules) {
		return source
	}

	let result = ''
	let index = 0
	let activeQuote = null

	while (index < source.length) {
		const character = source[index]
		const nextCharacter = source[index + 1]

		if (activeQuote !== null) {
			result += character

			if (character === '\\') {
				if (nextCharacter !== undefined) {
					result += nextCharacter
					index += 2
					continue
				}
			}

			if (character === activeQuote) {
				activeQuote = null
			}

			index++
			continue
		}

		const isQuoteStart = rules.quoteCharacters.includes(character)
		if (isQuoteStart) {
			activeQuote = character
			result += character
			index++
			continue
		}

		const isLineComment = rules.lineComment !== undefined && source.startsWith(rules.lineComment, index)
		if (isLineComment) {
			while (index < source.length && source[index] !== '\n') {
				index++
			}
			continue
		}

		const blockComment = findBlockComment(source, index, rules.blockComments)
		if (blockComment !== null) {
			const commentStart = index
			const commentEnd = source.indexOf(blockComment.end, index + blockComment.start.length)

			if (commentEnd === -1) {
				const commentText = source.slice(commentStart)
				result += keepNewLines(commentText)
				index = source.length
				continue
			}

			const endOfComment = commentEnd + blockComment.end.length
			const commentText = source.slice(commentStart, endOfComment)
			result += keepNewLines(commentText)
			index = endOfComment
			continue
		}

		result += character
		index++
	}

	return result
}

function findBlockComment(source, index, blockComments) {
	if (blockComments === undefined) {
		return null
	}

	for (const [start, end] of blockComments) {
		if (source.startsWith(start, index)) {
			return { start, end }
		}
	}

	return null
}

function keepNewLines(text) {
	return text.replace(/[^\n]/g, '')
}

function countCodeLines(filePath) {
	const extension = path.extname(filePath).toLowerCase()
	const source = fs.readFileSync(filePath, 'utf8')
	const sourceWithoutComments = stripComments(source, extension)

	return sourceWithoutComments.split(/\r?\n/).filter((line) => line.trim() !== '').length
}

function createFolderNode(name) {
	return {
		name,
		protato: { files: 0, lines: 0 },
		kit: { files: 0, lines: 0 },
		children: new Map()
	}
}

function addFileToTree(tree, project, relativePath, lineCount) {
	const folderPath = path.dirname(relativePath)
	const folderSegments = folderPath === '.' ? [] : folderPath.split(path.sep)

	addToFolderNode(tree, project, lineCount)

	let currentNode = tree

	for (const segment of folderSegments) {
		if (!currentNode.children.has(segment)) {
			currentNode.children.set(segment, createFolderNode(segment))
		}

		currentNode = currentNode.children.get(segment)
		addToFolderNode(currentNode, project, lineCount)
	}
}

function addToFolderNode(node, project, lineCount) {
	node[project].files++
	node[project].lines += lineCount
}

function buildComparisonTree(protatoFiles, kitFiles) {
	const tree = createFolderNode('.')

	for (const file of protatoFiles) {
		addFileToTree(tree, 'protato', file.relativePath, file.lineCount)
	}

	for (const file of kitFiles) {
		addFileToTree(tree, 'kit', file.relativePath, file.lineCount)
	}

	return tree
}

function collectProjectFiles(rootDirectory, options) {
	const codeFiles = collectCodeFiles(rootDirectory, options)

	return codeFiles.map((file) => {
		return {
			...file,
			lineCount: countCodeLines(file.fullPath)
		}
	})
}

function getFoldersToDisplay(tree, maxDepth) {
	const folders = []

	function visit(node, depth) {
		folders.push({ node, depth })

		if (depth >= maxDepth) {
			return
		}

		const sortedChildren = [...node.children.values()].sort((first, second) => {
			return first.name.localeCompare(second.name)
		})

		for (const child of sortedChildren) {
			visit(child, depth + 1)
		}
	}

	visit(tree, 0)
	return folders
}

function formatDifference(difference) {
	if (difference > 0) {
		return `+${difference}`
	}

	return String(difference)
}

function pluralise(count, singular) {
	if (count === 1) {
		return `${count} ${singular}`
	}

	return `${count} ${singular}s`
}

function formatTableRow(cells, widths) {
	const paddedCells = cells.map((cell, index) => {
		if (index === 0) {
			return cell.padEnd(widths[index])
		}

		return cell.padStart(widths[index])
	})

	return paddedCells.join('  ')
}

function printComparison(tree, options) {
	const folders = getFoldersToDisplay(tree, options.depth)

	const rows = folders.map(({ node, depth }) => {
		const folderLabel = depth === 0 ? '.' : '  '.repeat(depth) + node.name
		const difference = node.protato.lines - node.kit.lines

		return {
			folder: folderLabel,
			protatoFiles: String(node.protato.files),
			protatoLines: String(node.protato.lines),
			kitFiles: String(node.kit.files),
			kitLines: String(node.kit.lines),
			difference: formatDifference(difference)
		}
	})

	const folderWidth = Math.max(24, ...rows.map((row) => row.folder.length))
	const columnWidths = [folderWidth, 14, 14, 11, 11, 12]
	const headerCells = ['Folder', 'Protato files', 'Protato lines', 'Kit files', 'Kit lines', 'Difference']
	const tableWidth = columnWidths.reduce((total, width) => total + width, 0) + 10

	console.log('Lines of code comparison (comments and blank lines excluded)')
	console.log('')
	console.log(formatTableRow(headerCells, columnWidths))
	console.log('-'.repeat(tableWidth))

	for (const row of rows) {
		const cells = [row.folder, row.protatoFiles, row.protatoLines, row.kitFiles, row.kitLines, row.difference]

		console.log(formatTableRow(cells, columnWidths))
	}

	const totalDifference = tree.protato.lines - tree.kit.lines

	console.log('')
	console.log(`Protato: ${pluralise(tree.protato.lines, 'line')} in ${pluralise(tree.protato.files, 'file')}`)
	console.log(`Kit:     ${pluralise(tree.kit.lines, 'line')} in ${pluralise(tree.kit.files, 'file')}`)
	console.log(`Difference (protato minus kit): ${formatDifference(totalDifference)} lines`)
	console.log('')
	console.log(`Protato path: ${options.protatoPath}`)
	console.log(`Kit path:     ${options.kitPath}`)
	console.log(`Migration code: ${options.excludeMigration ? 'excluded' : 'included'}`)
	console.log(`Folder depth: ${options.depth}`)
}

function assertDirectoryExists(directoryPath, label) {
	const exists = fs.existsSync(directoryPath)
	const isDirectory = exists && fs.statSync(directoryPath).isDirectory()

	if (!isDirectory) {
		throw new Error(`${label} directory not found: ${directoryPath}`)
	}
}

function main() {
	const options = parseArguments(process.argv.slice(2))

	assertDirectoryExists(options.protatoPath, 'Protato')
	assertDirectoryExists(options.kitPath, 'Kit')

	const protatoFiles = collectProjectFiles(options.protatoPath, {
		excludeMigration: false
	})

	const kitFiles = collectProjectFiles(options.kitPath, {
		excludeMigration: options.excludeMigration
	})

	const tree = buildComparisonTree(protatoFiles, kitFiles)
	printComparison(tree, options)
}

try {
	main()
} catch (error) {
	console.error(`Error: ${error.message}`)
	process.exit(1)
}
