// Following cloud agents: the ones you started, checked on gently, their place in the fleet, and
// what you can do with them (follow-ups, held ones, stop, approve). Shared by Bridge AI's server
// (server/cloud.js) and the phone apps' Cloud agents (src/cloud), which each keep the keys and the
// list their own way. Plain JS with timers: no Node or browser APIs.
//
//   follow({ tasks, client, saved, save, place }) -> f
//     tasks: the agents being followed, as saved ([{ provider, id, title, status, ... }])
//     client(provider): its adapter (index.js connect), or null when there's no key for it
//     saved(slot): { set: true, last4 } for a key in that slot ('cursor', 'claude.github'...), else null
//     save(): something in f.tasks() changed, keep it
//     place: where the app keeps keys, for what it says ({ keys: 'in Bridge AI', settings: 'Settings › …' })
//   f.on({ change, watched }): change() when the fleet should be sent again; watched() while
//     someone is looking (finished agents are checked more often then)
import { ADAPTERS, PROVIDERS } from './index.js'

export const SPACE = { id: 'cloud', label: 'Cloud' }
const PREFIX = 'cloud:'
const DAY = 24 * 3600 * 1000
const infoOf = (id) => ADAPTERS[id].info
export const paneOf = (t) => `${PREFIX}${t.provider}:${t.id}`
export const isCloud = (pane) => String(pane || '').startsWith(PREFIX)
const last4 = (k) => (k.length >= 16 ? k.slice(-4) : '')
export const keyView = (k) => (k ? { set: true, last4: last4(k) } : null)
const err = (message, status) => Object.assign(new Error(message), { status })

// ---------- Status in the fleet ----------
// A finished agent is "done" until you've looked at it, then idle, like a local one. Failed ones
// count as done (so you hear about them) and say so.
export const fleetStatus = (t) => (t.status === 'working' || t.status === 'blocked' ? t.status : (t.status === 'done' || t.status === 'failed') && !t.seen ? 'done' : 'idle')

// Fold what the provider said into our record. Returns whether anything shown changed.
export function apply(t, fresh) {
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
  // seq: a new state, or a new question while it's still waiting, is news (notifications).
  if (fleetStatus(t) !== JSON.parse(before)[0] || (t.status === 'blocked' && t.ask !== JSON.parse(before)[5])) t.seq = (t.seq || 0) + 1
  return true
}

export function follow({ tasks: initial = [], client, saved, save = () => {}, place = {} }) {
  const where = { keys: 'in Bridge AI', settings: 'Settings › Model Providers', ...place }
  let tasks = initial.filter((t) => ADAPTERS[t?.provider] && t.id)
  const has = (id) => !!(ADAPTERS[id] && saved(id))
  let onChange = () => {}
  let watched = () => true
  const find = (pane) => {
    const m = String(pane || '').match(/^cloud:([a-z]+):(.+)$/)
    return m ? tasks.find((t) => t.provider === m[1] && t.id === m[2]) || null : null
  }

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

  // ---------- Polling ----------
  // Quick while an agent works, slower while it waits on you, every few minutes for ones that
  // finished in the last couple of days (a follow-up could have come from the provider's own
  // page), and not at all for older ones. One provider's errors don't hold up the others.
  const known = new Map() // pane -> the adapter's last full answer (not saved)
  const timers = new Map()
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
    // A poll that throws must never take the app down: note it and look again later.
    timers.set(id, setTimeout(() => tick(id).catch((e) => { noteError(id, e); schedule(id, 60_000) }), Math.max(500, ms)))
  }
  // Look again soon: at one agent (after you sent it something), or at all of a provider's agents
  // that are still being followed (after its key was saved, or a restart).
  function soon(id, ms = 2500, only = null) {
    if (!has(id)) return
    for (const t of tasks) if (t.provider === id && (only ? t === only : Number.isFinite(t.nextAt ?? 0))) t.nextAt = Math.min(t.nextAt ?? Infinity, Date.now() + ms)
    schedule(id, ms)
  }
  // once: one look at each agent that's due, with no next look planned (the phone's background check).
  async function tick(id, { once = false } = {}) {
    timers.delete(id)
    const c = client(id)
    const h = healthOf(id)
    if (!c || h.rejected) return
    if (Date.now() < h.until) return once ? undefined : schedule(id, h.until - Date.now())
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
    if (once) return
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

  // ---------- The fleet ----------
  // Cloud agents go in their own "Cloud" space, after your spaces. Only providers with a key.
  function fleetAgents({ isMuted = () => false } = {}) {
    return tasks.filter((t) => has(t.provider)).map((t) => {
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
  // The Cloud space's entry in the fleet's workspaces.
  const space = (list) => ({ ...SPACE, status: ['blocked', 'working', 'done', 'idle'].find((s) => list.some((a) => a.status === s)) || 'idle' })
  // Board previews: the last thing it said.
  const previews = () => Object.fromEntries(tasks.filter((t) => has(t.provider)).map((t) => [paneOf(t), t.summary ? { text: t.summary, role: 'assistant', tool: null, ts: t.summaryTs || t.updatedAt || null } : null]))

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
    if (!c) throw new Error(`No ${infoOf(t.provider).name} key ${where.keys}. Add it in ${where.settings}.`)
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
  // An agent's view, with its conversation; the last one known when the provider can't be reached.
  async function open(t, { fresh = false } = {}) {
    let d = null
    try { d = await detail(t, { fresh }) } catch (e) { noteError(t.provider, e); if (!known.get(paneOf(t))) throw e; d = known.get(paneOf(t)) }
    return view(t, d)
  }

  // ---------- Search ----------
  // Conversations you've opened are remembered for a while, so search finds cloud agents by what
  // they said, as well as by name and repo.
  function search(q) {
    const needle = String(q || '').trim().toLowerCase()
    if (needle.length < 2) return []
    const out = []
    for (const t of tasks.filter((x) => has(x.provider))) {
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
      const at = `${t.repo || ''} ${t.branch || ''} ${infoOf(t.provider).name}`.toLowerCase()
      if (!hits.length && !at.includes(needle)) continue
      // kind: the provider, for its logo in History; sessionId keys the row there.
      out.push({ kind: t.provider, provider: t.provider, sessionId: paneOf(t), paneId: paneOf(t), label: t.title, title: t.title, workspace: SPACE.label, cwd: t.repo ? `${infoOf(t.provider).name} · ${t.repo}` : infoOf(t.provider).name, hits, last: Date.parse(t.updatedAt || t.createdAt || 0) || 0 })
    }
    return out
  }

  // ---------- Keys ----------
  function providerView(id) {
    const i = infoOf(id)
    const h = healthOf(id)
    const key = saved(id)
    return {
      id, name: i.name, description: i.description, keyUrl: i.keyUrl, keyLabel: i.keyLabel, keyHint: i.keyHint, cost: i.cost, perUse: !!i.perUse,
      permissions: i.permissions || null, hosts: i.hosts || null, repoPlaceholder: i.repoPlaceholder || '', models: !!i.models, ghLogin: !!i.ghLogin,
      saved: key || null,
      github: i.github ? (saved(`${id}.github`) || { set: false, copilot: !!saved('copilot') }) : null,
      status: !key ? 'not set' : h.rejected ? 'rejected' : 'connected', error: key ? h.error : null, account: h.checked?.account || null,
      agents: tasks.filter((t) => t.provider === id).length,
    }
  }
  const providers = () => ({ providers: PROVIDERS.map((p) => providerView(p.id)) })
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
  // A key was saved or removed: start afresh with that provider (and stop looking, when removed).
  function reset(id, { stop = false } = {}) {
    health.delete(id)
    if (stop) clearTimeout(timers.get(id))
  }

  // ---------- What you do ----------
  const NO_LOCAL = (t) => `${infoOf(t.provider).name} runs this agent on its own computers, so there's no terminal or folder for it here.`
  async function send(t, text) {
    const body = String(text || '').trim()
    if (!body) throw new Error('Empty message')
    const c = client(t.provider)
    if (!c) throw new Error(`No ${infoOf(t.provider).name} key ${where.keys}`)
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
  async function stop(t) {
    const c = client(t.provider)
    if (!c?.stop) throw new Error(`${infoOf(t.provider).name} can't be stopped from here; open it on ${infoOf(t.provider).name}`)
    await c.stop(t.id)
    t.held = []
    details.delete(paneOf(t))
    soon(t.provider, 1500, t)
    save(); onChange()
    return { ok: true, stopped: true }
  }
  async function approve(t) {
    const c = client(t.provider)
    if (!c?.approve) throw new Error("This provider doesn't have plans to approve")
    await c.approve(t.id)
    t.status = 'working'; t.ask = null; t.seq = (t.seq || 0) + 1
    details.delete(paneOf(t))
    save(); onChange(); soon(t.provider, 2500, t)
    return { ok: true }
  }
  const seen = (t) => { if (!t.seen) { t.seen = true; save(); onChange() } return { ok: true } }
  const dropHeld = (t, id) => { t.held = (t.held || []).filter((x) => x.id !== id); save(); onChange(); return { ok: true } }
  // No longer followed here. The agent itself stays with the provider.
  function remove(t) {
    tasks = tasks.filter((x) => x !== t)
    known.delete(paneOf(t)); details.delete(paneOf(t))
    save(); onChange()
    return { ok: true }
  }
  // Forget every agent of a provider (the phone, when its key is removed).
  function forget(id) {
    for (const t of tasks.filter((x) => x.provider === id)) { known.delete(paneOf(t)); details.delete(paneOf(t)) }
    tasks = tasks.filter((x) => x.provider !== id)
    reset(id, { stop: true })
  }
  // { provider, repo, branch, prompt, model, approvePlan } -> { paneId }
  async function launch({ provider, repo, branch, prompt, model, approvePlan } = {}) {
    if (!ADAPTERS[provider]) throw new Error('Pick a provider')
    const c = client(provider)
    if (!c) throw new Error(`Add your ${infoOf(provider).name} key in ${where.settings} first`)
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
    onChange()
    soon(provider, 3000, t)
    return { paneId: paneOf(t) }
  }

  // The new agent dialog's pickers.
  const repoCache = new Map() // provider -> { at, list }
  async function repos(id, { refresh = false } = {}) {
    const c = client(id)
    if (!c) throw new Error('No key saved')
    const hit = repoCache.get(id)
    const every = infoOf(id).reposEvery || 5 * 60_000
    if (hit && (Date.now() - hit.at < every || !refresh) && hit.list) return { repos: hit.list, at: hit.at }
    try {
      const list = await c.repos()
      repoCache.set(id, { at: Date.now(), list })
      return { repos: list, at: Date.now() }
    } catch (e) {
      if (hit?.list) return { repos: hit.list, at: hit.at, error: e.message }
      throw e
    }
  }
  async function branches(id, repo) {
    const c = client(id)
    if (!c?.branches) return { branches: [] }
    return { branches: await c.branches(String(repo || '')).catch(() => []) }
  }
  async function models(id) {
    const c = client(id)
    return { models: c?.models ? await c.models().catch(() => []) : [] }
  }

  // The agent routes local agents use (Chat, the chief of staff's `bridge` helper, notifications),
  // answered for a cloud agent; everything about terminals and folders says why not.
  async function agentRoute(pane, method, what, body) {
    const t = find(pane)
    if (!t || !has(t.provider)) throw err(`No agent in pane ${pane}`, 404)
    const m = method
    if (m === 'GET' && what === 'transcript') return { supported: true, messages: (await detail(t)).messages || [], more: null }
    if (m === 'GET' && what === 'transcript/earlier') return { messages: [], more: null }
    if (m === 'GET' && what === 'question') return { text: t.ask || null }
    if (m === 'GET' && what === 'subagents') return { items: [] }
    if (m === 'GET' && what === 'commands') return []
    if (m === 'GET' && what === 'screen') return { ansi: [`${infoOf(t.provider).name} cloud agent · ${t.state || t.status}`, t.repo ? `${t.repo}${t.branch ? ` (${t.branch})` : ''}` : '', t.ask ? `Waiting on you: ${t.ask}` : t.summary || '', t.prUrl ? `Pull request: ${t.prUrl}` : ''].filter(Boolean).join('\n'), cols: null }
    if (m === 'POST' && (what === 'prompt' || what === 'queue' || what === 'steer')) return send(t, body?.text)
    if (m === 'POST' && what === 'focus') return seen(t)
    if (m === 'POST' && what === 'keys' && (body?.keys || []).join() === 'esc') return stop(t)
    throw err(NO_LOCAL(t), 400)
  }
  // An agent you act on: followed here, with its provider's key.
  const need = (pane) => {
    const t = find(pane)
    if (!t || !has(t.provider)) throw err('No such cloud agent', 404)
    return t
  }

  return {
    tasks: () => tasks,
    // The list as saved elsewhere since (the phone, after its background check).
    load(list) { tasks = (list || []).filter((t) => ADAPTERS[t?.provider] && t.id); details.clear() },
    on({ change, watched: w } = {}) { if (change) onChange = change; if (w) watched = w },
    // Start following: a first look at every provider with a key.
    start() { for (const id of Object.keys(ADAPTERS)) if (has(id)) soon(id, 1500) },
    // Stop every timer (the phone, while the app isn't showing).
    pause() { for (const [id, h] of timers) { clearTimeout(h); timers.delete(id) } },
    // One look at every agent due one now, without planning the next (the phone's background check).
    async once() { for (const id of Object.keys(ADAPTERS)) if (has(id)) await tick(id, { once: true }).catch((e) => noteError(id, e)) },
    soon, find, need, has, fleetAgents, space, previews, search, open, providerView, providers, check, reset, forget,
    send, stop, approve, seen, dropHeld, remove, launch, repos, branches, models, agentRoute, noteError,
  }
}
