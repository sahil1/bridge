// What runs where, for the agent map (src/components/AgentMap.jsx): each agent on this computer
// with what it's doing, how long it has run and been in its state, its model and account, the
// Chief of Staff thread that handed it its work, and the subagents it has going. Your other devices
// send the same with their agents (machines.js summary), so the map shows every computer's, and a
// computer that's offline shows what it last said.
//
// When each agent started and since when it's been working, waiting or done are noted as the fleet
// goes by (every second or two while someone watches, every 30 seconds otherwise) and kept in the
// cache folder (agent-runs.json), so a restart doesn't make every agent look new.
import fs from 'node:fs'
import path from 'node:path'
import { cacheFile, writeFileAtomic } from './paths.js'
import { preview, modelOf, locate } from './transcripts.js'
import { listSubagents } from './subagents.js'
import { nameOf, projectOf } from './needsyou.js'

const FILE = cacheFile('agent-runs.json')
const GONE_MS = 15 * 60 * 1000 // an agent missing this long has ended
// What it's doing and its subagents are looked at again after a few seconds while it works (an
// agent that isn't working says nothing new until its state changes); its model once a minute.
const LOOK_MS = 8000
const IDLE_MS = 60000
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
const keyOf = (a) => `${a.paneId}|${a.kind}|${a.cwd || a.cloud?.repo || ''}`

export function make({ rt, cfg = {} }) {
  let runs = {} // key -> { start, status, at, last }
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d && typeof d === 'object') runs = d } catch { /* none yet */ }
  let saved = Date.now()
  let dirty = false
  const save = (now) => {
    if (!dirty && now - saved < 60000) return
    saved = now
    dirty = false
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomic(FILE, JSON.stringify(runs)) } catch { /* next time */ }
  }

  // The fleet as it goes by: new agents, and changes of state.
  function observe(agents, now = Date.now()) {
    for (const a of agents || []) {
      if (!a?.paneId || a.kind === 'shell') continue
      const k = keyOf(a)
      const r = runs[k]
      if (!r) {
        const began = Date.parse(a.cloud?.startedAt || '') || now
        runs[k] = { start: Math.min(began, now), status: a.status, at: now, last: now }
        dirty = true
      } else {
        if (r.status !== a.status) { r.status = a.status; r.at = now; dirty = true }
        r.last = now
      }
    }
    for (const [k, r] of Object.entries(runs)) if (now - r.last > GONE_MS) { delete runs[k]; dirty = true }
    save(now)
  }

  // What's slow to find out about one agent (its last words or tool, its model, its subagents),
  // kept for a few seconds so a map watched on several screens reads each once.
  const looked = new Map() // paneId -> { at, key, v }
  const models = new Map() // paneId -> { at, key, model }
  function modelFor(a) {
    if (a.cloud) return null
    const key = a.sessionId || ''
    const hit = models.get(a.paneId)
    if (hit && hit.key === key && Date.now() - hit.at < IDLE_MS) return hit.model
    let model = null
    try { const m = modelOf(a); model = m?.switched?.model || m?.reply?.model || null } catch { /* no transcript */ }
    model ||= a.model || cfg.agents?.[a.kind]?.model || null
    models.set(a.paneId, { at: Date.now(), key, model })
    return model
  }
  async function look(a, cloudSaid) {
    const key = `${a.seq}|${a.sessionId || ''}|${a.status}`
    const hit = looked.get(a.paneId)
    if (hit && hit.key === key && Date.now() - hit.at < (a.status === 'working' ? LOOK_MS : IDLE_MS)) return { ...hit.v, model: modelFor(a) }
    let p = null
    if (a.cloud) p = cloudSaid?.[a.paneId] || null
    else { try { p = preview(a) } catch { /* no transcript */ } }
    const model = modelFor(a)
    // Subagents only show while it works (Claude Code's, from its logs and its footer).
    let subagents = null
    if (a.status === 'working' && a.caps?.subagents && a.sessionId) {
      try {
        const screen = await rt.read(a.paneId, 60).catch(() => '')
        const s = await listSubagents(locate(a.kind, a.sessionId, a.cwd), screen)
        const on = (s.items || []).filter((i) => i.status === 'running')
        subagents = on.length ? { count: on.length, items: on.slice(0, 4).map((i) => ({ title: clip(i.description, 80), type: i.type || null })) } : null
      } catch { /* its logs aren't readable now */ }
    }
    const v = { doing: p ? { text: clip(p.text, 140) || null, tool: a.status === 'working' && p.tool ? clip(p.tool, 100) : null, at: p.ts || null } : null, model, subagents }
    looked.set(a.paneId, { at: Date.now(), key, v })
    return v
  }

  // This computer's agents for the map (and for your other devices' maps), from a fleet
  // (index.js fleetView).
  async function agents(f, { cloudSaid = null } = {}) {
    const list = (f?.agents || []).filter((a) => a.kind !== 'shell')
    observe(list)
    for (const m of [looked, models]) for (const k of m.keys()) if (!list.some((a) => a.paneId === k)) m.delete(k)
    // The Chief of Staff's threads, by id, for who handed an agent its work.
    const threads = Object.fromEntries(list.filter((a) => a.chief && a.thread?.id).map((a) => [a.thread.id, a.thread.main ? 'Main' : a.thread.name]))
    return Promise.all(list.slice(0, 40).map(async (a) => {
      const r = runs[keyOf(a)]
      const v = await look(a, cloudSaid)
      return {
        paneId: a.paneId, title: a.title, name: nameOf(a), status: a.status, kind: a.kind, kindLabel: a.kindLabel, chief: !!a.chief,
        thread: a.thread ? { id: a.thread.id, name: a.thread.main ? 'Main' : a.thread.name, main: !!a.thread.main } : null,
        from: (a.chiefThreads || []).map((id) => threads[id] || null).filter(Boolean),
        project: projectOf(a), branch: a.cloud?.branch || a.worktree?.branch || null, workspace: a.workspace || null,
        model: v.model, account: a.account || null, chat: !!a.plainChat,
        cloud: a.cloud ? { label: a.cloud.label, repo: a.cloud.repo || null, prUrl: a.cloud.prUrl || null, state: a.cloud.state || null, failed: !!a.cloud.failed } : null,
        asking: a.asking ? clip(a.asking.title, 140) : a.cloud?.ask ? clip(a.cloud.ask, 140) : null,
        doing: v.doing, subagents: v.subagents,
        since: r ? new Date(r.start).toISOString() : null, statusSince: r ? new Date(r.at).toISOString() : null,
      }
    }))
  }
  return { observe, agents }
}
