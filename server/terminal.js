// "Open in terminal": run `bridge-ai attach <pane>` in the terminal app you use, so you can work in
// an agent with your own terminal's keys, fonts and scrollback. Set "terminal": { "app": "iterm" }
// in your config to choose; otherwise the first one found below is used.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { ROOT, NODE, cacheFile, ensureDir, IS_MAC, IS_WIN } from './paths.js'

const HOME = os.homedir()
const appPath = (name) => [path.join('/Applications', name), path.join(HOME, 'Applications', name), path.join('/System/Applications/Utilities', name)].find((p) => fs.existsSync(p))

// macOS: how to start each app with a script. The script is a small .command file (see below).
const MAC = [
  { id: 'ghostty', name: 'Ghostty', app: 'Ghostty.app', run: (f) => ['open', ['-na', 'Ghostty', '--args', '-e', f]] },
  { id: 'iterm', name: 'iTerm', app: 'iTerm.app', run: (f) => ['open', ['-a', 'iTerm', f]] },
  { id: 'warp', name: 'Warp', app: 'Warp.app', run: (f) => ['open', ['-a', 'Warp', f]] },
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

const onPath = (bin) => new Promise((resolve) => execFile(IS_WIN ? 'where' : '/bin/sh', IS_WIN ? [bin] : ['-c', `command -v ${bin}`], { timeout: 3000 }, (err) => resolve(!err)))

// The terminal apps on this machine, in the order "auto" tries them.
export async function terminals() {
  if (IS_MAC) return MAC.filter((t) => appPath(t.app)).map(({ id, name }) => ({ id, name }))
  if (IS_WIN) return (await Promise.all(WIN.map(async (t) => ((t.id === 'powershell' || await onPath('wt.exe')) ? { id: t.id, name: t.name } : null)))).filter(Boolean)
  return (await Promise.all(LINUX.map(async (t) => ((await onPath(t.run('x')[0])) ? { id: t.id, name: t.name } : null)))).filter(Boolean)
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

async function pickApp(app, yourself) {
  const found = await terminals()
  const pick = (app && app !== 'auto' && found.find((t) => t.id === app)) || found[0]
  if (!pick) throw new Error(`No terminal app found. Set "terminal": { "app": "..." } in your config, or run \`${yourself}\` yourself.`)
  return pick
}

// Open `bridge-ai attach <pane>` in a new terminal window. `env` carries a non-default data folder
// or port so the client finds this server.
export async function openAttach(paneId, { app, env = {}, label = 'agent' } = {}) {
  const pick = await pickApp(app, 'bridge-ai attach')
  const cli = path.join(ROOT, 'scripts', 'cli.js')
  if (IS_WIN) {
    const sets = Object.entries({ ...env, ...NODE.env }).map(([k, v]) => `$env:${k}='${String(v).replace(/'/g, "''")}'; `).join('')
    const [cmd, args] = WIN.find((t) => t.id === pick.id).run(`${sets}& '${NODE.bin}' '${cli}' attach '${paneId}'`)
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref()
    return { app: pick.name }
  }
  // A tiny script so every terminal runs the same thing, in your login shell (for PATH and node).
  const dir = ensureDir(cacheFile('terminal'))
  const file = path.join(dir, `attach-${paneId.replace(/[^\w.-]+/g, '_')}.command`)
  const exports = Object.entries({ ...env, ...NODE.env }).map(([k, v]) => `export ${k}=${shq(v)}`).join('\n')
  fs.writeFileSync(file, `#!/bin/sh\n# Opened by Bridge AI: attach to ${label.replace(/\n/g, ' ')}\n${exports}\nexec "\${SHELL:-/bin/sh}" -lc ${shq(`${shq(NODE.bin)} ${shq(cli)} attach ${shq(paneId)}`)}\n`, { mode: 0o755 })
  const list = IS_MAC ? MAC : LINUX
  const [cmd, args] = list.find((t) => t.id === pick.id).run(file)
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  return { app: pick.name }
}

// Run a command (argv) in a new terminal window, in your login shell: "Open in terminal" for a
// herdr session. `unset`: variables to clear first (herdr won't start inside herdr).
export async function openCommand(argv, { app, label = 'command', unset = [] } = {}) {
  const line = argv.map(shq).join(' ')
  const pick = await pickApp(app, argv.join(' '))
  if (IS_WIN) {
    const [cmd, args] = WIN.find((t) => t.id === pick.id).run(`& ${argv.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(' ')}`)
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref()
    return { app: pick.name }
  }
  const dir = ensureDir(cacheFile('terminal'))
  const file = path.join(dir, `${label.replace(/[^\w.-]+/g, '_').slice(0, 60)}.command`)
  fs.writeFileSync(file, `#!/bin/sh\n# Opened by Bridge AI: ${label.replace(/\n/g, ' ')}\n${unset.length ? `unset ${unset.join(' ')}\n` : ''}exec "\${SHELL:-/bin/sh}" -lc ${shq(line)}\n`, { mode: 0o755 })
  const [cmd, args] = (IS_MAC ? MAC : LINUX).find((t) => t.id === pick.id).run(file)
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  return { app: pick.name }
}
