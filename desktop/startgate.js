// The built app starts only as it was built (main.js, before anything else). It's given no switches
// of its own (a restart, Open at Login and a second copy pass none), so any argument that is one
// (starting with -, or / on Windows) means something else started it to change how it runs: through
// another program's proxy, with what it sends written to a file, with names resolved elsewhere,
// with its windows open to DevTools, with Chromium's stand-in for the keychain (a key everyone
// knows), Node's inspector, another profile. It doesn't start at all, before any window, profile or
// key, and says why in the data folder's logs/desktop.log and on stderr. Only what macOS adds itself
// is let through (-psn_…, -NS…, -Apple…). The same for the environment: Chromium's and Electron's
// logging (ELECTRON_ENABLE_LOGGING, ELECTRON_LOG_FILE), Node's proxy (NODE_USE_ENV_PROXY), on Linux a
// proxy Chromium takes from it (http_proxy, https_proxy, all_proxy, no_proxy, either case), and every
// BRIDGE_ setting but two: BRIDGE_HOME (a data folder of its own, so a second copy runs beside your
// usual one, with a profile, keys and server of its own, nothing of yours) and BRIDGE_PORT (the port
// that copy's server is at, which it proves itself at like any). The rest (another copy of the code,
// development mode, the tests' stand-ins and dry runs, other helpers) are for a copy run from source.
// A Mac build made for the smoke test (scripts/smokewindows.js drives the app through DevTools, with
// the stand-in keychain) is let start with switches: it's the one with its own bundle id
// (dev.bridge-ai.smoke), which its signature covers and which no release has. From source nothing is
// refused.
const fs = require('node:fs')
const path = require('node:path')

const SMOKE_ID = 'dev.bridge-ai.smoke'
const OS_ADDED = { darwin: [/^-psn_/, /^-NS[A-Za-z]/, /^-Apple[A-Za-z]/] }
const ENV = ['ELECTRON_ENABLE_LOGGING', 'ELECTRON_LOG_FILE', 'NODE_USE_ENV_PROXY']
const BRIDGE_OK = ['BRIDGE_HOME', 'BRIDGE_PORT']
const LINUX_PROXY = ['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']

// The arguments a built app refuses: every switch but what the system adds.
function given({ argv = [], platform = process.platform } = {}) {
  const lead = platform === 'win32' ? /^[-/]/ : /^-/
  const ok = OS_ADDED[platform] || []
  return argv.map(String).filter((a) => lead.test(a) && !ok.some((r) => r.test(a)))
}
// What's set in the environment that it refuses.
const envGiven = (env = process.env, platform = process.platform) => Object.keys(env).filter((k) => env[k] != null && env[k] !== '' && (
  ENV.includes(k) || (k.startsWith('BRIDGE_') && !BRIDGE_OK.includes(k)) || (platform === 'linux' && LINUX_PROXY.includes(k.toLowerCase()))
)).sort()
// This Mac app's bundle id, from its own Info.plist (in its signature); null elsewhere, or unread.
function bundleId({ resources = process.resourcesPath, platform = process.platform } = {}) {
  if (platform !== 'darwin' || !resources) return null
  try { return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(fs.readFileSync(path.join(resources, '..', 'Info.plist'), 'utf8'))?.[1] || null } catch { return null }
}
const smokeBuild = (id) => id === SMOKE_ID
// main.js: quits at once when a built app is given any of them, unless it's the smoke test's build.
function check({ app, data, argv = process.argv.slice(1), env = process.env, platform = process.platform, id = bundleId({ platform }) }) {
  if (!app.isPackaged || smokeBuild(id)) return []
  const found = [...given({ argv, platform }).map((a) => a.replace(/=.*/s, '')), ...envGiven(env, platform)]
  if (!found.length) return []
  const line = `Bridge AI doesn't start with ${found.join(', ')}: started that way, another program could see or change what it does. Open it without ${found.length === 1 ? 'it' : 'them'}.`
  try { process.stderr.write(`${line}\n`) } catch { /* no stderr */ }
  try { fs.mkdirSync(path.join(data, 'logs'), { recursive: true }); fs.appendFileSync(path.join(data, 'logs', 'desktop.log'), `${new Date().toISOString()} ${line}\n`) } catch { /* not this time */ }
  app.exit(1)
  process.exit(1)
}

module.exports = { SMOKE_ID, ENV, BRIDGE_OK, given, envGiven, bundleId, smokeBuild, check }
