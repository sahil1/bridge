// Starting programs in a terminal the same way on macOS, Linux and Windows.
import { IS_WIN } from '../paths.js'

const shQuote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

// One line you could type into a shell to run `bin args...`.
export function quoteCommand(bin, args = []) {
  return IS_WIN ? `& ${[bin, ...args].map(psQuote).join(' ')}` : [bin, ...args].map(shQuote).join(' ')
}

export const userShell = () => (IS_WIN ? (process.env.BRIDGE_SHELL || 'powershell.exe') : (process.env.BRIDGE_SHELL || process.env.SHELL || '/bin/bash'))

// The program and arguments for a pane: the user's login shell running the agent, then staying
// open as a plain shell when the agent exits (so you can read its last words or restart it).
export function shellCommand(bin, args) {
  const shell = userShell()
  if (IS_WIN) return bin ? [shell, ['-NoLogo', '-NoExit', '-Command', quoteCommand(bin, args)]] : [shell, ['-NoLogo']]
  return bin ? [shell, ['-l', '-c', `${quoteCommand(bin, args)}; exec ${shQuote(shell)} -l`]] : [shell, ['-l']]
}

// The environment agents start with: ours, minus markers that make them think they're nested
// (herdr, tmux, a parent Claude Code session, which would e.g. turn off transcript saving).
// Settings such as CLAUDE_CODE_USE_VERTEX or ANTHROPIC_* are kept.
const SESSION_MARKERS = new Set(['TMUX', 'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SSE_PORT'])
export function agentEnv(PATH, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERDR_') && !SESSION_MARKERS.has(k)))
  return { ...env, ...extra, PATH: PATH || env.PATH, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: env.LANG || 'en_US.UTF-8' }
}
