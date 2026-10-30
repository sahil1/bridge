// Thin wrapper over the herdr CLI. Every call is a separate process so a
// herdr restart or upgrade never leaves us holding a stale socket.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loginPath, which } from '../agents.js'
import { useSessions } from '../scope.js'

// The herdr program. The Mac app started at login or from the Dock has a bare PATH without
// ~/.local/bin, where herdr installs itself, so look on your login shell's PATH.
export async function herdrBin() {
  if (process.env.HERDR_BIN) return process.env.HERDR_BIN
  return (await which('herdr', await loginPath())) || 'herdr'
}

// Which herdr to talk to. A session picked in the sidebar or Settings (`herdr.session`) always wins. Otherwise:
// inside herdr the CLI gets HERDR_SOCKET_PATH from the environment; started any other way (the
// Mac app at login, a plain terminal) it would fall back to an old default path and see nothing.
// So find the running session's socket: the inherited one if it still exists, else "main", else
// the most recently used session. Checked on every call, so herdr starting after Bridge (or a
// herdr restart) is picked up.
const SESSIONS = path.join(os.homedir(), '.config', 'herdr', 'sessions')
const DEFAULT_SOCK = path.join(os.homedir(), '.config', 'herdr', 'herdr.sock') // the unnamed "default" session
const inherited = process.env.HERDR_SOCKET_PATH
let wanted = null
// herdr's own rule for session names; "default" is the unnamed session.
export const validName = (name) => /^[A-Za-z0-9._-]{1,64}$/.test(String(name ?? '')) && name !== '.' && name !== '..'
// Applies at once: every call looks the socket up again. What Bridge AI keeps per pane is filed
// under the session in view (scope.js), since each session numbers its panes from the start.
export function useSession(name) {
  wanted = validName(name) ? String(name) : null
  useSessions(() => sessionName())
}
export const socketOf = (name) => (name === 'default' ? DEFAULT_SOCK : path.join(SESSIONS, name, 'herdr.sock'))
export function herdrSocket() {
  if (wanted) return socketOf(wanted) // even when it isn't running, so you see that instead of another session
  if (inherited && fs.existsSync(inherited)) return inherited
  try {
    const live = [...fs.readdirSync(SESSIONS).map((name) => path.join(SESSIONS, name, 'herdr.sock')), DEFAULT_SOCK].filter((p) => fs.existsSync(p))
    const main = live.find((p) => p.includes(`${path.sep}main${path.sep}`))
    if (main) return main
    return live.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || inherited || null
  } catch { return inherited || null }
}
// The session's name for `herdr session attach` (Herdr view, opening in your terminal).
export function sessionName(sock = herdrSocket()) {
  if (wanted) return wanted
  if (!sock) return null
  return sock === DEFAULT_SOCK ? 'default' : path.basename(path.dirname(sock))
}

export const picked = () => wanted
const herdrEnv = () => { const sock = herdrSocket(); return sock ? { ...process.env, HERDR_SOCKET_PATH: sock } : process.env }

export async function run(args, { timeout = 15000, json = true } = {}) {
  const bin = await herdrBin()
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024, env: herdrEnv() }, (err, stdout, stderr) => {
      if (err) {
        // herdr reports structured errors as {"error":{"code","message"}}, on stdout or stderr
        let msg = (stderr || '').trim() || err.message
        let code
        for (const out of [stdout, stderr]) {
          try {
            const parsed = JSON.parse(out)
            if (parsed.error) { msg = parsed.error.message || parsed.error.code || msg; code = parsed.error.code; break }
          } catch { /* not json */ }
        }
        return reject(Object.assign(new Error(msg), code ? { code } : {}))
      }
      if (!json) return resolve(stdout)
      try {
        const parsed = JSON.parse(stdout)
        if (parsed.error) return reject(Object.assign(new Error(parsed.error.message || parsed.error.code), parsed.error.code ? { code: parsed.error.code } : {}))
        resolve(parsed.result ?? parsed)
      } catch {
        resolve(stdout)
      }
    })
  })
}

export async function snapshot() {
  const res = await run(['api', 'snapshot'])
  return res.snapshot
}

// Flatten the snapshot into one row per agent with its workspace and tab labels.
export async function fleet() {
  const snap = await snapshot()
  const ws = Object.fromEntries((snap.workspaces || []).map((w) => [w.workspace_id, w]))
  const tabs = Object.fromEntries((snap.tabs || []).map((t) => [t.tab_id, t]))
  const agents = (snap.agents || []).map((a) => ({
    paneId: a.pane_id,
    tabId: a.tab_id,
    workspaceId: a.workspace_id,
    workspace: ws[a.workspace_id]?.label || a.workspace_id,
    tab: tabs[a.tab_id]?.label || '',
    kind: a.agent,
    status: a.agent_status,
    title: a.terminal_title_stripped || '',
    cwd: a.foreground_cwd || a.cwd,
    sessionId: a.agent_session?.value || null,
    focused: !!a.focused,
    seq: a.state_change_seq || 0,
  }))
  // Every tab with its panes and layout, so plain shells (dev servers, editors) show up too.
  const layoutOf = Object.fromEntries((snap.layouts || []).map((l) => [l.tab_id, l]))
  const agentPanes = new Set(agents.map((a) => a.paneId))
  const tabList = (snap.tabs || []).map((t) => {
    const l = layoutOf[t.tab_id]
    const rect = Object.fromEntries((l?.panes || []).map((p) => [p.pane_id, p.rect]))
    const panes = (snap.panes || []).filter((p) => p.tab_id === t.tab_id).map((p) => ({
      paneId: p.pane_id, agent: agentPanes.has(p.pane_id), cwd: p.foreground_cwd || p.cwd,
      title: p.terminal_title_stripped || '', rect: rect[p.pane_id] || null,
    }))
    return {
      tabId: t.tab_id, workspaceId: t.workspace_id, workspace: ws[t.workspace_id]?.label || t.workspace_id,
      label: t.label || '', number: t.number, area: l?.area || null, zoomed: !!l?.zoomed, panes,
    }
  })
  return {
    agents,
    tabs: tabList,
    workspaces: (snap.workspaces || []).map((w) => ({ id: w.workspace_id, label: w.label, status: w.agent_status })),
  }
}

export function readPane(paneId, lines = 200) {
  return run(['pane', 'read', paneId, '--source', 'recent', '--lines', String(lines), '--format', 'ansi'], { json: false })
}

export function prompt(paneId, text) {
  return run(['agent', 'prompt', paneId, text])
}

export function paneSendText(paneId, text) {
  return run(['pane', 'send-text', paneId, text])
}

export function paneSendKeys(paneId, keys) {
  return run(['pane', 'send-keys', paneId, ...keys])
}

export function focusAgent(paneId) {
  return run(['agent', 'focus', paneId])
}

function needLabel(label) {
  if (!label) throw new Error('Name can\'t be empty')
  return label.slice(0, 80)
}
export const renameTab = (tabId, label) => run(['tab', 'rename', tabId, needLabel(label)])
export const closeTab = (tabId) => run(['tab', 'close', tabId])
export const renameWorkspace = (wsId, label) => run(['workspace', 'rename', wsId, needLabel(label)])
// Not with --group: a space with herdr worktree spaces open (made with herdr's own `worktree`
// commands) closes only with all of them, and Bridge AI shows each as a space of its own, so
// herdr's refusal (workspace_group_close_required) goes back to say which to close first.
export const closeWorkspace = (wsId) => run(['workspace', 'close', wsId])
export async function renameTabOfPane(paneId, label) {
  const snap = await snapshot()
  const p = (snap.panes || []).find((x) => x.pane_id === paneId)
  if (p) await renameTab(p.tab_id, label)
}

export function focusTab(tabId) {
  return run(['tab', 'focus', tabId])
}

export function sendKeys(paneId, keys) {
  return run(['agent', 'send-keys', paneId, ...keys])
}

// herdr starts an agent only at a pane's interactive shell prompt. A pane that was just created is
// still running your shell's startup (.zshrc and the like), which herdr answers with
// agent_pane_busy (on macOS also agent_start_input_failed, for a command longer than a starting
// shell takes in one line), so wait for the prompt and try again rather than fail. Nothing is
// typed into the pane until herdr accepts.
const PROMPT_WAIT = 30000
// waitIfLong: false gives up at once on a command too long for now, to try it without its prompt.
async function startAgent(name, kind, paneId, rest = [], { waitIfLong = true } = {}) {
  const until = Date.now() + PROMPT_WAIT
  for (let wait = 400; ; wait = Math.min(Math.round(wait * 1.5), 2000)) {
    try {
      return await run(['agent', 'start', name, '--kind', kind, '--pane', paneId, '--timeout', '60000', ...rest], { timeout: 70000 })
    } catch (err) {
      if (err.code !== 'agent_pane_busy' && !(err.code === 'agent_start_input_failed' && waitIfLong)) throw err
      if (Date.now() + wait > until) throw Object.assign(new Error(`The new tab's shell didn't reach its prompt within ${PROMPT_WAIT / 1000} seconds, so the agent couldn't start there. Something in your shell's startup may be waiting; open the tab to see, then try again.`), { code: 'shell_not_ready' })
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

// An opening prompt for an agent that isn't taking one yet: herdr turns it away while the agent
// starts or waits on you (a folder to trust, a sign-in), so it's tried again until it goes in,
// for up to a quarter of an hour.
const WAITING = new Set(['agent_blocked', 'agent_not_ready', 'agent_launch_pending'])
function promptWhenReady(paneId, text, until = Date.now() + 15 * 60000) {
  setTimeout(() => run(['agent', 'prompt', paneId, text]).catch((err) => {
    if (WAITING.has(err.code) && Date.now() < until) promptWhenReady(paneId, text, until)
  }), 3000)
}
const agentIn = async (paneId) => { try { return (await snapshot()).agents?.some((a) => a.pane_id === paneId) } catch { return false } }

// Open a new workspace in `cwd` and start an agent of `kind` in its first pane.
export async function launchAgent({ name, kind, cwd, label }) {
  const created = await run(['workspace', 'create', '--cwd', cwd, '--label', label || name, '--no-focus'])
  const paneId = findPaneId(created)
  if (!paneId) throw new Error('herdr did not return a pane for the new workspace')
  try {
    await startAgent(name, kind, paneId)
  } catch (err) {
    // A first launch usually stops at a trust or login prompt. The agent exists
    // and is waiting on you, which the UI shows as "Needs you".
    if (/not.?ready|blocked/i.test(err.message)) return { paneId, waiting: true }
    throw err
  }
  return { paneId }
}

// Start an agent with an opening prompt (e.g. a slash command) in a new tab of an
// existing workspace, or a new workspace when that one isn't open.
// env: extra variables for the pane (an account's config folder, say), set before the agent starts.
// args: extra arguments for the agent (resume or fork a session), before the opening prompt.
export async function launchTask({ name, kind = 'claude', cwd, label, workspaceId, prompt, env = {}, args = [] }) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`])
  const created = workspaceId
    ? await run(['tab', 'create', '--workspace', workspaceId, '--cwd', cwd, '--label', label, ...envArgs])
    : await run(['workspace', 'create', '--cwd', cwd, '--label', label, '--no-focus', ...envArgs])
  const paneId = findPaneId(created)
  if (!paneId) throw new Error('herdr did not return a pane for the new tab')
  let inline = inlinePrompt(prompt) ? prompt : null
  try {
    try {
      await startAgent(name, kind, paneId, ['--', ...args, ...(inline ? [inline] : [])], { waitIfLong: !inline })
    } catch (err) {
      // Refused with the prompt on its command line: without it, and the prompt follows.
      if (!inline || !['agent_start_input_failed', 'invalid_agent_argument'].includes(err.code)) throw err
      inline = null
      await startAgent(name, kind, paneId, ['--', ...args])
    }
  } catch (err) {
    const pending = !!prompt && !inline
    // A first launch usually stops at a trust or login prompt. The agent exists and is waiting on
    // you, which the UI shows as "Needs you"; its opening prompt goes in once you've answered.
    if (err.code === 'agent_not_ready' || /not.?ready|blocked/i.test(err.message)) {
      if (pending) promptWhenReady(paneId, prompt)
      return { paneId, waiting: true, promptPending: pending }
    }
    // Still busy after a minute (its first turn, on the prompt it started with): it's running.
    if ((err.code === 'timeout' || err.killed) && await agentIn(paneId)) return { paneId }
    // herdr refused the command, so the new tab holds a bare shell where the agent should be: close
    // it. One where something ran (and failed), or whose shell never got to its prompt, stays to show why.
    if (!['timeout', 'agent_start_failed', 'agent_kind_mismatch', 'shell_not_ready'].includes(err.code) && !err.killed) {
      await (workspaceId ? run(['tab', 'close', findId(created, 'tab_id')]) : run(['workspace', 'close', findId(created, 'workspace_id')])).catch(() => {})
    }
    throw err
  }
  if (prompt && !inline) {
    try { await run(['agent', 'prompt', paneId, prompt]) } catch (err) {
      if (!WAITING.has(err.code)) throw err
      promptWhenReady(paneId, prompt)
      return { paneId, promptPending: true }
    }
  }
  return { paneId }
}

// What goes on the agent's command line: a short one-line prompt with nothing a shell would read
// into. Anything else is sent once the agent is up. herdr types the command into the pane's
// shell, and on macOS refuses (since 0.9.4; before, it cut it off) one longer than a shell that's
// still starting takes in one line: 1024 bytes, with the agent's own arguments.
const INLINE_MAX = 200
// eslint-disable-next-line no-control-regex
export const inlinePrompt = (p) => !!p && Buffer.byteLength(p) <= INLINE_MAX && !/[\x00-\x1f\x7f"'`$\\]/.test(p)

// The first `key` (pane_id, tab_id, workspace_id) in herdr's answer, however deep.
export function findId(obj, key) {
  if (!obj || typeof obj !== 'object') return null
  if (typeof obj[key] === 'string') return obj[key]
  for (const v of Object.values(obj)) {
    const found = findId(v, key)
    if (found) return found
  }
  return null
}
export const findPaneId = (obj) => findId(obj, 'pane_id')
