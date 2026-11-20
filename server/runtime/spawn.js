// Starting programs in a terminal the same way on macOS, Linux and Windows.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { IS_WIN } from '../paths.js'

const shQuote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)
// PowerShell ends a single-quoted string at a curly single quote too (‘ ’ ‚ ‛), so a prompt's
// "don’t" ended it there; each is doubled like a straight one.
const psQuote = (s) => `'${String(s).replace(/['‘’‚‛]/g, '$&$&')}'`

// An agent's first message, which goes on its command line. On Windows that passes through
// PowerShell, which hands a program an argument's straight double quotes unescaped, then through
// cmd for an agent npm installed (claude.cmd), which ends it at a line break and reads % as the
// start of a variable. So there it goes as one line, its quotes curly.
export function forCommandLine(text, win = IS_WIN) {
  if (!win || !text) return text
  let open = true
  return String(text).replace(/"/g, () => ((open = !open) ? '”' : '“')).replace(/\s*[\r\n]+\s*/g, ' · ').replace(/%/g, ' percent')
}

// One line you could type into a shell to run `bin args...`.
export function quoteCommand(bin, args = []) {
  return IS_WIN ? `& ${[bin, ...args].map(psQuote).join(' ')}` : [bin, ...args].map(shQuote).join(' ')
}

// On Windows, PowerShell by its full path: node-pty looks a bare name up in PATH itself, and skips
// PATH's last folder when no ";" follows it, so with PowerShell's folder last no terminal started
// ("File not found:").
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
export const userShell = () => (IS_WIN ? (process.env.BRIDGE_SHELL || (fs.existsSync(POWERSHELL) ? POWERSHELL : 'powershell.exe')) : (process.env.BRIDGE_SHELL || process.env.SHELL || '/bin/bash'))

// Printed when a setup command finishes (an escape code terminals ignore), so a first message
// isn't typed into `npm install`.
export const SETUP_DONE = '\x1b]7420\x07'

// The program and arguments for a pane: the user's login shell running the agent, then staying
// open as a plain shell when the agent exits (so you can read its last words or restart it).
// setup: { command, cwd } to run first, in view (a new worktree's `npm install` at its top
// folder), then back to `dir` for the agent. It goes through eval, so a typo in it can't stop
// the agent from starting. before: a command of the shell's own run before all of it (on Windows, a
// bot's run that changes files taking Windows' backup and restore rights out of its terminal first:
// winpriv.js).
export function shellCommand(bin, args, setup, dir, { before = null } = {}) {
  const shell = userShell()
  const go = (to) => (IS_WIN ? `Set-Location -LiteralPath ${psQuote(to)}` : `cd ${shQuote(to)}`)
  const move = setup && dir && path.resolve(setup.cwd) !== path.resolve(dir)
  const first = setup && [
    IS_WIN ? `Write-Host ${psQuote(`> ${setup.command}`)}` : `printf '%s\\n' ${shQuote(`> ${setup.command}`)}`,
    move && go(setup.cwd), IS_WIN ? `Invoke-Expression ${psQuote(setup.command)}` : `eval ${shQuote(setup.command)}`, move && go(dir), !IS_WIN && `printf '\\033]7420\\007'`,
  ].filter(Boolean).join('; ')
  const run = [before, first, bin && quoteCommand(bin, args)].filter(Boolean).join('; ')
  if (IS_WIN) return run ? [shell, ['-NoLogo', '-NoExit', '-Command', run]] : [shell, ['-NoLogo']]
  return run ? [shell, ['-l', '-c', `${run}; exec ${shQuote(shell)} -l`]] : [shell, ['-l']]
}

// The same setup command where there's no terminal to show it in (herdr only starts an agent
// at an idle shell prompt): run before the pane opens. Resolves its error, or null.
export const runSetup = ({ command, cwd }) => new Promise((resolve) => {
  execFile(userShell(), IS_WIN ? ['-NoLogo', '-Command', command] : ['-l', '-c', command], { cwd, timeout: 15 * 60000, maxBuffer: 16 * 1024 * 1024, env: agentEnv(process.env.PATH) }, (err, stdout, stderr) => resolve(err ? `${command}: ${String(stderr || err.message).trim().split('\n').slice(-3).join(' ')}` : null))
})

// The environment agents start with: ours, minus markers that make them think they're nested
// (herdr, tmux, a parent Claude Code session, which would e.g. turn off transcript saving).
// Settings such as CLAUDE_CODE_USE_VERTEX or ANTHROPIC_* are kept.
const SESSION_MARKERS = new Set(['TMUX', 'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SSE_PORT'])
export function agentEnv(PATH, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERDR_') && !SESSION_MARKERS.has(k)))
  return { ...env, ...extra, PATH: PATH || env.PATH, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: env.LANG || 'en_US.UTF-8' }
}
