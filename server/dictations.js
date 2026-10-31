// Your dictations, kept (Settings › Voice › Dictation History): what you said with the
// dictation key, inside Bridge AI or in another app, so it's never lost in an app that didn't take
// it. Each one: when and how long, the text as it was put in and as it was heard (before the light
// cleanup), where it went (the app you were in, by name and bundle ID; an agent or the Chief of
// Staff; a terminal; a box in Bridge AI) and whether it was pasted, sent, typed or copied. The
// recording itself only with "Keep the recordings too" (off until you turn it on).
//
// On this computer only, in the data folder: dictations/<YYYY-MM>.jsonl, a line per dictation and
// a line per change to one (pasted, then sent, say), appended and never edited in place; the
// recordings in dictations/audio/<id>.wav, and the icons of the apps you dictated into in
// dictations/icons/<bundle ID>.png (the desktop app puts them there: desktop/dictation.js). A
// dictation deleted, or one older than you keep them for, is taken out of its month's file by
// writing the month again next to it and renaming it over the old one, so it's gone from the disk,
// not just hidden, and a crash leaves one month or the other, never half. Every read and write is
// asynchronous and one at a time.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA } from './paths.js'

const dir = () => path.join(DATA, 'dictations')
const AUDIO = () => path.join(dir(), 'audio')
const ICONS = () => path.join(dir(), 'icons')
const MONTH = /^(\d{4}-\d{2})\.jsonl$/
const ID = /^[a-z0-9]{8,40}$/
// A bundle ID as macOS has them (com.tinyspeck.slackmacgap), and nothing that walks out of the folder.
export const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const KEEP = { '30d': 30, '1y': 365 }
const DAY = 864e5

let cfg = {}
let nameOf = () => null // an agent's name and whether it's the chief, by its pane (index.js)
export function configure(c, { agent } = {}) { cfg = c || {}; if (agent) nameOf = agent }
const opts = () => cfg.dictation || {}
export const keeping = () => opts().history !== false
// How long they're kept: 30d, 1y or always (the default: nothing you said goes away by itself).
export const keepFor = () => (KEEP[opts().keepFor] ? opts().keepFor : 'always')
const cutoff = (now = Date.now()) => (KEEP[keepFor()] ? now - KEEP[keepFor()] * DAY : 0)

// One at a time: an append never lands in the middle of a month being written again.
let chain = Promise.resolve()
const one = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p }

const monthOf = (at) => new Date(at).toISOString().slice(0, 7)
const fileOf = (month) => path.join(dir(), `${month}.jsonl`)
const audioOf = (id) => path.join(AUDIO(), `${id}.wav`)
const gone = (p) => fs.promises.rm(p, { force: true }).catch(() => {})

// Written whole or not at all: next to it, flushed, then renamed over it. Windows can refuse a
// rename for a moment (a virus scan, a backup): tried again briefly.
async function saveWhole(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  const fh = await fs.promises.open(tmp, 'w', 0o600)
  try { await fh.writeFile(data); await fh.sync() } finally { await fh.close() }
  for (const wait of [15, 40, 100, 250, null]) {
    try { await fs.promises.rename(tmp, file); return } catch (e) {
      if (!wait || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { await gone(tmp); throw e }
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

// ---------- What's kept, read once and then kept up to date here ----------
// byId: id -> the dictation as it stands (its changes applied); month: id -> its month.
let byId = null
let month = new Map()
const fold = (map, line, m) => {
  let j
  try { j = JSON.parse(line) } catch { return false } // a line cut off by a crash: skipped
  if (!j || typeof j !== 'object' || !ID.test(String(j.id || ''))) return true
  if (j.set) { const was = map.get(j.id); if (was) map.set(j.id, { ...was, ...clip(j.set) }) } else if (typeof j.text === 'string') { map.set(j.id, j); month.set(j.id, m) }
  return true
}
async function load() {
  if (byId) return byId
  const map = new Map()
  month = new Map()
  let names = []
  try { names = (await fs.promises.readdir(dir())).filter((f) => MONTH.test(f)).sort() } catch { /* nothing kept yet */ }
  for (const f of names) {
    const m = MONTH.exec(f)[1]
    let text = ''
    try { text = await fs.promises.readFile(path.join(dir(), f), 'utf8') } catch { continue }
    // Cut off by a crash mid-line: the month written again without that bit, so the next line
    // appended starts on a line of its own.
    if (text && !text.endsWith('\n')) {
      const whole = text.slice(0, text.lastIndexOf('\n') + 1)
      await saveWhole(path.join(dir(), f), whole).catch(() => {})
      text = whole
    }
    for (const line of text.split('\n')) if (line.trim()) fold(map, line, m)
  }
  byId = map
  return map
}

// Only what a dictation is made of, each part checked and cut to size.
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined)
const HOW = ['pasted', 'sent', 'typed', 'copied']
const PLACE = ['terminal', 'field']
function clip(r = {}) {
  const o = {}
  if ('how' in r) o.how = HOW.includes(r.how) ? r.how : null
  if (r.app && typeof r.app === 'object') {
    const a = { name: str(r.app.name, 80) || '' }
    if (BUNDLE.test(String(r.app.bundle || ''))) a.bundle = r.app.bundle
    if (a.name || a.bundle) o.app = a
  }
  if (r.agent && typeof r.agent === 'object' && str(r.agent.id, 200)) {
    const known = nameOf(r.agent.id) || {}
    o.agent = { id: str(r.agent.id, 200), name: str(r.agent.name, 120) || known.name || '', ...(r.agent.chief || known.chief ? { chief: true } : {}) }
  }
  if (PLACE.includes(r.place)) o.place = r.place
  if (r.audio === true) o.audio = true
  return o
}

// The newest first, without what's older than you keep them for. q: words that must all be in its
// text, what was heard, or the app's or agent's name. before: the time to list from (for the next
// page). Also how it's set: history on, how long, the recordings.
export async function list({ q = '', before = null, limit = 200 } = {}) {
  const map = await one(load)
  const from = cutoff()
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12)
  const until = before ? new Date(before).getTime() : Infinity
  const all = [...map.values()].filter((r) => new Date(r.at).getTime() >= from).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const hits = words.length ? all.filter((r) => { const hay = `${r.text}\n${r.raw || ''}\n${r.app?.name || ''}\n${r.agent?.name || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)) }) : all
  const page = hits.filter((r) => new Date(r.at).getTime() < until)
  const n = Math.max(1, Math.min(500, Number(limit) || 200))
  if (all.length < map.size) tidy().catch(() => {})
  const icons = await iconList()
  return {
    items: page.slice(0, n).map((r) => (r.app?.bundle && icons.has(r.app.bundle) ? { ...r, icon: true } : r)),
    more: page.length > n, total: all.length, found: hits.length,
    history: keeping(), keepFor: keepFor(), keepAudio: opts().keepAudio === true,
  }
}
export async function get(id) {
  const r = (await one(load)).get(String(id))
  if (!r || new Date(r.at).getTime() < cutoff()) throw Object.assign(new Error('That dictation isn\'t here anymore'), { status: 404 })
  return r
}

// A new one, from the page that heard it: { text, raw, ms, at, how, app, agent, place }. Nothing is
// kept with history off ({ kept: false }). restore: one deleted a moment ago, put back as it was
// (Undo), with its id and time (and its recording, kept in memory meanwhile).
export async function add(body = {}, { restore = false } = {}) {
  if (!keeping() && !restore) return { kept: false }
  const text = str(body.text, 100_000)
  if (!text || !text.trim()) throw Object.assign(new Error('Nothing was said'), { status: 400 })
  const at = restore && !Number.isNaN(new Date(body.at).getTime()) ? new Date(body.at).toISOString() : new Date().toISOString()
  const id = restore && ID.test(String(body.id || '')) ? body.id : `${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`
  // What was heard, when the cleanup changed it.
  const raw = str(body.raw, 100_000)
  const rec = { id, at, ms: Math.max(0, Math.min(3_600_000, Math.round(Number(body.ms) || 0))), text, ...(raw && raw !== text ? { raw } : {}), ...clip(body) }
  if (!('how' in rec)) rec.how = null
  const back = restore ? undo.get(id) : null
  if (!back?.audio) delete rec.audio
  return one(async () => {
    const map = await load()
    if (map.has(id)) return { kept: true, id }
    await fs.promises.mkdir(dir(), { recursive: true })
    const m = monthOf(at)
    await fs.promises.appendFile(fileOf(m), `${JSON.stringify(rec)}\n`, { mode: 0o600 })
    map.set(id, rec)
    month.set(id, m)
    if (back?.audio) { await saveWhole(audioOf(id), back.audio).catch(() => {}); undo.delete(id) }
    return { kept: true, id }
  })
}

// What became of it (pasted, sent to an agent, copied): a line saying so, after the first.
export async function update(id, body = {}) {
  const set = clip(body)
  delete set.audio
  if (!Object.keys(set).length) return get(id)
  return one(async () => {
    const map = await load()
    const r = map.get(String(id))
    if (!r) throw Object.assign(new Error('That dictation isn\'t here anymore'), { status: 404 })
    await fs.promises.appendFile(fileOf(month.get(r.id)), `${JSON.stringify({ id: r.id, set })}\n`, { mode: 0o600 })
    const next = { ...r, ...set }
    map.set(r.id, next)
    return next
  })
}

// A month written again with only what stays (each kept one as it stands now, its changes folded in).
async function rewrite(m, map) {
  const keep = [...map.values()].filter((r) => month.get(r.id) === m)
  if (keep.length) await saveWhole(fileOf(m), keep.map((r) => `${JSON.stringify(r)}\n`).join(''))
  else await gone(fileOf(m))
}

// Deleted: out of its month's file and its recording gone, at once. What was deleted is held in
// memory for a minute, for Undo (the page has the text; this keeps the recording).
const undo = new Map() // id -> { audio, at }
export async function remove(id) {
  return one(async () => {
    const map = await load()
    const r = map.get(String(id))
    if (!r) throw Object.assign(new Error('That dictation isn\'t here anymore'), { status: 404 })
    const m = month.get(r.id)
    map.delete(r.id)
    await rewrite(m, map)
    month.delete(r.id)
    let audio = null
    if (r.audio) { audio = await fs.promises.readFile(audioOf(r.id)).catch(() => null); await gone(audioOf(r.id)) }
    for (const [k, v] of undo) if (Date.now() - v.at > 60_000) undo.delete(k)
    undo.set(r.id, { audio, at: Date.now() })
    return { deleted: r }
  })
}

// Every dictation, every recording and every app's icon.
export async function clear() {
  return one(async () => {
    await fs.promises.rm(dir(), { recursive: true, force: true })
    byId = new Map()
    month = new Map()
    undo.clear()
    icons = { at: 0, set: new Set() }
    return { ok: true }
  })
}

// Older than you keep them for: taken out, a month at a time. Asked for after a list that found
// some, and once in a while (index.js).
let tidying = null
export function tidy() {
  if (tidying) return tidying
  tidying = one(async () => {
    const map = await load()
    const from = cutoff()
    if (!from) return 0
    const old = [...map.values()].filter((r) => new Date(r.at).getTime() < from)
    const months = new Set(old.map((r) => month.get(r.id)))
    for (const r of old) { map.delete(r.id); if (r.audio) await gone(audioOf(r.id)) }
    for (const m of months) await rewrite(m, map)
    for (const r of old) month.delete(r.id)
    return old.length
  }).finally(() => { tidying = null })
  return tidying
}

// ---------- The recording, with "Keep the recordings too" ----------
export async function saveAudio(id, buf) {
  if (opts().keepAudio !== true) return { kept: false }
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw Object.assign(new Error('Not a recording'), { status: 400 })
  await get(id)
  await saveWhole(audioOf(String(id)), buf)
  return one(async () => {
    const map = await load()
    const r = map.get(String(id))
    if (!r) return { kept: false }
    await fs.promises.appendFile(fileOf(month.get(r.id)), `${JSON.stringify({ id: r.id, set: { audio: true } })}\n`, { mode: 0o600 })
    map.set(r.id, { ...r, audio: true })
    return { kept: true }
  })
}
export async function audioFile(id) {
  const r = await get(id)
  if (!r.audio) throw Object.assign(new Error('Its recording wasn\'t kept'), { status: 404 })
  return audioOf(r.id)
}

// ---------- The apps' icons ----------
let icons = { at: 0, set: new Set() }
async function iconList() {
  if (Date.now() - icons.at < 15_000) return icons.set
  let names = []
  try { names = await fs.promises.readdir(ICONS()) } catch { /* none yet */ }
  icons = { at: Date.now(), set: new Set(names.filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))) }
  return icons.set
}
export const iconFile = (bundle) => (BUNDLE.test(String(bundle || '')) ? path.join(ICONS(), `${bundle}.png`) : null)
