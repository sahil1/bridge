// Runtime: herdr (https://herdr.dev), a terminal multiplexer built for agents. herdr owns the
// panes and tracks each agent's status; Bridge AI reads and drives them over herdr's CLI and
// API socket. Agents herdr doesn't know are started as a command in a plain pane.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import * as cli from './herdr-cli.js'
import * as sock from './herdr-socket.js'
import { answers } from './herdr-sessions.js'
import { AGENTS, adapter, newSessionId } from '../agents.js'
import { quoteCommand, runSetup } from './spawn.js'
import { envFor, notePane, movePane, keepPanes, accountOf, labelOf } from '../accounts.js'
import { paneKey, inView } from '../scope.js'
import { DATA, dataFile, writeFileAtomic } from '../paths.js'

export const name = 'herdr'
export const caps = { liveView: true, reorder: true, splits: true }

// The oldest herdr Bridge AI works with. Before 0.9.0, reading a new agent's screen came back
// empty until it had scrolled, a prompt could be reported sent before it was, and closing a space
// worked differently; an older herdr would half work, so Bridge AI runs agents itself instead.
export const MIN_VERSION = '0.9.0'
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return true }
// What `herdr --version` says: { version, old } (old: older than MIN_VERSION), or null when herdr
// isn't installed or doesn't answer.
export async function version() {
  const bin = await cli.herdrBin()
  const out = await new Promise((resolve) => execFile(bin, ['--version'], { timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout))))
  const v = out?.match(/(\d+)\.(\d+)\.(\d+)/)?.[0]
  return v ? { version: v, old: !newer(v, MIN_VERSION) } : out == null ? null : { version: null, old: false }
}
// Usable when herdr is installed, new enough, and a session is running.
export async function available() {
  const v = await version()
  return !!v && !v.old && !!cli.herdrSocket()
}

// herdr's integrations for agents Bridge AI starts that are out of date (`herdr integration
// status`, which reads files and needs no session), with the command herdr gives to update each:
// herdr 0.9.5 stopped installing Codex's turn hooks, and the old ones warn on every start.
// Checked now and then, not on every look.
let outdatedMemo = { at: 0, list: [] }
export async function outdated() {
  if (Date.now() - outdatedMemo.at < 10 * 60000) return outdatedMemo.list
  const out = await cli.run(['integration', 'status'], { json: false, timeout: 10000 }).catch(() => '')
  const known = new Map(AGENTS.filter((a) => a.herdr).map((a) => [a.herdr, a]))
  const list = [...String(out).matchAll(/^([\w-]+): (?:outdated|needs repair)\b/gm)].map((m) => m[1]).filter((t) => known.has(t))
    .map((t) => ({ target: t, label: known.get(t).label, command: `herdr integration install ${t}` }))
  outdatedMemo = { at: Date.now(), list }
  return list
}

// Agents that continue in another session than herdr reports (Codex after an edit).
const followed = new Map() // pane key (scope.js: per herdr session) -> sessionId
export async function setSession(paneId, sessionId) { followed.set(paneKey(paneId), sessionId) }

// Bridge AI's own agents (the chat with any model, agents.js CHAT): to herdr they're a program in
// a plain pane, so Bridge AI remembers which panes they're in and lists them as agents itself.
// Whether one is working comes from the state file it keeps (chatagent.js), not from herdr.
const OWN = dataFile('herdr-own.json')
let own = (() => { try { return JSON.parse(fs.readFileSync(OWN, 'utf8')) } catch { return {} } })() // pane key -> { kind, sessionId, cwd }
const saveOwn = () => { try { writeFileAtomic(OWN, JSON.stringify(own), { mode: 0o600 }) } catch { /* read-only disk */ } }
const ownSeen = new Map() // pane key -> { status, seen }
const ownState = (o) => { try { return fs.readFileSync(path.join(DATA, 'chat-logs', `${o.sessionId}.state`), 'utf8').trim() } catch { return 'idle' } }
function ownAgents(snap, have) {
  const out = []
  const ws = Object.fromEntries((snap.workspaces || []).map((w) => [w.workspace_id, w]))
  const tabs = Object.fromEntries((snap.tabs || []).map((t) => [t.tab_id, t]))
  const panes = new Map((snap.panes || []).map((p) => [p.pane_id, p]))
  let gone = false
  for (const [key, o] of Object.entries(own)) {
    if (!inView(key)) continue
    const paneId = key.slice(key.indexOf('/') + 1)
    const p = panes.get(key.startsWith('@') ? paneId : key)
    if (!p) { delete own[key]; ownSeen.delete(key); gone = true; continue }
    if (have.has(p.pane_id)) continue
    const st = ownSeen.get(key) || { status: 'idle', seen: true }
    let s = ['working', 'blocked'].includes(ownState(o)) ? ownState(o) : 'idle'
    if (s === 'working' && st.status !== 'working') st.seen = false
    if (s === 'idle' && !st.seen && (st.status === 'working' || st.status === 'done')) s = 'done'
    const seq = (st.seq || 0) + (s !== st.status ? 1 : 0)
    ownSeen.set(key, { ...st, status: s, seq })
    out.push({
      paneId: p.pane_id, tabId: p.tab_id, workspaceId: p.workspace_id, workspace: ws[p.workspace_id]?.label || p.workspace_id, tab: tabs[p.tab_id]?.label || '',
      kind: o.kind, status: s, title: p.terminal_title_stripped || '', cwd: o.cwd || p.cwd, sessionId: o.sessionId, focused: !!p.focused, seq, own: true,
    })
  }
  if (gone) saveOwn()
  return out
}
const isOwn = (paneId) => !!own[paneKey(paneId)]

// session: the herdr session in view (the sidebar's session menu). When it isn't running, an
// empty fleet that says so (down), so the last session's agents don't linger on screen.
export async function fleet() {
  const session = cli.sessionName()
  let f, snap
  try {
    [f, snap] = await Promise.all([cli.fleet(), cli.snapshot()])
  } catch (err) {
    if (await answers(cli.herdrSocket())) throw err
    return { agents: [], tabs: [], workspaces: [], panes: [], session, down: true }
  }
  f.session = session
  const mine = ownAgents(snap, new Set((f.agents || []).map((a) => a.paneId)))
  if (mine.length) {
    f.agents = [...(f.agents || []), ...mine]
    const ids = new Set(mine.map((a) => a.paneId))
    for (const t of f.tabs || []) for (const p of t.panes || []) if (ids.has(p.paneId)) p.agent = true
  }
  for (const a of f.agents || []) {
    if (followed.has(paneKey(a.paneId))) a.sessionId = followed.get(paneKey(a.paneId))
    // herdr doesn't know which account an agent uses: the one it was started on from here.
    a.accountId = accountOf(a.kind, a.paneId, a.sessionId)
    a.account = labelOf(a.accountId)
  }
  if (snap.panes?.length) keepPanes(new Set(snap.panes.map((p) => p.pane_id)))
  const ws = Object.fromEntries((snap.workspaces || []).map((w, i) => [w.workspace_id, { label: w.label, number: i + 1 }]))
  const tabs = Object.fromEntries((snap.tabs || []).map((t) => [t.tab_id, t.label]))
  const rects = {}
  for (const l of snap.layouts || []) for (const p of l.panes || []) rects[p.pane_id] = p.rect
  f.panes = (snap.panes || []).map((p) => ({
    paneId: p.pane_id, workspaceId: p.workspace_id, tabId: p.tab_id,
    workspace: ws[p.workspace_id]?.label || p.workspace_id, number: ws[p.workspace_id]?.number || 0, tab: tabs[p.tab_id] || '',
    agent: p.agent || null, status: p.agent_status || null,
    title: p.terminal_title_stripped || '', cwd: p.foreground_cwd || p.cwd,
    cols: rects[p.pane_id]?.width || null, rows: rects[p.pane_id]?.height || null,
  }))
  return f
}

export const read = (paneId, lines) => sock.read(paneId, lines).catch(() => cli.readPane(paneId, lines))
export const input = (paneId, steps) => sock.input(paneId, steps)
export const keys = (paneId, k) => cli.sendKeys(paneId, k)
export const paneKeys = (paneId, k) => cli.paneSendKeys(paneId, k)
export const text = (paneId, t) => cli.paneSendText(paneId, t)
// One of Bridge AI's own agents: typed into its pane (herdr's agent commands don't know it).
// Line breaks as LF, which it keeps in the message; Enter sends it.
export async function prompt(paneId, t) {
  if (!isOwn(paneId)) return cli.prompt(paneId, t)
  await sock.input(paneId, [{ text: String(t).replace(/\r\n?/g, '\n') }])
  await new Promise((r) => setTimeout(r, 120))
  await sock.input(paneId, [{ keys: ['enter'] }])
  return { ok: true }
}
// The opening prompt of one of Bridge AI's own agents, typed in once it's up: it writes its state
// file as it starts (chatagent.js). herdr refuses input a shell still starting can't take in one
// line, so that's tried again too, for up to half a minute.
async function typeWhenUp(paneId, sessionId, text) {
  const up = path.join(DATA, 'chat-logs', `${sessionId}.state`)
  for (let i = 0; i < 60 && own[paneKey(paneId)]; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (!(await fs.promises.access(up).then(() => true, () => false))) continue
    await new Promise((r) => setTimeout(r, 400))
    try { return await prompt(paneId, text) } catch { /* not taking input yet */ }
  }
}
export async function focusAgent(paneId) {
  if (!isOwn(paneId)) return cli.focusAgent(paneId)
  const st = ownSeen.get(paneKey(paneId))
  if (st) st.seen = true
}
export const focusTab = (tabId) => cli.focusTab(tabId)
export const renameTab = cli.renameTab
export const closeTab = cli.closeTab
export const renameWorkspace = cli.renameWorkspace
// A space with herdr worktree spaces open closes only with them (herdr 0.9.0 on). Bridge AI shows
// each as a space of its own, so closing the one you picked mustn't close the others: say which.
export async function closeWorkspace(wsId) {
  try { return await cli.closeWorkspace(wsId) } catch (err) {
    if (err.code !== 'workspace_group_close_required') throw err
    const snap = await cli.snapshot().catch(() => ({}))
    const key = (snap.workspaces || []).find((w) => w.workspace_id === wsId)?.worktree?.repo_key
    const others = (snap.workspaces || []).filter((w) => w.workspace_id !== wsId && key && w.worktree?.repo_key === key).map((w) => w.label)
    throw Object.assign(new Error(`This space has herdr worktree spaces open${others.length ? ` (${others.join(', ')})` : ''}. Close those first, or close the whole group in herdr.`), { code: err.code })
  }
}
export const moveWorkspace = (wsId, index) => sock.call('workspace.move', { workspace_id: wsId, insert_index: index })
export const moveTab = (tabId, index) => sock.call('tab.move', { tab_id: tabId, insert_index: index })

// A new space. herdr has no empty spaces: it opens with a shell tab in your home folder.
export async function createSpace({ label, cwd = os.homedir() }) {
  const r = await sock.call('workspace.create', { label: String(label || 'Space').slice(0, 80), cwd, focus: false })
  return { workspaceId: r?.workspace?.workspace_id || null }
}

// Move a tab to another space (or a new one named newSpace), at `index` among its tabs. herdr
// moves panes, not tabs: the first pane becomes a new tab there, the others join it side by
// side. The terminals keep running, but get new pane ids (returned as moved: old -> new).
// The space left empty closes by itself.
export async function moveTabToSpace(tabId, { workspaceId, newSpace, index } = {}) {
  const snap = await cli.snapshot()
  const tab = (snap.tabs || []).find((t) => t.tab_id === tabId)
  if (!tab) throw new Error('Not found')
  const ids = (snap.layouts || []).find((l) => l.tab_id === tabId)?.panes?.map((p) => p.pane_id)
    || (snap.panes || []).filter((p) => p.tab_id === tabId).map((p) => p.pane_id)
  if (!ids.length) throw new Error('That tab has nothing in it')
  const label = tab.label && !/^\d+$/.test(tab.label) ? tab.label : null
  const moved = {}
  const first = await sock.call('pane.move', { pane_id: ids[0], destination: newSpace
    ? { type: 'new_workspace', label: String(newSpace).slice(0, 80), tab_label: label }
    : { type: 'new_tab', workspace_id: workspaceId, label } })
  const pane = first?.move_result?.pane
  if (!pane) throw new Error('herdr did not move the tab')
  moved[ids[0]] = pane.pane_id
  for (const id of ids.slice(1)) {
    const r = await sock.call('pane.move', { pane_id: id, destination: { type: 'tab', tab_id: pane.tab_id, split: 'right' } })
    if (r?.move_result?.pane) moved[id] = r.move_result.pane.pane_id
  }
  for (const [from, to] of Object.entries(moved)) movePane(from, to)
  if (Number.isInteger(index) && !newSpace) {
    try { await sock.call('tab.move', { tab_id: pane.tab_id, insert_index: index }) } catch { /* left at the end */ }
  }
  return { workspaceId: pane.workspace_id, tabId: pane.tab_id, moved }
}

// A new agent in a new space (newSpace) or a new tab of an existing one (workspaceId).
// herdr starts the agents it knows itself, so a default model applies only to the others, unless
// pinModel says this agent must start on it (restarted on another model from the message box).
// resume: a session id to open again; fork: a session id to copy into a new conversation.
// setup: { command, cwd } to run first (a new worktree's `npm install`). herdr starts an
// agent only at an idle shell prompt, so it runs before the pane opens; if it fails, the agent
// still starts and setupError says why.
// env: extra variables for the agent (a chief of staff thread's id).
export async function launch({ kind = 'claude', cwd, label, workspaceId, newSpace, prompt: opening, model, pinModel, access, account, resume, fork, setup, env: extraEnv }) {
  const env = { ...envFor(kind, account), ...extraEnv } // a second account's config folder, if one was picked
  const a = adapter(kind)
  const resumed = fork && a.fork ? a.fork(fork, a.sessionId === 'assign' ? newSessionId() : undefined) : resume && a.resume ? a.resume(resume) : []
  const allowed = access && a.access ? a.access(access) : [] // how much it may do without asking
  const extra = [...allowed, ...(pinModel && model && a.model && a.herdr ? [...a.model(model), ...resumed] : resumed)]
  const setupError = setup ? await runSetup(setup) : null
  const name = `ba-${Date.now().toString(36)}`
  const space = String(newSpace || '').trim()
  let out
  // Bridge AI's own agent: a session id of its own, and the first message as an argument.
  const sid = a.builtin ? resume || newSessionId() : null
  if (a.builtin) Object.assign(env, { BRIDGE_HOME: DATA })
  if (a.herdr) {
    out = await cli.launchTask({ name, kind: a.herdr, cwd, label: space || label, workspaceId: space ? null : workspaceId || null, prompt: opening, env, args: extra })
  } else {
    // herdr doesn't know this agent: open a pane and run it like you would by hand.
    const created = workspaceId && !space
      ? await cli.run(['tab', 'create', '--workspace', workspaceId, '--cwd', cwd, '--label', label, ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`])])
      : await cli.run(['workspace', 'create', '--cwd', cwd, '--label', space || label, '--no-focus', ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`])])
    const paneId = cli.findPaneId(created)
    if (!paneId) throw new Error('herdr did not return a pane for the new tab')
    // Its opening prompt rides on the command line, unless it's long or more than one line: a
    // shell still starting can cut a long line off (macOS), so that's typed in once it's up.
    const later = a.builtin && !resume && opening && (Buffer.byteLength(opening) > 200 || /[\r\n]/.test(opening)) ? opening : null
    const args = a.builtin ? (resume ? a.resume(resume) : a.start({ sessionId: sid, prompt: later ? undefined : opening })) : [...(model && a.model ? a.model(model) : []), ...(extra.length ? extra : a.start({}))]
    await cli.paneSendText(paneId, quoteCommand(a.bin[0], args))
    await cli.paneSendKeys(paneId, ['enter'])
    if (a.builtin) { own[paneKey(paneId)] = { kind, sessionId: sid, cwd }; saveOwn() }
    if (later) typeWhenUp(paneId, sid, later)
    out = a.builtin ? { paneId, sessionId: sid } : { paneId, promptPending: !!opening }
    if (opening && !a.builtin) setTimeout(() => cli.prompt(paneId, opening).catch(() => cli.paneSendText(paneId, opening).then(() => cli.paneSendKeys(paneId, ['enter'])).catch(() => {})), 6000)
  }
  if (space) { try { await cli.renameTabOfPane(out.paneId, label) } catch { /* default tab name */ } }
  notePane(out.paneId, kind, account)
  return setupError ? { ...out, setupError } : out
}

// Your herdr status colors, so both views use the same ones.
export function theme() {
  const out = {}
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), '.config', 'herdr', 'config.toml'), 'utf8')
    const block = toml.split(/^\[theme\.custom\]/m)[1]?.split(/^\[/m)[0] || ''
    for (const m of block.matchAll(/^(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/gm)) out[m[1]] = m[2]
  } catch { /* defaults in CSS */ }
  return out
}
