// How the built app starts its server, on the app's own Node (main.js; scripts/smoke.js starts a
// built app's server the same way and checks it):
//   flags  SIGUSR1 doesn't open Node's inspector, which would let any program running as you read
//          the server's memory (the window secret, the signatures' key). Electron's fuses turn off
//          --inspect and NODE_OPTIONS, but not that signal.
//   args   ...and server/lockdown.js loaded before anything of the server's, so it loads nothing from
//          outside its own copy (app-root).
//   env    only what the server and what it starts (agents, terminals, bots) need, never the rest of
//          what the app was started with: where you are (PATH, HOME, the user, the shell, the
//          language, a temporary folder, the terminal), your SSH agent, a proxy you set and the
//          certificates your network needs, a "no" to usage stats, where your agent CLIs keep their
//          settings, what
//          Windows or a Linux desktop needs to run programs, Electron's run-as-Node, the app's pipe,
//          and the app's own data folder and port; plus ws's optional native parts turned off (it
//          would look for them outside app-root). A build made for the smoke test passes its BRIDGE_
//          settings on too (its stand-in signing helper).
const { pathToFileURL } = require('node:url')
const path = require('node:path')

const SERVER_NODE_FLAGS = ['--disable-sigusr1']
const serverArgs = (root) => [...SERVER_NODE_FLAGS, '--import', pathToFileURL(path.join(root, 'server', 'lockdown.js')).href, path.join(root, 'server', 'index.js')]

const KEEP = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TMPDIR', 'TERM', 'SSH_AUTH_SOCK', '__CF_USER_TEXT_ENCODING', 'ELECTRON_RUN_AS_NODE', 'BRIDGE_WINDOW_FD', 'BRIDGE_HOME', 'BRIDGE_PORT',
  // A "no" to usage stats and crash reports said for every program (DO_NOT_TRACK=1, BRIDGE_TELEMETRY=0)
  // always reaches the server: dropping it would send what you said not to (server/counts.js).
  'DO_NOT_TRACK', 'BRIDGE_TELEMETRY',
  // The certificates this computer's network needs (a company's proxy that looks inside HTTPS): without
  // them the relay, Tailscale's check and every provider are out of reach from the server, as they
  // weren't before 3.22.0. They add trust in a certificate only; they load no code.
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // Where the agent CLIs the server starts keep their sign-ins and settings, when you've moved them.
  'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GEMINI_CLI_HOME', 'COPILOT_HOME', 'QWEN_HOME', 'CURSOR_DATA_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']
const PROXY = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY']
const WINDOWS = ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'PUBLIC', 'ALLUSERSPROFILE', 'SYSTEMDRIVE', 'PSMODULEPATH']
const LINUX = ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'DBUS_SESSION_BUS_ADDRESS']
function serverEnv(env = process.env, { platform = process.platform, smoke = false } = {}) {
  const keep = new Set([...KEEP, ...(platform === 'linux' ? LINUX : PROXY), ...(platform === 'win32' ? WINDOWS : [])])
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue
    const K = k.toUpperCase()
    if (keep.has(platform === 'win32' ? K : k) || (platform !== 'win32' && PROXY.includes(K) && platform !== 'linux') || /^LC_[A-Z_]+$/.test(k) || (smoke && /^BRIDGE(SIGN)?_/.test(k))) out[k] = v
  }
  out.WS_NO_BUFFER_UTIL = '1'
  out.WS_NO_UTF_8_VALIDATE = '1'
  // (This computer's own addresses never through a proxy, whatever else NO_PROXY says.)
  const no = [...new Set([...String(out.NO_PROXY || out.no_proxy || '').split(',').map((x) => x.trim()).filter(Boolean), 'localhost', '127.0.0.1', '::1'])].join(',')
  out.NO_PROXY = no
  if (platform !== 'win32') out.no_proxy = no
  return out
}

module.exports = { SERVER_NODE_FLAGS, serverArgs, serverEnv }
