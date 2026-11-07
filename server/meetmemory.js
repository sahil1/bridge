// Meeting memory: the names and terms that come up in your meetings (people, companies, products,
// jargon), how speech to text mishears them, and a note on each ("my company", "LAM's buyer").
// It's yours to edit (Meetings › Memory) and it grows by itself: a word you fix in a transcript
// with Remember on is kept, and each summary adds the names it found and the mishearings it spotted.
//
// It's used three ways: the speech engine is told how to spell them; transcripts show them fixed
// (transcript.jsonl keeps what was heard, so a fix can be undone); and the model writing notes or
// answering questions is told who and what they are.
//
// With Memory on (a beta feature: memory), it's a page of its own (memoryview.js): each name has a
// kind (a person, an organization, a project or product, a term) and the dictations it came up in
// as well as the meetings, and an "About you" made from it goes with what the models are told.
//
// Kept in <data>/meetings/memory.json: { terms: [{ id, term, kind, heard: [], also: [], note,
// source: you | learned, seen, meetings: [ids], dictations: [ids], keep, updatedAt }], apart:
// [[id, id]], aboutYou: { text, draft, names, at, off }, dictationsAt }. also: other ways it's written
// ("Priya" for "Priya Shah"), not mishearings, so a transcript never has them changed. keep: you
// said to keep it when the tidy-up offered to take it out. apart: two you said aren't the same.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA, writeFileAtomic } from './paths.js'

const FILE = path.join(DATA, 'meetings', 'memory.json')
const MAX = 2000
let terms = null
let rest = { apart: [], aboutYou: null, dictationsAt: null } // the rest of the file
let version = 0 // goes up with every change, so cached transcripts know to look again
let matcher = null
let namer = null
let cfg = {}
export const configure = (c) => { cfg = c || {} }
// The beta feature that makes memory a page, with kinds, dictations and About you (index.js TRIALS).
export const pageOn = () => cfg.trials?.memory === true

function load() {
  if (terms) return terms
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    terms = j.terms || []
    rest = { apart: Array.isArray(j.apart) ? j.apart : [], aboutYou: j.aboutYou || null, dictationsAt: j.dictationsAt || null }
  } catch { terms = [] }
  return terms
}
// quiet: nothing a transcript shows changed (a dictation noted, About you, one kept or kept apart),
// so cached transcripts and the names looked for stay as they are.
function store({ quiet = false } = {}) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileAtomic(FILE, JSON.stringify({ terms, ...rest }, null, 2))
  if (quiet) return
  version++
  matcher = null
  namer = null
}
const clean = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
const low = (s) => clean(s).toLowerCase().replace(/[\s-]+/g, ' ')
// By its name, or another way it's written (a name merged into it).
const find = (term) => load().find((t) => low(t.term) === low(term)) || load().find((t) => (t.also || []).some((a) => low(a) === low(term)))
const variants = (list, but) => [...new Set([].concat(list || []).map((h) => clean(h, 60)).filter((h) => h.length >= 2 && low(h) !== low(but)))]

// What kind of name it is, from what a summary or the page calls it.
export const KINDS = ['person', 'org', 'project', 'term']
const KIND = { person: 'person', people: 'person', org: 'org', organization: 'org', organizations: 'org', organisation: 'org', organisations: 'org', company: 'org', project: 'project', projects: 'project', product: 'project', products: 'project', term: 'term', terms: 'term' }
export const kindOf = (k) => KIND[String(k || '').toLowerCase()] || null

export const changed = () => version
export function list() {
  return [...load()].sort((a, b) => (a.source === b.source ? 0 : a.source === 'you' ? -1 : 1) || (b.seen || 0) - (a.seen || 0) || a.term.localeCompare(b.term))
}

// A term, or more about one already here: how it's misheard, a note, its kind, another way it's
// written, a meeting or a dictation it came up in. A misheard version belongs to one term only, so
// giving it to this one takes it from another. A kind you gave stays; a learned one fills an empty one.
export function add({ term, heard = [], note = '', kind = null, also = [] } = {}, { source = 'you', meeting = null, dictation = null } = {}) {
  const name = clean(term, 60)
  if (name.length < 2) throw new Error('A name or term, please')
  const vs = variants(heard, name)
  for (const t of load()) if (low(t.term) !== low(name)) t.heard = t.heard.filter((h) => !vs.some((v) => low(v) === low(h)))
  let t = find(name)
  if (!t) {
    if (load().length >= MAX) throw new Error('Meeting memory is full; remove some names first')
    t = { id: crypto.randomBytes(4).toString('hex'), term: name, heard: [], note: '', source, seen: 0, meetings: [], updatedAt: null }
    terms.push(t)
  }
  for (const v of vs) if (!t.heard.some((h) => low(h) === low(v))) t.heard.push(v)
  for (const a of variants(also, t.term)) if (!(t.also || []).some((x) => low(x) === low(a))) t.also = [...(t.also || []), a]
  // A note learned from a meeting fills an empty one, or replaces an older learned one: never yours.
  if (note && (source === 'you' || !t.note || (t.source === 'learned' && t.noteBy !== 'you'))) { t.note = clean(note, 200); t.noteBy = source }
  const k = kindOf(kind)
  if (k && (source === 'you' || !t.kind)) { t.kind = k; if (source === 'you') t.kindBy = 'you' }
  if (source === 'you') t.source = 'you'
  if (meeting && !t.meetings.includes(meeting)) { t.meetings = [...t.meetings, meeting].slice(-50); t.seen = (t.seen || 0) + 1 }
  if (dictation && !(t.dictations || []).includes(dictation)) t.dictations = [...(t.dictations || []), dictation].slice(-50)
  t.updatedAt = new Date().toISOString()
  store()
  return t
}

// Your edit of one: its spelling, how it's misheard, its note, its kind. Edited by you, it's yours.
export function update(id, { term, heard, note, kind } = {}) {
  const t = load().find((x) => x.id === id)
  if (!t) throw new Error('No such name in meeting memory')
  if (term != null) {
    const name = clean(term, 60)
    if (name.length < 2) throw new Error('A name or term, please')
    const other = find(name)
    if (other && other !== t) throw new Error(`"${other.term}" is in meeting memory already`)
    t.term = name
  }
  if (heard != null) {
    const vs = variants(heard, t.term)
    for (const x of load()) if (x !== t) x.heard = x.heard.filter((h) => !vs.some((v) => low(v) === low(h)))
    t.heard = vs
  }
  if (note != null) { t.note = clean(note, 200); t.noteBy = 'you' }
  if (kind != null) {
    if (kind && !kindOf(kind)) throw new Error('A person, an organization, a project or a term, please')
    if (kindOf(kind)) { t.kind = kindOf(kind); t.kindBy = 'you' } else { delete t.kind; delete t.kindBy }
  }
  t.source = 'you'
  t.updatedAt = new Date().toISOString()
  store()
  return t
}
export function remove(id) {
  const n = load().length
  terms = load().filter((t) => t.id !== id)
  if (terms.length === n) throw new Error('No such name in meeting memory')
  rest.apart = rest.apart.filter((p) => !p.includes(id))
  store()
  return { ok: true }
}
// Several at once (the tidy-up): those still here, taken out.
export function removeMany(ids) {
  const gone = new Set([].concat(ids || []).map(String))
  const n = load().length
  terms = load().filter((t) => !gone.has(t.id))
  rest.apart = rest.apart.filter((p) => !p.some((x) => gone.has(x)))
  if (terms.length !== n) store()
  return { removed: n - terms.length }
}
// Kept as they are: the tidy-up doesn't offer them again.
export function keep(ids) {
  const these = new Set([].concat(ids || []).map(String))
  let n = 0
  for (const t of load()) if (these.has(t.id) && !t.keep) { t.keep = true; n++ }
  if (n) store({ quiet: true })
  return { kept: n }
}

// Two that are the same: the second goes into the first, its spelling kept as another way it's
// written (not a mishearing), with its mishearings, note (when the first has none), kind, meetings
// and dictations.
export function merge(into, from) {
  const a = load().find((x) => x.id === into), b = load().find((x) => x.id === from)
  if (!a || !b) throw new Error('No such name in meeting memory')
  if (a === b) throw new Error('That\'s the same one')
  a.also = variants([...(a.also || []), b.term, ...(b.also || [])], a.term)
  a.heard = variants([...a.heard, ...b.heard], a.term)
  if (!a.note && b.note) { a.note = b.note; a.noteBy = b.noteBy }
  if (!a.kind && b.kind) { a.kind = b.kind; if (b.kindBy) a.kindBy = b.kindBy }
  a.meetings = [...new Set([...a.meetings, ...b.meetings])].slice(-50)
  a.seen = a.meetings.length
  const ds = [...new Set([...(a.dictations || []), ...(b.dictations || [])])].slice(-50)
  if (ds.length) a.dictations = ds
  if (b.source === 'you') a.source = 'you'
  if (b.keep) a.keep = true
  a.updatedAt = new Date().toISOString()
  terms = load().filter((t) => t !== b)
  rest.apart = rest.apart.filter((p) => !p.includes(b.id))
  store()
  return a
}
// Two that look alike but aren't the same: never offered as the same again.
export function apart(a, b) {
  if (!load().some((x) => x.id === a) || !load().some((x) => x.id === b)) throw new Error('No such name in meeting memory')
  if (!rest.apart.some((p) => p.includes(a) && p.includes(b))) { rest.apart.push([a, b]); store({ quiet: true }) }
  return { ok: true }
}
export function aparts() { load(); return rest.apart }

// Text with every misheard version (whole words, any case, spaces or hyphens between its words)
// written the way it should be.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const words = (keys) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.sort((a, b) => b.length - a.length).map((h) => h.split(' ').map(esc).join('[\\s-]+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
function build() {
  const map = new Map()
  for (const t of load()) for (const h of t.heard) map.set(low(h), t.term)
  if (!map.size) return { re: null, map }
  return { re: words([...map.keys()]), map }
}
export function fix(text) {
  if (!text) return text
  matcher ||= build()
  if (!matcher.re) return text
  return String(text).replace(matcher.re, (m) => matcher.map.get(low(m)) ?? m)
}

// For the speech engine: the names to listen for, yours first, then the ones that come up most,
// up to about `room` characters.
export function hint(room = 300) {
  const out = []
  let used = 0
  for (const t of list()) {
    if (used + t.term.length + 2 > room) break
    out.push(t.term)
    used += t.term.length + 2
  }
  return out.join(', ')
}

// For the model: About you (when it's on), then the names from memory that this text mentions
// (or mishears, or writes another way), with their notes, and every one of yours that has a note.
export function about(text, max = 40) {
  const s = String(text || '').toLowerCase()
  const said = (w) => w && s.includes(low(w))
  const pick = list().filter((t) => said(t.term) || t.heard.some(said) || (t.also || []).some(said) || (t.source === 'you' && t.note)).slice(0, max)
  const me = persona()
  const names = pick.length ? `Names and terms from my meeting memory (spell them this way, and they may have been misheard as shown):\n${pick.map((t) => `- ${t.term}${t.note ? `: ${t.note}` : ''}${t.heard.length ? ` (heard as ${t.heard.slice(0, 4).map((h) => `"${h}"`).join(', ')})` : ''}`).join('\n')}` : ''
  return [me && `About me, from my memory in Bridge AI:\n${me}`, names].filter(Boolean).join('\n\n')
}

// ---------- About you ----------
// A few lines on who you are, what you work on and who you deal with most, made from memory on this
// computer (memoryview.js writes the draft) or written by you, and used while Memory is on and it
// isn't switched off: with what the models writing notes and tidying dictation are told, and in
// Chief of Staff's folder.
export function aboutYou() {
  load()
  const a = rest.aboutYou || {}
  return { text: a.text ?? a.draft ?? '', draft: a.draft || '', yours: a.text != null, on: !a.off, at: a.at || null }
}
export function persona() {
  load()
  return pageOn() && !rest.aboutYou?.off ? String(rest.aboutYou?.text ?? rest.aboutYou?.draft ?? '').trim().slice(0, 2000) : ''
}
// Yours: text (empty, or the draft as it is, goes back to the one made from memory) and on.
export function setAboutYou({ text, on } = {}) {
  load()
  const a = { ...(rest.aboutYou || {}) }
  if (text != null) {
    const s = String(text).replace(/\r\n/g, '\n').trim().slice(0, 2000)
    if (!s || s === a.draft) delete a.text; else a.text = s
  }
  if (on != null) { if (on) delete a.off; else a.off = true }
  rest.aboutYou = a
  store({ quiet: true })
  return aboutYou()
}
// The draft, and the names in it (for tidying dictation, which only needs how they're spelled).
export function setDraft(text, names = []) {
  load()
  const s = String(text || '').trim().slice(0, 2000)
  const ns = [...new Set([].concat(names || []).map((n) => clean(n, 60)).filter(Boolean))].slice(0, 30)
  if ((rest.aboutYou?.draft || '') === s && JSON.stringify(rest.aboutYou?.names || []) === JSON.stringify(ns)) return false
  rest.aboutYou = { ...(rest.aboutYou || {}), draft: s, names: ns, at: new Date().toISOString() }
  store({ quiet: true })
  return true
}
export const personaNames = () => (persona() ? rest.aboutYou?.names || [] : [])

// ---------- Dictations ----------
// The names you said in dictations: each one's dictations, as the meetings it came up in are kept.
// Only names memory has already; a dictation is what speech to text heard, with no model to say
// what's a name, so nothing new is learned from one but a word you fix in it (add, with dictation).
function names() {
  const map = new Map()
  for (const t of load()) for (const w of [t.term, ...(t.also || [])]) if (low(w).length >= 2) map.set(low(w), [...(map.get(low(w)) || []), t])
  return map.size ? { re: words([...map.keys()]), map } : { re: null, map }
}
export function mentions(dictations = []) {
  namer ||= names()
  let n = 0, latest = rest.dictationsAt
  for (const d of dictations) {
    if (!d?.id) continue
    if (d.at && (!latest || d.at > latest)) latest = d.at
    if (!namer.re) continue
    for (const m of new Set(String(d.text || '').match(namer.re) || [])) {
      for (const t of namer.map.get(low(m)) || []) if (!(t.dictations || []).includes(d.id)) { t.dictations = [...(t.dictations || []), d.id].slice(-50); n++ }
    }
  }
  const moved = latest !== rest.dictationsAt
  rest.dictationsAt = latest
  if (n || moved) store({ quiet: true })
  return n
}
export function dictationsAt() { load(); return rest.dictationsAt }
// A dictation that's gone (deleted, or older than they're kept): out of every name's list.
export function forgetDictations(ids) {
  const gone = new Set([].concat(ids || []))
  let n = 0
  for (const t of load()) if (t.dictations?.some((d) => gone.has(d))) { t.dictations = t.dictations.filter((d) => !gone.has(d)); n++ }
  if (n) store({ quiet: true })
  return n
}

// ---------- What isn't worth keeping ----------
// Why a name adds nothing to memory, or null: speech to text spells it right by itself and it says
// nothing about your work. A country, region or continent; a language or nationality; a day, a
// month, a quarter or a year; an everyday acronym, title or word. Places, languages, days and
// months in English and the languages Bridge AI writes notes in, from the system's own lists (Intl).
const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'hi', 'ja', 'zh', 'ko', 'ar']
const M49 = ['001', '002', '005', '009', '011', '013', '014', '015', '017', '018', '019', '021', '029', '030', '034', '035', '039', '053', '054', '057', '061', '142', '143', '145', '150', '151', '154', '155', '202', '419']
const PLACES = 'US, USA, UK, UAE, Britain, Great Britain, England, Scotland, Wales, Northern Ireland, America, EMEA, APAC, LATAM, Americas, Middle East'
const PEOPLES = 'American, British, European, Canadian, Australian, Asian, African, Mexican, Brazilian, Indian, Israeli, Irish, Scottish, Welsh, Swiss, Belgian, Austrian, Pakistani, Nigerian, Kenyan, Egyptian, Saudi, Emirati, Singaporean, Argentine, Argentinian, Chilean, Colombian, Peruvian, Cuban, New Zealander, South African, Latin American'
const COMMON = new Set(('ai api apis app apps ceo cto cfo coo cpo cmo cio ciso cro vp svp evp avp gm md hr pr qa ui ux saas paas iaas b2b b2c d2c kpi kpis okr okrs roi mvp pdf pdfs url urls faq faqs eta eod eow eom asap fyi tbd tba pm pms po sow nda ndas rfp rfps rfi poc pocs sla slas it id ids ok okay usd eur gbp inr jpy cny aud cad q&a ama agm sme smes smb smbs crm erp sdk sdks cli gpu gpus cpu cpus ram ssd llm llms ml nlp vr iot gdpr hipaa ipo m&a gtm arr mrr cac ltv nps csat dau mau p&l capex opex '
  + 'mr mrs ms dr prof sir madam team teams product products engineering marketing sales finance legal design operations ops support roadmap strategy board budget launch beta alpha demo sprint standup retro review meeting meetings call email agenda deck slides doc docs spreadsheet dashboard report update plan morning afternoon evening today tomorrow yesterday weekend').split(' '))
const TIME = /^(q[1-4]|h[12]|fy\s?'?\d{2,4}|cy\s?\d{2,4}|q[1-4]\s?'?\d{2,4}|\d{4}s?|'\d{2}|\d{1,2}\s?(am|pm)|ytd|qtd|mtd|yoy|mom|qoq|wow)$/
const AMOUNT = /^[\d\s.,:%$€£¥₹+-]+[kmb]?$/
const fold = (s) => low(s).replace(/[.'’]/g, '').normalize('NFKD').replace(/\p{M}/gu, '')
let plainSets = null
function sets() {
  if (plainSets) return plainSets
  const place = new Set(PLACES.split(', ').map(fold)), lang = new Set(PEOPLES.split(', ').map(fold)), time = new Set()
  const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const pairs = [...AZ].flatMap((a) => [...AZ].map((b) => a + b))
  for (const l of LANGS) {
    try {
      for (const style of ['long', 'short']) {
        const r = new Intl.DisplayNames([l], { type: 'region', fallback: 'none', style })
        for (const c of [...pairs, ...M49]) { const n = r.of(c); if (n && c !== 'ZZ') place.add(fold(n)) }
      }
      const g = new Intl.DisplayNames([l], { type: 'language', fallback: 'none' })
      for (const c of pairs) { let n; try { n = g.of(c.toLowerCase()) } catch { /* not a code here */ } if (n) lang.add(fold(n)) }
      for (const month of ['long', 'short']) for (let m = 0; m < 12; m++) time.add(fold(new Intl.DateTimeFormat(l, { month, timeZone: 'UTC' }).format(Date.UTC(2024, m, 15))))
      for (const weekday of ['long', 'short']) for (let d = 0; d < 7; d++) time.add(fold(new Intl.DateTimeFormat(l, { weekday, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 1 + d))))
    } catch { /* a system without that language: the others */ }
  }
  plainSets = { place, lang, time }
  return plainSets
}
export function plain(name) {
  const k = fold(name)
  const s = sets()
  if (TIME.test(k) || s.time.has(k)) return 'time'
  if (k.length < 2 || AMOUNT.test(k)) return 'common'
  if (s.place.has(k)) return 'place'
  if (s.lang.has(k)) return 'language'
  if (COMMON.has(k)) return 'common'
  return null
}
// The same for a name of a kind: a person can be called what a place or a language is (Jordan,
// Georgia), so for one of those only a time or an everyday word counts.
export function plainFor(name, kind) {
  const why = plain(name)
  return kind === 'person' && (why === 'place' || why === 'language') ? null : why
}

// What a summary found: names by kind (people, organizations, projects and products, terms; or
// names, as older notes and the tests' model have it), kept as learned for the speech engine and
// later notes; clear mishearings ({ "Ack me": "Acme" }), taken only when the right spelling is one
// memory or the meeting already knows (`known`: its title, people and your notes) and the wrong one
// was heard; and who or what a name is ({ "Priya Shah": "Northwind's head of data" }), as a note on
// it for the meetings after: only for a name the meeting knows, and never over a note of yours.
//
// A name memory doesn't have yet is kept only when it adds something (fresh): not a place, a
// language, a time or an everyday word (plain); and a person's whole name (a first name alone could
// be anyone), or for anything else one the meeting's title, invite or your notes have, or one speech
// to text didn't write that way by itself in this meeting. One spelled right with no help and
// nothing more known about it adds nothing, and it's taken once a meeting says who or what it is
// (about). A name memory has already gets the meeting.
export function learn(found = {}, { meeting, known = '', heard = '' } = {}) {
  const { names = [], misheard = {}, about: whats = {} } = found && typeof found === 'object' ? found : {}
  let added = 0
  const k = String(known).toLowerCase(), h = String(heard).toLowerCase()
  const kinds = new Map()
  const named = []
  for (const key of ['people', 'organizations', 'organisations', 'projects', 'terms']) {
    for (const n of [].concat(found?.[key] || []).slice(0, 30)) { named.push([n, kindOf(key)]); kinds.set(low(clean(n, 60)), kindOf(key)) }
  }
  for (const n of [].concat(names || []).slice(0, 30)) named.push([n, kinds.get(low(clean(n, 60))) || null])
  const spelled = (name) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, 'u').test(String(heard))
  const fresh = (name, kind) => !plainFor(name, kind) && (kind === 'person' ? /\s/.test(name) : k.includes(low(name)) || !spelled(name))
  for (const [wrong, right] of Object.entries(misheard && typeof misheard === 'object' ? misheard : {}).slice(0, 20)) {
    const w = clean(wrong, 60), r = clean(right, 60)
    if (w.length < 3 || r.length < 2 || low(w) === low(r) || !h.includes(low(w))) continue
    if (!find(r) && !k.includes(low(r))) continue
    try { add({ term: r, heard: [w], kind: kinds.get(low(r)) }, { source: find(r)?.source || 'learned', meeting }); added++ } catch { /* full */ }
  }
  for (const [n, kind] of named) {
    const name = clean(n, 60)
    // Proper nouns only: something capitalized or with a digit, not a sentence.
    if (name.length < 2 || name.split(' ').length > 5 || !/[\p{Lu}\p{N}]/u.test(name)) continue
    if (!find(name) && !fresh(name, kind)) continue
    try { add({ term: name, kind }, { source: find(name)?.source || 'learned', meeting }); added++ } catch { /* full */ }
  }
  for (const [n, note] of Object.entries(whats && typeof whats === 'object' ? whats : {}).slice(0, 20)) {
    const name = clean(n, 60), what = clean(note, 160)
    if (name.length < 2 || what.length < 3 || !/[\p{Lu}\p{N}]/u.test(name) || !(find(name) || k.includes(low(name)) || h.includes(low(name)))) continue
    if (!find(name) && plainFor(name, kinds.get(low(name)))) continue
    try { add({ term: name, note: what, kind: kinds.get(low(name)) }, { source: find(name)?.source || 'learned', meeting }) } catch { /* full */ }
  }
  return added
}
