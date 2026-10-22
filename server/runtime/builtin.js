// Runtime: built in. Bridge AI runs the terminals itself (node-pty, with a headless xterm keeping
// each screen), so nothing else needs installing, on macOS, Linux or Windows. Spaces and tabs
// are saved to the data folder; after a restart, agents that can resume a session (Claude
// Code, Codex) reopen where they were, and the rest start fresh in the same folder.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import pty from 'node-pty'
import headless from '@xterm/headless'
import { adapter, loginPath, newSessionId, installed } from '../agents.js'
import { discoverSession, locate } from '../transcripts.js'
import { dataFile, ensureDir, DATA, IS_WIN } from '../paths.js'
import { shellCommand, agentEnv, SETUP_DONE } from './spawn.js'
import { providerEnv } from '../providers.js'
import * as accounts from '../accounts.js'
import { firstRun, knows } from '../firstrun.js'

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
const COLS = Number(process.env.BRIDGE_COLS) || 120
const ROWS = Number(process.env.BRIDGE_ROWS) || 40

let spaces = [] // { id, label, fresh } (fresh: made empty from the UI and nothing put in it yet)
let tabs = [] // { tabId, workspaceId, label }
const panes = new Map() // paneId -> live pane
let nextId = 1
let stopping = false
const id = () => nextId++

// eslint-disable-next-line no-control-regex
const plain = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/\r/g, '')
// A menu, permission prompt or question waiting on the user.
const ASKING = /(enter to (continue|confirm|select|submit)|do you want to|\(y\/n\)|\[y\/n\]|❯\s*\d+\.|allow .* \?|trust (this|the files in this) folder|Review your answers)/i

// Spaces go away with their last tab, except a new one you made that's still waiting for its first.
const prune = () => { spaces = spaces.filter((w) => w.fresh || tabs.some((t) => t.workspaceId === w.id)) }

function save() {
  ensureDir(DATA)
  const out = {
    nextId, spaces, tabs,
    panes: [...panes.values()].map((p) => ({ paneId: p.paneId, tabId: p.tabId, workspaceId: p.workspaceId, kind: p.kind, cwd: p.cwd, model: p.model, sessionId: p.sessionId, account: p.account })),
  }
  try { fs.writeFileSync(STATE, JSON.stringify(out, null, 2)) } catch { /* read-only disk: keep going */ }
}

async function spawnPane({ paneId, tabId, workspaceId, kind, cwd, sessionId, resume, fork, opening, model, account, setup }) {
  const a = adapter(kind)
  const PATH = await loginPath()
  let bin = null
  let args = []
  if (kind !== 'shell') {
    bin = (await installed()).find((x) => x.kind === kind)?.path || a.bin[0]
    // Resume only a session that has a transcript (one that never got a message can't be resumed).
    let hasLog = false
    try { hasLog = !!(resume && sessionId && a.resume && locate(kind, sessionId, cwd)) } catch { /* no transcript folder */ }
    if (fork && a.fork) {
      // A copy of session `fork`: Claude takes the new id we give it; Codex names its own.
      sessionId = a.sessionId === 'assign' ? newSessionId() : null
      args = a.fork(fork, sessionId || undefined)
    } else if (hasLog) args = a.resume(sessionId)
    else {
      if (resume) sessionId = null
      if (a.sessionId === 'assign' && !sessionId) sessionId = newSessionId()
      args = a.start({ sessionId: a.sessionId === 'assign' ? sessionId : undefined, prompt: a.promptArg ? opening : undefined })
    }
    if (model && a.model) args = [...a.model(model), ...args]
  }
  const [file, argv] = shellCommand(bin, args, setup, cwd)
  // Checked without blocking: macOS can hold a look into Desktop or Documents until you answer its
  // permission prompt, and the rest of Bridge AI shouldn't wait for that.
  const there = await fs.promises.access(cwd).then(() => true, () => false)
  const proc = pty.spawn(file, argv, { name: 'xterm-256color', cols: COLS, rows: ROWS, cwd: there ? cwd : process.env.HOME, env: agentEnv(PATH, { ...providerEnv(), ...accounts.envFor(kind, account) }) })
  const term = new Terminal({ cols: COLS, rows: ROWS, scrollback: 5000, allowProposedApi: true })
  const p = {
    paneId, tabId, workspaceId, kind, cwd, model: model || null, sessionId: sessionId || null, account: account || null, proc, term,
    title: '', status: kind === 'shell' ? null : 'idle', seq: 0, seen: true, setupPending: !!setup && !IS_WIN,
    startedAt: Date.now(), lastOutput: 0, lastInput: 0, clients: new Set(),
  }
  term.onTitleChange((t) => { p.title = t })
  proc.onData((d) => { if (p.setupPending && d.includes(SETUP_DONE)) p.setupPending = false; term.write(d); p.lastOutput = Date.now(); for (const c of p.clients) c.onData(d) })
  proc.onExit(() => {
    for (const c of p.clients) c.onExit?.()
    if (stopping) return
    panes.delete(paneId); tabs = tabs.filter((t) => t.tabId !== tabId || [...panes.values()].some((x) => x.tabId === tabId)); save() })
  panes.set(paneId, p)

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
  // Agents that name their own session (Codex): find it in their transcript folder (later too
  // when a setup command runs first).
  if (a.sessionId === 'discover' && !p.sessionId) {
    for (const ms of [3000, 8000, 20000, 45000, ...(setup ? [90000, 180000, 300000, 600000] : [])]) {
      setTimeout(() => {
        if (p.sessionId || !panes.has(paneId)) return
        const sid = discoverSession(kind, p.cwd, p.startedAt)
        if (sid) { p.sessionId = sid; save() }
      }, ms)
    }
  }
  save()
  return p
}

// Bring back the last saved layout.
export async function restore() {
  let s
  try { s = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return }
  spaces = s.spaces || []
  tabs = s.tabs || []
  nextId = s.nextId || 1
  for (const p of s.panes || []) {
    try { await spawnPane({ ...p, resume: true }) } catch { /* agent no longer installed */ }
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
  if (key !== (p.setupKey ?? null)) { p.setupKey = key; p.setup = setup; p.seq++ }
  let s = 'idle'
  if (setup || ASKING.test(tail)) s = 'blocked'
  else if (busy) { s = 'working'; p.pastSetup = true }
  // No busy indicator to read: fall back to "output is streaming that you didn't type".
  else if (a.busyFromOutput && Date.now() - p.lastOutput < 1200 && Date.now() - p.lastInput > 1500 && Date.now() - p.startedAt > 4000) s = 'working'
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
    sessionId: p.sessionId, focused: false, seq: p.seq,
    setup: p.setup?.step || null, setupUrl: p.setup?.url || null,
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

// One buffer line as text with color codes (SGR only, no cursor moves), the same shape herdr returns.
function sgrOf(c) {
  const out = [0]
  if (c.isBold()) out.push(1)
  if (c.isDim()) out.push(2)
  if (c.isItalic()) out.push(3)
  if (c.isUnderline()) out.push(4)
  if (c.isInverse()) out.push(7)
  if (c.isStrikethrough?.()) out.push(9)
  const color = (base, rgb, pal, v) => {
    if (rgb) return [base + 8, 2, (v >> 16) & 255, (v >> 8) & 255, v & 255]
    if (pal) return v < 8 ? [base + v] : v < 16 ? [base + 60 + v - 8] : [base + 8, 5, v]
    return []
  }
  out.push(...color(30, c.isFgRGB(), c.isFgPalette(), c.getFgColor()), ...color(40, c.isBgRGB(), c.isBgPalette(), c.getBgColor()))
  return out.join(';')
}
function lineAnsi(line, cols, cell) {
  if (!line) return ''
  let out = ''
  let cur = '0'
  let pendingSpaces = ''
  for (let x = 0; x < cols; x++) {
    const c = line.getCell(x, cell)
    if (!c || c.getWidth() === 0) continue
    const ch = c.getChars() || ' '
    const sgr = sgrOf(c)
    // Keep trailing default-styled blanks out of the line.
    if (ch === ' ' && sgr === '0') { pendingSpaces += ' '; continue }
    if (pendingSpaces) { if (cur !== '0') { out += '\x1b[0m'; cur = '0' } out += pendingSpaces; pendingSpaces = '' }
    if (sgr !== cur) { out += `\x1b[${sgr}m`; cur = sgr }
    out += ch
  }
  return cur !== '0' ? `${out}\x1b[0m` : out
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
export async function launch({ kind = 'claude', cwd, label, workspaceId, newSpace, prompt: opening, model, account, resume, fork, setup }) {
  const space = String(newSpace || '').trim()
  let ws = !space && workspaceId ? spaces.find((w) => w.id === workspaceId) : null
  if (!ws) { ws = { id: `w${id()}`, label: (space || label || 'Space').slice(0, 80) }; spaces.push(ws) }
  delete ws.fresh
  const tab = { tabId: `${ws.id}:t${id()}`, workspaceId: ws.id, label: (label || kind).slice(0, 80) }
  tabs.push(tab)
  const paneId = `${ws.id}:p${id()}`
  try {
    await spawnPane({ paneId, tabId: tab.tabId, workspaceId: ws.id, kind, cwd, opening, model, account, sessionId: resume || undefined, resume: !!resume, fork, setup })
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
export function attach(paneId, { cols, rows }, onData, onExit) {
  const p = need(paneId)
  const c = { onData, onExit, cols, rows }
  p.clients.add(c)
  // Paint what's there now (a shell won't redraw by itself), then let the app redraw at the new size.
  const buf = p.term.buffer.active
  const cell = buf.getNullCell()
  const lines = []
  for (let y = buf.baseY; y < buf.baseY + p.term.rows; y++) lines.push(lineAnsi(buf.getLine(y), p.term.cols, cell))
  // Put the client's terminal in the modes the app turned on (full-screen, bracketed paste, cursor keys).
  const m = p.term.modes
  const modes = `${buf.type === 'alternate' ? '\x1b[?1049h' : ''}${m.bracketedPasteMode ? '\x1b[?2004h' : ''}${m.applicationCursorKeysMode ? '\x1b[?1h' : ''}`
  onData(`${modes}\x1b[0m\x1b[2J\x1b[H${lines.join('\r\n')}\x1b[${buf.cursorY + 1};${buf.cursorX + 1}H`)
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

// Closing Bridge AI ends its terminals; the layout is saved and comes back next time.
export function shutdown() {
  save()
  stopping = true
  for (const p of panes.values()) { try { p.proc.kill() } catch { /* gone */ } }
}
