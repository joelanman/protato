import fs from 'node:fs'
import path from 'node:path'

/**
 * A list of configurations to parse different error message formats.
 * Each object has a regex and a 'map' to assign the captured parts
 * to our desired properties (like 'filePath', 'line').
 * They are processed in order, so place more specific matchers first.
 */
const errorMatchers = [
	{
		name: 'nunjucksWithLineAndColumn',
		regex: /\((?<filePath>.*)\) \[Line (?<line>\d+), Column \d+]\s+(?<message>.+)/
	},
	{
		name: 'nunjucks',
		regex: /\((?<filePath>.*)\)\s+(?<message>.*)\s+Template render error:/
	},
	{
		name: 'sass',
		regex: /(?<filePath>[a-zA-Z0-9\-@_/\\.]+)\s+(?<line>\d+):\d+/
	},
	{
		name: 'node',
		regex: /(?<filePath>(?:\/|[A-Z]:\\).+?):(?<line>\d+)/
	}
]

/**
 * Reads file and extracts a few lines of code around a line number.
 * @param {string} filePath - Absolute path to the file.
 * @param {number} errorLineNumber - Line number where the error occurred.
 * @param {number} contextLines - How many lines to show before and after the error line.
 * @returns {object} An object containing the code snippet.
 */
function getSourceCode(filePath, errorLineNumber, contextLines = 7) {
	try {
		const allLines = fs.readFileSync(filePath, 'utf8').split('\n')

		// Calculate the window of lines to display
		const startLine = Math.max(0, errorLineNumber - contextLines - 1)
		const endLine = Math.min(allLines.length, errorLineNumber + contextLines)

		const codeSnippet = allLines.slice(startLine, endLine)

		const result = {
			before: [],
			error: '',
			after: []
		}

		codeSnippet.forEach((lineContent, index) => {
			const currentLineNumber = startLine + index + 1
			const formattedLineNumber = currentLineNumber.toString().padStart(4, ' ')
			const formattedLine = `${formattedLineNumber}  ${lineContent}`

			if (currentLineNumber < errorLineNumber) {
				result.before.push(formattedLine)
			} else if (currentLineNumber === errorLineNumber) {
				result.error = formattedLine
			} else {
				result.after.push(formattedLine)
			}
		})

		return {
			before: result.before.join('\n'),
			error: result.error,
			after: result.after.join('\n')
		}
	} catch (err) {
		// Return an error if the file can't be read
		console.error('Error getting error source: ' + err)
		return
	}
}

/**
 * Process an error and create a model for display
 * @param {Error} error - Raw error object
 * @returns {object} A view-ready object with formatted error details
 */
function getErrorModel(error) {
	if (!error || !error.message) {
		return { error: { message: 'An unknown error occurred.' } }
	}

	const viewModel = {
		message: error.message.split('\n')[0],
		stack: error.stack
	}

	let filePath

	const textToSearch = error.message + '\n' + error.stack

	for (const matcher of errorMatchers) {
		const match = matcher.regex.exec(textToSearch)
		if (!match?.groups) continue

		// we got a match

		console.log('parseError matched by: ' + matcher.name)

		filePath = match.groups.filePath

		if (match.groups.message) {
			viewModel.message = match.groups.message
		}

		if (match.groups.line) {
			viewModel.line = parseInt(match.groups.line, 10)
		}

		break
	}

	viewModel.message = viewModel.message.replaceAll('Error:', '').trim()

	// get the source code

	if (filePath && viewModel.line) {
		viewModel.sourceCode = getSourceCode(filePath, viewModel.line)
	}

	// make the file path relative for cleaner display

	if (filePath) {
		viewModel.filePath = path.relative(process.cwd(), filePath)
	}

	return {
		error: viewModel
	}
}

export { getErrorModel }
