// Memory as a page of its own (src/components/memory/Memory.jsx): what meeting memory (meetmemory.js)
// holds, put in collections (People, Organizations, Projects & Products, Terms), with the meetings
// and dictations each came up in, the people you meet (Meeting Insights, when it's on) beside the
// ones memory has, what looks the same, what looks like it adds little (for you to look over:
// nothing goes by itself), and About you.
//
// About you: a few lines made here from what memory holds (your name, your organization, what you
// work on, the people and organizations that come up most), or as you wrote it. While it's on it
// goes with what the models writing notes and tidying dictation are told (meetmemory.js about), and
// into Chief of Staff's folder as about-you.md for it to read. Nothing here asks a model or leaves
// this computer by itself.
import fs from 'node:fs'
import path from 'node:path'
import * as memory from './meetmemory.js'
import * as meetings from './meetings.js'
import * as meetWork from './meetwork.js'
import * as meetInsights from './meetinsights.js'
import * as dictations from './dictations.js'
import * as projects from './projects.js'
import { EMAIL, notPerson, withoutNote } from './notpeople.js'

let cfg = {}
let chiefDir = null // Chief of Staff's folder (index.js CHIEF_DIR)
export const configure = (c, { chief } = {}) => { cfg = c || {}; if (chief) chiefDir = chief }
const DAY = 864e5
const low = (s) => String(s || '').toLowerCase().replace(/[\s-]+/g, ' ').trim()
const me = () => String(cfg.name || '').trim()
const insightsOn = () => cfg.trials?.['meeting-insights'] === true

// ---------- What kind each one is ----------
// The kind you or a summary gave it, else a guess: a person you've met (an invite, a name on a
// transcript), an organization by its name (Inc, Labs) or an address's domain, a project of yours
// (Bridge AI's projects), else from its note ("customer", "head of data at", "our billing app").
const ORG_NAME = /\b(inc|ltd|llc|llp|plc|corp|corporation|gmbh|ag|bv|pty|limited|group|holdings|labs|partners|capital|ventures|bank|university|institute|foundation|agency|studios?)\.?$/i
const PERSON_NOTE = /\b(he|she|him|her|his|hers|head of|lead|manager|director|engineer|designer|developer|founder|co-?founder|ceo|cto|cfo|coo|vp|chief|recruiter|contact|colleague|boss|reports to|works (at|on|for)|intern|analyst|consultant|advisor|partner at|friend|candidate)\b/i
const ORG_NOTE = /\b(customer|client|prospect|partner|vendor|supplier|compan(y|ies)|firm|agency|bank|fund|investors?|startup|competitor|employer|university|college|school|government|ministry|council|charity|organi[sz]ation|team at)\b/i
const PROJECT_NOTE = /\b(product|project|app|tool|feature|platform|service|library|framework|repo|repository|model|release|launch|codename|initiative|program(me)?|plugin|extension|website|system)\b/i
const OURS = /\b(my|our)\s+(company|employer|organi[sz]ation|firm|startup|team)\b|\bwhere I work\b/i
const FREE = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|mac|aol|proton|protonmail|gmx|zoho|yandex|fastmail|hey)\./i

// The people and the organizations' domains meetings know, read from what the server already has.
function known(all) {
  const names = new Set(), domains = new Map()
  for (const m of all) {
    for (const raw of m.event?.attendees || []) {
      const em = EMAIL.exec(String(raw))
      const d = em?.[1].split('@')[1].toLowerCase()
      if (d && !FREE.test(d)) domains.set(d.split('.').slice(-2)[0], d)
      if (notPerson(raw)) continue
      const name = withoutNote(em ? String(raw).replace(em[0], '') : raw).replace(/["']/g, '').trim()
      if (name) names.add(low(name))
    }
  }
  return { names, domains }
}
function guesser({ people = [], names, domains, folders }) {
  const person = new Set([...names, ...people.flatMap((p) => [p.name, ...(p.also || [])].map(low))])
  return (t) => {
    if (t.kind) return t.kind
    const k = low(t.term), note = t.note || ''
    if (person.has(k)) return 'person'
    if (ORG_NAME.test(t.term) || domains.has(k.replace(/[^\p{L}\p{N}]/gu, ''))) return 'org'
    if (folders.has(k)) return 'project'
    if (PERSON_NOTE.test(note)) return 'person'
    if (ORG_NOTE.test(note) || OURS.test(note)) return 'org'
    if (PROJECT_NOTE.test(note)) return 'project'
    return 'term'
  }
}

// ---------- What looks the same ----------
// Written the same but for spaces, dots, case or a company's ending ("Open AI" and "OpenAI", "Acme"
// and "Acme Inc."), or a single word that's the first of exactly one longer name of the same kind
// ("Priya" and "Priya Shah", "Northwind" and "Northwind Traders"). Two you said aren't the same are
// never offered again.
const SUFFIX = /\b(inc|ltd|llc|llp|plc|corp|corporation|co|gmbh|ag|sa|bv|pty|limited)\.?$/i
const keyOf = (s) => low(s).replace(SUFFIX, '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')
function alike(items) {
  const apart = memory.aparts()
  const kept = (a, b) => apart.some((p) => p.includes(a.id) && p.includes(b.id))
  const fits = (a, b) => a.kind === b.kind || a.kind === 'term' || b.kind === 'term'
  const out = []
  const byKey = new Map()
  for (const t of items) { const k = keyOf(t.term); if (k.length >= 2) byKey.set(k, [...(byKey.get(k) || []), t]) }
  for (const group of byKey.values()) for (let i = 1; i < group.length; i++) if (!kept(group[0], group[i])) out.push([group[0], group[i]])
  const longer = new Map()
  for (const t of items) { const w = low(t.term).split(' '); if (w.length >= 2) longer.set(w[0], [...(longer.get(w[0]) || []), t]) }
  for (const t of items) {
    if (/\s/.test(t.term)) continue
    const them = (longer.get(low(t.term)) || []).filter((x) => fits(t, x))
    if (them.length === 1 && !kept(t, them[0]) && !out.some((p) => p.includes(t) && p.includes(them[0]))) out.push([them[0], t])
  }
  // The one to keep first: yours, then the one that comes up most, then the fuller name.
  const first = (a, b) => (a.source === 'you') - (b.source === 'you') || (a.meetings.length + a.dictations.length) - (b.meetings.length + b.dictations.length) || a.term.length - b.term.length
  return out.slice(0, 100).map(([a, b]) => (first(a, b) >= 0 ? [a.id, b.id] : [b.id, a.id]))
}

// ---------- What looks like it adds little ----------
// Learned ones only, none you kept: a place, a language, a time or an everyday word (meetmemory.js
// plain) with no mishearing to fix; or a term from one meeting more than a month ago, with no note,
// no mishearing and no dictation, that hasn't come up since.
function little(items, now = Date.now()) {
  const out = []
  for (const t of items) {
    if (t.source === 'you' || t.keep) continue
    const why = memory.plainFor(t.term, t.kind)
    if (why && !t.heard.length) out.push({ id: t.id, why })
    else if (t.kind === 'term' && !t.note && !t.heard.length && !t.also?.length && t.meetings.length <= 1 && !t.dictations.length && now - Date.parse(t.updatedAt || 0) > 30 * DAY) out.push({ id: t.id, why: 'once' })
  }
  return out
}

// ---------- About you ----------
// How much each one comes up: its meetings and dictations, more for the last three months.
function weigh(when) {
  const now = Date.now()
  return (t) => {
    const recent = t.meetings.some((id) => now - Date.parse(when.get(id) || 0) < 90 * DAY)
    return (t.meetings.length + t.dictations.length / 2 + (t.source === 'you' ? 1 : 0)) * (recent ? 1.5 : 1)
  }
}
const short = (s, n = 70) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length <= n ? x : `${x.slice(0, x.lastIndexOf(' ', n) > 20 ? x.lastIndexOf(' ', n) : n)}…` }
const named = (list) => list.map((x) => (x.note ? `${x.term} (${short(x.note)})` : x.term)).join(', ')
function draft(items, people, all) {
  const score = weigh(new Map(all.map((m) => [m.id, m.startedAt])))
  const top = (kind, n, but = () => true) => items.filter((t) => t.kind === kind && but(t)).sort((a, b) => score(b) - score(a) || a.term.localeCompare(b.term)).slice(0, n)
  const ownDomains = meetWork.ownDomains(all)
  const stems = new Set([...ownDomains].map((d) => d.split('.').slice(-2)[0]))
  const mine = items.find((t) => t.kind === 'org' && OURS.test(t.note || '')) || items.find((t) => t.kind === 'org' && stems.has(keyOf(t.term)))
  // People: memory's and the ones you meet most (Meeting Insights), together, without you.
  const ppl = top('person', 12, (t) => !(me() && meetings.sameName(t.term, me())))
  const score2 = new Map(ppl.map((t) => [t, score(t)]))
  for (const p of people.slice(0, 12)) {
    if (me() && meetings.sameName(p.name, me())) continue
    const have = ppl.find((t) => meetings.sameName(t.term, p.name))
    const s = (p.meetings || 0) * (Date.now() - Date.parse(p.last || 0) < 90 * DAY ? 1.5 : 1)
    if (have) score2.set(have, Math.max(score2.get(have), s))
    else { const x = { term: p.name, note: p.about || '' }; ppl.push(x); score2.set(x, s) }
  }
  const who = ppl.sort((a, b) => score2.get(b) - score2.get(a)).slice(0, 8)
  const work = top('project', 5)
  const orgs = top('org', 6, (t) => t !== mine)
  const lines = []
  if (me() || mine) lines.push(me() ? (mine ? `I'm ${me()}, at ${mine.term}.` : `I'm ${me()}.`) : `I work at ${mine.term}.`)
  else if (ownDomains.size) lines.push(`My work email is at ${[...ownDomains][0]}.`)
  if (work.length) lines.push(`What I work on: ${named(work)}.`)
  if (who.length) lines.push(`The people I deal with most: ${named(who)}.`)
  if (orgs.length) lines.push(`The organizations I deal with most: ${named(orgs)}.`)
  // Only a name isn't much to go on: nothing, until memory has something about your work.
  if (!work.length && !who.length && !orgs.length) return { text: '', names: [] }
  return { text: lines.join('\n'), names: [mine, ...work, ...who, ...orgs].filter(Boolean).map((x) => x.term) }
}

// Chief of Staff's copy, in its folder (chief.js makes it): there while About you is on, gone when
// it's off. One at a time, each as About you is when its turn comes, so an older one can't take out
// what a newer one wrote.
let chiefChain = Promise.resolve()
function syncChief() {
  chiefChain = chiefChain.then(writeChief, writeChief)
  return chiefChain
}
async function writeChief() {
  if (!chiefDir) return
  const file = path.join(chiefDir, 'about-you.md')
  const text = memory.persona()
  try {
    await fs.promises.access(chiefDir)
    if (!text) { await fs.promises.rm(file, { force: true }); return }
    const you = me() || 'the user'
    const by = memory.aboutYou().yours ? `as ${you} wrote it` : `made on this computer from ${you}'s meetings and dictations`
    const body = `# About ${you}\n\nWhat Bridge AI knows about ${you}, ${by} (Memory › About You). Bridge AI keeps this file up to date: don't edit it.\n\n${text}\n`
    const was = await fs.promises.readFile(file, 'utf8').catch(() => null)
    if (was !== body) await fs.promises.writeFile(file, body)
  } catch { /* no Chief of Staff folder yet: written once there is */ }
}

// ---------- The page ----------
// Every one with its kind, the meetings and dictations it came up in, the people you meet, what
// looks the same, what looks like it adds little, and About you; the draft of About you made again
// from it. A dictation that's gone is taken off the names it was on.
let peopleCache = { at: 0, list: [] }
async function met() {
  if (!insightsOn()) return null
  if (Date.now() - peopleCache.at < 60_000) return peopleCache.list
  const got = await meetInsights.people().catch(() => null)
  const list = (got?.people || []).map((p) => ({ id: p.id, name: p.name, also: p.also || [], emails: p.emails || [], about: p.about || null, meetings: p.meetings, meetingIds: p.meetingIds || [], last: p.last }))
  peopleCache = { at: Date.now(), list }
  return list
}

export async function view() {
  await catchUp().catch(() => 0)
  const [people, folders] = await Promise.all([met(), projects.list().catch(() => [])])
  const all = meetings.list()
  const raw = memory.list()
  const ids = [...new Set(raw.flatMap((t) => t.dictations || []))]
  const found = new Map()
  const gone = []
  await Promise.all(ids.map((id) => dictations.get(id).then((d) => found.set(id, { at: d.at, text: String(d.text || '').slice(0, 600), app: d.app?.name || null, agent: d.agent?.name || null }), () => gone.push(id))))
  if (gone.length) memory.forgetDictations(gone)
  const kind = guesser({ people: people || [], ...known(all), folders: new Set(folders.map((p) => low(p.name))) })
  const items = raw.map((t) => ({ ...t, also: t.also || [], dictations: (t.dictations || []).filter((id) => found.has(id)), kind: kind(t), guessed: !t.kind }))
  // A series: the same name three times or more, as Meeting Insights has it.
  const key = (m) => meetWork.seriesOf(m.title) || meetWork.seriesOf(m.event?.title)
  const n = new Map()
  for (const m of all) { const k = key(m); if (k) n.set(k, (n.get(k) || 0) + 1) }
  const mids = new Set(items.flatMap((x) => x.meetings || []))
  const seen = all.filter((m) => mids.has(m.id)).map((m) => [m.id, { title: m.title, startedAt: m.startedAt, series: n.get(key(m)) >= 3 ? key(m) : null }])
  const made = draft(items, people || [], all)
  if (memory.setDraft(made.text, made.names)) syncChief().catch(() => {})
  // The people you meet that memory doesn't have, the most met first.
  const others = people ? people.filter((p) => !items.some((t) => t.kind === 'person' && [t.term, ...t.also].some((n) => meetings.sameName(n, p.name)))).slice(0, 200).map(({ meetingIds, ...p }) => p) : null
  return {
    terms: items, meetings: Object.fromEntries(seen), dictations: Object.fromEntries(found),
    people: others, insights: insightsOn(), me: me() || null, dictationsKept: dictations.keeping(),
    same: alike(items), little: little(items), aboutYou: memory.aboutYou(),
  }
}

// One of the people you meet, kept in memory as a person, with the meetings you met in and what
// memory knew of them.
export async function keepPerson(pid) {
  peopleCache.at = 0
  const p = (await met() || []).find((x) => x.id === pid)
  if (!p) throw Object.assign(new Error('That person isn\'t among the people you meet'), { status: 404 })
  let t = memory.add({ term: p.name, kind: 'person', note: p.about || '', also: p.also }, { source: 'you' })
  for (const id of p.meetingIds.slice(0, 50).reverse()) t = memory.add({ term: t.term }, { source: 'you', meeting: id })
  peopleCache.at = 0
  return t
}

// About you as you set it: your words (or back to the one made from memory), on or off.
export async function setAboutYou(body = {}) {
  const r = memory.setAboutYou({ text: typeof body.text === 'string' ? body.text : null, on: typeof body.on === 'boolean' ? body.on : null })
  await syncChief()
  return r
}

// The dictations since the last look, for the names said in them (meetmemory.js mentions): the
// first time, the ones from before too, then each as it's kept.
let catching = null
export function catchUp() {
  catching ||= (async () => {
    const since = memory.dictationsAt()
    const got = []
    let before = null
    for (let i = 0; i < 40; i++) {
      const page = await dictations.list({ before, limit: 500 })
      const fresh = page.items.filter((d) => !since || d.at > since)
      got.push(...fresh)
      if (!page.more || fresh.length < page.items.length) break
      before = page.items.at(-1).at
    }
    return got.length ? memory.mentions(got) : 0
  })().finally(() => { catching = null })
  return catching
}
// One just kept: its names at once, once the ones before it have been looked at.
export function said(d) {
  if (!d?.id) return Promise.resolve(0)
  return memory.dictationsAt() ? Promise.resolve(memory.mentions([d])) : catchUp()
}

// Settings changed (your name, say): Chief of Staff's copy follows, and About you is made if it
// hasn't been yet.
export function sync() {
  if (!memory.aboutYou().at) view().catch(() => {})
  return syncChief().catch(() => {})
}
// Made again when memory has changed (a summary, a fix, a dictation), so About you keeps up without
// the page being open: looked at every quarter of an hour.
let last = -1
export function keepFresh() {
  const look = () => {
    if (memory.changed() === last) return
    view().then(() => { last = memory.changed() }, () => {})
  }
  setTimeout(look, 2 * 60 * 1000).unref?.()
  setInterval(look, 15 * 60 * 1000).unref?.()
}
