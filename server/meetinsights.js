// Meeting Insights and the people you meet: your meetings added up, the way Usage adds up tokens
// (how many, how long, your share of the talk, words spoken and heard, by week and by kind of
// meeting), and People: everyone you've met, from invites and the names on transcripts, each with
// how often, when last and next, the time together, their share of the talk and what you talk
// about. A beta feature (meeting-insights). Worked out here, never sent, and nothing in it is a
// score of anyone: only what a transcript and a calendar can say, each with what it's based on.
//
// Each meeting is read once into a digest (who talked how long, words, questions, its people, the
// words its summary uses, its action items) kept in <data>/cache/meeting-insights.json with what it
// was read from, so a view only reads the meetings that changed since. A merge or split of people
// you make by hand is kept in <data>/meetings/people.json: { merge: [[a, b]], apart: [[a, b]] },
// by the keys of names as written.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA, cacheFile, writeFileAtomic } from './paths.js'
import * as meetings from './meetings.js'
import * as meetWork from './meetwork.js'
import * as memory from './meetmemory.js'
import { EMAIL, notPerson, withoutNote } from './notpeople.js'

const DIR = path.join(DATA, 'meetings')
const CACHE = cacheFile('meeting-insights.json')
const PEOPLE = path.join(DIR, 'people.json')
const VERSION = 3
const DAY = 864e5
let cfg = {}
export const configure = (c) => { cfg = c || {} }
// calendar(from, to): the calendar's events in those days (calendar.js range), for when you next
// meet someone.
let helpers = { calendar: null }
export const setHelpers = (h) => { helpers = { ...helpers, ...h } }

const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const readText = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)
const me = () => String(cfg.name || '').trim()

// You, by your name (Settings › General), or by an address whose name is yours, as an invite often
// lists you (alex@example.com for Alex Morgan); a call lists you as "Alex Morgan (me)".
const isMe = (raw) => {
  if (/\((me|you)\)/i.test(String(raw || ''))) return true
  const name = withoutNote(raw)
  if (!me()) return false
  const em = /([^\s<>@,;"']+)@[\w.-]+/.exec(name)
  return meetings.sameName(name, me()) || (!!em && !/\S\s+\S/.test(name.replace(em[0], '').replace(/[<>"']/g, '').trim()) && meetings.sameName(em[1], me()))
}

// ---------- One meeting, read once ----------
// What a digest is read from: the meeting, and each file beside it that changes what it says.
const FILES = ['transcript.jsonl', 'speakers.json', 'edits.json', 'cleaned.json', 'voices.json', 'summary.md']
const stamp = (f) => { const s = fs.statSync(f, { throwIfNoEntry: false }); return s ? `${s.size}.${Math.round(s.mtimeMs)}` : '-' }
const sigOf = (m) => hash(JSON.stringify([VERSION, me(), m.title, m.kind, m.kindPicked, m.event, m.seconds, m.startedAt, m.endedAt, m.status, m.work, ...FILES.map((f) => stamp(path.join(DIR, m.id, f)))]))

const seg = new Intl.Segmenter(undefined, { granularity: 'word' })
const wordsIn = (s) => { let n = 0; for (const x of seg.segment(String(s || ''))) if (x.isWordLike) n++; return n }
const questionsIn = (s) => (String(s || '').match(/[?？]/g) || []).length

// Words a summary uses for what was talked about: its sections' and bold points' names, the names
// in meeting memory it mentions, then its words that say most (not meeting filler).
const FILLER = new Set(('about after again agree agreed also another around asked being before between both came come could does doing done during each either every everyone first follow follow-up from going have having into item items just know last later like look looked looking made make making many meeting meetings mentioned more most much need needed needs next note notes other others over plan point points raised really said same says should some still sure take than that their them then there these they thing things think this those through time today together told update updates very want wanted week weeks well were what when where which while will with would year your yours shared discussed discuss discussion review reviewed check checked call calls team decided decision decisions question questions open action actions summary send sent start started work working talk talked keep kept').split(' '))
function topicsIn(summary) {
  const text = String(summary || '').split(/\n(?=##\s)/).filter((x) => !/^\s*##\s*(From your notes|Open questions)/i.test(x)).join('\n')
  const out = new Map() // phrase (lowercase) -> { t, w }
  const add = (t, w) => { const s = String(t).replace(/[*_`:.]+$/g, '').replace(/\s+/g, ' ').trim(); if (s.length < 3 || s.split(' ').length > 4) return; const k = s.toLowerCase(); if (!out.has(k) || out.get(k).w < w) out.set(k, { t: s, w }) }
  for (const x of text.matchAll(/^\s*###\s+(.+)$/gm)) add(x[1].replace(/\(.*\)$/, ''), 3)
  for (const x of text.matchAll(/\*\*([^*\n]{3,40})\*\*/g)) add(x[1], 3)
  const low = text.toLowerCase()
  for (const term of memory.list()) {
    const w = term.term.toLowerCase()
    const at = low.indexOf(w)
    if (at >= 0 && !/[\p{L}\p{N}]/u.test(low[at - 1] || '') && !/[\p{L}\p{N}]/u.test(low[at + w.length] || '')) add(term.term, 2)
  }
  const count = new Map()
  for (const w of low.replace(/^\s*##.*$/gm, '').match(/\p{L}[\p{L}'-]{3,}/gu) || []) if (!FILLER.has(w)) count.set(w, (count.get(w) || 0) + 1)
  for (const [w, n] of [...count].sort((a, b) => b[1] - a[1]).slice(0, 8)) if (n >= 2) add(w, 1)
  return [...out.values()].sort((a, b) => b.w - a.w).slice(0, 15).map((x) => ({ t: x.t, w: x.w }))
}

// Who said a line: 'me', a name, OTHER (someone else, not named), or UNKNOWN (can't be told). On a
// call your mic is you and the call's sound everyone else, unless your mic's voices were told apart
// too (a room on the call): then one of them is you once it's known; in a room the voices are told
// apart, and one of them is you once it's known.
const OTHER = ':other', UNKNOWN = ':unknown'
function digest(m) {
  const said = meetings.transcript(m.id).filter((l) => l.text && l.t1 > l.t0)
  const call = said.some((l) => l.src === 'them')
  const voiced = !call && said.some((l) => l.voice)
  // A room on the call whose voice for you is known: your mic's other voices are other people.
  const roomOnCall = call && said.some((l) => l.src === 'you' && l.me)
  const told = call ? 'call' : voiced ? (said.some((l) => l.me) ? 'voices' : 'noyou') : said.length ? 'room' : 'silent'
  const whoOf = (l) => {
    if (l.me) return 'me'
    if (l.name) return isMe(l.name) ? 'me' : l.name
    if (call) return l.src !== 'you' ? OTHER : !l.voice ? 'me' : roomOnCall ? OTHER : UNKNOWN
    return voiced && l.voice ? OTHER : UNKNOWN
  }
  const you = { s: 0, w: 0, q: 0, run: 0 }, others = { s: 0, w: 0 }, unknown = { s: 0, w: 0 }
  const named = {}
  let run = null
  for (const l of [...said].sort((a, b) => a.t0 - b.t0)) {
    const w = wordsIn(l.text), s = l.t1 - l.t0, who = whoOf(l)
    if (who === 'me') {
      you.s += s; you.w += w; you.q += questionsIn(l.text)
      // Your longest stretch: your lines with nobody else's between, and no long silence.
      run = run && l.t0 - run.t1 < 15 ? { t0: run.t0, t1: Math.max(run.t1, l.t1) } : { t0: l.t0, t1: l.t1 }
      you.run = Math.max(you.run, run.t1 - run.t0)
      continue
    }
    run = null
    const to = who === UNKNOWN ? unknown : others
    to.s += s; to.w += w
    if (who !== OTHER && who !== UNKNOWN && !notPerson(who)) { const x = named[who] || (named[who] = { s: 0, w: 0 }); x.s += s; x.w += w }
  }
  const r = (x) => Math.round(x * 100) / 100
  for (const x of [you, others, unknown, ...Object.values(named)]) { x.s = r(x.s); if ('run' in x) x.run = r(x.run) }
  const summary = readText(path.join(DIR, m.id, 'summary.md'))
  const items = meetWork.itemsIn(summary).map((it) => ({ who: it.who, text: it.what || it.text, yours: it.yours, done: it.ticked || !!m.work?.[it.key]?.done }))
  return {
    id: m.id, title: m.title, start: m.startedAt, end: m.endedAt || null, seconds: Math.round(m.seconds || 0), kind: m.kind || 'general',
    event: m.event ? { title: m.event.title || null, start: m.event.start || null, end: m.event.end || null } : null,
    people: (m.event?.attendees || []).filter((p) => p && !isMe(p) && !notPerson(p)),
    told, you, others, unknown, named, topics: topicsIn(summary), items, summary: !!summary.trim(),
  }
}

// Every finished meeting's digest, read again only where it changed. Archived meetings are left
// out, as they are from search; one still recording is counted once it ends.
let cache = null // { id: { sig, d } }
let reading = null
const saveCache = () => { try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); writeFileAtomic(CACHE, JSON.stringify({ v: VERSION, meetings: cache })) } catch { /* read again next time */ } }
export function digests() {
  if (reading) return reading
  reading = (async () => {
    if (!cache) { const c = readJSON(CACHE, null); cache = c?.v === VERSION ? c.meetings || {} : {} }
    const all = meetings.list()
    const out = []
    let changed = false
    let archived = 0, recording = 0, reread = 0, failed = 0
    for (const m of all) {
      if (m.archived) { archived++; continue }
      if (m.parts) continue // a combined meeting: its meetings are counted themselves
      if (['recording', 'paused'].includes(m.status)) { recording++; continue }
      const sig = sigOf(m)
      let hit = cache[m.id]
      if (hit?.sig !== sig) {
        // Read one at a time, letting the server answer others between.
        await new Promise((r) => setImmediate(r))
        try { hit = { sig, d: digest(m) } } catch { failed++; continue }
        cache[m.id] = hit
        changed = true
        reread++
      }
      out.push(hit.d)
    }
    const ids = new Set(all.map((m) => m.id))
    for (const id of Object.keys(cache)) if (!ids.has(id)) { delete cache[id]; changed = true }
    if (changed) saveCache()
    return { list: out, archived, recording, reread, failed }
  })().finally(() => { reading = null })
  return reading
}

// ---------- Series ----------
// A series: the same name (without its dates and numbers) three times or more. The rest are one-off.
const seriesKey = (d) => meetWork.seriesOf(d.title) || meetWork.seriesOf(d.event?.title)
function seriesIn(list) {
  const n = new Map()
  for (const d of list) { const s = seriesKey(d); if (s) n.set(s, (n.get(s) || 0) + 1) }
  return (d) => { const s = seriesKey(d); return s && n.get(s) >= 3 ? s : null }
}

// ---------- The kind of meeting ----------
// One kind each, from the first thing that says: its name or the kind you picked (an interview, a
// standup, a 1:1), someone invited from another company (an email domain that isn't yours, or a
// customer in meeting memory), one other person, the same name three or more times, two or more
// others, else nobody known.
export const KIND_ORDER = ['one_on_one', 'customer', 'standup', 'interview', 'brainstorm', 'recurring', 'group', 'other']
function kinder(list, seriesOf = seriesIn(list)) {
  const ours = meetWork.ownDomains(list.map((d) => ({ event: { attendees: d.people } })))
  return (d) => {
    if (['interview', 'standup', 'brainstorm', 'customer', 'one_on_one'].includes(d.kind)) return d.kind
    if (meetWork.customers({ id: d.id, title: `${d.title} ${d.event?.title || ''}`, people: d.people }, ours).size) return 'customer'
    const n = othersIn(d).length
    if (n === 1) return 'one_on_one'
    if (seriesOf(d)) return 'recurring'
    return n >= 2 ? 'group' : 'other'
  }
}
// The others in a meeting: who was invited, and anyone named on the transcript who wasn't.
function othersIn(d) {
  const out = [...d.people]
  for (const n of Object.keys(d.named)) if (!out.some((p) => meetings.sameName(p, n))) out.push(n)
  return out
}

// ---------- Weeks ----------
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d }
const weekOf = (t) => { const d = dayStart(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d }
const startOf = (d) => Date.parse(d.start)
const endOf = (d) => (d.end ? Date.parse(d.end) : startOf(d) + d.seconds * 1000)
const knownTalk = (d) => d.told === 'call' || d.told === 'voices'
const talkOf = (d) => d.you.s + d.others.s + d.unknown.s
const r2 = (x) => Math.round(x * 100) / 100
const sum = (arr, f) => arr.reduce((a, d) => a + f(d), 0)

// Signals, each from what it says: your lines that ask, your longest stretch, the recording's end
// against the invite's, three or more meetings in a day with under 5 minutes between, and your
// action items ticked.
function signalsOf(these) {
  const told = these.filter(knownTalk)
  const timed = these.filter((d) => d.event?.end && d.event?.start)
  const byDay = new Map()
  for (const d of [...these].sort((a, b) => startOf(a) - startOf(b))) { const k = ymd(new Date(startOf(d))); byDay.set(k, [...(byDay.get(k) || []), d]) }
  let packed = 0
  for (const ds of byDay.values()) {
    let row = 1, most = 1
    for (let i = 1; i < ds.length; i++) { row = startOf(ds[i]) - endOf(ds[i - 1]) < 5 * 60e3 ? row + 1 : 1; most = Math.max(most, row) }
    if (most >= 3) packed++
  }
  const mine = these.flatMap((d) => d.items.filter((x) => x.yours))
  return {
    questions: { n: sum(told, (d) => d.you.q), meetings: told.length },
    longest: { s: told.length ? r2(sum(told, (d) => d.you.run) / told.length) : 0, meetings: told.length },
    ranOver: { n: timed.filter((d) => endOf(d) - Date.parse(d.event.end) > 5 * 60e3).length, of: timed.length },
    backToBack: { days: packed },
    followed: { done: mine.filter((x) => x.done).length, of: mine.length },
  }
}

// When you meet: each weekday (Monday first) and hour, the time in meetings that fell in it and how
// many meetings did, from each one's start and how long it was recorded: [weekday, hour, seconds, n].
function heatOf(these) {
  const cells = new Map()
  for (const d of these) {
    let t = startOf(d)
    const end = t + Math.min(12 * 3600, Math.max(60, d.seconds)) * 1000
    while (t < end) {
      const x = new Date(t)
      const k = ((x.getDay() + 6) % 7) * 24 + x.getHours()
      const next = new Date(x); next.setMinutes(60, 0, 0)
      const upto = Math.min(end, next.getTime())
      const c = cells.get(k) || [Math.floor(k / 24), k % 24, 0, 0, null]
      c[2] += (upto - t) / 1000
      if (c[4] !== d.id) { c[3]++; c[4] = d.id }
      cells.set(k, c)
      t = upto
    }
  }
  return [...cells.values()].map(([w, h, s, n]) => [w, h, Math.round(s), n]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

// ---------- Insights ----------
// days: 30, 90, 365 or 'all'. kind: one of KIND_ORDER, or 'all'.
export async function insights({ days = 90, kind = 'all', now = Date.now() } = {}) {
  const { list, archived, recording, reread, failed } = await digests()
  const span = days === 'all' ? null : Math.max(1, Math.min(3660, Number(days) || 90))
  // Counted back in days, not 24 hours: across a clock change one of them is 23 or 25, and the range
  // would start a day off for an hour of every day.
  const daysBack = (t, n) => { const d = dayStart(t); d.setDate(d.getDate() - n); return d.getTime() }
  const from = span ? daysBack(now, span - 1) : -Infinity
  const at = startOf
  const seriesOf = seriesIn(list)
  const kindOf = kinder(list, seriesOf)
  const inRange = list.filter((d) => at(d) >= from && at(d) <= now)
  const kinds = KIND_ORDER.map((id) => ({ id, n: inRange.filter((d) => kindOf(d) === id).length })).filter((k) => k.n)
  const these = inRange.filter((d) => kind === 'all' || kindOf(d) === kind).sort((a, b) => at(a) - at(b))
  const prevFrom = span ? daysBack(from, span) : null
  const prev = span ? list.filter((d) => at(d) >= prevFrom && at(d) < from && (kind === 'all' || kindOf(d) === kind)) : null
  const told = these.filter(knownTalk)
  const untold = { room: these.filter((d) => d.told === 'room').length, noyou: these.filter((d) => d.told === 'noyou').length, silent: these.filter((d) => d.told === 'silent').length }
  const start = span ? from : these.length ? dayStart(at(these[0])).getTime() : dayStart(now).getTime()

  // Each week in the range, oldest first, the empty ones too; rec: the part of it in a series.
  const weeks = []
  for (const w = weekOf(start); w.getTime() <= now && weeks.length < 530; w.setDate(w.getDate() + 7)) weeks.push({ week: ymd(w), n: 0, seconds: 0, rec: 0, recN: 0, you: 0, talk: 0, words: 0, heard: 0 })
  const byWeek = new Map(weeks.map((w) => [w.week, w]))
  for (const d of these) {
    const w = byWeek.get(ymd(weekOf(at(d))))
    if (!w) continue
    w.n++; w.seconds += d.seconds
    if (seriesOf(d)) { w.rec += d.seconds; w.recN++ }
    if (knownTalk(d)) { w.you += d.you.s; w.talk += talkOf(d); w.words += d.you.w; w.heard += d.others.w + d.unknown.w }
  }
  for (const w of weeks) { w.you = r2(w.you); w.talk = r2(w.talk) }
  const byKind = KIND_ORDER.map((id) => {
    const ds = told.filter((d) => kindOf(d) === id)
    return { id, n: ds.length, you: r2(sum(ds, (d) => d.you.s)), talk: r2(sum(ds, talkOf)) }
  }).filter((k) => k.n)

  // Each weekday, Monday first: the time in meetings on it, and how many of that weekday the range
  // has, for a day's average. And the day with the most.
  const weekdays = Array.from({ length: 7 }, () => ({ s: 0, n: 0, days: 0 }))
  for (const d of these) { const w = weekdays[(new Date(at(d)).getDay() + 6) % 7]; w.s += d.seconds; w.n++ }
  for (let x = new Date(start), i = 0; x.getTime() <= now && i < 4000; x.setDate(x.getDate() + 1), i++) weekdays[(x.getDay() + 6) % 7].days++
  const onDay = new Map()
  for (const d of these) { const k = ymd(new Date(at(d))); const x = onDay.get(k) || { date: k, seconds: 0, n: 0 }; x.seconds += d.seconds; x.n++; onDay.set(k, x) }
  const busiest = [...onDay.values()].sort((a, b) => b.seconds - a.seconds || a.date.localeCompare(b.date))[0] || null

  // The series in the range, most time first, with the newest of each to open.
  const bySeries = new Map()
  for (const d of these) {
    const k = seriesOf(d)
    if (!k) continue
    const x = bySeries.get(k) || { key: k, titles: new Map(), n: 0, seconds: 0, last: null, id: null, people: new Set() }
    x.n++; x.seconds += d.seconds
    x.titles.set(d.title, (x.titles.get(d.title) || 0) + 1)
    if (!x.last || d.start > x.last) { x.last = d.start; x.id = d.id }
    for (const p of othersIn(d)) { const v = variantOf(p); if (v && !isMe(p)) x.people.add(v.key) }
    bySeries.set(k, x)
  }
  const series = [...bySeries.values()].sort((a, b) => b.seconds - a.seconds || b.n - a.n).map((x) => ({
    key: x.key, title: [...x.titles].sort((a, b) => b[1] - a[1])[0][0], n: x.n, seconds: x.seconds, last: x.last, id: x.id, people: x.people.size,
  }))
  const inSeries = these.filter((d) => seriesOf(d))

  // The people in the range, most time together first; how many you met, how many of them for the
  // first time, and how many you met in the days before.
  const ppl = await people({ list })
  const byId = new Map(these.map((d) => [d.id, d]))
  const prevIds = new Set((prev || []).map((d) => d.id))
  const met = ppl.people.map((p) => {
    const ds = p.meetingIds.map((x) => byId.get(x)).filter(Boolean)
    return { id: p.id, name: p.name, n: ds.length, s: sum(ds, (d) => d.seconds), last: ds[0]?.start || null, share: p.share, first: p.first }
  }).filter((p) => p.n)
  const top = [...met].sort((a, b) => b.s - a.s || b.n - a.n || a.name.localeCompare(b.name)).slice(0, 8).map(({ first, ...p }) => p)

  const totals = (ds) => {
    const k = ds.filter(knownTalk)
    const ids = new Set(ds.map((d) => d.id))
    return {
      meetings: ds.length, seconds: sum(ds, (d) => d.seconds), rec: sum(ds.filter((d) => seriesOf(d)), (d) => d.seconds),
      talk: { you: r2(sum(k, (d) => d.you.s)), all: r2(sum(k, talkOf)), told: k.length }, signals: signalsOf(ds),
      people: ppl.people.filter((p) => p.meetingIds.some((x) => ids.has(x))).length,
    }
  }
  return {
    days: span || 'all', from: ymd(new Date(start)), kind,
    total: list.length, archived, recording, reread, failed, kinds,
    meetings: these.length, seconds: sum(these, (d) => d.seconds),
    prev: prev ? totals(prev) : null,
    talk: { you: r2(sum(told, (d) => d.you.s)), others: r2(sum(told, (d) => d.others.s)), unknown: r2(sum(told, (d) => d.unknown.s)), told: told.length, untold },
    words: { you: sum(told, (d) => d.you.w), heard: sum(told, (d) => d.others.w + d.unknown.w) },
    weeks, byKind, signals: signalsOf(these), people: top, me: me() || null,
    met: { n: met.length, fresh: span ? met.filter((p) => p.first && Date.parse(p.first) >= from).length : null },
    heat: heatOf(these), weekdays, busiest,
    series: series.slice(0, 8),
    recurring: { n: inSeries.length, seconds: sum(inSeries, (d) => d.seconds), series: series.length },
    oneoff: { n: these.length - inSeries.length, seconds: sum(these, (d) => d.seconds) - sum(inSeries, (d) => d.seconds) },
  }
}

// ---------- People ----------
// A name as written, in an invite or on a transcript: "Priya Shah", "priya.shah2", "Priya Shah
// <priya@example.org>", "priya@example.org". Its key is its parts in order of the alphabet, so
// "Shah, Priya" is the same; an address is also known by itself.
const partsOf = (s) => String(s).toLowerCase().replace(/\d+/g, '').split(/[\s.@_,-]+/).filter(Boolean)
const asWritten = (p) => (/^[a-z0-9._-]+$/.test(p) && /[._-]/.test(p) ? partsOf(p).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : p)
function variantOf(raw) {
  if (notPerson(raw)) return null
  const s = withoutNote(raw)
  const em = EMAIL.exec(s)
  const email = em ? em[1].toLowerCase() : null
  const name = (em ? s.replace(em[0], '').replace(/["']/g, '').trim() : s) || (email ? email.split('@')[0] : '')
  const parts = partsOf(name)
  if (!parts.length) return null
  return { key: [...parts].sort().join(' '), parts, display: asWritten(name), email }
}
// Whole: a first and last name ("Priya Shah"); short: a first name, or a first name and an initial.
const whole = (v) => v.parts.length >= 2 && v.parts[1].length >= 2
const fits = (short, full) => short.parts[0] === full.parts[0] && (short.parts.length === 1 || full.parts.slice(1).some((p) => p.startsWith(short.parts[1])))

const edits = () => { const e = readJSON(PEOPLE, {}) || {}; return { merge: Array.isArray(e.merge) ? e.merge : [], apart: Array.isArray(e.apart) ? e.apart : [] } }
const saveEdits = (e) => { fs.mkdirSync(DIR, { recursive: true }); writeFileAtomic(PEOPLE, JSON.stringify(e, null, 2)) }

// Everyone in your meetings, the same person written different ways put together carefully: the
// same name in any order (and an address's name), the same address, a first name in a meeting
// where only one person invited has it, and a first name only one person you've met has. Two you
// said are different people are never put together, and two you said are the same always are.
export async function people({ list = null } = {}) {
  const ds = list || (await digests()).list
  const vars = new Map() // key -> { v, names: Map(display -> n), emails: Set, meetings: Map(id -> { invited, spoke }) }
  const note = (raw, id, how) => {
    const v = variantOf(raw)
    if (!v || isMe(raw)) return null
    const x = vars.get(v.key) || { v, names: new Map(), emails: new Set(), meetings: new Map() }
    vars.set(v.key, x)
    x.names.set(v.display, (x.names.get(v.display) || 0) + 1)
    if (v.email) x.emails.add(v.email)
    const m = x.meetings.get(id) || {}
    m[how] = true
    x.meetings.set(id, m)
    return v
  }
  const inMeeting = new Map() // id -> [variant]
  for (const d of ds) {
    const here = []
    for (const p of d.people) { const v = note(p, d.id, 'invited'); if (v) here.push(v) }
    for (const n of Object.keys(d.named)) { const v = note(n, d.id, 'spoke'); if (v) here.push(v) }
    inMeeting.set(d.id, here)
  }
  // Put together, unless that would join two you keep apart.
  const { merge, apart } = edits()
  const up = new Map([...vars.keys()].map((k) => [k, k]))
  const root = (k) => { while (up.get(k) !== k) k = up.get(k); return k }
  const blocked = (a, b) => { const ra = root(a), rb = root(b); return apart.some(([x, y]) => vars.has(x) && vars.has(y) && ((root(x) === ra && root(y) === rb) || (root(x) === rb && root(y) === ra))) }
  const join = (a, b, force = false) => { if (!vars.has(a) || !vars.has(b)) return; const ra = root(a), rb = root(b); if (ra === rb || (!force && blocked(a, b))) return; up.set(rb, ra) }
  const byEmail = new Map()
  for (const [k, x] of vars) for (const e of x.emails) { if (byEmail.has(e)) join(byEmail.get(e), k); else byEmail.set(e, k) }
  for (const here of inMeeting.values()) {
    for (const s of here.filter((v) => !whole(v))) {
      const full = [...new Map(here.filter((v) => whole(v) && fits(s, v)).map((v) => [v.key, v])).values()]
      if (full.length === 1) join(full[0].key, s.key)
    }
  }
  const wholes = [...vars.values()].map((x) => x.v).filter(whole)
  for (const x of vars.values()) {
    if (whole(x.v)) continue
    const groups = new Set(wholes.filter((v) => fits(x.v, v)).map((v) => root(v.key)))
    if (groups.size === 1) join([...groups][0], x.v.key)
  }
  for (const [a, b] of merge) join(a, b, true)

  // Each person: their meetings and what was said in them.
  const byId = new Map(ds.map((d) => [d.id, d]))
  const groups = new Map()
  for (const k of vars.keys()) { const r = root(k); groups.set(r, [...(groups.get(r) || []), k]) }
  const terms = memory.list()
  const seriesOf = seriesIn(ds)
  // The last six months, this one last: how many meetings with each person in each.
  const month = (t) => { const d = new Date(t); return d.getFullYear() * 12 + d.getMonth() }
  const thisMonth = month(Date.now())
  const out = []
  for (const keys of groups.values()) {
    const xs = keys.map((k) => vars.get(k))
    const names = new Map()
    for (const x of xs) for (const [n, c] of x.names) names.set(n, (names.get(n) || 0) + c)
    // The fullest way it's written, capitalized, the most often.
    const name = [...names].sort((a, b) => partsOf(b[0]).length - partsOf(a[0]).length || Number(/\p{Lu}/u.test(b[0])) - Number(/\p{Lu}/u.test(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    // The id: the fullest key, so it stays put as meetings come and go (either id finds them).
    const id = [...keys].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length || a.localeCompare(b))[0]
    const seen = new Map()
    for (const x of xs) for (const [mid, how] of x.meetings) seen.set(mid, { ...(seen.get(mid) || {}), ...how })
    const mine = [...seen.keys()].map((mid) => byId.get(mid)).filter(Boolean).sort((a, b) => String(b.start).localeCompare(String(a.start)))
    const variants = xs.map((x) => x.v)
    const theirs = (d) => Object.entries(d.named).filter(([n]) => variants.some((v) => v.key === variantOf(n)?.key)).reduce((a, [, x]) => ({ s: a.s + x.s, w: a.w + x.w }), { s: 0, w: 0 })
    const heard = mine.filter((d) => (d.told === 'call' || d.told === 'voices') && theirs(d).s > 0)
    const talk = heard.reduce((a, d) => a + d.you.s + d.others.s + d.unknown.s, 0)
    const said = heard.reduce((a, d) => a + theirs(d).s, 0)
    const about = terms.find((t) => t.note && variants.some((v) => whole(v) && meetings.sameName(t.term, v.display)))?.note || null
    const spark = [0, 0, 0, 0, 0, 0]
    for (const d of mine) { const i = 5 - (thisMonth - month(startOf(d))); if (i >= 0 && i < 6) spark[i]++ }
    // The series you meet them in most, by name.
    const inSeries = new Map()
    for (const d of mine) { const k = seriesOf(d); if (k) { const x = inSeries.get(k) || { title: d.title, n: 0 }; x.n++; inSeries.set(k, x) } }
    const often = [...inSeries.values()].sort((a, b) => b.n - a.n)[0] || null
    out.push({
      id, name, keys, emails: [...new Set(xs.flatMap((x) => [...x.emails]))], also: [...names.keys()].filter((n) => n !== name), about,
      meetingIds: mine.map((d) => d.id), meetings: mine.length, last: mine[0]?.start || null, first: mine.at(-1)?.start || null, seconds: mine.reduce((a, d) => a + d.seconds, 0),
      recent: mine.filter((d) => Date.now() - startOf(d) < 30 * DAY).length, spark, series: often && often.n >= 2 ? often.title : null,
      share: heard.length ? { pct: talk ? Math.round((said / talk) * 100) : 0, s: Math.round(said), meetings: heard.length } : null,
      topics: null, variants, _mine: mine, _seen: seen, _theirs: theirs,
    })
  }
  // What you talk about: the summary's words in most of your meetings with them, not anyone's name.
  const nameParts = new Set(out.flatMap((p) => p.variants.flatMap((v) => v.parts)).concat(partsOf(me())))
  for (const p of out) {
    const count = new Map()
    for (const d of p._mine) for (const tp of d.topics) { const k = tp.t.toLowerCase(); if (partsOf(tp.t).every((w) => nameParts.has(w))) continue; const c = count.get(k) || { t: tp.t, n: 0, w: tp.w }; c.n++; count.set(k, c) }
    // A word that's part of a longer topic already there ("flow" with "Refund flow") says nothing more.
    const picked = []
    for (const x of [...count.values()].sort((a, b) => b.n - a.n || b.w - a.w || a.t.localeCompare(b.t))) {
      const ws = partsOf(x.t)
      if (picked.length < 4 && !picked.some((y) => ws.every((w) => partsOf(y).includes(w)) || partsOf(y).every((w) => ws.includes(w)))) picked.push(x.t)
    }
    p.topics = picked
  }
  out.sort((a, b) => b.meetings - a.meetings || String(b.last).localeCompare(String(a.last)) || a.name.localeCompare(b.name))
  return { people: out, meetings: ds.length, list: ds }
}
const shown = ({ variants, _mine, _seen, _theirs, keys, ...p }) => p

// The calendar's next events with each person, when it can be read (a Mac, allowed): { events } or
// { error, code }. Never waits more than a few seconds on it.
async function upcoming(now = Date.now()) {
  if (!helpers.calendar) return { error: 'No calendar', code: 'none' }
  try {
    const got = await Promise.race([helpers.calendar(ymd(new Date(now)), ymd(new Date(now + 30 * DAY))), new Promise((_, no) => setTimeout(() => no(new Error('The calendar took too long to answer')), 5000).unref?.())])
    return { events: (got?.events || []).filter((e) => !e.canceled && !e.allDay && Date.parse(e.end) > now) }
  } catch (e) {
    return { error: e.message, code: e.code || (/isn't available on this platform/.test(e.message) ? 'platform' : null) }
  }
}
// The next event they're invited to, by a way their name is written (a calendar gives a name, or an
// address's name).
const nextWith = (p, events) => events.filter((e) => (e.attendees || []).some((a) => p.keys.includes(variantOf(a)?.key))).sort((a, b) => a.start.localeCompare(b.start))[0] || null

export async function list() {
  const [{ people: all, meetings: n }, cal] = await Promise.all([people(), upcoming()])
  const out = all.map((p) => { const e = cal.events ? nextWith(p, cal.events) : null; return { ...shown(p), next: e ? { title: e.title, start: e.start } : null } })
  return { people: out, meetings: n, calendar: cal.events ? { ok: true } : { ok: false, error: cal.error, code: cal.code }, me: me() || null }
}

// One person's page: every meeting with them (with their share of each), the action items still
// open that are theirs or name them, and the next meeting with them.
export async function person(pid) {
  const [{ people: all, list: ds }, cal] = await Promise.all([people(), upcoming()])
  const p = all.find((x) => x.id === pid || x.keys.includes(pid))
  if (!p) throw new Error('No such person in your meetings')
  const named = (text) => p.variants.some((v) => whole(v) && new RegExp(`(?<![\\p{L}])${v.parts.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.-]+')}(?![\\p{L}])`, 'iu').test(text))
  // An item carried from summary to summary (a weekly's, repeating it) is one: the newest, with how
  // many meetings have it.
  // Whose each is: yours (that names them), theirs, or someone else's that names them.
  const items = new Map()
  for (const d of p._mine) {
    for (const x of d.items.filter((x) => !x.done && ((x.who && !x.yours && p.variants.some((v) => meetings.sameName(x.who, v.display))) || named(x.text)))) {
      const k = `${String(x.who || '').toLowerCase()}|${x.text.toLowerCase().replace(/\s+/g, ' ').trim()}`
      const whose = x.yours ? 'you' : x.who && p.variants.some((v) => meetings.sameName(x.who, v.display)) ? 'them' : 'other'
      if (items.has(k)) items.get(k).meetings++
      else items.set(k, { text: x.text, who: x.who, yours: x.yours, whose, meeting: { id: d.id, title: d.title, start: d.start }, meetings: 1 })
    }
  }
  // Meetings together by month, the last twelve, this one last; and how many came before them.
  const seriesOf = seriesIn(ds)
  const now = new Date()
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { month: ymd(d).slice(0, 7), n: 0, seconds: 0 } })
  const byMonth = new Map(months.map((m) => [m.month, m]))
  let before = 0
  for (const d of p._mine) { const m = byMonth.get(ymd(new Date(startOf(d))).slice(0, 7)); if (m) { m.n++; m.seconds += d.seconds } else if (startOf(d) < now) before++ }
  const e = cal.events ? nextWith(p, cal.events) : null
  return {
    ...shown(p),
    meetingsList: p._mine.map((d) => { const s = p._theirs(d).s; const talk = d.you.s + d.others.s + d.unknown.s; return { id: d.id, title: d.title, start: d.start, seconds: d.seconds, series: seriesOf(d), how: p._seen.get(d.id), pct: (d.told === 'call' || d.told === 'voices') && s > 0 && talk ? Math.round((s / talk) * 100) : null } }),
    months, before,
    items: [...items.values()],
    next: e ? { title: e.title, start: e.start, attendees: e.attendees } : null,
    calendar: cal.events ? { ok: true } : { ok: false, error: cal.error, code: cal.code },
    // The ways their name is written, to take one out (split).
    written: p.variants.map((v) => ({ key: v.key, name: v.display })),
    others: all.filter((x) => x.id !== p.id).map((x) => ({ id: x.id, name: x.name, meetings: x.meetings, last: x.last, also: x.also, emails: x.emails })),
  }
}

// By hand: two people are the same (merge), or a way of writing a name isn't this person (split).
export async function mergePeople(a, b) {
  const { people: all } = await people()
  const A = all.find((x) => x.id === a || x.keys.includes(a)), B = all.find((x) => x.id === b || x.keys.includes(b))
  if (!A || !B) throw new Error('No such person in your meetings')
  if (A.id === B.id) return { id: A.id }
  const e = edits()
  e.apart = e.apart.filter(([x, y]) => !((A.keys.includes(x) && B.keys.includes(y)) || (A.keys.includes(y) && B.keys.includes(x))))
  e.merge.push([A.id, B.id])
  saveEdits(e)
  const after = (await people()).people.find((x) => x.keys.includes(A.id))
  return { id: after?.id || A.id }
}
export async function splitPerson(pid, key) {
  const { people: all } = await people()
  const p = all.find((x) => x.id === pid || x.keys.includes(pid))
  if (!p || !p.keys.includes(key)) throw new Error('No such name for this person')
  if (p.keys.length < 2) throw new Error('That\'s the only way their name is written')
  const e = edits()
  const rest = p.keys.filter((k) => k !== key)
  e.merge = e.merge.filter(([x, y]) => !((x === key && rest.includes(y)) || (y === key && rest.includes(x))))
  // Kept apart from each of the others it was with, so no other way round puts it back.
  for (const k of rest) if (!e.apart.some(([x, y]) => (x === key && y === k) || (x === k && y === key))) e.apart.push([key, k])
  // A merge by hand that only held it there through another name goes too.
  e.merge = e.merge.filter(([x, y]) => !(x === key || y === key))
  saveEdits(e)
  const after = (await people()).people
  return { id: after.find((x) => x.keys.includes(rest[0]))?.id || null, split: after.find((x) => x.keys.includes(key))?.id || null }
}

// ---------- Turning itself on ----------
// Once there's something to add up (5 meetings recorded on this computer), Meeting Insights turns
// itself on, once, unless you've turned it on or off yourself. When it did, and whether Meetings has
// said so yet, is kept in <data>/meetings/insights-auto.json: { at, meetings, said }.
const AUTO = path.join(DIR, 'insights-auto.json')
export const AUTO_AFTER = 5
let auto
export const autoOn = () => (auto === undefined ? (auto = readJSON(AUTO, null)) : auto)
// How many meetings there are to add up, once there are enough (else 0): finished, not archived.
export function ready(list) {
  const n = list.filter((m) => !m.archived && !m.parts && !['recording', 'paused'].includes(m.status)).length
  return n >= AUTO_AFTER ? n : 0
}
const keepAuto = (a) => { fs.mkdirSync(DIR, { recursive: true }); writeFileAtomic(AUTO, JSON.stringify(a)); auto = a }
export const turnedOn = (n) => keepAuto({ at: new Date().toISOString(), meetings: n, said: false })
export function said() { const a = autoOn(); if (a && !a.said) keepAuto({ ...a, said: true }); return { ok: true } }
