// Home (a trial feature, `home`): what needs you, what's ready to look at and what's coming up on
// this computer, in one list for Home (src/components/NeedsHome.jsx) and for your other devices'
// Home, which ask for it with this device's summary (machines.js). Each item says which of the
// three it belongs to (group), or none: Everything shows those too.
//
// - Needs you: the needs-you inbox's questions, permissions and failed runs (needsyou.js), and the
//   Chief of Staff's tasks that wait on you (chieftasks.js).
// - Ready to look at: finished work (with its pull request), a meeting's notes and the action items
//   not handed on yet, a whiteboard an agent drew or changed since you last looked at it, a task the
//   Chief of Staff finished with what came of it.
// - Coming up: the Chief of Staff's tasks, with the day each names if it names one (due). The
//   calendar's part (the next meetings, the brief, the files in an invite) comes from the calendar
//   the page already has; Home puts a task with a day among them, and the rest on its own list.
//
// One row per thing (tidy): the same task twice on the list (a meeting's action items handed on
// again) or on two of your computers is one row, and so is a cloud agent seen from both.
//
// Kept in the cache folder (home.json): when you last opened or saved each whiteboard.
import fs from 'node:fs'
import path from 'node:path'
import { cacheFile, writeFileAtomic } from './paths.js'

const FILE = cacheFile('home.json')
const DAY = 86400e3
// Cut at a whole word, so a title never ends in half of one.
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const c = t.slice(0, n); return `${(c.slice(0, c.lastIndexOf(' ')) || c).replace(/[\s,;:.-]+$/, '')}…` }
// A day alone (a task's added or done) is the start of that day here, not in Greenwich.
const iso = (v) => { const t = typeof v === 'number' ? v : /^\d{4}-\d\d-\d\d$/.test(v || '') ? +new Date(`${v}T00:00:00`) : Date.parse(v || ''); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null }
const within = (v, ms) => { const t = Date.parse(v || ''); return Number.isFinite(t) && Date.now() - t < ms }

// A needs-you item as Home has it: questions, permissions and failed runs need you; finished work
// is ready to look at. Also what a device that sends no Home of its own (an older Bridge AI, or one
// whose list hasn't come yet) is shown with. nid: its own id in the needs-you inbox (Clear takes it).
export const fromNeeds = (i) => ({ ...i, id: `agent:${i.id}`, nid: i.id, kind: 'agent', group: i.type === 'review' ? 'ready' : 'needs', at: i.since || null })

// The day a task names, as YYYY-MM-DD, or null: "by Friday", "tomorrow", "on 12 Nov", "2026-11-12",
// counted from the day it was added. The Chief of Staff's tasks have no due date of their own, and
// a meeting's action items often say when. Only English words; a task in any other words has none.
const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const monthOf = (m) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m.slice(0, 3))
const dayOf = (d) => d.toLocaleDateString('en-CA')
export function dueOf(title, added) {
  const s = String(title || '').toLowerCase()
  const a = /^(\d{4})-(\d\d)-(\d\d)$/.exec(added || '')
  const base = a ? new Date(+a[1], +a[2] - 1, +a[3], 12) : new Date(new Date().setHours(12, 0, 0, 0))
  const plus = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return dayOf(d) }
  let m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${MONTH})\\b`).exec(s)
  const md = m ? [monthOf(m[2]), +m[1]] : (m = new RegExp(`\\b(${MONTH}) (\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(s)) ? [monthOf(m[1]), +m[2]] : null
  if (md && md[1] >= 1 && md[1] <= 31) {
    const d = new Date(base.getFullYear(), md[0], md[1], 12)
    // Two months or more before it was added: next year's.
    if (base - d > 60 * DAY) d.setFullYear(d.getFullYear() + 1)
    return dayOf(d)
  }
  if (/\b(today|tonight|eod|end of (the )?day)\b/.test(s)) return plus(0)
  if (/\btomorrow\b/.test(s)) return plus(1)
  if (/\b(eow|end of (the )?week)\b/.test(s)) return plus((5 - base.getDay() + 7) % 7)
  m = /\b(by|on|before|due|until|till|this|next) (sun|mon|tue|wed|thu|fri|sat)(day|s|sday|nesday|rsday|urday)?\b/.exec(s)
  if (m) { const n = (WEEK.indexOf(m[2]) - base.getDay() + 7) % 7; return plus(n === 0 && m[1] === 'next' ? 7 : n) }
  return null
}

// One row per thing. Kept of the same ones: what needs you over what's coming up over the rest (a
// task Chief of Staff is on over one it isn't), this computer's over another's, one that's online,
// then the newest. A task is the same task by its words (a meeting's action items handed on twice,
// or on two computers); a cloud agent is the same wherever it's seen from; anything else is itself
// on its own device. Fills in the day a task names when a device too old to say sent it without.
const RANK = { needs: 0, coming: 1, ready: 2 }
const STATUS = { waiting: 0, doing: 1, open: 2, done: 3 }
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const keyOf = (i) => (i.kind === 'task' && i.task ? `task|${words(i.task.title)}`
  : i.kind === 'agent' && i.agent?.cloud ? `cloud|${i.agent.cloud}|${i.paneId}`
    : `${i.kind}|${i.machine || ''}|${i.id}`)
const better = (x, y) => (RANK[x.group] ?? 3) - (RANK[y.group] ?? 3) || (STATUS[x.task?.status] ?? 4) - (STATUS[y.task?.status] ?? 4)
  || !!x.machine - !!y.machine || (y.online !== false) - (x.online !== false)
  || (Date.parse(y.at || 0) || 0) - (Date.parse(x.at || 0) || 0) || (Number(y.task?.id) || 0) - (Number(x.task?.id) || 0)
export function tidy(items) {
  const kept = new Map()
  for (const i of items) {
    const it = i.kind === 'task' && i.task && i.task.due === undefined ? { ...i, task: { ...i.task, due: i.task.status === 'done' ? null : dueOf(i.task.title, i.task.added) } } : i
    const k = keyOf(it)
    const was = kept.get(k)
    if (!was || better(it, was) < 0) kept.set(k, it)
  }
  // In the order each first came (a Map keeps where a key went in).
  return [...kept.values()]
}

// waiting: needsyou.make's; tasks: chieftasks.makeTasks's; meetings: meetings.js; unsent(id): a
// meeting's action items not handed on (meetwork.js); boards: boards.js; chief(): the Chief of
// Staff's main pane, or null when it isn't running (a reply to a task goes there).
export function make({ waiting, tasks, meetings, unsent, boards, chief }) {
  let kept = { boards: {} }
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.boards && typeof d.boards === 'object') kept = { boards: d.boards } } catch { /* none yet */ }
  let timer = null
  const save = () => { clearTimeout(timer); timer = setTimeout(() => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomic(FILE, JSON.stringify(kept)) } catch { /* next change */ } }, 500); timer.unref?.() }
  // You opened, saved, made or renamed it here: what's in it now is yours, not news.
  function looked(kind, id) {
    if (kind !== 'board' || !id) return
    kept.boards[String(id)] = Date.now()
    save()
    forget()
  }

  function taskItems(chiefPane) {
    let list = []
    try { list = tasks.list().items || [] } catch { return [] }
    const out = []
    for (const x of list) {
      const task = { id: x.id, title: x.title, status: x.status, needs: x.needs || null, outcome: x.outcome || null, link: x.link || null, from: x.from || null, added: x.added || null, done: x.done || null, due: x.status === 'done' ? null : dueOf(x.title, x.added) }
      if (x.status === 'done') {
        if (x.done && within(x.done, 2 * DAY)) out.push({ id: `task:${x.id}`, kind: 'task', group: x.outcome || x.link ? 'ready' : null, task, chief: chiefPane, at: iso(x.done) })
        continue
      }
      out.push({ id: `task:${x.id}`, kind: 'task', group: x.status === 'waiting' ? 'needs' : 'coming', task, chief: chiefPane, at: iso(x.added) })
    }
    const one = tidy(out)
    return [...one.filter((i) => i.group !== null).slice(0, 24), ...one.filter((i) => i.group === null).slice(0, 8)]
  }

  // The last week's meetings: notes ready (a day) or action items not handed on are worth a look.
  function meetingItems() {
    let list = []
    try { list = meetings.list() } catch { return [] }
    return list.filter((m) => !m.archived && within(m.startedAt, 7 * DAY)).slice(0, 12).map((m) => {
      const rec = m.status === 'recording' || m.status === 'paused'
      let left = []
      if (m.hasSummary && !rec) { try { left = unsent(m.id) || [] } catch { left = [] } }
      const fresh = m.hasSummary && within(m.summarizedAt || m.endedAt, DAY)
      return {
        id: `meeting:${m.id}`, kind: 'meeting', group: !rec && m.hasSummary && (left.length > 0 || fresh) ? 'ready' : null,
        meeting: { id: m.id, title: clip(m.title, 120) || 'Meeting', startedAt: m.startedAt || null, status: m.status || null, summarizing: !!m.summarizing, hasSummary: !!m.hasSummary, chief: m.chief || null },
        unsent: left.length, at: iso(m.summarizedAt || m.endedAt || m.startedAt),
      }
    })
  }

  // The last week's whiteboards: one changed since you last looked at it (an agent drew it or handed
  // it a new version) in the last three days is ready to look at. A second's leeway: a file's time
  // has finer digits than the clock's, and a save you made is noted as it's answered.
  async function boardItems() {
    let list = []
    try { list = (await boards.list()).boards || [] } catch { return [] }
    return list.filter((b) => Date.now() - b.mtime < 7 * DAY).slice(0, 12).map((b) => {
      const seen = kept.boards[b.id] || 0
      return { id: `board:${b.id}`, kind: 'board', group: b.mtime > seen + 1000 && Date.now() - b.mtime < 3 * DAY ? 'ready' : null, board: { id: b.id, title: b.title, mtime: b.mtime, changed: b.mtime > seen + 1000 }, at: iso(b.mtime) }
    })
  }

  async function build() {
    const needs = await waiting.items().catch(() => [])
    const pane = await Promise.resolve().then(chief).catch(() => null)
    return [...needs.map(fromNeeds), ...taskItems(pane), ...meetingItems(), ...await boardItems()]
  }
  // Asked for by Home and your other devices at once: one look serves them for a moment.
  let last = { at: 0, items: null, p: null }
  function items() {
    if (last.p) return last.p
    if (last.items && Date.now() - last.at < 3000) return Promise.resolve(last.items)
    last.p = build().then((x) => { last = { at: Date.now(), items: x, p: null }; return x }, (e) => { last.p = null; throw e })
    return last.p
  }
  function forget() { last = { at: 0, items: null, p: null } }
  return { items, looked, forget }
}
