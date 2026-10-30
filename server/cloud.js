// Cloud agents: coding agents that run on a provider's own computers (Cursor, GitHub Copilot,
// Jules, Claude Managed Agents) on a hosted repo, started and followed from here with your own key.
// The provider code is shared/cloud/ (plain fetch, so the phone apps can run it too), and so is
// following them (shared/cloud/follow.js: checking on them gently, held follow-ups, their place in
// the fleet). This file keeps the keys and the agents you started, and answers the API, so the
// sidebar, notifications, the phone and the chief of staff see them like local agents.
//
// Keys live in <data>/cloud-keys.json (mode 0600), never in config.json, and never go back to
// the browser: the API says { set, last4 } at most. They're kept apart from secrets.json so
// they aren't handed to the agents Bridge AI starts on this computer.
// For tests, BRIDGE_CLOUD_BASE_<PROVIDER> (e.g. BRIDGE_CLOUD_BASE_CURSOR) points a provider
// at another address.
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { DATA, dataFile, ensureDir, IS_WIN, writeFileAtomic } from './paths.js'
import { loginPath } from './agents.js'
import { ADAPTERS } from '../shared/cloud/index.js'
import { follow, keyView, isCloud } from '../shared/cloud/follow.js'

export { isCloud }

const KEYS = dataFile('cloud-keys.json')
const AGENTS = dataFile('cloud-agents.json')

// ---------- Files ----------
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) || d } catch { return d } }
function writeJSON(file, value) {
  ensureDir(DATA)
  writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}

let keys = (() => {
  const raw = readJSON(KEYS, {})
  // "<provider>" is its key; "claude.github" is the GitHub token Claude uses for your repo.
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => (ADAPTERS[k] || /^\w+\.github$/.test(k)) && typeof v === 'string' && v))
})()
// What the adapters keep between calls (Cursor: the prompts you sent; Claude: its agent and
// environment ids). Saved with the agents.
const store = readJSON(AGENTS, {})
const memoData = store.memo && typeof store.memo === 'object' ? store.memo : {}
let saveTimer = null
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { writeJSON(AGENTS, { agents: cloud.tasks(), memo: memoData }) } catch { /* next change */ } }, 300) }
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

const cloud = follow({ tasks: Array.isArray(store.agents) ? store.agents : [], client, saved: (slot) => keyView(keys[slot]), save })

export const soon = (...a) => cloud.soon(...a)
export function start(opts = {}) {
  cloud.on({ change: opts.onChange, watched: opts.watched })
  cloud.start()
}

// ---------- The fleet ----------
export const fleetAgents = (opts) => cloud.fleetAgents(opts)
// Added to the fleet the server already built (index.js fleetView).
export function addTo(f, opts) {
  const list = fleetAgents(opts)
  if (!list.length) return f
  f.agents.push(...list)
  f.workspaces = [...(f.workspaces || []), cloud.space(list)]
  return f
}
export const previews = () => cloud.previews()
export const search = (q) => cloud.search(q)

// ---------- Keys ----------
function saveKey(id, key, slot = id) {
  const v = String(key || '').trim()
  if (!v) throw new Error('Paste a key first')
  if (/[\s\0]/.test(v) || v.length > 4096) throw new Error("That doesn't look like a key")
  keys = { ...keys, [slot]: v }
  writeJSON(KEYS, keys)
  cloud.reset(id)
  clients.delete(id)
}
function removeKey(id) {
  const { [id]: _, [`${id}.github`]: __, ...rest } = keys
  keys = rest
  writeJSON(KEYS, keys)
  cloud.reset(id, { stop: true })
  clients.delete(id)
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
// Requests through the relay (your phone) can use cloud agents but not read your GitHub CLI login.
const onComputer = (req) => { if (req.headers['x-bridge-relay']) throw Object.assign(new Error('Do this in Bridge AI on your computer'), { status: 403 }) }
const wrap = (fn) => async (req, res, next) => {
  try {
    const out = await fn(req, res, next)
    if (out !== undefined && !res.headersSent) res.json(out)
  } catch (e) { if (!res.headersSent) res.status(e.status || (e.limited ? 429 : 502)).json({ error: e.message }) }
}

export function routes(app, { pushFleet = () => {} } = {}) {
  cloud.on({ change: pushFleet })

  // The agent routes local agents use (Chat, the chief of staff's `bridge` helper, phone
  // notifications), answered for cloud agents; everything about terminals and folders says why not.
  app.all('/api/agents/:pane/*rest', wrap(async (req, res, next) => {
    if (!isCloud(req.params.pane)) return next()
    const what = [].concat(req.params.rest || []).join('/')
    if (what === 'mute') return next() // index.js, the same as local agents
    return cloud.agentRoute(req.params.pane, req.method, what, req.body)
  }))

  // Settings › Model providers › Cloud agents.
  app.get('/api/cloud', wrap(() => cloud.providers()))
  const known404 = (req) => { if (!ADAPTERS[req.params.provider]) throw Object.assign(new Error('Unknown provider'), { status: 404 }); return req.params.provider }
  // { key } and, for Claude, { github } (a token) or { github: 'copilot' } (the one saved for Copilot).
  app.put('/api/cloud/keys/:provider', wrap(async (req) => {
    const id = known404(req)
    const { key, github } = req.body || {}
    if (github !== undefined && ADAPTERS[id].info.github) {
      if (github === null || github === '') { const { [`${id}.github`]: _, ...rest } = keys; keys = rest; writeJSON(KEYS, keys); clients.delete(id) }
      else saveKey(id, github === 'copilot' ? keys.copilot : github, `${id}.github`)
      if (!key) return cloud.providerView(id)
    }
    saveKey(id, key)
    const r = await cloud.check(id)
    pushFleet()
    return { ...cloud.providerView(id), test: r }
  }))
  app.post('/api/cloud/keys/:provider/test', wrap(async (req) => { const id = known404(req); return { ...(await cloud.check(id)), provider: cloud.providerView(id) } }))
  app.delete('/api/cloud/keys/:provider', wrap((req) => { const id = known404(req); removeKey(id); pushFleet(); return cloud.providerView(id) }))
  app.get('/api/cloud/gh', wrap(async (req) => { onComputer(req); return ghStatus() }))
  app.post('/api/cloud/keys/copilot/gh', wrap(async (req) => {
    onComputer(req)
    const r = await gh(['auth', 'token', '--hostname', 'github.com'])
    if (!r.ok || !r.out) throw new Error("The GitHub CLI isn't signed in. Run gh auth login, or paste a token.")
    saveKey('copilot', r.out.split('\n')[0])
    const test = await cloud.check('copilot')
    pushFleet()
    return { ...cloud.providerView('copilot'), test }
  }))

  // The new agent dialog's pickers.
  app.get('/api/cloud/:provider/repos', wrap((req) => cloud.repos(known404(req), { refresh: req.query.refresh === '1' })))
  app.get('/api/cloud/:provider/branches', wrap((req) => cloud.branches(known404(req), req.query.repo)))
  app.get('/api/cloud/:provider/models', wrap((req) => cloud.models(known404(req))))

  app.post('/api/cloud/launch', wrap((req) => cloud.launch(req.body || {})))

  app.get('/api/cloud/agents/:pane', wrap((req) => cloud.open(cloud.need(req.params.pane), { fresh: req.query.refresh === '1' })))
  app.post('/api/cloud/agents/:pane/send', wrap((req) => cloud.send(cloud.need(req.params.pane), req.body?.text)))
  app.post('/api/cloud/agents/:pane/stop', wrap((req) => cloud.stop(cloud.need(req.params.pane))))
  app.post('/api/cloud/agents/:pane/approve', wrap((req) => cloud.approve(cloud.need(req.params.pane))))
  app.post('/api/cloud/agents/:pane/seen', wrap((req) => cloud.seen(cloud.need(req.params.pane))))
  app.delete('/api/cloud/agents/:pane/held/:id', wrap((req) => cloud.dropHeld(cloud.need(req.params.pane), req.params.id)))
  // Remove from Bridge AI: it stops being followed here. The agent itself stays with the provider.
  app.delete('/api/cloud/agents/:pane', wrap((req) => cloud.remove(cloud.need(req.params.pane))))
}
