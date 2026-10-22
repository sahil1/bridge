// Cloud agents on the phone alone: the backend the UI talks to (src/standalone/serve.js), in the
// page. It follows the agents you start from this phone the way Bridge AI on a computer does
// (shared/cloud/follow.js), on the same adapters, through the app (native.js), which holds the keys
// and makes the requests. The rest of the app answers calmly: there's no computer here, so no local
// agents, terminals, files, usage or brief.
import { version } from '../../package.json'
import { ADAPTERS } from '../../shared/cloud/index.js'
import { follow } from '../../shared/cloud/follow.js'
import { cloudApi, NOT_CLOUD } from '../standalone/cloud.js'
import { call, appFetch, standIn } from './native.js'

const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }) }
const PLACE = { keys: 'on this phone', settings: 'Settings › Cloud agents' }
const PROVIDERS = Object.keys(ADAPTERS)

// What's kept for one provider: its agents (without what's only for now) and what its adapter remembers.
const LOCAL = ['readAt']
const pack = (tasks, memo, id) => JSON.stringify({
  agents: tasks.filter((t) => t.provider === id).map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !LOCAL.includes(k)).map(([k, v]) => [k, k === 'nextAt' && !Number.isFinite(v) ? null : v]))),
  memo: Object.fromEntries(Object.entries(memo).filter(([k]) => k.startsWith(`${id}:`))),
})
function unpack(state) {
  const tasks = []
  const memo = {}
  for (const id of PROVIDERS) {
    let s = null
    try { s = state?.[id] ? JSON.parse(state[id]) : null } catch { s = null }
    // An agent with no next look planned stays that way (null is how Infinity is kept).
    for (const t of s?.agents || []) if (t?.id) tasks.push({ ...t, provider: id, nextAt: t.nextAt == null ? Infinity : t.nextAt })
    Object.assign(memo, s?.memo || {})
  }
  return { tasks, memo }
}

// -> { request, stream, cloud, ready, save, slots }. check: the background check (no timers, no UI).
export function createPhone({ check = false } = {}) {
  let slots = {} // slot -> { set, last4 }
  let bases = {} // provider -> another address (debug builds of the app, for testing)
  let memo = {}
  let rev = 0
  const sent = {} // provider -> what was last saved
  const clients = new Map()

  function client(id) {
    if (!ADAPTERS[id] || !slots[id]?.set) return null
    const github = id === 'claude' && slots['claude.github']?.set ? standIn('claude.github') : null
    const hit = clients.get(id)
    if (hit && hit.github === github) return hit.client
    const c = ADAPTERS[id].create({ key: standIn(id), fetch: appFetch(id), base: bases[id], memo: { get: (k) => memo[k], set: (k, v) => { memo[k] = v; save() } }, github, githubBase: bases.copilot })
    clients.set(id, { github, client: c })
    return c
  }

  let timer = null
  function save() { clearTimeout(timer); timer = setTimeout(flush, 300) }
  async function flush() {
    clearTimeout(timer)
    for (const id of PROVIDERS) {
      if (!slots[id]?.set) continue
      const s = pack(cloud.tasks(), memo, id)
      if (sent[id] === s) continue
      sent[id] = s
      try { rev = (await call('save', { provider: id, state: s }))?.rev ?? rev } catch { delete sent[id] }
    }
  }

  const cloud = follow({ client, saved: (slot) => slots[slot] || null, save, place: PLACE })
  const listeners = new Set()
  let pending = false
  const changed = () => {
    if (pending) return
    pending = true
    setTimeout(() => { pending = false; const f = fleet(); for (const send of listeners) send(f, 'fleet') }, 30)
  }
  cloud.on({ change: changed, watched: () => !check && document.visibilityState === 'visible' })

  function take(state, r) {
    const u = unpack(state)
    memo = u.memo
    cloud.load(u.tasks)
    for (const id of PROVIDERS) sent[id] = state?.[id] ? pack(cloud.tasks(), memo, id) : undefined
    rev = r ?? rev
  }
  const ready = call('config').then((c) => {
    slots = c?.keys || {}
    bases = c?.bases || {}
    take(c?.state || {}, c?.rev)
    if (!check) cloud.start()
  })

  // While the app isn't showing, nothing is checked here; the app's background check may look
  // meanwhile (Android), so what it saved is read again on the way back.
  if (!check) {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') { cloud.pause(); flush(); return }
      try {
        const s = await call('load')
        if (s && s.rev !== rev) { take(s.state || {}, s.rev); changed() }
      } catch { /* keep what's here */ }
      cloud.start()
    })
  }

  // ---------- Keys ----------
  const keys = {
    async put(id, { key, github }) {
      if (github !== undefined && ADAPTERS[id].info.github) {
        const slot = `${id}.github`
        if (github === null || github === '') slots = (await call('removeKey', { slot })).keys
        else if (github === 'copilot') slots = (await call('copyKey', { from: 'copilot', to: slot })).keys
        else slots = (await call('setKey', { slot, key: tidy(github) })).keys
        clients.delete(id)
        if (!key) return cloud.providerView(id)
      }
      slots = (await call('setKey', { slot: id, key: tidy(key) })).keys
      cloud.reset(id)
      clients.delete(id)
      const test = await cloud.check(id)
      save()
      changed()
      return { ...cloud.providerView(id), test }
    },
    // The key goes, and with it the agents started with it and what's kept for them.
    async remove(id) {
      slots = (await call('removeKey', { slot: id })).keys
      cloud.forget(id)
      clients.delete(id)
      for (const k of Object.keys(memo)) if (k.startsWith(`${id}:`)) delete memo[k]
      delete sent[id]
      changed()
      return cloud.providerView(id)
    },
  }
  const tidy = (k) => {
    const v = String(k || '').trim()
    if (!v) fail('Paste a key first')
    if (/[\s\0]/.test(v) || v.length > 4096) fail("That doesn't look like a key")
    return v
  }
  const cloudReq = cloudApi(cloud, { keys, mute: (t, on) => { t.muted = on; save(); changed(); return { ok: true, muted: on } } })

  // ---------- The rest of the app ----------
  function fleet() {
    const rank = { blocked: 0, done: 1, working: 2, idle: 3 }
    const agents = cloud.fleetAgents({ isMuted: (pane) => !!cloud.find(pane)?.muted }).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || Date.parse(cloud.find(b.paneId)?.createdAt || 0) - Date.parse(cloud.find(a.paneId)?.createdAt || 0))
    return { agents, tabs: [], workspaces: agents.length ? [cloud.space(agents)] : [], counts: agents.reduce((c, a) => ({ ...c, [a.status]: (c[a.status] || 0) + 1 }), {}), queue: {} }
  }
  const NOT_HERE = 'That needs Bridge AI on your computer. Here on the phone it runs cloud agents.'
  const routes = {
    'GET /fleet': () => fleet(),
    'GET /config': () => ({ version, name: '', location: null, hasMortgage: false, runtime: { name: 'phone', liveView: false, reorder: false, splits: false }, platform: 'phone', mail: false, calendar: false, defaultAgent: null, setupDone: true, cloudOnly: true }),
    'GET /runtime-theme': () => ({}),
    'GET /version': () => ({ version, build: 'phone', bundled: true }),
    'GET /previews': () => cloud.previews(),
    'GET /places': () => ({}),
    'GET /panes': () => ({ panes: [] }),
    'GET /agent-kinds': () => [],
    'GET /agents/catalog': () => [],
    'GET /accounts': () => [],
    'GET /quota': () => ({ providers: [], accounts: [] }),
    'GET /updates': () => ({ current: version, latest: version, available: false, url: null, notes: '', checkedAt: null, error: null, how: 'store', command: null }),
    'GET /archive': () => ({ items: [] }),
    'GET /routines': () => ({ routines: [] }),
    'GET /prompts': () => ({ prompts: [] }),
    'GET /ideas': () => ({ items: [] }),
    'GET /herdr/sessions': () => ({ installed: false, sessions: [] }),
    'GET /push/devices': () => [],
    'GET /phone': () => ({ installed: false, state: null, running: false, name: null }),
    'GET /mcp': () => ({ servers: [] }),
    'POST /presence': () => ({ ok: true }),
  }

  async function request({ method, path, query, body }) {
    await ready
    const route = path.replace(/\/$/, '') || '/'
    const out = await cloudReq(method, route, query, body)
    if (out !== NOT_CLOUD) return out
    if (method === 'GET' && route === '/search') { const results = cloud.search(query.get('q')); return { results, total: results.length } }
    if (method === 'GET' && /^\/(dirs|repo)$/.test(route)) return route === '/dirs' ? { exists: false, path: '', dirs: [] } : { repo: null }
    const fn = routes[`${method} ${route}`]
    if (fn) return fn()
    return fail(NOT_HERE, 501)
  }
  function stream(path, send) {
    if (path.split('?')[0] !== '/events') return null
    listeners.add(send)
    ready.then(() => send(fleet(), 'fleet'))
    return () => listeners.delete(send)
  }
  return { request, stream, cloud, ready, flush, fleet }
}
