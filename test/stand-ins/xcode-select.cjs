// Stand-in for macOS's xcode-select, so a test can be a Mac without Apple's command line developer
// tools (and then with them) whatever this computer has: -p says where they are, from devtools.txt
// beside it (a folder with usr/bin/git), or that there are none, as the real one does. Anything else
// (--install, --switch) only goes in xcode-select.log there: macOS's window never opens.
const fs = require('node:fs')
const path = require('node:path')

const a = process.argv.slice(2)
const here = path.join(__dirname, 'devtools.txt')
if (a[0] === '-p' || a[0] === '--print-path') {
  if (fs.existsSync(here)) { process.stdout.write(`${fs.readFileSync(here, 'utf8').trim()}\n`); process.exit(0) }
  process.stderr.write('xcode-select: error: unable to get active developer directory. Use `sudo xcode-select --switch path/to/Xcode.app` to set it (this is a test\'s stand-in).\n')
  process.exit(2)
}
fs.appendFileSync(path.join(__dirname, 'xcode-select.log'), `${a.join(' ')}\n`)
if (a[0] === '--install') process.stdout.write('xcode-select: note: install requested for command line developer tools\n')
