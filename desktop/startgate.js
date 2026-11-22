// The built app starts only as it was built (main.js, before anything else): given Chromium's or
// Node's debugging switches (DevTools over a port or a pipe, which origins may use it, Node's
// inspector) or Chromium's stand-in for the keychain, a program running as you could drive the app's
// windows or read what it seals with a key everyone knows, so it doesn't start at all, before any
// window, profile or key: the reason goes in the data folder's logs/desktop.log and to stderr.
// A build made for the smoke test (scripts/smokewindows.js drives the app through DevTools, with the
// stand-in keychain) carries a mark set as it's built, in the package.json inside the app's own
// archive (bridgeSmokeBuild: electron-builder's extraMetadata), which no release build sets and which
// can't be added to a signed app without breaking its signature. From source nothing is refused.
const fs = require('node:fs')
const path = require('node:path')

const REFUSED = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins', 'use-mock-keychain', 'inspect', 'inspect-brk', 'inspect-port', 'inspect-brk-node', 'inspect-publish-uid']
// Any of them as Chromium would take it (--x, -x, and on Windows /x; =value or not), and any other
// of Node's --inspect… options.
const NAMED = /^(remote-debugging-(?:port|pipe)|remote-allow-origins|use-mock-keychain|inspect[a-z-]*)$/

// The switches given that the app refuses: hasSwitch, Electron's own app.commandLine.hasSwitch.
function given({ argv = [], hasSwitch = () => false, platform = process.platform } = {}) {
  const prefix = platform === 'win32' ? /^(?:--|-|\/)([^=]+)/ : /^(?:--|-)([^=]+)/
  const named = argv.map((a) => prefix.exec(String(a))?.[1]?.toLowerCase()).filter((n) => n && NAMED.test(n))
  return [...new Set([...REFUSED.filter((s) => { try { return hasSwitch(s) } catch { return false } }), ...named])]
}
// Whether this build is the smoke test's own (its archive's package.json, read as main.js reads it).
function smokeBuild(pkg) {
  const v = pkg?.bridgeSmokeBuild
  return v === true || v === 'true'
}
// main.js: quits at once when a built app is given any of them, unless it's the smoke test's build.
function check({ app, data, pkg, argv = process.argv.slice(1), platform = process.platform }) {
  if (!app.isPackaged || smokeBuild(pkg)) return []
  const found = given({ argv, hasSwitch: (s) => app.commandLine.hasSwitch(s), platform })
  if (!found.length) return []
  const line = `Bridge AI doesn't start with ${found.map((s) => `--${s}`).join(', ')}: with ${found.length === 1 ? 'it' : 'them'}, another program could drive its windows or read what it keeps. Open it without ${found.length === 1 ? 'it' : 'them'}.`
  try { process.stderr.write(`${line}\n`) } catch { /* no stderr */ }
  try { fs.mkdirSync(path.join(data, 'logs'), { recursive: true }); fs.appendFileSync(path.join(data, 'logs', 'desktop.log'), `${new Date().toISOString()} ${line}\n`) } catch { /* not this time */ }
  app.exit(1)
  process.exit(1)
}

module.exports = { REFUSED, given, smokeBuild, check }
