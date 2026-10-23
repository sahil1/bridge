// Several sign-ins for one agent: a work and a personal Claude account, or two ChatGPT logins for
// Codex. Each extra account is its own config folder (CLAUDE_CONFIG_DIR, CODEX_HOME) under
// <data>/accounts, holding only that account's login. Everything else in it (settings, skills,
// commands, session transcripts) links back to your usual folder, so every account works with
// the same setup and history, and Bridge AI finds its transcripts in the usual place.
//
// "Default" is the login you already have (~/.claude, ~/.codex). New agents of a kind start with
// the account marked active, or with Auto, the one with the most of its usage window left at the
// last quota reading (feeds.js reads each account's). Sign in opens the agent's own login flow in
// a terminal tab.
// Like the sign-in checks in providers.js, nothing here reads tokens or sends emails to the
// account list: an account shows the name you gave it and, at most, its plan. (The quota feed
// passes on quota-axi's account identity, as it does for your usual login.)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { DATA, HOME, IS_WIN, dataFile, ensureDir } from './paths.js'
import { adapter, installed, loginPath } from './agents.js'
import { agentEnv, quoteCommand } from './runtime/spawn.js'

const FILE = dataFile('accounts.json')
const DIR = path.join(DATA, 'accounts')
// A server or container with no desktop: no browser here, so a sign-in link is opened on your
// phone or laptop, and a login that waits for the browser to call back to this machine can't finish.
const NO_BROWSER = !IS_WIN && process.platform !== 'darwin' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY

// What each agent needs: the variable that moves its config folder, your usual folder, what to
// share from it, and how to sign in, sign out and ask whether it's signed in.
const KINDS = {
  claude: {
    env: 'CLAUDE_CONFIG_DIR',
    home: () => process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'),
    share: ['projects', 'settings.json', 'CLAUDE.md', 'agents', 'commands', 'skills', 'plugins', 'hooks', 'output-styles', 'todos', 'file-history', 'history.jsonl', 'keybindings.json'],
    shareDirs: ['projects'], // made in your usual folder first, so transcripts always land there
    login: ['auth', 'login'],
    logout: ['auth', 'logout'],
    async status(bin, env) {
      const r = await run(bin, ['auth', 'status', '--json'], env)
      try {
        const j = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1))
        return { signedIn: !!j.loggedIn, plan: plan(j.subscriptionType) || (j.authMethod && j.authMethod !== 'none' && j.authMethod !== 'claude.ai' ? String(j.authMethod) : null) }
      } catch { return { signedIn: r.code === 0 ? null : false, plan: null } }
    },
  },
  codex: {
    env: 'CODEX_HOME',
    home: () => process.env.CODEX_HOME || path.join(HOME, '.codex'),
    share: ['config.toml', 'sessions', 'archived_sessions', 'AGENTS.md', 'prompts', 'skills', 'rules', 'hooks.json', 'plugins', 'history.jsonl'],
    shareDirs: ['sessions'],
    // Codex's usual login waits for the browser on localhost:1455; with no browser here, a code instead.
    login: NO_BROWSER ? ['login', '--device-auth'] : ['login'],
    logout: ['logout'],
    async status(bin, env) {
      const r = await run(bin, ['login', 'status'], env)
      if (r.code !== 0) return { signedIn: false, plan: null }
      return { signedIn: true, plan: /chatgpt/i.test(r.out) ? 'ChatGPT' : /api key/i.test(r.out) ? 'API key' : null }
    },
  },
}
export const supports = (kind) => !!KINDS[kind]

const plan = (s) => (typeof s === 'string' && s ? s.replace(/^claude_/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() : null)
const run = (bin, args, env, ms = 8000) => new Promise((resolve) => {
  execFile(bin, args, { timeout: ms, windowsHide: true, env, shell: IS_WIN }, (err, stdout = '', stderr = '') => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}\n${stderr}` }))
})

// ---------- Store ----------
const defaultId = (kind) => `${kind}-default`
// Read on every fleet update, so kept in memory until the file changes.
let memo = { mtime: -1, d: null }
function load() {
  let mtime = 0
  try { mtime = fs.statSync(FILE).mtimeMs } catch { /* none yet */ }
  if (memo.d && memo.mtime === mtime) return structuredClone(memo.d)
  let d = {}
  try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {} } catch { /* none yet */ }
  const accounts = (Array.isArray(d.accounts) ? d.accounts : []).filter((a) => a && KINDS[a.kind] && /^[\w-]+$/.test(a.id || ''))
  memo = { mtime, d: { accounts, active: d.active && typeof d.active === 'object' ? d.active : {} } }
  return structuredClone(memo.d)
}
function save(d) {
  ensureDir(DATA)
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', { mode: 0o600 })
  memo = { mtime: -1, d: null }
}
const dirOf = (a) => path.join(DIR, a.id)
const find = (d, id) => d.accounts.find((a) => a.id === id)

// The account folder, with links to what's shared from your usual folder. Run before every use,
// so things added to your usual folder later (a new skill folder, say) show up too.
function prepare(a) {
  const k = KINDS[a.kind]
  const dir = ensureDir(dirOf(a))
  try { fs.chmodSync(dir, 0o700) } catch { /* Windows */ }
  const home = k.home()
  for (const d of k.shareDirs) ensureDir(path.join(home, d))
  for (const name of k.share) {
    const from = path.join(home, name)
    const to = path.join(dir, name)
    if (!fs.existsSync(from)) continue
    try { fs.lstatSync(to); continue } catch { /* not there yet */ }
    const isDir = fs.statSync(from).isDirectory()
    // Windows: a junction needs no admin rights; a file it can't link is skipped.
    try { fs.symlinkSync(from, to, isDir ? (IS_WIN ? 'junction' : 'dir') : 'file') } catch { /* skip */ }
  }
  return dir
}

// ---------- Usage per account (feeds.js notes each reading; Auto picks by them) ----------
const readings = new Map() // account id -> its last quota reading (feeds.js normalizeProvider)
export const noteQuota = (id, r) => { if (r) readings.set(id, r) }

// The extra accounts whose usage to read: each one's folder, in the variable the agent uses. Only
// the path: quota-axi reads the login in it, so nothing needs linking first.
export const quotaTargets = () => load().accounts.map((a) => ({ id: a.id, kind: a.kind, env: { [KINDS[a.kind].env]: dirOf(a) } }))

const rowsOf = (kind, d) => [{ id: defaultId(kind), kind, label: 'Default', isDefault: true }, ...d.accounts.filter((a) => a.kind === kind)]
// Auto: the signed-in account with the most left at the last reading (the tighter of its 5-hour
// and weekly windows, so one about to hit its weekly cap isn't picked). Default until there's one.
function autoPick(kind, d = load()) {
  let best = null
  for (const { id } of rowsOf(kind, d)) {
    const r = readings.get(id)
    if (r?.usable && r.percentRemaining != null && (!best || r.percentRemaining > readings.get(best).percentRemaining)) best = id
  }
  return best || defaultId(kind)
}
// What you chose for this kind: an account id, or 'auto'.
function settingOf(kind, d) {
  const id = d.active[kind]
  return id === 'auto' || (id && find(d, id)) ? id : defaultId(kind)
}
// The setting, Auto's pick, and the account new agents get from the two.
function choice(kind, d) {
  const setting = settingOf(kind, d)
  const pick = autoPick(kind, d)
  return { setting, pick, active: setting === 'auto' ? pick : setting }
}

// ---------- Used by the runtime ----------
// Which account a new agent of this kind starts with.
export function activeId(kind) {
  return KINDS[kind] ? choice(kind, load()).active : null
}
// An account picked for one launch; 'auto' is resolved now, so the agent keeps the one it got.
export const resolve = (kind, id) => (id === 'auto' && KINDS[kind] ? autoPick(kind) : id)
export const has = (kind, id) => !!KINDS[kind] && (id === defaultId(kind) || find(load(), id)?.kind === kind)

// Environment for an agent started with this account: its config folder, or nothing for Default
// (or an account that has since been removed, which falls back to Default).
export function envFor(kind, id) {
  const k = KINDS[kind]
  if (!k || !id || id === defaultId(kind)) return {}
  const a = find(load(), id)
  if (!a || a.kind !== kind) return {}
  try { return { [k.env]: prepare(a) } } catch { return {} }
}

// The name of a non-default account, to show on the agents using it.
export function labelOf(id) {
  if (!id || id.endsWith('-default')) return null
  return find(load(), id)?.label || null
}

// ---------- Which account each agent is on ----------
// herdr starts the agents and doesn't know about accounts, so Bridge AI remembers the account of
// each pane it started there. And of each conversation, so one opened again from Closed agents
// (or forked) stays on its account, and a pane herdr renumbers can be matched again.
const USED = dataFile('account-use.json')
const MAX_SESSIONS = 500
let used = null // { panes: { paneId: { id, kind } }, sessions: { sessionId: id } }
function usedNow() {
  if (used) return used
  try { used = JSON.parse(fs.readFileSync(USED, 'utf8')) } catch { /* none yet */ }
  if (!used || typeof used !== 'object') used = {}
  used.panes = used.panes && typeof used.panes === 'object' ? used.panes : {}
  used.sessions = used.sessions && typeof used.sessions === 'object' ? used.sessions : {}
  return used
}
function saveUsed() {
  const s = Object.entries(used.sessions)
  if (s.length > MAX_SESSIONS) used.sessions = Object.fromEntries(s.slice(-MAX_SESSIONS))
  try { ensureDir(DATA); fs.writeFileSync(USED, JSON.stringify(used) + '\n', { mode: 0o600 }) } catch { /* read-only disk: keep it in memory */ }
}
// A pane just started on account `id` (or moved from `from`, when herdr gives it a new id).
export function notePane(paneId, kind, id) {
  if (!paneId || !KINDS[kind] || !id) return
  const u = usedNow()
  if (u.panes[paneId]?.id === id && u.panes[paneId]?.kind === kind) return
  u.panes[paneId] = { id, kind }
  saveUsed()
}
export function movePane(from, to) {
  const u = usedNow()
  if (!u.panes[from] || from === to) return
  u.panes[to] = u.panes[from]
  delete u.panes[from]
  saveUsed()
}
// Panes that are gone: forget them, so a new pane given the same id later doesn't inherit one.
export function keepPanes(live) {
  const u = usedNow()
  const gone = Object.keys(u.panes).filter((p) => !live.has(p))
  if (!gone.length) return
  for (const p of gone) delete u.panes[p]
  saveUsed()
}
export function noteSession(sessionId, id) {
  if (!sessionId || !id) return
  const u = usedNow()
  if (u.sessions[sessionId] === id) return
  delete u.sessions[sessionId] // newest last, for the trim in saveUsed
  u.sessions[sessionId] = id
  saveUsed()
}
// The account of an agent of this kind in this pane, or that had this conversation.
export function accountOf(kind, paneId, sessionId) {
  const u = usedNow()
  const p = u.panes[paneId]
  const id = p && p.kind === kind ? p.id : sessionId ? u.sessions[sessionId] : null
  return id && has(kind, id) ? id : null
}

// ---------- Listing, with sign-in status ----------
let statusCache = new Map() // id -> { at, s }
async function statusOf(kind, id, bin, PATH) {
  const hit = statusCache.get(id)
  if (hit && Date.now() - hit.at < 30_000) return hit.s
  let s = { signedIn: null, plan: null }
  if (bin) { try { s = await KINDS[kind].status(bin, agentEnv(PATH, envFor(kind, id))) } catch { /* unknown */ } }
  statusCache.set(id, { at: Date.now(), s })
  return s
}

// One account as the UI shows it: its name, whether new agents start with it (active: the one
// you picked, or Auto's pick), and its last usage reading, flattened. Signed in: from its status
// check, else from what the reading says.
function view(a, active, s = statusCache.get(a.id)?.s) {
  const r = readings.get(a.id)
  const read = r?.usable ? true : r?.status === 'auth_required' || r?.notSetUp ? false : null
  return {
    id: a.id, label: a.label, isDefault: !!a.isDefault, active: a.id === active,
    signedIn: s?.signedIn ?? read, plan: r?.plan || s?.plan || null,
    usable: !!r?.usable, status: r ? r.status : 'pending', error: r?.error || null, hint: r?.hint || null, allow: !!r?.allow,
    percentRemaining: r?.percentRemaining ?? null, windows: r?.windows || [], refreshedAt: r?.refreshedAt || null,
  }
}

// Every account of each kind with its last reading, for the switcher and Usage. No checks run:
// it's what's known now (the quota feed calls this on each read).
export function groups() {
  const d = load()
  return Object.keys(KINDS).map((kind) => {
    const { setting, pick, active } = choice(kind, d)
    // With who quota-axi says it is, as the quota feed gives for your usual login (Usage masks it).
    return { kind, label: adapter(kind).label, setting, pick, accounts: rowsOf(kind, d).map((a) => ({ ...view(a, active), account: readings.get(a.id)?.account || null })) }
  })
}

export async function list({ refresh = false } = {}) {
  if (refresh) statusCache = new Map()
  const d = load()
  const inst = await installed().catch(() => [])
  const PATH = await loginPath()
  return Promise.all(Object.keys(KINDS).map(async (kind) => {
    const bin = inst.find((x) => x.kind === kind)?.path || null
    const { setting, pick, active } = choice(kind, d)
    // statusPlan: the plan as the sign-in check names it (Max, ChatGPT), as Settings shows it.
    const accounts = await Promise.all(rowsOf(kind, d).map(async (a) => {
      const s = await statusOf(kind, a.id, bin, PATH)
      return { ...view(a, active, s), statusPlan: s.plan }
    }))
    return { kind, label: adapter(kind).label, installed: !!bin, setting, pick, accounts }
  }))
}

// One account's sign-in, checked now rather than from the cache: the add-account dialog asks
// every few seconds while you sign in, and moves on once it says yes.
export async function check(id) {
  const kind = String(id || '').replace(/-[^-]+$/, '')
  if (!has(kind, id)) throw new Error('No such account')
  statusCache.delete(id)
  const bin = (await installed().catch(() => [])).find((x) => x.kind === kind)?.path || null
  const s = await statusOf(kind, id, bin, await loginPath())
  return { id, kind, label: labelOf(id) || 'Default', signedIn: s.signedIn, plan: s.plan }
}

// ---------- Changes ----------
const cleanLabel = (s) => String(s || '').replace(/[\r\n\0]/g, ' ').trim().slice(0, 40)

export function add(kind, label) {
  if (!KINDS[kind]) throw new Error(`Accounts aren't supported for ${kind} yet`)
  const name = cleanLabel(label)
  if (!name) throw new Error('Give the account a name, like Work or Personal')
  const d = load()
  if (name.toLowerCase() === 'default' || d.accounts.some((a) => a.kind === kind && a.label.toLowerCase() === name.toLowerCase())) throw new Error(`There's already an account called ${name}`)
  const a = { id: `${kind}-${crypto.randomBytes(4).toString('hex')}`, kind, label: name, createdAt: new Date().toISOString() }
  d.accounts.push(a)
  save(d)
  prepare(a)
  return a
}

export function rename(id, label) {
  const d = load()
  const a = find(d, id)
  if (!a) throw new Error('No such account')
  const name = cleanLabel(label)
  if (!name) throw new Error('Give the account a name')
  a.label = name
  save(d)
  return a
}

// id: an account, or 'auto' for whichever has the most left when an agent starts.
export function setActive(kind, id) {
  if (!KINDS[kind]) throw new Error(`Accounts aren't supported for ${kind} yet`)
  const d = load()
  if (id !== 'auto' && id !== defaultId(kind) && find(d, id)?.kind !== kind) throw new Error('No such account')
  d.active[kind] = id
  save(d)
  return { kind, active: id }
}

// Sign the account out (so its login doesn't linger in the keychain), then delete its folder.
// The links in it point at your usual folder; removing a link never touches what it points to.
export async function remove(id) {
  const d = load()
  const a = find(d, id)
  if (!a) throw new Error('No such account')
  const bin = (await installed().catch(() => [])).find((x) => x.kind === a.kind)?.path
  if (bin) await run(bin, KINDS[a.kind].logout, agentEnv(await loginPath(), envFor(a.kind, a.id)), 10000)
  const dir = dirOf(a)
  if (path.dirname(dir) === DIR) {
    // Unlink the links first, so deleting the folder can't reach into what they point to.
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const p = path.join(dir, name)
      if (!fs.lstatSync(p).isSymbolicLink()) continue
      try { fs.unlinkSync(p) } catch { fs.rmdirSync(p) } // a Windows junction
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
  d.accounts = d.accounts.filter((x) => x.id !== id)
  if (d.active[a.kind] === id) delete d.active[a.kind]
  save(d)
  statusCache.delete(id)
  readings.delete(id)
  return { ok: true }
}

// The line to type in a terminal to sign this account in: the agent's own login flow, pointed at
// the account's folder.
export function loginCommand(id) {
  const kind = id.replace(/-[^-]+$/, '')
  const k = KINDS[kind]
  if (!k) throw new Error('No such account')
  statusCache.delete(id)
  const bin = adapter(kind).bin[0]
  const cmd = quoteCommand(bin, k.login)
  const env = envFor(kind, id)
  const dir = env[k.env]
  if (id !== defaultId(kind) && !dir) throw new Error('No such account')
  if (!dir) return { kind, command: cmd }
  return { kind, command: IS_WIN ? `$env:${k.env}=${psq(dir)}; ${cmd}` : `${k.env}=${shq(dir)} ${cmd}` }
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`
