// Thin wrapper over the herdr CLI. Every call is a separate process so a
// herdr restart or upgrade never leaves us holding a stale socket.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HERDR = process.env.HERDR_BIN || 'herdr'

// Which herdr to talk to. A session picked in Settings (`herdr.session`) always wins. Otherwise:
// inside herdr the CLI gets HERDR_SOCKET_PATH from the environment; started any other way (the
// Mac app at login, a plain terminal) it would fall back to an old default path and see nothing.
// So find the running session's socket: the inherited one if it still exists, else "main", else
// the most recently used session. Checked on every call, so herdr starting after Bridge (or a
// herdr restart) is picked up.
const SESSIONS = path.join(os.homedir(), '.config', 'herdr', 'sessions')
const DEFAULT_SOCK = path.join(os.homedir(), '.config', 'herdr', 'herdr.sock') // the unnamed "default" session
const inherited = process.env.HERDR_SOCKET_PATH
let wanted = null
export function useSession(name) { wanted = /^[\w.-]{1,64}$/.test(String(name || '')) ? String(name) : null }
const socketOf = (name) => (name === 'default' ? DEFAULT_SOCK : path.join(SESSIONS, name, 'herdr.sock'))
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

// Every herdr session on this computer, for the picker in Settings.
export async function sessions() {
  const res = await run(['session', 'list', '--json'])
  const current = sessionName()
  return { picked: wanted, current, sessions: (res?.sessions || []).map((s) => ({ name: s.name, running: !!s.running, current: s.name === current })) }
}
const herdrEnv = () => { const sock = herdrSocket(); return sock ? { ...process.env, HERDR_SOCKET_PATH: sock } : process.env }

export function run(args, { timeout = 15000, json = true } = {}) {
  return new Promise((resolve, reject) => {
    execFile(HERDR, args, { timeout, maxBuffer: 16 * 1024 * 1024, env: herdrEnv() }, (err, stdout, stderr) => {
      if (err) {
        // herdr reports structured errors on stdout as {"error":{...}}
        let msg = (stderr || '').trim() || err.message
        try {
          const parsed = JSON.parse(stdout)
          if (parsed.error) msg = parsed.error.message || parsed.error.code || msg
        } catch { /* not json */ }
        return reject(new Error(msg))
      }
      if (!json) return resolve(stdout)
      try {
        const parsed = JSON.parse(stdout)
        if (parsed.error) return reject(new Error(parsed.error.message || parsed.error.code))
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

// Open a new workspace in `cwd` and start an agent of `kind` in its first pane.
export async function launchAgent({ name, kind, cwd, label }) {
  const created = await run(['workspace', 'create', '--cwd', cwd, '--label', label || name, '--no-focus'])
  const paneId = findPaneId(created)
  if (!paneId) throw new Error('herdr did not return a pane for the new workspace')
  try {
    await run(['agent', 'start', name, '--kind', kind, '--pane', paneId, '--timeout', '60000'], { timeout: 70000 })
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
export async function launchTask({ name, kind = 'claude', cwd, label, workspaceId, prompt, env = {} }) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`])
  const created = workspaceId
    ? await run(['tab', 'create', '--workspace', workspaceId, '--cwd', cwd, '--label', label, ...envArgs])
    : await run(['workspace', 'create', '--cwd', cwd, '--label', label, '--no-focus', ...envArgs])
  const paneId = findPaneId(created)
  if (!paneId) throw new Error('herdr did not return a pane for the new tab')
  // herdr only passes simple one-line prompts on the command line; longer ones are sent once the agent is up.
  const inline = prompt && !/[\n"'`$\\]/.test(prompt) ? prompt : null
  try {
    await run(['agent', 'start', name, '--kind', kind, '--pane', paneId, '--timeout', '60000', '--', ...(inline ? [inline] : [])], { timeout: 70000 })
  } catch (err) {
    if (/not.?ready|blocked/i.test(err.message)) return { paneId, waiting: true, promptPending: !!prompt && !inline }
    throw err
  }
  if (prompt && !inline) await run(['agent', 'prompt', paneId, prompt])
  return { paneId }
}

export function findPaneId(obj) {
  if (!obj || typeof obj !== 'object') return null
  if (typeof obj.pane_id === 'string') return obj.pane_id
  for (const v of Object.values(obj)) {
    const found = findPaneId(v)
    if (found) return found
  }
  return null
}
