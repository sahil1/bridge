// Meeting memory: the names and terms that come up in your meetings (people, companies, products,
// jargon), how speech to text mishears them, and a note on each ("my company", "LAM's buyer").
// It's yours to edit (Meetings › Memory) and it grows by itself: a word you fix in a transcript
// with Remember on is kept, and each summary adds the names it found and the mishearings it spotted.
//
// It's used three ways: the speech engine is told how to spell them; transcripts show them fixed
// (transcript.jsonl keeps what was heard, so a fix can be undone); and the model writing notes or
// answering questions is told who and what they are.
//
// Kept in <data>/meetings/memory.json: { terms: [{ id, term, heard: [], note, source: you | learned,
// seen, meetings: [ids], updatedAt }] }.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA, writeFileAtomic } from './paths.js'

const FILE = path.join(DATA, 'meetings', 'memory.json')
const MAX = 2000
let terms = null
let version = 0 // goes up with every change, so cached transcripts know to look again
let matcher = null

function load() {
  if (terms) return terms
  try { terms = JSON.parse(fs.readFileSync(FILE, 'utf8')).terms || [] } catch { terms = [] }
  return terms
}
function store() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileAtomic(FILE, JSON.stringify({ terms }, null, 2))
  version++
  matcher = null
}
const clean = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
const low = (s) => clean(s).toLowerCase().replace(/[\s-]+/g, ' ')
const find = (term) => load().find((t) => low(t.term) === low(term))

export const changed = () => version
export function list() {
  return [...load()].sort((a, b) => (a.source === b.source ? 0 : a.source === 'you' ? -1 : 1) || (b.seen || 0) - (a.seen || 0) || a.term.localeCompare(b.term))
}

// A term, or more about one already here: how it's misheard, a note, a meeting it came up in.
// A misheard version belongs to one term only, so giving it to this one takes it from another.
export function add({ term, heard = [], note = '' } = {}, { source = 'you', meeting = null } = {}) {
  const name = clean(term, 60)
  if (name.length < 2) throw new Error('A name or term, please')
  const variants = [...new Set([].concat(heard || []).map((h) => clean(h, 60)).filter((h) => h.length >= 2 && low(h) !== low(name)))]
  for (const t of load()) if (low(t.term) !== low(name)) t.heard = t.heard.filter((h) => !variants.some((v) => low(v) === low(h)))
  let t = find(name)
  if (!t) {
    if (load().length >= MAX) throw new Error('Meeting memory is full; remove some names first')
    t = { id: crypto.randomBytes(4).toString('hex'), term: name, heard: [], note: '', source, seen: 0, meetings: [], updatedAt: null }
    terms.push(t)
  }
  for (const v of variants) if (!t.heard.some((h) => low(h) === low(v))) t.heard.push(v)
  // A note learned from a meeting fills an empty one, or replaces an older learned one: never yours.
  if (note && (source === 'you' || !t.note || (t.source === 'learned' && t.noteBy !== 'you'))) { t.note = clean(note, 200); t.noteBy = source }
  if (source === 'you') t.source = 'you'
  if (meeting && !t.meetings.includes(meeting)) { t.meetings = [...t.meetings, meeting].slice(-50); t.seen = (t.seen || 0) + 1 }
  t.updatedAt = new Date().toISOString()
  store()
  return t
}

// Your edit of one: its spelling, how it's misheard, its note. Edited by you, it's yours.
export function update(id, { term, heard, note } = {}) {
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
    const variants = [...new Set([].concat(heard).map((h) => clean(h, 60)).filter((h) => h.length >= 2 && low(h) !== low(t.term)))]
    for (const x of load()) if (x !== t) x.heard = x.heard.filter((h) => !variants.some((v) => low(v) === low(h)))
    t.heard = variants
  }
  if (note != null) { t.note = clean(note, 200); t.noteBy = 'you' }
  t.source = 'you'
  t.updatedAt = new Date().toISOString()
  store()
  return t
}
export function remove(id) {
  const n = load().length
  terms = load().filter((t) => t.id !== id)
  if (terms.length === n) throw new Error('No such name in meeting memory')
  store()
  return { ok: true }
}

// Text with every misheard version (whole words, any case, spaces or hyphens between its words)
// written the way it should be.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function build() {
  const map = new Map()
  for (const t of load()) for (const h of t.heard) map.set(low(h), t.term)
  if (!map.size) return { re: null, map }
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map((h) => h.split(' ').map(esc).join('[\\s-]+'))
  return { re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu'), map }
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

// For the model: the names from memory that this text mentions (or mishears), with their notes,
// and every one of yours that has a note.
export function about(text, max = 40) {
  const s = String(text || '').toLowerCase()
  const said = (w) => w && s.includes(low(w))
  const pick = list().filter((t) => said(t.term) || t.heard.some(said) || (t.source === 'you' && t.note)).slice(0, max)
  if (!pick.length) return ''
  return `Names and terms from my meeting memory (spell them this way, and they may have been misheard as shown):\n${pick.map((t) => `- ${t.term}${t.note ? `: ${t.note}` : ''}${t.heard.length ? ` (heard as ${t.heard.slice(0, 4).map((h) => `"${h}"`).join(', ')})` : ''}`).join('\n')}`
}

// What a summary found: names (kept as learned, for the speech engine and later notes), clear
// mishearings ({ "Ack me": "Acme" }), taken only when the right spelling is one memory or the
// meeting already knows (`known`: its title, people and your notes) and the wrong one was heard,
// and who or what a name is ({ "Priya Shah": "Northwind's head of data" }), as a note on it for the
// meetings after: only for a name the meeting knows, and never over a note of yours.
export function learn({ names = [], misheard = {}, about = {} } = {}, { meeting, known = '', heard = '' } = {}) {
  let added = 0
  const k = String(known).toLowerCase(), h = String(heard).toLowerCase()
  for (const [wrong, right] of Object.entries(misheard && typeof misheard === 'object' ? misheard : {}).slice(0, 20)) {
    const w = clean(wrong, 60), r = clean(right, 60)
    if (w.length < 3 || r.length < 2 || low(w) === low(r) || !h.includes(low(w))) continue
    if (!find(r) && !k.includes(low(r))) continue
    try { add({ term: r, heard: [w] }, { source: find(r)?.source || 'learned', meeting }); added++ } catch { /* full */ }
  }
  for (const n of [].concat(names || []).slice(0, 30)) {
    const name = clean(n, 60)
    // Proper nouns only: something capitalized or with a digit, not a sentence.
    if (name.length < 2 || name.split(' ').length > 5 || !/[\p{Lu}\p{N}]/u.test(name)) continue
    try { add({ term: name }, { source: find(name)?.source || 'learned', meeting }); added++ } catch { /* full */ }
  }
  for (const [n, note] of Object.entries(about && typeof about === 'object' ? about : {}).slice(0, 20)) {
    const name = clean(n, 60), what = clean(note, 160)
    if (name.length < 2 || what.length < 3 || !/[\p{Lu}\p{N}]/u.test(name) || !(find(name) || k.includes(low(name)) || h.includes(low(name)))) continue
    try { add({ term: name, note: what }, { source: find(name)?.source || 'learned', meeting }) } catch { /* full */ }
  }
  return added
}
