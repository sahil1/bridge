// What needs you on this computer, for the needs-you inbox (src/components/NeedsYou.jsx): agents
// asking for permission or asking a question (the Chief of Staff's questions among them), runs that
// failed (a cloud agent's, or one stopped at a usage limit), and finished work to look over. Your
// other devices send theirs with their agents (machines.js summary), so the inbox lists everything
// that waits on you, wherever it runs, and each one is answered on the device it's on.
//
// An item is one wait: an agent's pane and its state counter (seq), which moves on whenever the
// agent stops waiting or starts again. So an answer is only ever typed into the question it was
// given for (checked against the question on its screen, as a notification's buttons are), and an
// item you clear stays cleared until that agent has something new.
//
// Kept in the cache folder (needs-you.json): what you cleared, and since when each item has waited.
import fs from 'node:fs'
import path from 'node:path'
import { cacheFile, writeFileAtomic } from './paths.js'
import { question, pick } from './notify.js'
import { preview } from './transcripts.js'

const FILE = cacheFile('needs-you.json')
const MAX = 60
// What a Claude Code or Codex agent says when it stops at its plan's usage limit.
const LIMIT = /\b(hit your (session|weekly|usage|5-hour) limit|usage limit reached|rate limit reached)\b/i
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }

// What the inbox calls an agent: its tab's name, as the sidebar does (on Windows its terminal's
// title can be the shell's, the same for every agent), else its title; and the project it works on.
export const nameOf = (a) => (a.chief ? (a.thread && !a.thread.main ? `Chief of Staff · ${a.thread.name}` : 'Chief of Staff')
  : (a.tab && !/^\d+$/.test(a.tab) ? a.tab : null) || a.title || a.kindLabel || 'Agent')
export function projectOf(a) {
  if (a.cloud) return a.cloud.repo ? base(a.cloud.repo) : null
  if (a.chief || a.plainChat) return null
  return base(a.worktree?.repo) || base(a.cwd) || null
}

// One agent's item, or null. q: what it's asking (notify.question, or its own words for a cloud
// agent or a question Codex asked); p: its last message (transcripts.preview).
export function itemOf(a, { q = null, p = null } = {}) {
  if (!a?.paneId || a.shellTab || a.kind === 'shell') return null
  const agent = {
    title: nameOf(a), kind: a.kind, kindLabel: a.kindLabel || a.kind, chief: !!a.chief, project: projectOf(a),
    branch: a.cloud?.branch || a.worktree?.branch || null, account: a.account || null, model: a.model || null,
    cloud: a.cloud ? a.cloud.label : null, workspace: a.workspace || null,
  }
  const head = { id: `${a.paneId}@${a.seq ?? 0}`, paneId: a.paneId, seq: a.seq ?? 0, agent }
  if (a.status === 'blocked') {
    if (a.cloud) {
      const approve = a.cloud.canApprove ? [{ n: 'approve', title: a.cloud.approveLabel || 'Approve' }] : null
      return { ...head, type: approve ? 'permission' : 'question', text: clip(a.cloud.ask, 300) || null, answers: approve, pr: a.cloud.prUrl || null }
    }
    if (a.asking) return { ...head, type: 'question', text: clip(a.asking.title, 300), count: a.asking.count || 1 }
    const yes = q?.simple?.length && /^yes\b/i.test(q.simple[0].title) && q.simple.some((o) => /^no\b/i.test(o.title))
    const [ask, about] = String(q?.text || '').split('\n')
    return { ...head, type: yes ? 'permission' : 'question', text: ask ? clip(ask, 300) : null, about: about ? clip(about, 200) : null, answers: q?.simple?.map((o) => ({ n: o.n, title: o.title })) || null, qid: q?.id || null }
  }
  if (a.status !== 'done') return null
  if (a.cloud?.failed) return { ...head, type: 'failed', text: clip(a.cloud.error, 300) || null, pr: a.cloud.prUrl || null }
  const said = clip(p?.text, 300)
  if (LIMIT.test(said)) return { ...head, type: 'failed', limit: true, text: said }
  return { ...head, type: 'review', text: said || null, pr: a.cloud?.prUrl || null }
}

// Most urgent first: what stops an agent until you answer (permission, then questions), then
// runs that failed, then finished work; within each, the one that has waited longest. newest: by
// when each began, newest first.
const RANK = { permission: 0, question: 1, failed: 2, review: 3 }
export const urgent = (i) => i.type === 'permission' || i.type === 'question'
export function order(items, by = 'urgent') {
  const at = (i) => Date.parse(i.since || 0) || 0
  return [...items].sort(by === 'newest' ? (x, y) => at(y) - at(x) : (x, y) => (RANK[x.type] ?? 9) - (RANK[y.type] ?? 9) || at(x) - at(y))
}

// What a device on an older Bridge AI says about its agents (no items of its own): who waits on
// you, with nothing to answer from here (opening it does), and what finished.
export function fromAgents(agents) {
  return (Array.isArray(agents) ? agents : []).map((a) => (a?.status === 'blocked' || a?.status === 'done'
    ? { id: `${a.paneId}@old`, paneId: a.paneId, seq: null, type: a.status === 'blocked' ? 'question' : 'review', text: null, answers: null, agent: { title: a.title || a.kindLabel || 'Agent', kind: a.kind, kindLabel: a.kindLabel || a.kind, chief: !!a.chief, project: null } }
    : null)).filter(Boolean)
}

export function make({ rt, fleet }) {
  let kept = { cleared: [], since: {} }
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); kept = { cleared: Array.isArray(d.cleared) ? d.cleared : [], since: d.since && typeof d.since === 'object' ? d.since : {} } } catch { /* none yet */ }
  let timer = null
  const save = () => { clearTimeout(timer); timer = setTimeout(() => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomic(FILE, JSON.stringify(kept)) } catch { /* next change */ } }, 500); timer.unref?.() }

  // What a waiting agent asks, read from its screen: kept for its wait, and looked at again every
  // few seconds (sooner while there's nothing to read yet: its screen may still be drawing).
  const asked = new Map() // `${paneId}@${seq}` -> { at, q }
  const said = new Map() // `${paneId}@${seq}` -> its last message, once it's done (it says no more until it starts again)
  async function questionOf(a) {
    if (a.cloud || a.asking) return null
    const key = `${a.paneId}@${a.seq}`
    const hit = asked.get(key)
    if (hit && Date.now() - hit.at < (hit.q ? 5000 : 1500)) return hit.q
    let q = null
    try { q = question(await rt.read(a.paneId, 60)) } catch { /* gone */ }
    asked.set(key, { at: Date.now(), q })
    return q
  }

  let last = { at: 0, items: null, p: null }
  async function build() {
    const f = await fleet()
    if (f.down) return []
    const out = []
    for (const a of f.agents || []) {
      if (a.status !== 'blocked' && a.status !== 'done') continue
      let p = null
      if (a.status === 'done' && !a.cloud) {
        const key = `${a.paneId}@${a.seq}`
        if (!said.has(key)) { try { said.set(key, preview(a)) } catch { said.set(key, null) } }
        p = said.get(key)
      }
      const it = itemOf(a, { q: a.status === 'blocked' ? await questionOf(a) : null, p })
      if (it) out.push(it)
    }
    const ids = new Set(out.map((i) => i.id))
    const now = new Date().toISOString()
    let dirty = false
    for (const i of out) if (!kept.since[i.id]) { kept.since[i.id] = now; dirty = true }
    for (const k of Object.keys(kept.since)) if (!ids.has(k)) { delete kept.since[k]; dirty = true }
    const cleared = kept.cleared.filter((k) => ids.has(k))
    if (cleared.length !== kept.cleared.length) { kept.cleared = cleared; dirty = true }
    for (const m of [asked, said]) for (const k of m.keys()) if (!ids.has(k)) m.delete(k)
    if (dirty) save()
    return order(out.filter((i) => !kept.cleared.includes(i.id)).map((i) => ({ ...i, since: kept.since[i.id] }))).slice(0, MAX)
  }
  // This computer's items. Asked for by the inbox, the top bar and your other devices at once, so
  // one look serves them all for a moment.
  function items() {
    if (last.p) return last.p
    if (last.items && Date.now() - last.at < 1000) return Promise.resolve(last.items)
    last.p = build().then((x) => { last = { at: Date.now(), items: x, p: null }; return x }, (e) => { last.p = null; throw e })
    return last.p
  }
  const forget = () => { last = { at: 0, items: null, p: null } }

  // An answer from the inbox: one of the question's simple answers, typed if it still asks that.
  // A cloud agent's plan is approved with its own provider (cloud.js).
  async function answer({ paneId, seq, qid, n }, { approve } = {}) {
    forget()
    if (n === 'approve' && approve) { await approve(paneId); return { ok: true, answered: 'approve' } }
    if (!paneId || !qid || n == null) return { ok: false, why: 'changed' }
    return pick(String(paneId), { seq: seq == null ? null : Number(seq), qid: String(qid), n: String(n) })
  }
  // Cleared: finished work you've looked at, or a failed run you've dealt with. It comes back
  // only when that agent has something new.
  function clear(id) {
    forget()
    const k = String(id || '')
    if (k && !kept.cleared.includes(k)) { kept.cleared.push(k); save() }
    return { ok: true }
  }
  return { items, answer, clear, forget }
}
