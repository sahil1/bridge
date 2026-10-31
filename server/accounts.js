// Several sign-ins for one agent: a work and a personal Claude account, or two ChatGPT logins for
// Codex. Each extra account is its own config folder (CLAUDE_CONFIG_DIR, CODEX_HOME) under
// <data>/accounts, holding only that account's login. Everything else in it (settings, skills,
// commands, session transcripts) links back to your usual folder, so every account works with
// the same setup and history, and Bridge AI finds its transcripts in the usual place.
//
// One plain list of your accounts per agent. Your usual login (~/.claude, ~/.codex) is one of them,
// "Your usual login" until you name it (Work main, say). Add as many more as you like, each with
// its own name. Remove takes any off the list: an added one is signed out and its folder deleted;
// your usual login only leaves Bridge AI's list (the agent keeps it for the terminal) and can be
// shown again. At least one always stays. New agents of a kind start with your default (one you
// picked, else the first listed), or with Auto, the one with the most of its usage window left at
// the last quota reading (feeds.js reads each account's). Sign in opens the agent's own login flow
// in a terminal tab; Sign out runs its own logout for that account's folder.
// Like the sign-in checks in providers.js, nothing here reads tokens or sends emails to the
// account list: an account shows the name you gave it and, at most, its plan. (The quota feed
// passes on quota-axi's account identity, as it does for your usual login.)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { DATA, HOME, IS_WIN, dataFile, ensureDir, writeFileAtomic } from './paths.js'
import { adapter, installed, loginPath } from './agents.js'
import { agentEnv, quoteCommand } from './runtime/spawn.js'
import { paneKey, inView, paneOfKey, adopt } from './scope.js'

const FILE = dataFile('accounts.json')
const DIR = path.join(DATA, 'accounts')
// A server or container with no desktop: no browser here, so a sign-in link is opened on your
// phone or laptop, and a login that waits for the browser to call back to this device can't finish.
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
  // names: what you call each kind's usual login. hidden: kinds whose usual login you took off the list.
  // order: each kind's accounts as you put them in Settings (ids), for every list of them.
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {})
  memo = { mtime, d: { accounts, active: obj(d.active), names: obj(d.names), hidden: obj(d.hidden), order: obj(d.order) } }
  return structuredClone(memo.d)
}
function save(d) {
  ensureDir(DATA)
  writeFileAtomic(FILE, JSON.stringify(d, null, 2) + '\n', { mode: 0o600 })
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
// Its saved sign-in ran out (quota-axi: "Claude access token expired"): still signed in, but its
// usage can't be read until it signs in again or the agent runs on it and renews it.
export const isLapsed = (r) => !!r && !r.usable && /access token expired|credentials_expired|sign-in required|reauth/i.test(r.error || '')
export const lapsed = (id) => isLapsed(readings.get(id))

// The extra accounts whose usage to read: each one's folder, in the variable the agent uses. Only
// the path: quota-axi reads the login in it, so nothing needs linking first.
export const quotaTargets = () => load().accounts.map((a) => ({ id: a.id, kind: a.kind, env: { [KINDS[a.kind].env]: dirOf(a) } }))

// Your usual login's name: the one you gave it, else "Your usual login" (the app shows that in
// your language: named is false).
const USUAL = 'Your usual login'
const defaultName = (kind, d = load()) => cleanLabel(d.names?.[kind]) || USUAL
// Taken off the list: only while another account of its kind is listed, so there's always one.
const hiddenUsual = (kind, d) => !!d.hidden?.[kind] && d.accounts.some((a) => a.kind === kind)
// The accounts of a kind as listed: in the order you put them in Settings, else your usual login
// first (unless you took it off), then the others in the order you added them. isDefault: your
// usual login (not "the default").
const rowsOf = (kind, d) => {
  const rows = [
    ...(hiddenUsual(kind, d) ? [] : [{ id: defaultId(kind), kind, label: defaultName(kind, d), isDefault: true, named: !!cleanLabel(d.names?.[kind]) }]),
    ...d.accounts.filter((a) => a.kind === kind),
  ]
  const order = Array.isArray(d.order?.[kind]) ? d.order[kind] : []
  const at = (a) => { const i = order.indexOf(a.id); return i < 0 ? order.length + rows.indexOf(a) : i }
  return rows.sort((a, b) => at(a) - at(b))
}
const listed = (kind, id, d) => rowsOf(kind, d).some((a) => a.id === id)
const firstOf = (kind, d) => rowsOf(kind, d)[0].id
// Auto: the signed-in account with the most left at the last reading (the tighter of its 5-hour
// and weekly windows, so one about to hit its weekly cap isn't picked). The first listed until there's one.
function autoPick(kind, d = load()) {
  let best = null
  for (const { id } of rowsOf(kind, d)) {
    const r = readings.get(id)
    if (r?.usable && r.percentRemaining != null && (!best || r.percentRemaining > readings.get(best).percentRemaining)) best = id
  }
  return best || firstOf(kind, d)
}
// What you chose for this kind: a listed account's id, or 'auto'. Nothing chosen, or the one you
// chose is gone: the first listed.
function settingOf(kind, d) {
  const id = d.active[kind]
  return id === 'auto' || (id && listed(kind, id, d)) ? id : firstOf(kind, d)
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
// A listed account of this kind: your usual login only while it's on the list, so nothing new
// starts on it once you took it off.
export const has = (kind, id) => !!KINDS[kind] && !!id && listed(kind, id, load())
// Any account of this kind Bridge AI knows, your usual login even when off the list.
const known = (kind, id) => !!KINDS[kind] && (id === defaultId(kind) || find(load(), id)?.kind === kind)

// Environment for an agent started with this account: its config folder, or nothing for your usual
// login. None given, or one since removed: your usual login, unless you took it off the list, then
// the account new agents start with.
export function envFor(kind, id) {
  const k = KINDS[kind]
  if (!k || id === defaultId(kind)) return {}
  const d = load()
  let a = id ? find(d, id) : null
  if (!a || a.kind !== kind) {
    if (!hiddenUsual(kind, d)) return {}
    a = find(d, choice(kind, d).active)
    if (!a) return {}
  }
  try { return { [k.env]: prepare(a) } } catch { return {} }
}

// The name of any account of this kind, your usual login's included ("Your usual login" unless named).
export const nameOf = (kind, id) => (!KINDS[kind] ? null : !id || id === defaultId(kind) ? defaultName(kind) : find(load(), id)?.label || defaultName(kind))

// The name of an added account (not your usual login), to show on the agents using it.
export function labelOf(id) {
  if (!id || id.endsWith('-default')) return null
  return find(load(), id)?.label || null
}

// ---------- Which account each agent is on ----------
// herdr starts the agents and doesn't know about accounts, so Bridge AI remembers the account of
// each pane it started there. And of each conversation, so one opened again from Closed agents
// (or forked) stays on its account, and a pane herdr renumbers can be matched again.
const USED = dataFile('account-use.json')
const MAX_SESSIONS = 3000 // a month of conversations, for Insights by account
let used = null // { panes: { paneId: { id, kind } }, sessions: { sessionId: id } }
function usedNow() {
  if (used) return used
  try { used = JSON.parse(fs.readFileSync(USED, 'utf8')) } catch { /* none yet */ }
  if (!used || typeof used !== 'object') used = {}
  used.panes = used.panes && typeof used.panes === 'object' ? used.panes : {}
  used.sessions = used.sessions && typeof used.sessions === 'object' ? used.sessions : {}
  if (adopt(used.panes)) saveUsed() // panes are filed per herdr session (scope.js)
  return used
}
function saveUsed() {
  const s = Object.entries(used.sessions)
  if (s.length > MAX_SESSIONS) used.sessions = Object.fromEntries(s.slice(-MAX_SESSIONS))
  try { ensureDir(DATA); writeFileAtomic(USED, JSON.stringify(used) + '\n', { mode: 0o600 }) } catch { /* read-only disk: keep it in memory */ }
}
// A pane just started on account `id` (or moved from `from`, when herdr gives it a new id).
export function notePane(paneId, kind, id) {
  if (!paneId || !KINDS[kind] || !id) return
  const u = usedNow()
  const k = paneKey(paneId)
  if (u.panes[k]?.id === id && u.panes[k]?.kind === kind) return
  u.panes[k] = { id, kind }
  saveUsed()
}
export function movePane(from, to) {
  const u = usedNow()
  const [a, b] = [paneKey(from), paneKey(to)]
  if (!u.panes[a] || a === b) return
  u.panes[b] = u.panes[a]
  delete u.panes[a]
  saveUsed()
}
// Panes that are gone: forget them, so a new pane given the same id later doesn't inherit one.
// Only the session in view's: another herdr session's panes are just out of view.
export function keepPanes(live) {
  const u = usedNow()
  const gone = Object.keys(u.panes).filter((k) => inView(k) && !live.has(paneOfKey(k)))
  if (!gone.length) return
  for (const k of gone) delete u.panes[k]
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
  const p = paneId ? u.panes[paneKey(paneId)] : null
  const id = p && p.kind === kind ? p.id : sessionId ? u.sessions[sessionId] : null
  return id && has(kind, id) ? id : null
}

// ---------- Renewing a sign-in that ran out ----------
// Claude Code renews its own expired sign-in whenever it runs, and `claude doctor` is the smallest
// run that does: no session, no model request, no browser. quota-axi renews the same way, but only
// while no Claude Code runs at all, as it can't tell which account one is on, and here one nearly
// always runs. Bridge AI knows the account of each agent it started, so it renews an extra account
// none of them is on. Not your usual login: Claude Codes started outside Bridge AI use that one.
// A renewal works once, so two at the same time could sign the account out; and one is never
// stopped early, as one cut off halfway can lose the sign-in too. force: you asked (Sign in
// again), so not held back by the last try. True once it ran; the next reading says if it worked.
const renewals = new Map() // id -> { at, running }
// Whether an agent is on an account now: index.js answers from the live agents (either runtime).
let agentOn = async () => true
export const agentsFrom = (fn) => { agentOn = fn }
export async function renew(id, { force = false } = {}) {
  const kind = String(id || '').replace(/-[^-]+$/, '')
  if (kind !== 'claude' || id === defaultId(kind) || find(load(), id)?.kind !== kind) return false
  const last = renewals.get(id)
  if (last?.running || (!force && last && Date.now() - last.at < 30 * 60 * 1000)) return false
  renewals.set(id, { at: Date.now(), running: true })
  const done = (ok) => { renewals.set(id, { at: Date.now() }); return ok }
  if (await agentOn(id).catch(() => true)) return done(false)
  const bin = (await installed().catch(() => [])).find((x) => x.kind === kind)?.path
  if (!bin) return done(false)
  const env = agentEnv(await loginPath(), envFor(kind, id))
  return new Promise((resolve) => {
    const wait = setTimeout(() => resolve(false), 60_000) // stops waiting, not the renewal
    const c = spawn(bin, ['doctor'], { env, stdio: 'ignore', windowsHide: true, shell: IS_WIN })
    c.on('error', () => { clearTimeout(wait); resolve(done(false)) })
    c.on('exit', (code) => { clearTimeout(wait); resolve(done(code === 0)) })
  })
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
    id: a.id, label: a.label, isDefault: !!a.isDefault, named: a.isDefault ? !!a.named : true, active: a.id === active,
    signedIn: s?.signedIn ?? read, plan: r?.plan || s?.plan || null,
    usable: !!r?.usable, status: r ? r.status : 'pending', error: r?.error || null, hint: r?.hint || null, allow: !!r?.allow,
    percentRemaining: r?.percentRemaining ?? null, windows: r?.windows || [], refreshedAt: r?.refreshedAt || null,
  }
}

// Every listed account of each kind with its last reading, for the switcher and Usage. No checks
// run: it's what's known now (the quota feed calls this on each read). usualHidden: your usual
// login is off the list (Settings can show it again).
export function groups() {
  const d = load()
  return Object.keys(KINDS).map((kind) => {
    const { setting, pick, active } = choice(kind, d)
    // With who quota-axi says it is, as the quota feed gives for your usual login (Usage masks it).
    return { kind, label: adapter(kind).label, setting, pick, usualHidden: hiddenUsual(kind, d), accounts: rowsOf(kind, d).map((a) => ({ ...view(a, active), account: readings.get(a.id)?.account || null })) }
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
    // account: who quota-axi says it is, which names your usual login until you name it.
    const accounts = await Promise.all(rowsOf(kind, d).map(async (a) => {
      const s = await statusOf(kind, a.id, bin, PATH)
      return { ...view(a, active, s), statusPlan: s.plan, account: readings.get(a.id)?.account || null }
    }))
    return { kind, label: adapter(kind).label, installed: !!bin, setting, pick, usualHidden: hiddenUsual(kind, d), accounts }
  }))
}

// One account's sign-in, checked now rather than from the cache: the add-account dialog asks
// every few seconds while you sign in, and moves on once it says yes.
export async function check(id) {
  const kind = String(id || '').replace(/-[^-]+$/, '')
  if (!known(kind, id)) throw new Error('No such account')
  statusCache.delete(id)
  const bin = (await installed().catch(() => [])).find((x) => x.kind === kind)?.path || null
  const s = await statusOf(kind, id, bin, await loginPath())
  return { id, kind, label: nameOf(kind, id), signedIn: s.signedIn, plan: s.plan }
}

// ---------- Changes ----------
const cleanLabel = (s) => String(s || '').replace(/[\r\n\0]/g, ' ').trim().slice(0, 40)

// Names are unique per agent, your usual login's included (listed or not). "Default" and "Your
// usual login" would read as something else, so they're not names an added account can have.
const reserved = (name) => ['default', USUAL.toLowerCase()].includes(name.toLowerCase())
const taken = (d, kind, name, except) => [{ id: defaultId(kind), label: defaultName(kind, d) }, ...d.accounts.filter((a) => a.kind === kind)]
  .some((a) => a.id !== except && a.label.toLowerCase() === name.toLowerCase()) || (reserved(name) && except !== defaultId(kind))

export function add(kind, label) {
  if (!KINDS[kind]) throw new Error(`Accounts aren't supported for ${kind} yet`)
  const name = cleanLabel(label)
  if (!name) throw new Error('Give the account a name, like Work backup or Personal')
  const d = load()
  if (taken(d, kind, name)) throw new Error(`There's already an account called ${name}`)
  const a = { id: `${kind}-${crypto.randomBytes(4).toString('hex')}`, kind, label: name, createdAt: new Date().toISOString() }
  d.accounts.push(a)
  save(d)
  prepare(a)
  return a
}

// Your usual login too: its name is kept per agent (back to "Your usual login" if you clear it).
export function rename(id, label) {
  const d = load()
  const kind = String(id || '').replace(/-default$/, '')
  const a = id === defaultId(kind) && KINDS[kind] ? null : find(d, id)
  if (!a && !(KINDS[kind] && id === defaultId(kind))) throw new Error('No such account')
  const name = cleanLabel(label)
  if (!name && a) throw new Error('Give the account a name')
  if (name && taken(d, a ? a.kind : kind, name, id)) throw new Error(`There's already an account called ${name}`)
  if (a) a.label = name
  else if (!name || reserved(name)) delete d.names[kind]
  else d.names[kind] = name
  save(d)
  return a || { id, kind, label: defaultName(kind, d), isDefault: true, named: !!d.names[kind] }
}

// Your default, where new agents start: a listed account, or 'auto' for whichever has the most
// left when an agent starts.
export function setActive(kind, id) {
  if (!KINDS[kind]) throw new Error(`Accounts aren't supported for ${kind} yet`)
  const d = load()
  if (id !== 'auto' && !listed(kind, id, d)) throw new Error(id === defaultId(kind) ? 'Your usual login is off the list. Show it again first (Settings › Model Providers › Accounts).' : 'No such account')
  d.active[kind] = id
  save(d)
  return { kind, active: id }
}

// The agent's own logout, for this account's folder (nothing for your usual login: the agent's own).
// statusCache: it reads as signed out from now on.
async function logoutOf(kind, id, bin) {
  const r = await run(bin, KINDS[kind].logout, agentEnv(await loginPath(), envFor(kind, id)), 10000)
  statusCache.delete(id)
  return r
}

// Sign out: an added account's login, or your usual login, which is the agent's own (Claude Code
// in the terminal signs out too: the app asks first). The account stays on the list, to sign in again.
export async function logout(id) {
  const kind = String(id || '').replace(/-[^-]+$/, '')
  if (!known(kind, id)) throw new Error('No such account')
  const bin = (await installed().catch(() => [])).find((x) => x.kind === kind)?.path
  if (!bin) throw Object.assign(new Error(`${adapter(kind).label} isn't installed`), { code: `install:${kind}` })
  const r = await logoutOf(kind, id, bin)
  // One that wasn't signed in can say so with an error: signed out either way.
  if (r.code === 0 || (await statusOf(kind, id, bin, await loginPath())).signedIn === false) return { ok: true }
  throw new Error(`${adapter(kind).label} couldn't sign ${nameOf(kind, id)} out: ${r.out.trim().split('\n').pop() || `it stopped with ${r.code}`}`)
}

// Back on the list: your usual login, after Remove took it off.
// The order you put a kind's accounts in (Settings › Model Providers): every list follows it.
export function reorder(kind, ids) {
  if (!KINDS[kind]) throw new Error(`Accounts aren't supported for ${kind} yet`)
  const d = load()
  const known = new Set(rowsOf(kind, d).map((a) => a.id))
  d.order[kind] = [...new Set([].concat(ids || []).map(String))].filter((id) => known.has(id))
  save(d)
  return { ok: true, order: rowsOf(kind, d).map((a) => a.id) }
}

export function show(kind) {
  if (!KINDS[kind]) throw new Error(`Accounts aren't supported for ${kind} yet`)
  const d = load()
  if (d.hidden[kind]) { delete d.hidden[kind]; save(d) }
  return { ok: true }
}

// Off the list. An added account: signed out (so its login doesn't linger in the keychain), then
// its folder deleted. The links in it point at your usual folder; removing a link never touches
// what it points to. Your usual login: only taken off Bridge AI's list, as it's the agent's own
// login (Claude Code in the terminal keeps it); nothing is signed out or deleted. The last one
// listed stays, so there's always an account to start agents on.
export async function remove(id) {
  const d = load()
  const kind = String(id || '').replace(/-[^-]+$/, '')
  const usual = KINDS[kind] && id === defaultId(kind)
  const a = usual ? null : find(d, id)
  if (!usual && !a) throw new Error('No such account')
  const k = usual ? kind : a.kind
  if (!listed(k, id, d)) return { ok: true } // your usual login, already off the list
  if (rowsOf(k, d).length < 2) throw new Error(`${nameOf(k, id)} is your only ${adapter(k).label} account here, so it stays. Add another one first.`)
  // Your default going: the first one listed after it is, and stays so (showing your usual login
  // again later doesn't move it back).
  const wasDefault = settingOf(k, d) === id
  if (usual) {
    d.hidden[k] = true
    if (wasDefault) d.active[k] = firstOf(k, d)
    save(d)
    return { ok: true, hidden: true }
  }
  const bin = (await installed().catch(() => [])).find((x) => x.kind === a.kind)?.path
  if (bin) await logoutOf(a.kind, a.id, bin)
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
  if (wasDefault) d.active[k] = firstOf(k, d)
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
  if (!k || !known(kind, id)) throw new Error('No such account')
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
