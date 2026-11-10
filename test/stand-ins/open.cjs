// Stand-in for macOS's open, first on a test's PATH (and beside the stand-in agents, which open the
// browser with it), so nothing a test runs opens a real browser: each thing it's asked to open goes
// in opened.log beside it, one a line.
const fs = require('node:fs')
const path = require('node:path')

fs.appendFileSync(path.join(__dirname, 'opened.log'), `${process.argv.slice(2).join(' ')}\n`)
