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

const DIR = path.join(DATA, 'meetings')
const CACHE = cacheFile('meeting-insights.json')
const PEOPLE = path.join(DIR, 'people.json')
const VERSION = 2
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
// lists you (alex@example.com for Alex Morgan).
const isMe = (name) => {
  if (!me()) return false
  const em = /([^\s<>@,;"']+)@[\w.-]+/.exec(String(name || ''))
  return meetings.sameName(name, me()) || (!!em && !/\S\s+\S/.test(String(name).replace(em[0], '').replace(/[<>"']/g, '').trim()) && meetings.sameName(em[1], me()))
}

// ---------- One meeting, read once ----------
// What a digest is read from: the meeting, and each file beside it that changes what it says.
const FILES = ['transcript.jsonl', 'speakers.json', 'edits.json', 'cleaned.json', 'voices.json', 'summary.md']
const stamp = (f) => { const s = fs.statSync(f, { throwIfNoEntry: false }); return s ? `${s.size}.${Math.round(s.mtimeMs)}` : '-' }
const sigOf = (m) => hash(JSON.stringify([VERSION, me(), m.title, m.kind, m.kindPicked, m.event, m.seconds, m.startedAt, m.endedAt, m.status, m.work, ...FILES.map((f) => stamp(path.join(DIR, m.id, f)))]))

const seg = new Intl.Segmenter(undefined, { granularity: 'word' })
const wordsIn = (s) => { let n = 0; for (const x of seg.segment(String(s || ''))) if (x.isWordLike) n++; return n }
const questionsIn = (s) => (String(s || '').match(/[?？]/g) || []).length
const NOT_A_NAME = /^(you|them|me|speaker \d+|unknown|null)$/i

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
// call your mic is you and the call's sound everyone else; in a room the voices are told apart,
// and one of them is you once it's known.
const OTHER = ':other', UNKNOWN = ':unknown'
function digest(m) {
  const said = meetings.transcript(m.id).filter((l) => l.text && l.t1 > l.t0)
  const call = said.some((l) => l.src === 'them')
  const voiced = !call && said.some((l) => l.voice)
  const told = call ? 'call' : voiced ? (said.some((l) => l.me) ? 'voices' : 'noyou') : said.length ? 'room' : 'silent'
  const whoOf = (l) => {
    if (l.me) return 'me'
    if (l.name) return isMe(l.name) ? 'me' : l.name
    if (call) return l.src === 'you' ? 'me' : OTHER
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
    if (who !== OTHER && who !== UNKNOWN && !NOT_A_NAME.test(who)) { const x = named[who] || (named[who] = { s: 0, w: 0 }); x.s += s; x.w += w }
  }
  const r = (x) => Math.round(x * 100) / 100
  for (const x of [you, others, unknown, ...Object.values(named)]) { x.s = r(x.s); if ('run' in x) x.run = r(x.run) }
  const summary = readText(path.join(DIR, m.id, 'summary.md'))
  const items = meetWork.itemsIn(summary).map((it) => ({ who: it.who, text: it.what || it.text, yours: it.yours, done: it.ticked || !!m.work?.[it.key]?.done }))
  return {
    id: m.id, title: m.title, start: m.startedAt, end: m.endedAt || null, seconds: Math.round(m.seconds || 0), kind: m.kind || 'general',
    event: m.event ? { title: m.event.title || null, start: m.event.start || null, end: m.event.end || null } : null,
    people: (m.event?.attendees || []).filter((p) => p && !isMe(p)),
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

// ---------- The kind of meeting ----------
// One kind each, from the first thing that says: its name or the kind you picked (an interview, a
// standup, a 1:1), someone invited from another company (an email domain that isn't yours, or a
// customer in meeting memory), one other person, the same name three or more times, two or more
// others, else nobody known.
export const KIND_ORDER = ['one_on_one', 'customer', 'standup', 'interview', 'brainstorm', 'recurring', 'group', 'other']
function kinder(list) {
  const series = new Map()
  for (const d of list) { const s = meetWork.seriesOf(d.title) || meetWork.seriesOf(d.event?.title); if (s) series.set(s, (series.get(s) || 0) + 1) }
  const ours = meetWork.ownDomains(list.map((d) => ({ event: { attendees: d.people } })))
  return (d) => {
    if (['interview', 'standup', 'brainstorm', 'customer', 'one_on_one'].includes(d.kind)) return d.kind
    if (meetWork.customers({ id: d.id, title: `${d.title} ${d.event?.title || ''}`, people: d.people }, ours).size) return 'customer'
    const n = othersIn(d).length
    if (n === 1) return 'one_on_one'
    const s = meetWork.seriesOf(d.title) || meetWork.seriesOf(d.event?.title)
    if (s && series.get(s) >= 3) return 'recurring'
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

// ---------- Insights ----------
// days: 30, 90, 365 or 'all'. kind: one of KIND_ORDER, or 'all'.
export async function insights({ days = 90, kind = 'all', now = Date.now() } = {}) {
  const { list, archived, recording, reread, failed } = await digests()
  const span = days === 'all' ? null : Math.max(1, Math.min(3660, Number(days) || 90))
  const from = span ? dayStart(now - (span - 1) * DAY).getTime() : -Infinity
  const at = (d) => Date.parse(d.start)
  const kindOf = kinder(list)
  const inRange = list.filter((d) => at(d) >= from && at(d) <= now)
  const kinds = KIND_ORDER.map((id) => ({ id, n: inRange.filter((d) => kindOf(d) === id).length })).filter((k) => k.n)
  const these = inRange.filter((d) => kind === 'all' || kindOf(d) === kind).sort((a, b) => at(a) - at(b))
  const prevFrom = span ? from - span * DAY : null
  const prev = span ? list.filter((d) => at(d) >= prevFrom && at(d) < from && (kind === 'all' || kindOf(d) === kind)) : null
  const sum = (arr, f) => arr.reduce((a, d) => a + f(d), 0)
  const told = these.filter((d) => d.told === 'call' || d.told === 'voices')
  const talkOf = (d) => d.you.s + d.others.s + d.unknown.s
  const r = (x) => Math.round(x * 100) / 100
  const untold = { room: these.filter((d) => d.told === 'room').length, noyou: these.filter((d) => d.told === 'noyou').length, silent: these.filter((d) => d.told === 'silent').length }

  // Each week in the range, oldest first, the empty ones too.
  const weeks = []
  const first = weekOf(span ? from : these.length ? at(these[0]) : now)
  for (const w = new Date(first); w.getTime() <= now && weeks.length < 530; w.setDate(w.getDate() + 7)) weeks.push({ week: ymd(w), n: 0, seconds: 0, you: 0, talk: 0, words: 0, heard: 0 })
  const byWeek = new Map(weeks.map((w) => [w.week, w]))
  for (const d of these) {
    const w = byWeek.get(ymd(weekOf(at(d))))
    if (!w) continue
    w.n++; w.seconds += d.seconds
    if (told.includes(d)) { w.you += d.you.s; w.talk += talkOf(d); w.words += d.you.w; w.heard += d.others.w + d.unknown.w }
  }
  for (const w of weeks) { w.you = r(w.you); w.talk = r(w.talk) }
  const byKind = KIND_ORDER.map((id) => {
    const ds = told.filter((d) => kindOf(d) === id)
    return { id, n: ds.length, you: r(sum(ds, (d) => d.you.s)), talk: r(sum(ds, talkOf)) }
  }).filter((k) => k.n)

  // Signals, each from what it says: your lines that ask, your longest stretch, the recording's
  // end against the invite's, three or more meetings in a day with under 5 minutes between, and
  // your action items ticked.
  const ends = (d) => (d.end ? Date.parse(d.end) : at(d) + d.seconds * 1000)
  const timed = these.filter((d) => d.event?.end && d.event?.start)
  const ranOver = timed.filter((d) => ends(d) - Date.parse(d.event.end) > 5 * 60e3).length
  const byDay = new Map()
  for (const d of these) { const k = ymd(new Date(at(d))); byDay.set(k, [...(byDay.get(k) || []), d]) }
  let packed = 0
  for (const ds of byDay.values()) {
    let row = 1, most = 1
    for (let i = 1; i < ds.length; i++) { row = at(ds[i]) - ends(ds[i - 1]) < 5 * 60e3 ? row + 1 : 1; most = Math.max(most, row) }
    if (most >= 3) packed++
  }
  const mine = these.flatMap((d) => d.items.filter((x) => x.yours))
  const signals = {
    questions: { n: sum(told, (d) => d.you.q), meetings: told.length },
    longest: { s: told.length ? r(sum(told, (d) => d.you.run) / told.length) : 0, meetings: told.length },
    ranOver: { n: ranOver, of: timed.length },
    backToBack: { days: packed },
    followed: { done: mine.filter((x) => x.done).length, of: mine.length },
  }

  // The people you met most in the range.
  const ppl = await people({ list })
  const ids = new Set(these.map((d) => d.id))
  const top = ppl.people.map((p) => ({ id: p.id, name: p.name, n: p.meetingIds.filter((x) => ids.has(x)).length, share: p.share })).filter((p) => p.n).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 6)

  return {
    days: span || 'all', from: span ? ymd(new Date(from)) : these.length ? ymd(new Date(at(these[0]))) : null, kind,
    total: list.length, archived, recording, reread, failed, kinds,
    meetings: these.length, seconds: sum(these, (d) => d.seconds),
    prev: prev ? { meetings: prev.length, seconds: sum(prev, (d) => d.seconds) } : null,
    talk: { you: r(sum(told, (d) => d.you.s)), others: r(sum(told, (d) => d.others.s)), unknown: r(sum(told, (d) => d.unknown.s)), told: told.length, untold },
    words: { you: sum(told, (d) => d.you.w), heard: sum(told, (d) => d.others.w + d.unknown.w) },
    weeks, byKind, signals, people: top, me: me() || null,
  }
}

// ---------- People ----------
// A name as written, in an invite or on a transcript: "Priya Shah", "priya.shah2", "Priya Shah
// <priya@example.org>", "priya@example.org". Its key is its parts in order of the alphabet, so
// "Shah, Priya" is the same; an address is also known by itself.
const EMAIL = /<?([^\s<>@,;]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})>?/i
const partsOf = (s) => String(s).toLowerCase().replace(/\d+/g, '').split(/[\s.@_,-]+/).filter(Boolean)
const asWritten = (p) => (/^[a-z0-9._-]+$/.test(p) && /[._-]/.test(p) ? partsOf(p).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : p)
function variantOf(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  const em = EMAIL.exec(s)
  const email = em ? em[1].toLowerCase() : null
  const name = (em ? s.replace(em[0], '').replace(/["']/g, '').trim() : s) || (email ? email.split('@')[0] : '')
  const parts = partsOf(name)
  if (!parts.length || NOT_A_NAME.test(name)) return null
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
    out.push({
      id, name, keys, emails: [...new Set(xs.flatMap((x) => [...x.emails]))], also: [...names.keys()].filter((n) => n !== name), about,
      meetingIds: mine.map((d) => d.id), meetings: mine.length, last: mine[0]?.start || null, seconds: mine.reduce((a, d) => a + d.seconds, 0),
      share: heard.length ? { pct: talk ? Math.round((said / talk) * 100) : 0, s: Math.round(said), meetings: heard.length } : null,
      topics: null, variants, _mine: mine, _seen: seen, _theirs: theirs,
    })
  }
  // What you talk about: the summary's words in most of your meetings with them, not anyone's name.
  const nameParts = new Set(out.flatMap((p) => p.variants.flatMap((v) => v.parts)).concat(partsOf(me())))
  for (const p of out) {
    const count = new Map()
    for (const d of p._mine) for (const tp of d.topics) { const k = tp.t.toLowerCase(); if (partsOf(tp.t).every((w) => nameParts.has(w))) continue; const c = count.get(k) || { t: tp.t, n: 0, w: tp.w }; c.n++; count.set(k, c) }
    p.topics = [...count.values()].sort((a, b) => b.n - a.n || b.w - a.w || a.t.localeCompare(b.t)).slice(0, 4).map((x) => x.t)
  }
  out.sort((a, b) => b.meetings - a.meetings || String(b.last).localeCompare(String(a.last)) || a.name.localeCompare(b.name))
  return { people: out, meetings: ds.length }
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
  const [{ people: all }, cal] = await Promise.all([people(), upcoming()])
  const p = all.find((x) => x.id === pid || x.keys.includes(pid))
  if (!p) throw new Error('No such person in your meetings')
  const named = (text) => p.variants.some((v) => whole(v) && new RegExp(`(?<![\\p{L}])${v.parts.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.-]+')}(?![\\p{L}])`, 'iu').test(text))
  // An item carried from summary to summary (a weekly's, repeating it) is one: the newest, with how
  // many meetings have it.
  const items = new Map()
  for (const d of p._mine) {
    for (const x of d.items.filter((x) => !x.done && ((x.who && !x.yours && p.variants.some((v) => meetings.sameName(x.who, v.display))) || named(x.text)))) {
      const k = `${String(x.who || '').toLowerCase()}|${x.text.toLowerCase().replace(/\s+/g, ' ').trim()}`
      if (items.has(k)) items.get(k).meetings++
      else items.set(k, { text: x.text, who: x.who, yours: x.yours, meeting: { id: d.id, title: d.title, start: d.start }, meetings: 1 })
    }
  }
  const e = cal.events ? nextWith(p, cal.events) : null
  return {
    ...shown(p),
    meetingsList: p._mine.map((d) => { const s = p._theirs(d).s; const talk = d.you.s + d.others.s + d.unknown.s; return { id: d.id, title: d.title, start: d.start, seconds: d.seconds, how: p._seen.get(d.id), pct: (d.told === 'call' || d.told === 'voices') && s > 0 && talk ? Math.round((s / talk) * 100) : null } }),
    items: [...items.values()],
    next: e ? { title: e.title, start: e.start, attendees: e.attendees } : null,
    calendar: cal.events ? { ok: true } : { ok: false, error: cal.error, code: cal.code },
    // The ways their name is written, to take one out (split).
    written: p.variants.map((v) => ({ key: v.key, name: v.display })),
    others: all.filter((x) => x.id !== p.id).map((x) => ({ id: x.id, name: x.name, meetings: x.meetings })),
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
