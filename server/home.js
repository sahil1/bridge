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
// - Coming up: the Chief of Staff's tasks it's on. The calendar's part (the next meeting, its brief,
//   the files in its invite) comes from the calendar the page already has.
//
// Kept in the cache folder (home.json): when you last opened or saved each whiteboard.
import fs from 'node:fs'
import path from 'node:path'
import { cacheFile, writeFileAtomic } from './paths.js'

const FILE = cacheFile('home.json')
const DAY = 86400e3
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
const iso = (v) => { const t = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null }
const within = (v, ms) => { const t = Date.parse(v || ''); return Number.isFinite(t) && Date.now() - t < ms }

// A needs-you item as Home has it: questions, permissions and failed runs need you; finished work
// is ready to look at. Also what a device that sends no Home of its own (an older Bridge AI, or one
// whose list hasn't come yet) is shown with. nid: its own id in the needs-you inbox (Clear takes it).
export const fromNeeds = (i) => ({ ...i, id: `agent:${i.id}`, nid: i.id, kind: 'agent', group: i.type === 'review' ? 'ready' : 'needs', at: i.since || null })

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
      const task = { id: x.id, title: x.title, status: x.status, needs: x.needs || null, outcome: x.outcome || null, link: x.link || null, from: x.from || null, added: x.added || null, done: x.done || null }
      if (x.status === 'done') {
        if (x.done && within(x.done, 2 * DAY)) out.push({ id: `task:${x.id}`, kind: 'task', group: x.outcome || x.link ? 'ready' : null, task, chief: chiefPane, at: iso(x.done) })
        continue
      }
      out.push({ id: `task:${x.id}`, kind: 'task', group: x.status === 'waiting' ? 'needs' : 'coming', task, chief: chiefPane, at: iso(x.added) })
    }
    return [...out.filter((i) => i.group !== null).slice(0, 24), ...out.filter((i) => i.group === null).slice(0, 8)]
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
