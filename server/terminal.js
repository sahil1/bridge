// "Open in terminal": run `bridge-ai attach <pane>` in the terminal app you use, so you can work in
// an agent with your own terminal's keys, fonts and scrollback. Set "terminal": { "app": "iterm" }
// in your config (Settings › General › Terminal app) to choose; otherwise ("auto") the one of
// those below you have open, else the first one found.
// It answers once the agent shows there: the command it runs says how it went (scripts/cli.js, to
// /api/terminal/opened), so the app never says "Opened" of a window that didn't open or didn't
// attach. When it can't, it says why and what to do instead, and a window that did open says why
// too, staying open until Return is pressed.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { ROOT, NODE, cacheFile, ensureDir, IS_MAC, IS_WIN } from './paths.js'

const HOME = os.homedir()
// Where Mac apps are (Terminal is in Utilities). BRIDGE_APPLICATIONS (tests): the one folder to look in.
const appDirs = () => (process.env.BRIDGE_APPLICATIONS ? [process.env.BRIDGE_APPLICATIONS] : ['/Applications', path.join(HOME, 'Applications'), '/System/Applications/Utilities'])
const appPath = (name) => appDirs().map((d) => path.join(d, name)).find((p) => fs.existsSync(p))

// macOS: how to start each app with a script. The script is a small .command file (see below).
// Warp runs no command another app hands it (its links open a tab or a folder, its docs say, and
// it has no way to be given a script), so "auto" never picks it; chosen, it's tried, and if
// nothing comes of it that's said.
const MAC = [
  { id: 'ghostty', name: 'Ghostty', app: 'Ghostty.app', run: (f) => ['open', ['-na', 'Ghostty', '--args', '-e', f]] },
  { id: 'iterm', name: 'iTerm', app: 'iTerm.app', run: (f) => ['open', ['-a', 'iTerm', f]] },
  { id: 'warp', name: 'Warp', app: 'Warp.app', auto: false, run: (f) => ['open', ['-a', 'Warp', f]] },
  { id: 'wezterm', name: 'WezTerm', app: 'WezTerm.app', run: (f) => ['open', ['-na', 'WezTerm', '--args', 'start', '--', f]] },
  { id: 'kitty', name: 'kitty', app: 'kitty.app', run: (f) => ['open', ['-na', 'kitty', '--args', f]] },
  { id: 'alacritty', name: 'Alacritty', app: 'Alacritty.app', run: (f) => ['open', ['-na', 'Alacritty', '--args', '-e', f]] },
  { id: 'terminal', name: 'Terminal', app: 'Terminal.app', run: (f) => ['open', ['-a', 'Terminal', f]] },
]
// Linux: the usual "run this command in a new window" flags.
const LINUX = [
  { id: 'x-terminal-emulator', name: 'Default terminal', run: (f) => ['x-terminal-emulator', ['-e', f]] },
  { id: 'gnome-terminal', name: 'GNOME Terminal', run: (f) => ['gnome-terminal', ['--', f]] },
  { id: 'konsole', name: 'Konsole', run: (f) => ['konsole', ['-e', f]] },
  { id: 'ghostty', name: 'Ghostty', run: (f) => ['ghostty', ['-e', f]] },
  { id: 'kitty', name: 'kitty', run: (f) => ['kitty', [f]] },
  { id: 'wezterm', name: 'WezTerm', run: (f) => ['wezterm', ['start', '--', f]] },
  { id: 'alacritty', name: 'Alacritty', run: (f) => ['alacritty', ['-e', f]] },
  { id: 'foot', name: 'foot', run: (f) => ['foot', [f]] },
  { id: 'xterm', name: 'xterm', run: (f) => ['xterm', ['-e', f]] },
]
// Windows: Windows Terminal if present, else a PowerShell window.
const WIN = [
  { id: 'wt', name: 'Windows Terminal', run: (cmd) => ['wt.exe', ['new-tab', 'powershell', '-NoExit', '-Command', cmd]] },
  { id: 'powershell', name: 'PowerShell', run: (cmd) => ['cmd.exe', ['/c', 'start', 'powershell', '-NoExit', '-Command', cmd]] },
]

// How long the window has to say it shows the agent: a terminal app starting cold, a slow login
// shell and the command starting take a few seconds. BRIDGE_TERMINAL_WAIT_MS: tests.
const WAIT = Number(process.env.BRIDGE_TERMINAL_WAIT_MS) || 20000

const onPath = (bin) => new Promise((resolve) => execFile(IS_WIN ? 'where' : '/bin/sh', IS_WIN ? [bin] : ['-c', `command -v ${bin}`], { timeout: 3000 }, (err) => resolve(!err)))

// The terminal apps on this device, in the order "auto" tries them.
export async function terminals() {
  if (IS_MAC) return MAC.filter((t) => appPath(t.app)).map(({ id, name }) => ({ id, name }))
  if (IS_WIN) return (await Promise.all(WIN.map(async (t) => ((t.id === 'powershell' || await onPath('wt.exe')) ? { id: t.id, name: t.name } : null)))).filter(Boolean)
  return (await Promise.all(LINUX.map(async (t) => ((await onPath(t.run('x')[0])) ? { id: t.id, name: t.name } : null)))).filter(Boolean)
}

// The Mac apps running now, as their programs' paths (ps asks no permission).
const running = () => new Promise((resolve) => execFile('ps', ['-axo', 'comm='], { timeout: 3000, maxBuffer: 8 << 20 }, (err, out) => resolve(err ? '' : String(out))))

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

// The app chosen in Settings, or for "auto" the one you have open (the first of them in the list),
// else the first one here. yourself: how to do the same in any terminal, for when there's none.
async function pickApp(app, yourself) {
  const found = await terminals()
  const chosen = app && app !== 'auto' && found.find((t) => t.id === app)
  if (chosen) return chosen
  const auto = found.filter((t) => !IS_MAC || MAC.find((m) => m.id === t.id).auto !== false)
  if (IS_MAC && auto.length > 1) {
    const ps = await running()
    const open = auto.find((t) => ps.includes(`/${MAC.find((m) => m.id === t.id).app}/Contents/MacOS/`))
    if (open) return open
  }
  const pick = auto[0] || found[0]
  if (!pick) throw new Error(`No terminal app found on this ${IS_MAC ? 'Mac' : 'computer'} to open it in.${yourself ? ` In any terminal, run: ${yourself}` : ''}`)
  return pick
}

// What "auto" opens now ({ id, name }), for Settings to show; null when there's no terminal app.
export const autoTerminal = () => pickApp('auto').catch(() => null)

// Start the app (on a Mac, ask `open` to). It can't be started, or `open` fails (no such app):
// an error in its own words. A Linux terminal runs as long as its window is open, so one still
// running after a moment has started.
function launch(cmd, args) {
  return new Promise((resolve, reject) => {
    let said = ''
    let child
    try { child = spawn(cmd, args, { detached: true, stdio: ['ignore', 'ignore', IS_MAC ? 'pipe' : 'ignore'], windowsHide: false }) } catch (e) { reject(e); return }
    child.stderr?.on('data', (d) => { said += d })
    const started = setTimeout(() => { child.stderr?.destroy(); child.unref(); resolve() }, IS_MAC ? 15000 : 2000)
    child.on('error', (e) => { clearTimeout(started); reject(new Error(e.code === 'ENOENT' ? `${cmd} wasn't found` : e.message)) })
    child.on('exit', (code) => {
      clearTimeout(started)
      child.unref()
      if (code) reject(new Error(said.trim().split('\n').pop() || `${cmd} stopped (${code})`))
      else resolve()
    })
  })
}

// Each open waiting to hear from its window, by the token the window's command was given.
const waiting = new Map()
// What the command in the window says: started (it runs), attached (the agent shows), or failed
// (and why). False when no open is waiting for that token (one that already answered).
export function opened(token, { state, error } = {}) {
  const w = waiting.get(String(token || ''))
  if (!w) return false
  if (state === 'started') w.started = true
  else if (state === 'attached' || state === 'failed') w.done({ state, error: error ? String(error).slice(0, 300) : null })
  return true
}

// Open the window, then wait to hear from it. yourself: how to do the same in any terminal.
async function openAndWait(pick, [cmd, args], token, { wait = WAIT, yourself } = {}) {
  const w = { started: false }
  const heard = new Promise((resolve) => { w.done = resolve })
  waiting.set(token, w)
  try {
    try { await launch(cmd, args) } catch (e) { throw new Error(`Couldn't open ${pick.name}: ${e.message}`) }
    let timer
    const r = await Promise.race([heard, new Promise((resolve) => { timer = setTimeout(() => resolve(null), wait) })])
    clearTimeout(timer)
    if (r?.state === 'attached') return { app: pick.name, attached: true }
    if (r?.state === 'failed') throw new Error(`${pick.name} opened, but couldn't show the agent: ${r.error || 'the attach failed'}`)
    if (w.started) throw new Error(`${pick.name} opened, but the agent didn't show there within ${Math.round(wait / 1000)} seconds. Its window says why.`)
    throw new Error(`${pick.name} didn't run Bridge AI's command within ${Math.round(wait / 1000)} seconds, so the agent isn't open there. Choose another app in Settings › General › Terminal app${yourself ? `, or run this in any terminal: ${yourself}` : ''}.`)
  } finally {
    waiting.delete(token)
  }
}

// A command line that runs Bridge AI's CLI on the Node it runs on (the app's own, as Node, in the
// desktop app: that setting only for it, not for what it starts).
const cliLine = (args) => `${Object.entries(NODE.env).map(([k, v]) => `${k}=${shq(v)} `).join('')}${shq(NODE.bin)} ${shq(path.join(ROOT, 'scripts', 'cli.js'))} ${args.map(shq).join(' ')}`

// A small script, so every terminal runs the same thing in your login shell (for PATH and node).
// It runs `line`; if that fails, the window says so and waits for Return, so you can read why.
function script(name, label, { vars = {}, unset = [], before = '', line }) {
  const dir = ensureDir(cacheFile('terminal'))
  const file = path.join(dir, `${name.replace(/[^\w.-]+/g, '_').slice(0, 60)}.command`)
  const exports = Object.entries(vars).map(([k, v]) => `export ${k}=${shq(v)}\n`).join('')
  fs.writeFileSync(file, `#!/bin/sh\n# Opened by Bridge AI: ${label.replace(/\n/g, ' ')}\n${unset.length ? `unset ${unset.join(' ')}\n` : ''}${exports}${before}"\${SHELL:-/bin/sh}" -lc ${shq(line)} && exit 0\nprintf '\\n%s ' 'Press Return to close this window.'\nread reply\n`, { mode: 0o755 })
  fs.chmodSync(file, 0o755) // written before, by an older version
  return file
}

// Open `bridge-ai attach <pane>` in a new terminal window. `env` carries a non-default data folder
// or port so the client finds this server. Answers { app, attached } once the agent shows there.
export async function openAttach(paneId, { app, env = {}, label = 'agent', wait } = {}) {
  const token = crypto.randomBytes(12).toString('hex')
  const vars = { ...env, BRIDGE_OPENED: token }
  if (IS_WIN) {
    const pick = await pickApp(app)
    const cli = path.join(ROOT, 'scripts', 'cli.js')
    const sets = Object.entries({ ...vars, ...NODE.env }).map(([k, v]) => `$env:${k}='${String(v).replace(/'/g, "''")}'; `).join('')
    return openAndWait(pick, WIN.find((t) => t.id === pick.id).run(`${sets}& '${NODE.bin}' '${cli}' attach '${paneId}'`), token, { wait })
  }
  const file = script(`attach-${paneId}`, `attach to ${label}`, { vars, line: cliLine(['attach', paneId]) })
  const yourself = `sh ${shq(file)}`
  const pick = await pickApp(app, yourself)
  return openAndWait(pick, (IS_MAC ? MAC : LINUX).find((t) => t.id === pick.id).run(file), token, { wait, yourself })
}

// Run a command (argv) in a new terminal window, in your login shell: "Open in terminal" for a
// herdr session. `unset`: variables to clear first (herdr won't start inside herdr). Answers once
// the window runs it (Bridge AI's CLI says so, then hands over to the command).
export async function openCommand(argv, { app, env = {}, label = 'command', unset = [], wait } = {}) {
  const token = crypto.randomBytes(12).toString('hex')
  if (IS_WIN) {
    const pick = await pickApp(app, argv.join(' '))
    const cli = path.join(ROOT, 'scripts', 'cli.js')
    const sets = Object.entries({ ...env, BRIDGE_OPENED: token, ...NODE.env }).map(([k, v]) => `$env:${k}='${String(v).replace(/'/g, "''")}'; `).join('')
    const run = `${sets}& '${NODE.bin}' '${cli}' opened; Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; & ${argv.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(' ')}`
    return openAndWait(pick, WIN.find((t) => t.id === pick.id).run(run), token, { wait })
  }
  const file = script(label, label, { unset, vars: { ...env, BRIDGE_OPENED: token }, before: `${cliLine(['opened'])}\n`, line: argv.map(shq).join(' ') })
  const yourself = `sh ${shq(file)}`
  const pick = await pickApp(app, yourself)
  return openAndWait(pick, (IS_MAC ? MAC : LINUX).find((t) => t.id === pick.id).run(file), token, { wait, yourself })
}
