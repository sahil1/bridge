// What a meeting's action items turn into. Each one can start an agent in the project it's about,
// on its own branch, told what was said about it; or go on Chief of Staff's task list. What became
// of them (the agent working, waiting on you, its pull request; the task's state and outcome) shows
// under each item, and before the next meeting in the same series, with the same people or the same
// customer, as "since last time".
//
// What's kept: meeting.json's `work`, by the item's key (meetings.setWork). Nothing here looks in
// your folders: the projects come from projects.js's list, the agents from the fleet, pull requests
// from pr.js (gh, asked without waiting on the server), so a meeting page never brings up macOS's
// question about a folder.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as meetings from './meetings.js'
import * as memory from './meetmemory.js'

let cfg = {}
export const configure = (c) => { cfg = c || {} }
// fleet(): the agents now; projects(): yours; tasks(): Chief of Staff's list; pr(dir, branch): the
// pull request for a branch (null: the one dir is on); launch(body): an agent started as New agent
// does.
// tree(folder): the repo and branch of a worktree Bridge AI made; kindLabel(kind): "Claude Code".
let helpers = { fleet: async () => null, projects: async () => [], tasks: () => ({ items: [] }), pr: async () => null, tree: () => null, kindLabel: (k) => k, launch: async () => { throw new Error('Agents can\'t start here') } }
export const setHelpers = (h) => { helpers = { ...helpers, ...h } }

// ---------- The items ----------
const plain = (s) => String(s || '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim()
const norm = (s) => plain(s).replace(/[.;,!]+$/, '').toLowerCase()
export const keyOf = (text) => crypto.createHash('sha1').update(norm(text)).digest('hex').slice(0, 10)
// "Priya: fix the login bug" -> who "Priya", what "fix the login bug". No name: it's yours.
function owner(text) {
  const m = /^\s*(?:\*\*)?([^:*\n]{1,40}?)(?:\*\*)?\s*:\s+(.+)$/.exec(plain(text))
  return m && !/^https?$/i.test(m[1]) ? { who: m[1].trim(), what: m[2].trim() } : { who: null, what: plain(text) }
}
const mine = (who) => !who || /^(you|me|i|myself|us|we)$/i.test(who) || (!!String(cfg.name || '').trim() && meetings.sameName(who, cfg.name))

// The action items in a summary: "- [ ] Who: what" ([x] once ticked in the notes) under ## Action
// items, else the first heading with a checklist (notes in another language), as meetings.actions
// finds them.
export function itemsIn(summary) {
  const parts = String(summary || '').split(/\n(?=##\s)/)
  const section = parts.find((x) => /^\s*##\s*Action items/i.test(x)) || parts.find((x) => /^\s*##\s/.test(x) && /^\s*[-*]\s*\[[ xX]\]/m.test(x))
  if (!section) return []
  return [...section.matchAll(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/gm)].map((x, n) => {
    const text = x[2].trim()
    const o = owner(text)
    return { n, key: keyOf(text), text, who: o.who, what: o.what, yours: mine(o.who), ticked: x[1] !== ' ' }
  })
}

// Words, for matching an item with what was said and a summary rewritten since: an item's work
// follows it when its words barely changed.
const STOP = new Set('the a an and or but for with from into over under to of in on at by as is are was were be been it its this that these those we our us i my me you your he she they them their his her if then than so not no all any each some more most other such only own same very can will just also about after before during while when where which who what why how here there should would could need needs make sure get got going next week friday monday tuesday wednesday thursday today tomorrow'.split(' '))
const termsOf = (s) => [...new Set((String(s || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'_-]+/gu) || []).filter((w) => w.length > 2 && !STOP.has(w)))]
const like = (a, b) => { const x = new Set(termsOf(a)), y = new Set(termsOf(b)); if (!x.size || !y.size) return 0; let n = 0; for (const w of x) if (y.has(w)) n++; return n / (x.size + y.size - n) }
function withWork(items, work = {}) {
  const left = new Map(Object.entries(work || {}))
  const out = items.map((it) => { const w = left.get(it.key); if (w) left.delete(it.key); return { ...it, work: w || null, workKey: w ? it.key : null } })
  for (const it of out.filter((x) => !x.work)) {
    let best = null
    for (const [k, w] of left) { const s = like(it.text, w.text || ''); if (s >= 0.6 && (!best || s > best.s)) best = { k, w, s } }
    if (best) { left.delete(best.k); Object.assign(it, { work: best.w, workKey: best.k }) }
  }
  return out
}

// ---------- The project an item is about ----------
// A project's name as it's said: "payments-api", "payments api", "PaymentsAPI".
const nameRe = (name) => {
  const words = String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (!words.length || words.join('').length < 3) return null
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s._-]*')}(?![\\p{L}\\p{N}])`, 'giu')
}
const count = (re, text) => (re ? (String(text || '').match(re) || []).length : 0)
// A project goes by its name ("example/payments-api" from its GitHub remote), the part after the
// owner, and its folder's name.
const namesOf = (p) => [...new Set([p.name, String(p.name || '').split('/').pop(), path.basename(String(p.path || ''))].filter(Boolean))].map(nameRe).filter(Boolean)
const mentions = (res, text) => Math.max(0, ...res.map((re) => count(re, text)))
const withoutItems = (summary) => String(summary || '').split(/\n(?=##\s)/).filter((x) => !/^\s*##\s*Action items/i.test(x)).join('\n')

// Your projects in the order an item likely belongs to them, each with why: named in the item, in
// the meeting's name, in the notes, said in the meeting, used for this meeting (or the one before)
// already, or where you worked last. Top three.
export async function suggest(m, item, { said = '', notes = '', summary = '', before = [] } = {}) {
  const list = await helpers.projects().catch(() => [])
  const used = new Map()
  for (const w of [...Object.values(m.work || {}), ...before]) if (w?.agent?.project) used.set(w.agent.project, (used.get(w.agent.project) || 0) + 1)
  const out = list.map((p, i) => {
    const re = namesOf(p)
    const why = []
    let score = 0
    if (mentions(re, item.text)) { score += 10; why.push('item') }
    if (mentions(re, `${m.title} ${m.event?.title || ''}`)) { score += 5; why.push('title') }
    if (mentions(re, `${withoutItems(summary)}\n${notes}`)) { score += 3; why.push('notes') }
    const n = mentions(re, said)
    if (n) { score += Math.min(5, n); why.push(n === 1 ? 'said' : `said:${n}`) }
    if (used.has(p.path)) { score += 4; why.push('before') }
    if (i === 0) score += 0.5 // the list is newest work first
    return { path: p.path, name: p.name, short: p.short, git: !!p.git, score, why: why.length ? why : i === 0 ? ['last'] : [] }
  })
  return out.filter((x) => x.why.length).sort((a, b) => b.score - a.score).slice(0, 3)
}

// ---------- What the agent is told ----------
const clock = (s) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600); const mm = Math.floor((t % 3600) / 60); const ss = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}` }
// The stretch of the transcript about an item: the lines sharing the most of its words, with two
// before and after each, in order, up to about 2,500 characters.
export function excerpt(lines, item, me = 'You', max = 2500) {
  const ws = termsOf(item.what || item.text)
  if (!ws.length) return ''
  const said = lines.filter((l) => l.text)
  const hits = said.map((l, i) => {
    const low = l.text.toLowerCase()
    return { i, n: ws.filter((w) => low.includes(w.length > 5 ? w.slice(0, w.length - 2) : w)).length }
  }).filter((x) => x.n >= (ws.length <= 2 ? 1 : 2)).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 3)
  if (!hits.length) return ''
  const pick = new Set()
  for (const h of hits) for (let j = Math.max(0, h.i - 2); j <= Math.min(said.length - 1, h.i + 2); j++) pick.add(j)
  const out = []
  let size = 0
  let last = -2
  for (const j of [...pick].sort((a, b) => a - b)) {
    const l = said[j]
    const row = `${j > last + 1 && out.length ? '…\n' : ''}[${clock(l.t0)}] ${l.name || (l.src === 'them' ? 'Them' : me)}: ${l.text}`
    if (size + row.length > max) break
    out.push(row)
    size += row.length + 1
    last = j
  }
  return out.join('\n')
}
const sectionOf = (summary, re) => { const part = String(summary || '').split(/\n(?=##\s)/).find((x) => re.test(x)); return part ? part.replace(/^\s*##[^\n]*\n/, '').trim() : '' }

// The first message for an agent started on an item: the item, who it's from, what was said about
// it, what the meeting decided, and where its notes are.
export function brief(m, item, { lines = [], summary = '' } = {}) {
  const me = String(cfg.name || '').trim() || 'You'
  const people = (m.event?.attendees || []).filter((p) => !meetings.sameName(p, me))
  const when = new Date(m.startedAt).toDateString()
  const ex = excerpt(lines, item, me)
  const decided = sectionOf(summary, /^\s*##\s*Decisions/i).slice(0, 1500)
  return [
    `This comes from my meeting "${m.title}" on ${when}${people.length ? ` with ${people.slice(0, 8).join(', ')}` : ''}. One of its action items is for you:`,
    `> ${plain(item.text)}`,
    ex && `What was said about it (from the transcript; speech to text can mishear names):\n${ex}`,
    decided && `What the meeting decided:\n${decided}`,
    m.saved && `The meeting's notes, if you need more: ${m.saved}`,
    'Work on it here. If what\'s wanted isn\'t clear enough to start, ask me first. When you\'re done, say what you changed.',
  ].filter(Boolean).join('\n\n')
}
// A short name for the agent's tab and branch: the item's first words, without who it's for.
export const labelOf = (item) => {
  const w = plain(item.what || item.text).replace(/\s*\([^)]*\)\s*$/, '').replace(/[.:;,]+$/, '').split(' ')
  const s = w.slice(0, 7).join(' ')
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 50) || 'Action item'
}

// ---------- One meeting's items, and what became of them ----------
const read = (id) => meetings.get(id)
export function itemsOf(id) {
  const m = read(id)
  return { m, items: withWork(itemsIn(m.summary), m.work) }
}
// The item and what's needed to start an agent on it: the projects it's likely about, the agent
// kind you start by default, and what it would be told.
export async function prepare(id, key) {
  const { m, items } = itemsOf(id)
  const item = items.find((x) => x.key === key || x.workKey === key)
  if (!item) throw new Error('That action item isn\'t in the summary any more')
  const lines = m.transcript || []
  const before = lastOf(m)?.items || []
  const projects = await suggest(m, item, { said: lines.map((l) => l.text).join('\n'), notes: m.notes, summary: m.summary, before: before.map((x) => x.work).filter(Boolean) })
  return { item: { key: item.key, text: item.text, who: item.who, yours: item.yours }, projects, label: labelOf(item), prompt: brief(m, item, { lines, summary: m.summary }) }
}

// Start an agent on it: in cwd (a project), on its own branch unless own is false, in a space
// named after the meeting (so a series' agents are together), told prompt (what prepare wrote,
// or your edit of it). The item keeps the agent, to show what became of it.
export async function start(id, key, { cwd, kind, own = true, prompt, label } = {}) {
  const prep = await prepare(id, key)
  if (!String(cwd || '').trim()) throw new Error('Pick the project it\'s for')
  const m = read(id)
  const fleet = await helpers.fleet().catch(() => null)
  const space = String(m.title || 'Meeting').slice(0, 60)
  const ws = (fleet?.workspaces || []).find((w) => w.label === space)
  const name = String(label || prep.label).trim().slice(0, 60) || prep.label
  const text = String(prompt || '').trim() || prep.prompt
  const out = await helpers.launch({ kind, cwd, label: name, prompt: text, ownBranch: own !== false, ...(ws ? { workspaceId: ws.id } : { newSpace: space }) })
  const project = (await helpers.projects().catch(() => [])).find((p) => p.path === path.resolve(String(cwd).replace(/^~(?=$|\/)/, process.env.HOME || ''))) || null
  const agent = {
    paneId: out.paneId, kind: kind || cfg.defaultAgent || 'claude', label: name, at: new Date().toISOString(),
    cwd: out.worktree?.folder || out.cwd || cwd, project: project?.path || null, projectName: project?.name || path.basename(String(cwd).replace(/[\\/]+$/, '')),
    ...(out.worktree ? { folder: out.worktree.folder, branch: out.worktree.branch, base: out.worktree.base, repo: helpers.tree(out.worktree.folder)?.repo || null } : {}),
  }
  meetings.setWork(id, prep.item.key, { text: prep.item.text, agent })
  return { ...out, agent }
}

// What became of an item: the agent (working, needs you, finished, closed; its pull request) and
// Chief of Staff's task (open, doing, waiting on you with what for, done with its outcome).
// state: done, needs (you), working, review (finished, or a pull request open) or open.
async function stateOf(w, fleet, tasks) {
  const out = { done: w?.done || null, agent: null, chief: null }
  if (w?.agent) {
    const a = w.agent
    const live = (fleet?.agents || []).find((x) => x.paneId === a.paneId && (!a.folder || x.worktree?.folder === a.folder)) || (a.folder && (fleet?.agents || []).find((x) => x.worktree?.folder === a.folder)) || null
    out.agent = { ...a, paneId: live?.paneId || a.paneId, live: !!live, status: live ? live.status : 'closed', title: live?.title || null, kindLabel: live?.kindLabel || helpers.kindLabel(a.kind) }
    if (a.branch) {
      // The worktree while it's there (it's in Bridge AI's data folder); once tidied away, the repo
      // with the branch named.
      const dir = a.folder && fs.existsSync(a.folder) ? a.folder : a.repo || a.project
      const pr = dir ? await helpers.pr(dir, a.folder && fs.existsSync(a.folder) ? null : a.branch).catch(() => null) : null
      if (pr?.pr) out.agent.pr = pr.pr
    }
  }
  if (w?.chief) {
    const t = (tasks || []).find((x) => x.id === String(w.chief.task))
    out.chief = { ...w.chief, status: t ? t.status : 'gone', outcome: t?.outcome || null, needs: t?.needs || null, link: t?.link || null }
  }
  const pr = out.agent?.pr
  // A task gone from the list was done long ago (the list keeps the last 40 done); an agent closed
  // with no pull request open is finished with.
  out.state = out.done || pr?.state === 'MERGED' || ['done', 'gone'].includes(out.chief?.status) || (out.agent && !out.agent.live && pr?.state !== 'OPEN') ? 'done'
    : out.agent?.status === 'blocked' || out.chief?.status === 'waiting' || (pr?.state === 'OPEN' && pr.checks?.fail) ? 'needs'
      : out.agent?.status === 'working' || out.chief?.status === 'doing' ? 'working'
        : pr?.state === 'OPEN' || ['done', 'idle'].includes(out.agent?.status) ? 'review'
          : 'open'
  return out
}
const tally = (items) => {
  const c = { all: items.length, done: 0, needs: 0, working: 0, review: 0, open: 0, prs: 0, agents: 0, chief: 0 }
  for (const x of items) {
    c[x.state]++
    if (x.agent) c.agents++
    if (x.chief) c.chief++
    if (x.agent?.pr?.state === 'OPEN') c.prs++
  }
  return c
}
async function described(items) {
  const fleet = await helpers.fleet().catch(() => null)
  const tasks = (() => { try { return helpers.tasks().items || [] } catch { return [] } })()
  return Promise.all(items.map(async (it) => ({ key: it.key, text: it.text, who: it.who, yours: it.yours, ticked: it.ticked, ...(await stateOf(it.work, fleet, tasks)) })))
}
export async function work(id) {
  const { items } = itemsOf(id)
  const out = await described(items)
  return { items: out, counts: tally(out) }
}
// Ticked (or unticked) by you: counted as done, wherever it went.
export function tick(id, key, on) {
  const { items } = itemsOf(id)
  const it = items.find((x) => x.key === key || x.workKey === key)
  if (!it) throw new Error('That action item isn\'t in the summary any more')
  meetings.setWork(id, it.workKey || it.key, { text: it.text, done: on ? new Date().toISOString() : null })
  return { ok: true }
}
// The items that haven't gone anywhere yet: no agent, no task, not ticked. What Send action items
// to Chief of Staff sends, so one already handed on isn't handed on twice.
export function unsent(id) {
  try { return itemsOf(id).items.filter((x) => !x.ticked && !x.work?.agent && !x.work?.chief && !x.work?.done).map((x) => x.text) } catch { return [] }
}
// Sent to Chief of Staff: each item keeps its task's number, so what it did with it shows.
export function sentToChief(id, pairs) {
  let items = []
  try { items = itemsOf(id).items } catch { return }
  for (const { text, task } of pairs) {
    const it = items.find((x) => norm(x.text) === norm(text)) || items.find((x) => like(x.text, text) >= 0.6)
    if (it) meetings.setWork(id, it.workKey || it.key, { text: it.text, chief: { task: String(task.id), at: new Date().toISOString() } })
  }
}

// ---------- Since last time ----------
// The meeting before one (or before a calendar event about to start) that it follows on from: the
// same series (its name, without dates and numbers), else the same people, else the same customer
// (an email domain they share, or a customer in meeting memory both are about). Within 120 days,
// with a summary, newest first.
const GENERIC = new Set(['meeting', 'call', 'untitled', 'sync', 'chat', 'catch up', 'catchup', 'notes', 'recording', 'new meeting'])
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/gi
export const seriesOf = (title) => {
  const s = String(title || '').toLowerCase().replace(MONTHS, ' ').replace(/\d+(st|nd|rd|th)?/g, ' ').replace(/[^\p{L}\s&+]/gu, ' ').replace(/\s+/g, ' ').trim()
  return s.length < 4 || GENERIC.has(s) ? null : s
}
const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|fastmail|hey|zoho|yandex|mail|qq|163)\./i
const domainOf = (p) => { const d = /@([\w.-]+\.[a-z]{2,})\s*>?$/i.exec(String(p || ''))?.[1]?.toLowerCase(); return d && !FREE_MAIL.test(d) ? d : null }
// Your own organisation's domains aren't a customer: Settings' mail domains, and the one most of
// your meetings have people from (in three or more, and at least two in five of those with any).
function ownDomains(all) {
  const out = new Set((cfg.mail?.myDomains || []).map((d) => String(d).toLowerCase().replace(/^@/, '')))
  const seen = new Map()
  let withAny = 0
  for (const m of all) {
    const ds = new Set((m.event?.attendees || []).map(domainOf).filter(Boolean))
    if (ds.size) withAny++
    for (const d of ds) seen.set(d, (seen.get(d) || 0) + 1)
  }
  for (const [d, n] of seen) if (n >= 3 && n / withAny >= 0.4) out.add(d)
  return out
}
const others = (people) => { const me = String(cfg.name || '').trim(); return [...new Set([].concat(people || []).map(String).filter(Boolean))].filter((p) => !me || !meetings.sameName(p, me)) }
function samePeople(a, b) {
  const x = others(a), y = others(b)
  if (!x.length || !y.length) return false
  const both = x.filter((p) => y.some((q) => meetings.sameName(p, q))).length
  return both / (x.length + y.length - both) >= 0.6
}
const CUSTOMER = /\b(customer|client|prospect|partner|account|buyer|vendor|supplier)\b/i
const OURS = /\b(my|our)\s+(company|team|employer)\b/i
function customers(about, ours = new Set()) {
  const text = ` ${String(about.title || '')} `.toLowerCase()
  const doms = new Set(others(about.people).map(domainOf).filter((d) => d && !ours.has(d)))
  const out = new Set([...doms].map((d) => `@${d}`))
  for (const t of memory.list()) {
    if (!CUSTOMER.test(t.note || '') || OURS.test(t.note || '')) continue
    const re = nameRe(t.term)
    if ((re && count(re, text)) || (about.id && (t.meetings || []).includes(about.id))) out.add(t.term.toLowerCase())
  }
  return out
}
export function lastOf(target) {
  const at = Date.parse(target.startedAt || target.start || '') || Date.now()
  const about = { id: target.id || null, title: target.title || target.event?.title || '', people: target.event?.attendees || target.attendees || [] }
  const series = seriesOf(about.title) || seriesOf(target.event?.title)
  const every = meetings.list()
  const ours = ownDomains(every)
  const theirs = customers(about, ours)
  const all = every.filter((x) => x.id !== about.id && !x.archived && x.hasSummary && Date.parse(x.startedAt) < at - 60_000 && at - Date.parse(x.startedAt) < 120 * 86400e3)
  const pick = (why, test) => { const m = all.find(test); return m ? { m, why } : null }
  const found = (series && pick('series', (x) => seriesOf(x.title) === series || seriesOf(x.event?.title) === series))
    || pick('people', (x) => samePeople(about.people, x.event?.attendees))
    || (theirs.size ? pick('customer', (x) => { const c = customers({ id: x.id, title: `${x.title} ${x.event?.title || ''}`, people: x.event?.attendees }, ours); return [...c].some((k) => theirs.has(k)) }) : null)
  if (!found) return null
  let items = []
  try { items = itemsOf(found.m.id).items } catch { /* gone */ }
  return { ...found, items, customer: found.why === 'customer' ? [...theirs][0]?.replace(/^@/, '') : null }
}
export async function since(target) {
  const last = lastOf(target)
  if (!last) return { last: null }
  const items = await described(last.items)
  return { last: { id: last.m.id, title: last.m.title, startedAt: last.m.startedAt, why: last.why, customer: last.customer, chief: last.m.chief || null }, items, counts: tally(items) }
}
