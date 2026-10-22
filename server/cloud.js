// Cloud agents: coding agents that run on a provider's own computers (Cursor, GitHub Copilot,
// Jules, Claude Managed Agents) on a hosted repo, started and followed from here with your own key.
// The provider code is shared/cloud/ (plain fetch, so the phone apps can run it too); this file
// keeps the keys and the agents you started, checks on them gently, and adds them to the fleet,
// so the sidebar, notifications, the phone and the chief of staff see them like local agents.
//
// Keys live in <data>/cloud-keys.json (mode 0600), never in config.json, and never go back to
// the browser: the API says { set, last4 } at most. They're kept apart from secrets.json so
// they aren't handed to the agents Bridge AI starts on this computer.
// For tests, BRIDGE_CLOUD_BASE_<PROVIDER> (e.g. BRIDGE_CLOUD_BASE_CURSOR) points a provider
// at another address.
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { DATA, dataFile, ensureDir, IS_WIN } from './paths.js'
import { loginPath } from './agents.js'
import { ADAPTERS, PROVIDERS } from '../shared/cloud/index.js'

const KEYS = dataFile('cloud-keys.json')
const AGENTS = dataFile('cloud-agents.json')
const SPACE = { id: 'cloud', label: 'Cloud' }
const PREFIX = 'cloud:'

// ---------- Files ----------
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) || d } catch { return d } }
function writeJSON(file, value) {
  ensureDir(DATA)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  try { fs.chmodSync(tmp, 0o600) } catch { /* Windows */ }
  fs.renameSync(tmp, file)
}

let keys = (() => {
  const raw = readJSON(KEYS, {})
  // "<provider>" is its key; "claude.github" is the GitHub token Claude uses for your repo.
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => (ADAPTERS[k] || /^\w+\.github$/.test(k)) && typeof v === 'string' && v))
})()
// What the adapters keep between calls (Cursor: the prompts you sent; Claude: its agent and
// environment ids). Saved with the agents.
const store = readJSON(AGENTS, {})
let tasks = Array.isArray(store.agents) ? store.agents.filter((t) => ADAPTERS[t?.provider] && t.id) : []
const memoData = store.memo && typeof store.memo === 'object' ? store.memo : {}
let saveTimer = null
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { writeJSON(AGENTS, { agents: tasks, memo: memoData }) } catch { /* next change */ } }, 300) }
const memo = { get: (k) => memoData[k], set: (k, v) => { memoData[k] = v; save() } }

// ---------- Providers ----------
const base = (id) => process.env[`BRIDGE_CLOUD_BASE_${id.toUpperCase()}`] || undefined
const fetchFn = (...a) => globalThis.fetch(...a)
const clients = new Map() // provider -> { key, client }
function client(id) {
  const key = ADAPTERS[id] ? keys[id] : null
  if (!key) return null
  const hit = clients.get(id)
  // Claude takes a GitHub token of its own, for private repos and pushing its branch.
  const github = keys[`${id}.github`] || null
  if (hit && hit.key === key && hit.github === github) return hit.client
  const c = ADAPTERS[id].create({ key, fetch: fetchFn, base: base(id), memo, github, githubBase: base('copilot') })
  clients.set(id, { key, github, client: c })
  return c
}
const infoOf = (id) => ADAPTERS[id].info
const paneOf = (t) => `${PREFIX}${t.provider}:${t.id}`
const find = (pane) => {
  const m = String(pane || '').match(/^cloud:([a-z]+):(.+)$/)
  return m ? tasks.find((t) => t.provider === m[1] && t.id === m[2]) || null : null
}
export const isCloud = (pane) => String(pane || '').startsWith(PREFIX)

// ---------- Health: rejected keys and backing off ----------
// failures: errors in a row; until: no requests before then (a rate limit, or backing off).
const health = new Map()
const healthOf = (id) => health.get(id) || health.set(id, { failures: 0, until: 0, error: null, rejected: false, checked: null }).get(id)
function noteError(id, e) {
  const h = healthOf(id)
  if (e?.auth) { h.rejected = true; h.error = e.message; return }
  h.failures++
  h.error = e?.message || String(e)
  // 15s, 30s, 1m, 2m... up to 15 minutes, or longer if the provider asked; a little jitter.
  const back = Math.min(15 * 60_000, 15_000 * 2 ** (h.failures - 1))
  h.until = Date.now() + Math.max(back, e?.retryAfter || 0) + Math.round(Math.random() * 2000)
}
const noteOk = (id) => { const h = healthOf(id); h.failures = 0; h.until = 0; h.error = null; h.rejected = false }

// ---------- Status in the fleet ----------
// A finished agent is "done" until you've looked at it, then idle, like a local one. Failed ones
// count as done (so you hear about them) and say so.
const fleetStatus = (t) => (t.status === 'working' || t.status === 'blocked' ? t.status : (t.status === 'done' || t.status === 'failed') && !t.seen ? 'done' : 'idle')
const ACTIVE = new Set(['working', 'blocked'])

// Fold what the provider said into our record. Returns whether anything shown changed.
const known = new Map() // pane -> the adapter's last full answer (not saved)
function apply(t, fresh) {
  const before = JSON.stringify([fleetStatus(t), t.title, t.prUrl, t.branch, t.summary, t.ask, t.state])
  const was = t.status
  for (const k of ['status', 'state', 'url', 'urlLabel', 'prUrl', 'branch', 'updatedAt', 'ask', 'approveLabel']) if (fresh[k] !== undefined) t[k] = fresh[k]
  // A quick look (no conversation) has no preview: keep the last one.
  if (fresh.summary) t.summary = fresh.summary
  if (fresh.repo && !t.repo) t.repo = fresh.repo
  if (fresh.title && (!t.title || t.autoTitle)) { t.title = fresh.title; t.autoTitle = false }
  if (t.status === 'working' && was !== 'working') t.seen = false
  if (fresh.messages) {
    const last = [...fresh.messages].reverse().find((m) => m.role === 'assistant')
    if (last) { t.summary = last.text.replace(/\s+/g, ' ').trim().slice(0, 220); t.summaryTs = last.ts || null }
    if (t.status === 'blocked' && !fresh.ask && last) t.ask = t.summary
  }
  if (t.status !== 'blocked') { t.ask = null; t.approveLabel = null }
  t.error = null
  const after = JSON.stringify([fleetStatus(t), t.title, t.prUrl, t.branch, t.summary, t.ask, t.state])
  if (after === before) return false
  // seq: a new state, or a new question while it's still waiting, is news (notify.js).
  if (fleetStatus(t) !== JSON.parse(before)[0] || (t.status === 'blocked' && t.ask !== JSON.parse(before)[5])) t.seq = (t.seq || 0) + 1
  return true
}

// ---------- Polling ----------
// Quick while an agent works, slower while it waits on you, every few minutes for ones that
// finished in the last couple of days (a follow-up could have come from the provider's own
// page), and not at all for older ones. One provider's errors don't hold up the others.
let onChange = () => {}
let watched = () => true
const timers = new Map()
const DAY = 24 * 3600 * 1000
function cadence(t) {
  const p = infoOf(t.provider).poll || {}
  // Several running at once on one provider: each is checked less often, to stay well under its
  // rate limit (Cursor's default is about 20 requests a minute).
  const busy = tasks.filter((x) => x.provider === t.provider && x.status === 'working' && !x.gone).length
  if (t.status === 'working') return (p.working || 15_000) * Math.max(1, Math.ceil(busy / 2))
  if (t.status === 'blocked') return p.blocked || 30_000
  if (Date.now() - Date.parse(t.updatedAt || t.createdAt || 0) > 2 * DAY) return null
  return watched() ? 5 * 60_000 : 15 * 60_000
}
function schedule(id, ms) {
  clearTimeout(timers.get(id))
  // A poll that throws must never take the server down: note it and look again later.
  timers.set(id, setTimeout(() => tick(id).catch((e) => { noteError(id, e); schedule(id, 60_000) }), Math.max(500, ms)))
}
// Look again soon: at one agent (after you sent it something), or at all of a provider's agents that
// are still being followed (after its key was saved, or a restart).
export function soon(id, ms = 2500, only = null) {
  if (!ADAPTERS[id] || !keys[id]) return
  for (const t of tasks) if (t.provider === id && (only ? t === only : Number.isFinite(t.nextAt ?? 0))) t.nextAt = Math.min(t.nextAt ?? Infinity, Date.now() + ms)
  schedule(id, ms)
}
async function tick(id) {
  timers.delete(id)
  const c = client(id)
  const h = healthOf(id)
  if (!c || h.rejected) return
  if (Date.now() < h.until) return schedule(id, h.until - Date.now())
  const mine = tasks.filter((t) => t.provider === id && !t.gone)
  let changed = false
  for (const t of mine) {
    if ((t.nextAt || 0) > Date.now()) continue
    const pane = paneOf(t)
    try {
      const prev = known.get(pane)
      let fresh = await c.get(t.id, { messages: false, known: prev })
      // Something moved: read the conversation too (for the preview, and what it's asking).
      const moved = !prev || prev.state !== fresh.state || prev.updatedAt !== fresh.updatedAt || prev.status !== fresh.status
      if (moved || (t.status === 'working' && Date.now() - (t.readAt || 0) > 60_000)) { fresh = await c.get(t.id, { messages: true, known: prev }); t.readAt = Date.now() }
      else if (prev?.messages) fresh = { ...fresh, messages: prev.messages }
      known.set(pane, fresh)
      if (apply(t, fresh)) changed = true
      noteOk(id)
      await deliverHeld(c, t).then((d) => { if (d) changed = true })
    } catch (e) {
      // Gone from the provider (but not just made: a new one can briefly read as missing).
      if (e?.status === 404 && Date.now() - Date.parse(t.createdAt || 0) > 2 * 60_000) { t.gone = true; t.status = 'failed'; t.error = 'The provider no longer has this agent'; changed = true; continue }
      noteError(id, e)
      if (t.error !== e.message) { t.error = e.message; changed = true }
      break
    }
    const next = cadence(t)
    t.nextAt = next == null ? Infinity : Date.now() + next
  }
  if (changed) { save(); onChange() }
  const wait = Math.min(...tasks.filter((t) => t.provider === id && !t.gone).map((t) => (t.nextAt || 0) - Date.now()))
  if (healthOf(id).until > Date.now()) schedule(id, healthOf(id).until - Date.now())
  else if (Number.isFinite(wait)) schedule(id, Math.max(1000, wait))
}

// Messages held because the agent was busy (Cursor refuses a follow-up mid-run): sent once it's free.
async function deliverHeld(c, t) {
  if (!t.held?.length || (t.status === 'working' && infoOf(t.provider).holdWhileWorking)) return false
  const [next, ...rest] = t.held
  try {
    await c.send(t.id, next.text)
    t.held = rest
    t.status = 'working'
    t.seen = false
    t.seq = (t.seq || 0) + 1
    t.nextAt = Date.now() + 3000
    return true
  } catch (e) { if (!e.busy) { t.held = rest; t.error = `Couldn't send a held message: ${e.message}` } return false }
}

export function start(opts = {}) {
  if (opts.onChange) onChange = opts.onChange
  if (opts.watched) watched = opts.watched
  for (const id of Object.keys(ADAPTERS)) if (keys[id]) soon(id, 1500)
}

// ---------- The fleet ----------
// Cloud agents go in their own "Cloud" space, after your spaces. Only providers with a key.
export function fleetAgents({ isMuted = () => false } = {}) {
  return tasks.filter((t) => keys[t.provider]).map((t) => {
    const pane = paneOf(t)
    const i = infoOf(t.provider)
    const c = client(t.provider)
    return {
      paneId: pane, tabId: null, workspaceId: SPACE.id, workspace: SPACE.label, tab: '',
      kind: 'cloud', kindLabel: `${i.name} cloud agent`, status: fleetStatus(t), title: t.title || 'Cloud agent',
      cwd: '', sessionId: null, focused: false, seq: t.seq || 0, chief: false, caps: {}, tabNumber: 0, worktree: null,
      muted: isMuted(pane),
      cloud: {
        provider: t.provider, label: i.name, repo: t.repo || null, branch: t.branch || null, base: t.base || null,
        url: t.url || null, urlLabel: t.urlLabel || null, prUrl: t.prUrl || null, state: t.state || '', failed: t.status === 'failed', ask: t.ask || null,
        error: t.error || healthOf(t.provider).error || null, held: (t.held || []).length,
        canSend: !!c?.send, canStop: !!c?.stop, holds: !!i.holdWhileWorking,
        canApprove: !!c?.approve && t.status === 'blocked' && !!t.approveLabel, approveLabel: t.approveLabel || null,
      },
    }
  })
}
// Added to the fleet the server already built (index.js fleetView).
export function addTo(f, opts) {
  const list = fleetAgents(opts)
  if (!list.length) return f
  f.agents.push(...list)
  f.workspaces = [...(f.workspaces || []), { ...SPACE, status: ['blocked', 'working', 'done', 'idle'].find((s) => list.some((a) => a.status === s)) || 'idle' }]
  return f
}
// Board previews: the last thing it said.
export function previews() {
  return Object.fromEntries(tasks.filter((t) => keys[t.provider]).map((t) => [paneOf(t), t.summary ? { text: t.summary, role: 'assistant', tool: null, ts: t.summaryTs || t.updatedAt || null } : null]))
}

// The conversation while you have it open (shared by everyone looking): a quick look every few
// seconds, and the whole conversation only when something moved, or once a minute. It stands in
// for the background check, and waits out a rate limit like it.
const details = new Map() // pane -> { at, p }
async function detail(t, { fresh = false } = {}) {
  const pane = paneOf(t)
  const hit = details.get(pane)
  const ttl = Math.min(10_000, infoOf(t.provider).poll?.working || 15_000)
  if (hit && !fresh && Date.now() - hit.at < ttl) return hit.p
  const c = client(t.provider)
  if (!c) throw new Error(`No ${infoOf(t.provider).name} key in Bridge AI. Add it in Settings › Model providers.`)
  const h = healthOf(t.provider)
  const prev = known.get(pane)
  if ((h.rejected || Date.now() < h.until) && prev?.messages) return prev
  const p = (async () => {
    let d = prev?.messages && !fresh ? await c.get(t.id, { messages: false, known: prev }) : null
    const moved = !d || prev.state !== d.state || prev.updatedAt !== d.updatedAt || prev.status !== d.status || Date.now() - (t.readAt || 0) > 60_000
    if (moved) { d = await c.get(t.id, { messages: true, known: prev }); t.readAt = Date.now() } else d = { ...d, messages: prev.messages }
    known.set(pane, d)
    if (apply(t, d)) { save(); onChange() }
    noteOk(t.provider)
    const next = cadence(t)
    t.nextAt = next == null ? Infinity : Date.now() + next
    return d
  })()
  details.set(pane, { at: Date.now(), p })
  p.catch(() => details.delete(pane))
  return p
}
const view = (t, d) => ({
  ...fleetAgents().find((a) => a.paneId === paneOf(t)),
  messages: d?.messages || [],
  held: (t.held || []).map((x) => ({ id: x.id, text: x.text, at: x.at })),
})

// ---------- Search ----------
// Conversations you've opened are remembered for a while, so search finds cloud agents by what
// they said, as well as by name and repo.
export function search(q) {
  const needle = String(q || '').trim().toLowerCase()
  if (needle.length < 2) return []
  const out = []
  for (const t of tasks.filter((x) => keys[x.provider])) {
    const d = known.get(paneOf(t))
    const texts = [{ role: 'user', text: t.title || '' }, { role: 'assistant', text: t.summary || '' }, ...((d?.messages || []).filter((m) => m.role !== 'event'))]
    const hits = []
    for (const m of texts) {
      const flat = String(m.text || '').replace(/\s+/g, ' ')
      const i = flat.toLowerCase().indexOf(needle)
      if (i < 0) continue
      const s = Math.max(0, i - 70)
      hits.push({ role: m.role, ts: m.ts || t.updatedAt, text: `${s ? '…' : ''}${flat.slice(s, i + needle.length + 110)}`, at: i - s + (s ? 1 : 0) })
      if (hits.length >= 3) break
    }
    const where = `${t.repo || ''} ${t.branch || ''} ${infoOf(t.provider).name}`.toLowerCase()
    if (!hits.length && !where.includes(needle)) continue
    // kind: the provider, for its logo in History; sessionId keys the row there.
    out.push({ kind: t.provider, provider: t.provider, sessionId: paneOf(t), paneId: paneOf(t), label: t.title, title: t.title, workspace: SPACE.label, cwd: t.repo ? `${infoOf(t.provider).name} · ${t.repo}` : infoOf(t.provider).name, hits, last: Date.parse(t.updatedAt || t.createdAt || 0) || 0 })
  }
  return out
}

// ---------- Keys ----------
const last4 = (k) => (k.length >= 16 ? k.slice(-4) : '')
function providerView(id) {
  const i = infoOf(id)
  const h = healthOf(id)
  return {
    id, name: i.name, description: i.description, keyUrl: i.keyUrl, keyLabel: i.keyLabel, keyHint: i.keyHint, cost: i.cost, perUse: !!i.perUse,
    permissions: i.permissions || null, hosts: i.hosts || null, repoPlaceholder: i.repoPlaceholder || '', models: !!i.models, ghLogin: !!i.ghLogin,
    saved: keys[id] ? { set: true, last4: last4(keys[id]) } : null,
    github: i.github ? (keys[`${id}.github`] ? { set: true, last4: last4(keys[`${id}.github`]) } : { set: false, copilot: !!keys.copilot }) : null,
    status: !keys[id] ? 'not set' : h.rejected ? 'rejected' : 'connected', error: keys[id] ? h.error : null, account: h.checked?.account || null,
    agents: tasks.filter((t) => t.provider === id).length,
  }
}
async function check(id) {
  const c = client(id)
  if (!c) return { ok: false, message: 'No key saved' }
  try {
    const r = await c.check()
    noteOk(id)
    healthOf(id).checked = r
    soon(id, 500)
    return { ok: true, message: r.account ? `Key works (${r.account})` : 'Key works', account: r.account || null }
  } catch (e) {
    noteError(id, e)
    return { ok: false, message: e.message }
  }
}
function saveKey(id, key, slot = id) {
  const v = String(key || '').trim()
  if (!v) throw new Error('Paste a key first')
  if (/[\s\0]/.test(v) || v.length > 4096) throw new Error("That doesn't look like a key")
  keys = { ...keys, [slot]: v }
  writeJSON(KEYS, keys)
  health.delete(id)
  clients.delete(id)
}
function removeKey(id) {
  const { [id]: _, [`${id}.github`]: __, ...rest } = keys
  keys = rest
  writeJSON(KEYS, keys)
  health.delete(id)
  clients.delete(id)
  clearTimeout(timers.get(id))
}
export const keyFor = (id) => keys[id] || null

// The GitHub CLI's sign-in, for Copilot: only read when you click "Use my GitHub CLI sign-in".
const gh = async (args) => {
  const PATH = await loginPath().catch(() => process.env.PATH)
  return new Promise((resolve) => execFile(IS_WIN ? 'gh.exe' : 'gh', args, { timeout: 8000, windowsHide: true, env: { ...process.env, PATH } }, (err, stdout = '') => resolve({ ok: !err, out: String(stdout).trim() })))
}
let ghCache = { at: 0, v: null }
async function ghStatus() {
  if (ghCache.v && Date.now() - ghCache.at < 60_000) return ghCache.v
  const r = await gh(['auth', 'status', '--hostname', 'github.com'])
  ghCache = { at: Date.now(), v: { signedIn: r.ok } }
  return ghCache.v
}

// ---------- Routes ----------
const NO_LOCAL = (t) => `${infoOf(t.provider).name} runs this agent on its own computers, so there's no terminal or folder for it here.`
// Requests through the relay (your phone) can use cloud agents but not read your GitHub CLI login.
const onComputer = (req) => { if (req.headers['x-bridge-relay']) throw Object.assign(new Error('Do this in Bridge AI on your computer'), { status: 403 }) }
const wrap = (fn) => async (req, res, next) => {
  try {
    const out = await fn(req, res, next)
    if (out !== undefined && !res.headersSent) res.json(out)
  } catch (e) { if (!res.headersSent) res.status(e.status || (e.limited ? 429 : 502)).json({ error: e.message }) }
}

async function sendTo(t, text) {
  const body = String(text || '').trim()
  if (!body) throw new Error('Empty message')
  const c = client(t.provider)
  if (!c) throw new Error(`No ${infoOf(t.provider).name} key in Bridge AI`)
  const hold = () => {
    const item = { id: Math.random().toString(36).slice(2, 10), text: body, at: new Date().toISOString() }
    t.held = [...(t.held || []), item]
    save(); onChange()
    return { ok: true, queued: true, id: item.id, reason: 'it is still working' }
  }
  if (t.status === 'working' && infoOf(t.provider).holdWhileWorking) return hold()
  try { await c.send(t.id, body) } catch (e) { if (e.busy) return hold(); throw e }
  t.status = 'working'
  t.seen = false
  t.seq = (t.seq || 0) + 1
  details.delete(paneOf(t))
  save(); onChange()
  soon(t.provider, 2500, t)
  return { ok: true }
}

export function routes(app, { pushFleet = () => {} } = {}) {
  onChange = pushFleet

  // The agent routes local agents use (Chat, the chief of staff's `bridge` helper, phone
  // notifications), answered for cloud agents; everything about terminals and folders says why not.
  app.all('/api/agents/:pane/*rest', wrap(async (req, res, next) => {
    if (!isCloud(req.params.pane)) return next()
    const t = find(req.params.pane)
    const what = [].concat(req.params.rest || []).join('/')
    if (what === 'mute') return next() // index.js, the same as local agents
    if (!t || !keys[t.provider]) throw Object.assign(new Error(`No agent in pane ${req.params.pane}`), { status: 404 })
    const m = req.method
    if (m === 'GET' && what === 'transcript') return { supported: true, messages: (await detail(t)).messages || [], more: null }
    if (m === 'GET' && what === 'transcript/earlier') return { messages: [], more: null }
    if (m === 'GET' && what === 'question') return { text: t.ask || null }
    if (m === 'GET' && what === 'subagents') return { items: [] }
    if (m === 'GET' && what === 'commands') return []
    if (m === 'GET' && what === 'screen') return { ansi: [`${infoOf(t.provider).name} cloud agent · ${t.state || t.status}`, t.repo ? `${t.repo}${t.branch ? ` (${t.branch})` : ''}` : '', t.ask ? `Waiting on you: ${t.ask}` : t.summary || '', t.prUrl ? `Pull request: ${t.prUrl}` : ''].filter(Boolean).join('\n'), cols: null }
    if (m === 'POST' && (what === 'prompt' || what === 'queue' || what === 'steer')) return sendTo(t, req.body?.text)
    if (m === 'POST' && what === 'focus') { if (!t.seen) { t.seen = true; save(); pushFleet() } return { ok: true } }
    if (m === 'POST' && what === 'keys') {
      if ((req.body?.keys || []).join() === 'esc') return stopTask(t)
      throw Object.assign(new Error(NO_LOCAL(t)), { status: 400 })
    }
    throw Object.assign(new Error(NO_LOCAL(t)), { status: 400 })
  }))

  // Settings › Model providers › Cloud agents.
  app.get('/api/cloud', wrap(() => ({ providers: PROVIDERS.map((p) => providerView(p.id)) })))
  const known404 = (req) => { if (!ADAPTERS[req.params.provider]) throw Object.assign(new Error('Unknown provider'), { status: 404 }); return req.params.provider }
  // { key } and, for Claude, { github } (a token) or { github: 'copilot' } (the one saved for Copilot).
  app.put('/api/cloud/keys/:provider', wrap(async (req) => {
    const id = known404(req)
    const { key, github } = req.body || {}
    if (github !== undefined && infoOf(id).github) {
      if (github === null || github === '') { const { [`${id}.github`]: _, ...rest } = keys; keys = rest; writeJSON(KEYS, keys); clients.delete(id) }
      else saveKey(id, github === 'copilot' ? keys.copilot : github, `${id}.github`)
      if (!key) return providerView(id)
    }
    saveKey(id, key)
    const r = await check(id)
    pushFleet()
    return { ...providerView(id), test: r }
  }))
  app.post('/api/cloud/keys/:provider/test', wrap(async (req) => { const id = known404(req); return { ...(await check(id)), provider: providerView(id) } }))
  app.delete('/api/cloud/keys/:provider', wrap((req) => { const id = known404(req); removeKey(id); pushFleet(); return providerView(id) }))
  app.get('/api/cloud/gh', wrap(async (req) => { onComputer(req); return ghStatus() }))
  app.post('/api/cloud/keys/copilot/gh', wrap(async (req) => {
    onComputer(req)
    const r = await gh(['auth', 'token', '--hostname', 'github.com'])
    if (!r.ok || !r.out) throw new Error("The GitHub CLI isn't signed in. Run gh auth login, or paste a token.")
    saveKey('copilot', r.out.split('\n')[0])
    const test = await check('copilot')
    pushFleet()
    return { ...providerView('copilot'), test }
  }))

  // The new agent dialog's pickers.
  const repoCache = new Map() // provider -> { at, list }
  app.get('/api/cloud/:provider/repos', wrap(async (req) => {
    const id = known404(req)
    const c = client(id)
    if (!c) throw new Error('No key saved')
    const hit = repoCache.get(id)
    const every = infoOf(id).reposEvery || 5 * 60_000
    if (hit && (Date.now() - hit.at < every || req.query.refresh !== '1') && hit.list) return { repos: hit.list, at: hit.at }
    try {
      const list = await c.repos()
      repoCache.set(id, { at: Date.now(), list })
      return { repos: list, at: Date.now() }
    } catch (e) {
      if (hit?.list) return { repos: hit.list, at: hit.at, error: e.message }
      throw e
    }
  }))
  app.get('/api/cloud/:provider/branches', wrap(async (req) => {
    const id = known404(req)
    const c = client(id)
    if (!c?.branches) return { branches: [] }
    return { branches: await c.branches(String(req.query.repo || '')).catch(() => []) }
  }))
  app.get('/api/cloud/:provider/models', wrap(async (req) => {
    const id = known404(req)
    const c = client(id)
    return { models: c?.models ? await c.models().catch(() => []) : [] }
  }))

  app.post('/api/cloud/launch', wrap(async (req) => {
    const { provider, repo, branch, prompt, model, approvePlan } = req.body || {}
    if (!ADAPTERS[provider]) throw new Error('Pick a provider')
    const c = client(provider)
    if (!c) throw new Error(`Add your ${infoOf(provider).name} key in Settings › Model providers first`)
    const text = String(prompt || '').trim()
    if (!text) throw new Error('Write what the agent should do')
    if (!String(repo || '').trim() && infoOf(provider).needsRepo !== false) throw new Error('Pick a repository')
    const out = await c.launch({ repo: String(repo || '').trim(), branch: String(branch || '').trim() || undefined, prompt: text, model: String(model || '').trim() || undefined, approvePlan: !!approvePlan })
    noteOk(provider)
    const t = { provider, id: String(out.id), title: out.title || text.split('\n')[0].slice(0, 60), autoTitle: !out.title, repo: out.repo || String(repo || '').trim(), branch: out.branch || String(branch || '').trim() || null, base: String(branch || '').trim() || null, createdAt: out.createdAt || new Date().toISOString(), seen: false, seq: 1 }
    apply(t, out)
    if (!t.status) t.status = 'working'
    t.nextAt = Date.now() + 3000
    tasks = [t, ...tasks.filter((x) => !(x.provider === provider && x.id === t.id))]
    known.set(paneOf(t), out)
    save()
    pushFleet()
    soon(provider, 3000, t)
    return { paneId: paneOf(t) }
  }))

  const need = (req) => {
    const t = find(req.params.pane)
    if (!t || !keys[t.provider]) throw Object.assign(new Error('No such cloud agent'), { status: 404 })
    return t
  }
  app.get('/api/cloud/agents/:pane', wrap(async (req) => {
    const t = need(req)
    let d = null
    try { d = await detail(t, { fresh: req.query.refresh === '1' }) } catch (e) { noteError(t.provider, e); if (!known.get(paneOf(t))) throw e; d = known.get(paneOf(t)) }
    return view(t, d)
  }))
  app.post('/api/cloud/agents/:pane/send', wrap((req) => sendTo(need(req), req.body?.text)))
  app.post('/api/cloud/agents/:pane/stop', wrap((req) => stopTask(need(req))))
  app.post('/api/cloud/agents/:pane/approve', wrap(async (req) => {
    const t = need(req)
    const c = client(t.provider)
    if (!c?.approve) throw new Error("This provider doesn't have plans to approve")
    await c.approve(t.id)
    t.status = 'working'; t.ask = null; t.seq = (t.seq || 0) + 1
    details.delete(paneOf(t))
    save(); pushFleet(); soon(t.provider, 2500, t)
    return { ok: true }
  }))
  app.post('/api/cloud/agents/:pane/seen', wrap((req) => { const t = need(req); if (!t.seen) { t.seen = true; save(); pushFleet() } return { ok: true } }))
  app.delete('/api/cloud/agents/:pane/held/:id', wrap((req) => { const t = need(req); t.held = (t.held || []).filter((x) => x.id !== req.params.id); save(); pushFleet(); return { ok: true } }))
  // Remove from Bridge AI: it stops being followed here. The agent itself stays with the provider.
  app.delete('/api/cloud/agents/:pane', wrap((req) => {
    const t = need(req)
    tasks = tasks.filter((x) => x !== t)
    known.delete(paneOf(t)); details.delete(paneOf(t))
    save(); pushFleet()
    return { ok: true }
  }))

  async function stopTask(t) {
    const c = client(t.provider)
    if (!c?.stop) throw new Error(`${infoOf(t.provider).name} can't be stopped from here; open it on ${infoOf(t.provider).name}`)
    await c.stop(t.id)
    t.held = []
    details.delete(paneOf(t))
    soon(t.provider, 1500, t)
    save(); pushFleet()
    return { ok: true, stopped: true }
  }
}
