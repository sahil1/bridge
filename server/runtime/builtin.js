// Runtime: built in. Bridge AI runs the terminals itself (node-pty, with a headless xterm keeping
// each screen), so nothing else needs installing, on macOS, Linux or Windows. The terminals live
// in a small terminal host process (ptyhost.js), so agents keep running while the server quits,
// restarts or updates, and the next server picks them up as they are (Settings › General › Keep
// agents running; off, they end with the server). Here each one has a copy of its screen, fed
// from the host. Spaces and tabs are saved to the data folder; when the host is gone too (after
// a reboot), agents that can resume a session (Claude Code, Codex) reopen where they were, and
// the rest start fresh in the same folder. If the host can't start, terminals run in this process.
// An agent that was in the middle of something when its terminal ended is told to carry on once
// it's back in its conversation (carryOn, below).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import pty from 'node-pty'
import headless from '@xterm/headless'
import { adapter, loginPath, newSessionId, installed } from '../agents.js'
import { discoverSession, locate } from '../transcripts.js'
import { dataFile, ensureDir, DATA, IS_WIN, ROOT } from '../paths.js'
import { shellCommand, agentEnv, SETUP_DONE } from './spawn.js'
import { providerEnv } from '../providers.js'
import * as accounts from '../accounts.js'
import { firstRun, knows } from '../firstrun.js'
import { lineAnsi, SCROLLBACK } from './screen.js'
import * as host from './hostlink.js'

const { Terminal } = headless

export const name = 'builtin'
export const caps = { liveView: false, reorder: true, splits: false }
export const available = () => true

// node-pty's prebuilt helper sometimes installs without the execute bit (macOS, Linux).
try {
  const prebuilds = path.join(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')), 'prebuilds')
  for (const d of fs.readdirSync(prebuilds)) { const h = path.join(prebuilds, d, 'spawn-helper'); if (fs.existsSync(h)) fs.chmodSync(h, 0o755) }
} catch { /* Windows, or a source build */ }

const STATE = dataFile('runtime.json')
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version } catch { return null } })()
const COLS = Number(process.env.BRIDGE_COLS) || 120
const ROWS = Number(process.env.BRIDGE_ROWS) || 40

let spaces = [] // { id, label, fresh } (fresh: made empty from the UI and nothing put in it yet)
let tabs = [] // { tabId, workspaceId, label }
const panes = new Map() // paneId -> live pane
let nextId = 1
let stopping = false
const id = () => nextId++
// The terminal host, while this server has it. BRIDGE_PTY_HOST=0 runs terminals in this process.
let link = null
let keepOn = true // Settings › Keep agents running
let hostOff = process.env.BRIDGE_PTY_HOST === '0'
let retryAt = 0
const losses = []

// eslint-disable-next-line no-control-regex
const plain = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/\r/g, '')
// A menu, permission prompt or question waiting on the user.
const ASKING = /(enter to (continue|confirm|select|submit)|do you want to|\(y\/n\)|\[y\/n\]|❯\s*\d+\.|allow .* \?|trust (this|the files in this) folder|Review your answers)/i

// Spaces go away with their last tab, except a new one you made that's still waiting for its first.
const prune = () => { spaces = spaces.filter((w) => w.fresh || tabs.some((t) => t.workspaceId === w.id)) }

function save() {
  ensureDir(DATA)
  // version and at: whether what ends up reopening them was an update or the computer restarting.
  const out = {
    nextId, spaces, tabs, version: VERSION, at: Date.now(),
    panes: [...panes.values()].map((p) => ({ paneId: p.paneId, tabId: p.tabId, workspaceId: p.workspaceId, kind: p.kind, cwd: p.cwd, model: p.model, sessionId: p.sessionId, account: p.account, ...(p.env ? { env: p.env } : {}), ...(p.midTask ? { midTask: true } : {}), ...(p.continuedAt ? { continuedAt: p.continuedAt } : {}) })),
  }
  try { fs.writeFileSync(STATE, JSON.stringify(out, null, 2)) } catch { /* read-only disk: keep going */ }
}

// env: extra variables for the agent (a chief of staff thread's id), kept for when it starts again.
// continuedAt: when it was last told to carry on after an interruption (carryOn).
async function spawnPane({ paneId, tabId, workspaceId, kind, cwd, sessionId, resume, fork, opening, model, access, account, setup, env, continuedAt }) {
  const a = adapter(kind)
  const PATH = await loginPath()
  let bin = null
  let args = []
  let reopened = false // its conversation, from its transcript
  if (kind !== 'shell') {
    bin = (await installed()).find((x) => x.kind === kind)?.path || a.bin[0]
    // Resume only a session that has a transcript (one that never got a message can't be resumed).
    let hasLog = false
    try { hasLog = !!(resume && sessionId && a.resume && locate(kind, sessionId, cwd)) } catch { /* no transcript folder */ }
    if (fork && a.fork) {
      // A copy of session `fork`: Claude takes the new id we give it; Codex names its own.
      sessionId = a.sessionId === 'assign' ? newSessionId() : null
      args = a.fork(fork, sessionId || undefined)
    } else if (hasLog) { args = a.resume(sessionId); reopened = true } else {
      if (resume) sessionId = null
      if (a.sessionId === 'assign' && !sessionId) sessionId = newSessionId()
      args = a.start({ sessionId: a.sessionId === 'assign' ? sessionId : undefined, prompt: a.promptArg ? opening : undefined })
    }
    if (model && a.model) args = [...a.model(model), ...args]
    if (access && a.access) args = [...a.access(access), ...args]
  }
  const [file, argv] = shellCommand(bin, args, setup, cwd)
  // Checked without blocking: macOS can hold a look into Desktop or Documents until you answer its
  // permission prompt, and the rest of Bridge AI shouldn't wait for that.
  const there = await fs.promises.access(cwd).then(() => true, () => false)
  // What a later server needs to show it, should it find the terminal before the saved layout does.
  const meta = { tabId, workspaceId, kind, cwd, model: model || null, access: access || null, sessionId: sessionId || null, account: account || null, env: env || null, tab: tabs.find((t) => t.tabId === tabId)?.label, space: spaces.find((w) => w.id === workspaceId)?.label }
  const { proc, remote } = await openTerm(paneId, file, argv, { cols: COLS, rows: ROWS, cwd: there ? cwd : process.env.HOME, env: agentEnv(PATH, { ...providerEnv(), ...accounts.envFor(kind, account), ...env }) }, meta)
  const p = {
    paneId, tabId, workspaceId, kind, cwd, model: model || null, sessionId: sessionId || null, account: account || null, env: env || null, proc, remote, term: null,
    title: '', status: kind === 'shell' ? null : 'idle', seq: 0, seen: true, setupPending: !!setup && !IS_WIN,
    startedAt: Date.now(), lastOutput: 0, lastInput: 0, clients: new Set(),
    reopened, continuedAt: continuedAt || null,
  }
  await wire(p)

  // An opening prompt the CLI can't take as an argument: type it in once the agent settles.
  if (opening && kind !== 'shell' && !a.promptArg) {
    let begun = Date.now()
    const tick = setInterval(() => {
      if (!panes.has(paneId)) return clearInterval(tick)
      if (p.setupPending && Date.now() - p.startedAt < 15 * 60000) { begun = Date.now(); return }
      const quiet = Date.now() - p.lastOutput > 1500 && Date.now() - begun > 2500
      if (quiet || Date.now() - begun > 25000) { clearInterval(tick); prompt(paneId, opening).catch(() => {}) }
    }, 500)
  }
  findSession(p, !!setup)
  save()
  return p
}

// Agents that name their own session (Codex): find it in their transcript folder (later too
// when a setup command runs first).
function findSession(p, setup) {
  if (adapter(p.kind).sessionId !== 'discover' || p.sessionId) return
  for (const ms of [3000, 8000, 20000, 45000, ...(setup ? [90000, 180000, 300000, 600000] : [])]) {
    setTimeout(() => {
      if (p.sessionId || panes.get(p.paneId) !== p) return
      const sid = discoverSession(p.kind, p.cwd, p.startedAt)
      if (sid) { p.sessionId = sid; save() }
    }, ms)
  }
}

// The terminal host for this server: the one already running, or a new one. Null means run
// terminals here (it couldn't start, or BRIDGE_PTY_HOST=0).
let opening = null
function hostLink() {
  if (link && !link.closed) return Promise.resolve(link)
  if (hostOff || Date.now() < retryAt) return Promise.resolve(null)
  // One at a time: agents started together share the one host.
  opening ||= (async () => {
    const l = await host.open({ keep: keepOn }).catch((e) => { console.log(`Terminal host: ${e.message}`); return null })
    if (!l || l.busy) {
      if (l?.busy) console.log(`Another Bridge AI server is using the agents in ${DATA}; agents started here end with this server.`)
      retryAt = Date.now() + 60000
      return null
    }
    link = l
    link.onLost = () => { link = null; lost().catch((e) => console.log(`Terminal host: ${e.message}`)) }
    return link
  })().finally(() => { opening = null })
  return opening
}

// A new terminal: in the host when there is one, else in this process.
async function openTerm(paneId, file, argv, opts, meta) {
  const l = await hostLink()
  if (l) return { proc: await l.spawn(paneId, { file, args: argv, ...opts, meta }), remote: true }
  return { proc: pty.spawn(file, argv, { name: 'xterm-256color', ...opts }), remote: false }
}

// The pane's own copy of its screen (from the host's, when picking one up), fed by its terminal,
// and what happens when the terminal ends.
async function wire(p, from) {
  p.term = new Terminal({ cols: from?.cols || COLS, rows: from?.rows || ROWS, scrollback: SCROLLBACK, allowProposedApi: true })
  p.term.onTitleChange((t) => { p.title = t })
  if (from?.screen) await new Promise((r) => p.term.write(from.screen, r))
  p.proc.onData((d) => { if (p.setupPending && d.includes(SETUP_DONE)) p.setupPending = false; p.term.write(d); p.lastOutput = Date.now(); for (const c of p.clients) c.onData(d) })
  p.proc.onExit(() => {
    for (const c of p.clients) c.onExit?.()
    if (stopping || panes.get(p.paneId) !== p) return
    panes.delete(p.paneId); tabs = tabs.filter((t) => t.tabId !== p.tabId || [...panes.values()].some((x) => x.tabId === p.tabId)); save()
  })
  panes.set(p.paneId, p)
}

// A terminal still running in the host (Bridge AI quit, restarted or updated meanwhile): picked
// up as it is, the same program with its screen and scrollback. s: what's saved about it.
async function adopt(t, s) {
  const { term: proc, screen, cols, rows } = await link.attach(t.id)
  proc.pid = t.pid
  const kind = s.kind || 'shell'
  const p = {
    paneId: t.id, tabId: s.tabId, workspaceId: s.workspaceId, kind, cwd: s.cwd, model: s.model || null, sessionId: s.sessionId || null, account: s.account || null, env: s.env || null, proc, remote: true, term: null,
    title: t.title || '', status: kind === 'shell' ? null : 'idle', seq: 0, seen: true, setupPending: false,
    startedAt: t.startedAt || Date.now(), lastOutput: t.lastOutput || 0, lastInput: 0, clients: new Set(),
  }
  await wire(p, { screen, cols, rows })
  // Sized for a terminal app that was attached when the server stopped: back to the usual size.
  if (cols !== COLS || rows !== ROWS) { proc.resize(COLS, ROWS); p.term.resize(COLS, ROWS) }
  findSession(p)
  return p
}

// An agent that was in the middle of something when its terminal ended, now back in its
// conversation: index.js tells it to carry on (unless Settings › General says not to). Not twice in
// ten minutes, so work that keeps taking Bridge AI down isn't sent round in circles. why: update,
// reboot, restart (Bridge AI stopped) or host (its terminals stopped while it ran).
let onInterrupted = null
const interrupted = []
function carryOn(p, why) {
  if (!p?.reopened) return
  if (p.continuedAt && Date.now() - p.continuedAt < 10 * 60000) { console.log(`${p.paneId} was interrupted again within ten minutes; not telling it to carry on this time`); return }
  p.continuedAt = Date.now()
  save()
  if (onInterrupted) onInterrupted(p.paneId, why)
  else interrupted.push([p.paneId, why])
}
// The server asks once it's ready; the ones reopened before then are handed over at once.
export function whenInterrupted(fn) {
  onInterrupted = fn
  for (const [paneId, why] of interrupted.splice(0)) fn(paneId, why)
}

// Bring back the last saved layout: terminals still running in the host just as they are, and
// the rest started again (after a reboot, say, or with Keep agents running off).
export async function restore({ keep = true } = {}) {
  keepOn = keep
  let s = {}
  try { s = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { /* nothing saved yet */ }
  spaces = s.spaces || []
  tabs = s.tabs || []
  nextId = s.nextId || 1
  const saved = new Map((s.panes || []).map((p) => [p.paneId, p]))
  // Why the ones that have to start again ended: an update, the computer restarting, or Bridge AI
  // stopping (a crash, or quitting with Keep agents running off).
  const booted = Date.now() - os.uptime() * 1000
  const why = s.version && VERSION && s.version !== VERSION ? 'update' : s.at && s.at < booted ? 'reboot' : 'restart'
  const l = await hostLink()
  for (const t of l ? await l.list().catch(() => []) : []) {
    // Never hand out an id the host already uses.
    for (const n of String(t.id).match(/\d+/g) || []) nextId = Math.max(nextId, Number(n) + 1)
    const m = { ...(t.meta || {}), ...(saved.get(t.id) || {}) }
    saved.delete(t.id)
    if (t.exited) continue // it ended while Bridge AI was away, like any agent that exits
    // Started just before the last server stopped, so not in the saved layout: put its tab back.
    if (!m.workspaceId || !m.tabId) { m.workspaceId ||= `w${id()}`; m.tabId = `${m.workspaceId}:t${id()}` }
    if (!spaces.some((w) => w.id === m.workspaceId)) spaces.push({ id: m.workspaceId, label: String(m.space || 'Space').slice(0, 80) })
    if (!tabs.some((x) => x.tabId === m.tabId)) tabs.push({ tabId: m.tabId, workspaceId: m.workspaceId, label: String(m.tab || m.kind || 'shell').slice(0, 80) })
    try { await adopt(t, m) } catch (e) {
      // Never leave one running that nobody can see.
      if (e.code !== 'gone') { console.log(`Couldn't pick up ${t.id} (${e.message}); stopping it`); l.send({ t: 'kill', id: t.id }) }
    }
  }
  for (const p of saved.values()) {
    try { const back = await spawnPane({ ...p, resume: true }); if (p.midTask) carryOn(back, why) } catch { /* agent no longer installed */ }
  }
  tabs = tabs.filter((t) => [...panes.values()].some((p) => p.tabId === t.tabId))
  prune()
  save()
}

// The connection to the host dropped while running: the host crashed or was stopped (its
// terminals with it), or it let go of a server that stopped reading. Pick up what's still
// running, and start the rest again, resuming their sessions.
async function lost() {
  // A beat first: when everything is being stopped at once (an update on Windows stops every
  // "Bridge AI" process), this server is next, and mustn't start a new host meanwhile.
  await new Promise((r) => setTimeout(r, 1000))
  if (stopping) return
  const now = Date.now()
  losses.push(now)
  while (now - losses[0] > 120000) losses.shift()
  if (losses.length >= 3) { hostOff = true; console.log('The terminal host keeps stopping; terminals run in the server until it restarts') }
  const mine = [...panes.values()].filter((p) => p.remote)
  console.log(`Lost the terminal host; picking up ${mine.length} terminal(s) again`)
  const l = await hostLink()
  const live = new Map((l ? await l.list().catch(() => []) : []).map((t) => [t.id, t]))
  for (const p of mine) {
    if (panes.get(p.paneId) !== p) continue
    for (const c of p.clients) c.onExit?.()
    const t = live.get(p.paneId)
    try {
      if (t && !t.exited) await adopt(t, p)
      else if (!t) { const back = await spawnPane({ ...p, resume: true }); if (p.midTask) carryOn(back, 'host') } else panes.delete(p.paneId)
    } catch { if (panes.get(p.paneId) === p) panes.delete(p.paneId) }
  }
  tabs = tabs.filter((t) => [...panes.values()].some((p) => p.tabId === t.tabId))
  prune()
  save()
}

// The last `lines` non-blank lines on screen (full-screen apps often leave the bottom empty).
function screenText(p, lines = 14) {
  const buf = p.term.buffer.active
  const out = []
  for (let y = buf.baseY; y < buf.baseY + p.term.rows; y++) out.push(buf.getLine(y)?.translateToString(true) ?? '')
  return out.filter((l) => l.trim()).slice(-lines).join('\n')
}

// The whole screen, a string per row.
function screenRows(p) {
  const buf = p.term.buffer.active
  const out = []
  for (let y = buf.baseY; y < buf.baseY + p.term.rows; y++) out.push(buf.getLine(y)?.translateToString(true) ?? '')
  return out
}

// working / blocked / done / idle, from what's on screen and how recently it changed. A new
// agent's first-run screens (its look, sign-in, trusting the folder) count as needing you, and say
// which one it is (p.setup), until it has done some work.
function statusOf(p) {
  if (p.kind === 'shell') return null
  const a = adapter(p.kind)
  const tail = screenText(p)
  const busy = !!a.busy?.test(tail)
  // Not gated on busy: the trust screen itself says "Esc to cancel".
  const setup = knows(p.kind) && !p.pastSetup ? firstRun(p.kind, screenRows(p)) : null
  const key = setup ? `${setup.step} ${setup.url || ''}` : null
  if (key !== (p.setupKey ?? null)) { p.setupKey = key; p.seq++ }
  p.setup = setup // its keys follow the pointer, if you move it in the terminal
  let s = 'idle'
  if (setup || ASKING.test(tail)) s = 'blocked'
  else if (busy) { s = 'working'; p.pastSetup = true }
  // No busy indicator to read: fall back to "output is streaming that you didn't type".
  else if (a.busyFromOutput && Date.now() - p.lastOutput < 1200 && Date.now() - p.lastInput > 1500 && Date.now() - p.startedAt > 4000) s = 'working'
  // In the middle of something (working, or waiting on you mid-turn): kept, for carryOn after a crash.
  const mid = s === 'working' || (s === 'blocked' && !setup)
  if (mid !== !!p.midTask) { p.midTask = mid; save() }
  if (s === 'working' && p.status !== 'working') p.seen = false
  if (s === 'idle' && !p.seen && (p.status === 'working' || p.status === 'done')) s = 'done'
  if (s !== p.status) { p.status = s; p.seq++ }
  return s
}

export async function fleet() {
  const order = (wsId) => spaces.findIndex((w) => w.id === wsId)
  const live = [...panes.values()]
  const wsLabel = (wsId) => spaces.find((w) => w.id === wsId)?.label || wsId
  const tabOf = (tabId) => tabs.find((t) => t.tabId === tabId)
  const agents = live.filter((p) => p.kind !== 'shell').map((p) => ({
    paneId: p.paneId, tabId: p.tabId, workspaceId: p.workspaceId,
    workspace: wsLabel(p.workspaceId), tab: tabOf(p.tabId)?.label || '',
    kind: p.kind, status: statusOf(p), title: p.title, cwd: p.cwd, account: accounts.labelOf(p.account), accountId: p.account,
    sessionId: p.sessionId, model: p.model, focused: false, seq: p.seq,
    setup: p.setup?.step || null, setupUrl: p.setup?.url || null, setupKeys: p.setup?.keys || null,
  }))
  const tabList = tabs.map((t) => ({
    tabId: t.tabId, workspaceId: t.workspaceId, workspace: wsLabel(t.workspaceId), label: t.label,
    number: tabs.filter((x) => x.workspaceId === t.workspaceId).indexOf(t) + 1,
    area: { x: 0, y: 0, width: live.find((p) => p.tabId === t.tabId)?.term.cols || COLS, height: live.find((p) => p.tabId === t.tabId)?.term.rows || ROWS }, zoomed: false,
    panes: live.filter((p) => p.tabId === t.tabId).map((p) => ({ paneId: p.paneId, agent: p.kind !== 'shell', cwd: p.cwd, title: p.title, rect: { x: 0, y: 0, width: p.term.cols, height: p.term.rows } })),
  })).sort((a, b) => order(a.workspaceId) - order(b.workspaceId))
  const workspaces = spaces.map((w) => {
    const st = agents.filter((a) => a.workspaceId === w.id).map((a) => a.status)
    return { id: w.id, label: w.label, status: ['blocked', 'working', 'done', 'idle'].find((s) => st.includes(s)) || 'idle' }
  })
  const paneList = live.map((p) => ({
    paneId: p.paneId, workspaceId: p.workspaceId, tabId: p.tabId, workspace: wsLabel(p.workspaceId), number: order(p.workspaceId) + 1,
    tab: tabOf(p.tabId)?.label || '', agent: p.kind === 'shell' ? null : p.kind, status: p.kind === 'shell' ? null : p.status,
    title: p.title, cwd: p.cwd, cols: p.term.cols, rows: p.term.rows,
  }))
  return { agents, tabs: tabList, workspaces, panes: paneList }
}

const need = (paneId) => {
  const p = panes.get(paneId)
  if (!p) throw new Error(`No pane ${paneId}`)
  return p
}

export async function read(paneId, lines = 300) {
  const p = need(paneId)
  await new Promise((r) => p.term.write('', r)) // let pending output land first
  // The active screen: the alternate one for full-screen apps (their history lives in the app).
  const buf = p.term.buffer.active
  const end = buf.baseY + p.term.rows
  const cell = buf.getNullCell()
  const out = []
  for (let y = Math.max(0, end - lines); y < end; y++) out.push(lineAnsi(buf.getLine(y), p.term.cols, cell))
  return out.join('\r\n') // CRLF, like herdr: the browser's mirror writes it straight into a terminal
}

// Key names as the UI sends them, to the bytes a terminal expects.
const CSI = '\x1b['
const NAMED = {
  enter: '\r', esc: '\x1b', tab: '\t', 'shift+tab': `${CSI}Z`, backspace: '\x7f', space: ' ',
  up: `${CSI}A`, down: `${CSI}B`, right: `${CSI}C`, left: `${CSI}D`, home: `${CSI}H`, end: `${CSI}F`,
  pageup: `${CSI}5~`, pagedown: `${CSI}6~`, delete: `${CSI}3~`, 'shift+enter': '\x1b\r', 'alt+enter': '\x1b\r',
  'ctrl+left': `${CSI}1;5D`, 'ctrl+right': `${CSI}1;5C`, 'shift+up': `${CSI}1;2A`, 'shift+down': `${CSI}1;2B`, 'shift+left': `${CSI}1;2D`, 'shift+right': `${CSI}1;2C`,
}
function keyBytes(k) {
  if (NAMED[k]) return NAMED[k]
  let m = k.match(/^ctrl\+([a-z])$/)
  if (m) return String.fromCharCode(m[1].charCodeAt(0) - 96)
  if (k === 'ctrl+[') return '\x1b'
  if (k === 'ctrl+]') return '\x1d'
  m = k.match(/^alt\+(.)$/)
  if (m) return `\x1b${m[1]}`
  m = k.match(/^f(\d{1,2})$/)
  if (m) return ['', '\x1bOP', '\x1bOQ', '\x1bOR', '\x1bOS', `${CSI}15~`, `${CSI}17~`, `${CSI}18~`, `${CSI}19~`, `${CSI}20~`, `${CSI}21~`, `${CSI}23~`, `${CSI}24~`][Number(m[1])] || ''
  return k.length === 1 ? k : ''
}
const write = (p, data) => { p.lastInput = Date.now(); p.seen = true; p.proc.write(data) }
const paste = (p, t) => write(p, p.term.modes.bracketedPasteMode ? `\x1b[200~${t}\x1b[201~` : t)

// In order per pane, so fast typing never arrives shuffled.
export async function input(paneId, steps) {
  const p = need(paneId)
  for (const st of steps || []) {
    if (typeof st?.text === 'string' && st.text) (st.text.length > 1 ? paste(p, st.text.slice(0, 20000)) : write(p, st.text))
    else if (Array.isArray(st?.keys)) for (const k of st.keys) write(p, keyBytes(String(k)))
  }
}
export const keys = (paneId, k) => input(paneId, [{ keys: k }])
export const paneKeys = keys
export const text = (paneId, t) => input(paneId, [{ text: t }])
export async function prompt(paneId, t) {
  const p = need(paneId)
  paste(p, t)
  await new Promise((r) => setTimeout(r, 120))
  write(p, '\r')
  return { ok: true }
}
export async function focusAgent(paneId) { need(paneId).seen = true }
// The agent now continues in another session (Codex after an edit): resume that one from here on.
export async function setSession(paneId, sessionId) { need(paneId).sessionId = sessionId; save() }
// It switched model (from the message box): reopen it on that one after a restart (null: its default).
export async function setModel(paneId, model) { need(paneId).model = model || null; save() }
export async function focusTab() {}

function renameIn(list, key, idv, label) {
  if (!label) throw new Error('Name can\'t be empty')
  const it = list.find((x) => x[key] === idv)
  if (!it) throw new Error('Not found')
  it.label = label.slice(0, 80)
  save()
}
export const renameTab = (tabId, label) => renameIn(tabs, 'tabId', tabId, label)
export const renameWorkspace = (wsId, label) => renameIn(spaces, 'id', wsId, label)
export async function closeTab(tabId) {
  for (const p of [...panes.values()]) if (p.tabId === tabId) { try { p.proc.kill() } catch { /* gone */ } panes.delete(p.paneId) }
  tabs = tabs.filter((t) => t.tabId !== tabId)
  prune()
  save()
}
export async function closeWorkspace(wsId) {
  for (const t of tabs.filter((x) => x.workspaceId === wsId)) await closeTab(t.tabId)
  spaces = spaces.filter((w) => w.id !== wsId)
  save()
}
const moveIn = (list, pred, index) => {
  const from = list.findIndex(pred)
  if (from < 0) throw new Error('Not found')
  const [it] = list.splice(from, 1)
  list.splice(Math.min(from < index ? index - 1 : index, list.length), 0, it)
  save()
}
export async function moveWorkspace(wsId, index) { moveIn(spaces, (w) => w.id === wsId, index) }
// A new, empty space; agents are started in it or dragged into it.
export async function createSpace({ label }) {
  const ws = { id: `w${id()}`, label: String(label || 'Space').slice(0, 80), fresh: true }
  spaces.push(ws)
  save()
  return { workspaceId: ws.id }
}

// Move a tab (and everything in it) to another space, or to a new one (newSpace: its name), at
// `index` among that space's tabs (default: last). The terminals keep running. Returns the moved
// panes' ids, old -> new (unchanged here; herdr gives them new ones).
export async function moveTabToSpace(tabId, { workspaceId, newSpace, index } = {}) {
  const t = tabs.find((x) => x.tabId === tabId)
  if (!t) throw new Error('Not found')
  let ws = newSpace ? null : spaces.find((w) => w.id === workspaceId)
  if (!ws && !newSpace) throw new Error('No such space')
  if (!ws) { ws = { id: `w${id()}`, label: String(newSpace).slice(0, 80) }; spaces.push(ws) }
  delete ws.fresh
  const moved = {}
  for (const p of panes.values()) if (p.tabId === tabId) { p.workspaceId = ws.id; moved[p.paneId] = p.paneId }
  tabs = tabs.filter((x) => x !== t)
  t.workspaceId = ws.id
  const peers = tabs.filter((x) => x.workspaceId === ws.id)
  peers.splice(Number.isInteger(index) ? Math.min(Math.max(index, 0), peers.length) : peers.length, 0, t)
  tabs = [...tabs.filter((x) => x.workspaceId !== ws.id), ...peers]
  prune()
  save()
  return { workspaceId: ws.id, tabId, moved }
}

export async function moveTab(tabId, index) {
  const t = tabs.find((x) => x.tabId === tabId)
  if (!t) throw new Error('Not found')
  const peers = tabs.filter((x) => x.workspaceId === t.workspaceId)
  moveIn(peers, (x) => x.tabId === tabId, index)
  tabs = [...tabs.filter((x) => x.workspaceId !== t.workspaceId), ...peers]
  save()
}

// resume: a session id to open again; fork: a session id to copy into a new conversation.
// setup: { command, cwd } run in the terminal before the agent starts (a new worktree's `npm install`).
export async function launch({ kind = 'claude', cwd, label, workspaceId, newSpace, prompt: opening, model, access, account, resume, fork, setup, env }) {
  const space = String(newSpace || '').trim()
  let ws = !space && workspaceId ? spaces.find((w) => w.id === workspaceId) : null
  if (!ws) { ws = { id: `w${id()}`, label: (space || label || 'Space').slice(0, 80) }; spaces.push(ws) }
  delete ws.fresh
  const tab = { tabId: `${ws.id}:t${id()}`, workspaceId: ws.id, label: (label || kind).slice(0, 80) }
  tabs.push(tab)
  const paneId = `${ws.id}:p${id()}`
  try {
    await spawnPane({ paneId, tabId: tab.tabId, workspaceId: ws.id, kind, cwd, opening, model, access, account, sessionId: resume || undefined, resume: !!resume, fork, setup, env })
  } catch (e) {
    // Don't leave an empty tab (or space) behind.
    tabs = tabs.filter((t) => t !== tab)
    prune()
    save()
    throw new Error(`Couldn't start ${kind}: ${e.message}`)
  }
  return { paneId }
}

export const theme = () => ({})

// ---------- Terminal clients (`bridge-ai attach`) ----------
function sizeTo(p, cols, rows) {
  if (p.term.cols === cols && p.term.rows === rows) {
    // Same size: nudge it so full-screen apps repaint for the new client.
    try { p.proc.resize(cols, rows - 1) } catch { /* exited */ }
    setTimeout(() => { try { p.proc.resize(cols, rows) } catch { /* exited */ } }, 60)
    return
  }
  try { p.proc.resize(cols, rows) } catch { /* exited */ }
  p.term.resize(cols, rows)
}
export function attach(paneId, { cols, rows, history = false }, onData, onExit) {
  const p = need(paneId)
  const c = { onData, onExit, cols, rows }
  p.clients.add(c)
  // Paint what's there now (a shell won't redraw by itself), then let the app redraw at the new size.
  // With history, from the top of the scrollback: it scrolls up into the client's own scrollback.
  // (A full-screen app's screen has none.) Blank rows under the cursor aren't painted, so a short
  // client doesn't push a new shell's prompt out of view.
  const buf = p.term.buffer.active
  const cell = buf.getNullCell()
  const cursorAt = buf.baseY + buf.cursorY
  let end = buf.baseY + p.term.rows - 1
  if (buf.type === 'normal') while (end > cursorAt && !buf.getLine(end)?.translateToString(true).trim()) end--
  const lines = []
  for (let y = history && buf.type === 'normal' ? 0 : buf.baseY; y <= end; y++) lines.push(lineAnsi(buf.getLine(y), p.term.cols, cell))
  // Put the client's terminal in the modes the app turned on (full-screen, bracketed paste, cursor keys).
  const m = p.term.modes
  const modes = `${buf.type === 'alternate' ? '\x1b[?1049h' : ''}${m.bracketedPasteMode ? '\x1b[?2004h' : ''}${m.applicationCursorKeysMode ? '\x1b[?1h' : ''}`
  // The cursor counted up from the last row written (the client's bottom row once the lines fill
  // it): right even while the client is a different height from the pane.
  const row = Math.max(1, Math.min(lines.length, rows) - (end - cursorAt))
  onData(`${modes}\x1b[0m\x1b[2J\x1b[H${lines.join('\r\n')}\x1b[${row};${buf.cursorX + 1}H`)
  sizeTo(p, cols, rows)
  return {
    write: (d) => write(p, d),
    resize: (w, h) => { c.cols = Math.max(20, w); c.rows = Math.max(5, h); sizeTo(p, c.cols, c.rows) },
    detach: () => {
      p.clients.delete(c)
      const last = [...p.clients].at(-1)
      if (last) sizeTo(p, last.cols, last.rows)
      else if (panes.has(paneId)) { try { p.proc.resize(COLS, ROWS) } catch { /* exited */ } p.term.resize(COLS, ROWS) }
    },
  }
}

// Settings › General › Keep agents running: whether the terminals outlive this server.
export function setKeep(on) {
  keepOn = !!on
  if (link && !link.closed) link.setKeep(keepOn)
}

// The server is stopping. With Keep agents running on, the terminals carry on in the host for the
// next server to pick up. Off (or without a host), they end now; the layout is saved, and they
// come back next time, resuming their sessions.
export function shutdown({ keep = keepOn } = {}) {
  // What each is doing right now, not at the last look, so one quit mid-task carries on next time.
  for (const p of panes.values()) { try { statusOf(p) } catch { /* no screen yet */ } }
  save()
  stopping = true
  if (link && !link.closed) { if (keep) link.detach(true); else link.quit() }
  for (const p of panes.values()) if (!p.remote) { try { p.proc.kill() } catch { /* gone */ } }
}
