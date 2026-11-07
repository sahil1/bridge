// What you asked in Bridge AI's boxes (History › Commands, with Scheduled Routines on): each message
// you sent an agent or the Chief of Staff from its message box, each new agent's first message (New,
// and the New agent dialog), a task added in the Chief of Staff's Tasks and an answer typed in Needs
// You, so you can find one again, make it a routine, and be told when you ask the same thing on a
// schedule. The page says which box a message came from; what the Chief of Staff sends other
// agents (`bridge send`), a terminal's keys and ⌘K's search never come here, and dictations have a
// history of their own (dictations.js).
//
// On this computer only, in the data folder: commands/<YYYY-MM>.jsonl, a line each, appended. One
// deleted, or older than you keep them for (90 days unless Settings › General › Command History
// says 30 days or a year), is taken out by writing its month again next to it and renaming it over
// the old one, so it's gone from the disk. With the history off, nothing is kept. Suggestions you
// dismissed are in commands/dismissed.json, so one never comes back. Every read and write is
// asynchronous and one at a time.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA } from './paths.js'
import { periodOf } from '../shared/schedule.js'

const dir = () => path.join(DATA, 'commands')
const DISMISSED = () => path.join(dir(), 'dismissed.json')
const MONTH = /^(\d{4}-\d{2})\.jsonl$/
const ID = /^[a-z0-9]{8,40}$/
const KEEP = { '30d': 30, '90d': 90, '1y': 365 }
const BOXES = ['message', 'new', 'tasks', 'reply']
const DAY = 864e5

let cfg = {}
export const configure = (c) => { cfg = c || {} }
const opts = () => cfg.commands || {}
export const keeping = () => opts().history !== false
export const keepFor = () => (KEEP[opts().keepFor] ? opts().keepFor : '90d')
const cutoff = (now = Date.now()) => now - KEEP[keepFor()] * DAY

let chain = Promise.resolve()
const one = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p }
const monthOf = (at) => new Date(at).toISOString().slice(0, 7)
const fileOf = (m) => path.join(dir(), `${m}.jsonl`)
const gone = (p) => fs.promises.rm(p, { force: true }).catch(() => {})

// Written whole or not at all: next to it, flushed, then renamed over it (tried again briefly where
// Windows holds a rename up).
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
let byId = null
let month = new Map()
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
    // Cut off by a crash mid-line: written again without that bit, so the next line starts on its own.
    if (text && !text.endsWith('\n')) {
      const whole = text.slice(0, text.lastIndexOf('\n') + 1)
      await saveWhole(path.join(dir(), f), whole).catch(() => {})
      text = whole
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let j
      try { j = JSON.parse(line) } catch { continue }
      if (j && ID.test(String(j.id || '')) && typeof j.text === 'string' && !Number.isNaN(new Date(j.at).getTime())) { map.set(j.id, j); month.set(j.id, m) }
    }
  }
  byId = map
  return map
}

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
// Where it went: an agent (its kind, name and folder), or the Chief of Staff.
function target(to = {}) {
  const o = { kind: str(to.kind, 40) || null, name: str(to.name, 120) }
  if (to.chief) o.chief = true
  if (str(to.cwd, 1000)) o.cwd = str(to.cwd, 1000)
  if (str(to.pane, 200)) o.pane = str(to.pane, 200)
  return o
}
// The message box adds the files you attached as a line of paths: kept as how many, not where.
const ATTACHED = /\n*\s*Attached: \S[^\n]*$/

// A message you sent: { text, box, to }. Nothing is kept with the history off ({ kept: false }).
export async function add({ text, box, to } = {}) {
  if (!keeping()) return { kept: false }
  let t = str(text, 20_000)
  const files = ATTACHED.test(t) ? (t.match(ATTACHED)[0].match(/\S+/g).length - 1) : 0
  t = t.replace(ATTACHED, '').trim()
  if (!t) return { kept: false }
  const rec = { id: `${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`, at: new Date().toISOString(), text: t, box: BOXES.includes(box) ? box : 'message', to: target(to), ...(files ? { files } : {}) }
  return one(async () => {
    const map = await load()
    await fs.promises.mkdir(dir(), { recursive: true })
    const m = monthOf(rec.at)
    await fs.promises.appendFile(fileOf(m), `${JSON.stringify(rec)}\n`, { mode: 0o600 })
    map.set(rec.id, rec)
    month.set(rec.id, m)
    return { kept: true, id: rec.id }
  })
}

// The newest first, without what's older than you keep them for. q: words that must all be in its
// text or where it went. before: the time to list from (the next page).
export async function list({ q = '', before = null, limit = 200 } = {}) {
  const map = await one(load)
  const from = cutoff()
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12)
  const until = before ? new Date(before).getTime() : Infinity
  const all = [...map.values()].filter((r) => new Date(r.at).getTime() >= from).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const hits = words.length ? all.filter((r) => { const hay = `${r.text}\n${r.to?.name || ''}\n${r.to?.cwd || ''}${r.to?.chief ? '\nchief of staff' : ''}`.toLowerCase(); return words.every((w) => hay.includes(w)) }) : all
  const page = hits.filter((r) => new Date(r.at).getTime() < until)
  const n = Math.max(1, Math.min(500, Number(limit) || 200))
  if (all.length < map.size) tidy().catch(() => {})
  return { items: page.slice(0, n), more: page.length > n, total: all.length, found: hits.length, history: keeping(), keepFor: keepFor() }
}

async function rewrite(m, map) {
  const keep = [...map.values()].filter((r) => month.get(r.id) === m)
  if (keep.length) await saveWhole(fileOf(m), keep.map((r) => `${JSON.stringify(r)}\n`).join(''))
  else await gone(fileOf(m))
}

// Deleted: out of its month's file at once.
export async function remove(id) {
  return one(async () => {
    const map = await load()
    const r = map.get(String(id))
    if (!r) throw Object.assign(new Error('That command isn\'t in your history anymore'), { status: 404 })
    const m = month.get(r.id)
    map.delete(r.id)
    await rewrite(m, map)
    month.delete(r.id)
    return { deleted: r.id }
  })
}

// Everything, and the suggestions you dismissed.
export async function clear() {
  return one(async () => {
    await fs.promises.rm(dir(), { recursive: true, force: true })
    byId = new Map()
    month = new Map()
    return { ok: true }
  })
}

// Older than you keep them for: taken out, a month at a time (after a list that found some, and
// once in a while: index.js).
let tidying = null
export function tidy() {
  if (tidying) return tidying
  tidying = one(async () => {
    const map = await load()
    const from = cutoff()
    const old = [...map.values()].filter((r) => new Date(r.at).getTime() < from)
    const months = new Set(old.map((r) => month.get(r.id)))
    for (const r of old) map.delete(r.id)
    for (const m of months) await rewrite(m, map)
    for (const r of old) month.delete(r.id)
    return old.length
  }).finally(() => { tidying = null })
  return tidying
}

// ---------- Asked again and again: a routine suggested ----------
// The same request (or nearly: the same words, give or take a few, numbers and dates aside) sent to
// the same place (the Chief of Staff, or an agent in the same folder) on 3 or more days, at about the
// same time each day (within two hours), on a pattern: the same weekday or two each week, every
// weekday, or every day, with at most one in five of those days left out and none off it. Still
// going: the last one within two of its periods. Not one already a routine, or one you dismissed.
// Only ever shown where your routines are (never a notification), at most three.
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'please', 'can', 'could', 'you', 'me', 'my', 'for', 'on', 'in', 'it', 'is', 'this', 'that', 'with', 'i', 'we', 'our', 'us', 'pls', 'thanks'])
const norm = (s) => String(s || '').toLowerCase().replace(/https?:\/\/\S+/g, ' link ').replace(/\d+/g, '#').replace(/[^\p{L}\p{N}#/@._-]+/gu, ' ').trim()
const wordsOf = (s) => new Set(norm(s).split(' ').map((w) => w.replace(/^[._\-/@]+|[._\-/@]+$/g, '')).filter((w) => w.length > 1 && !STOP.has(w)))
const alike = (a, b) => { if (!a.size || !b.size) return false; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n) >= 0.7 }
const placeOf = (to = {}) => (to.chief ? 'chief' : `dir:${to.cwd || ''}`)
const dayNo = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
const dateOf = (n) => { const u = new Date(n * DAY); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()) }
export const keyOf = (text, to) => crypto.createHash('sha256').update(`${placeOf(to)}\n${[...wordsOf(text)].sort().join(' ')}`).digest('hex').slice(0, 16)

async function dismissed() {
  try { const j = JSON.parse(await fs.promises.readFile(DISMISSED(), 'utf8')); return new Set(Array.isArray(j.keys) ? j.keys : []) } catch { return new Set() }
}
export async function dismiss(key) {
  if (!/^[a-f0-9]{16}$/.test(String(key || ''))) throw Object.assign(new Error('No such suggestion'), { status: 400 })
  return one(async () => {
    const keys = await dismissed()
    keys.add(key)
    await saveWhole(DISMISSED(), `${JSON.stringify({ keys: [...keys].slice(-500) })}\n`)
    return { ok: true }
  })
}

// Which pattern a set of days is on, if any: the most particular that fits.
function patternOf(days) {
  const first = days[0]
  const last = days.at(-1)
  const dows = [...new Set(days.map((n) => dateOf(n).getDay()))]
  const fits = (on) => {
    const want = []
    for (let n = first; n <= last; n++) if (on(dateOf(n).getDay())) want.push(n)
    const have = new Set(days)
    if (days.some((n) => !on(dateOf(n).getDay()))) return false
    return want.filter((n) => !have.has(n)).length <= Math.floor(want.length / 5)
  }
  const weekdays = dows.every((d) => d >= 1 && d <= 5)
  if (dows.length <= 2 && last - first >= 7 && fits((d) => dows.includes(d))) return { every: 'week', days: dows.sort((a, b) => a - b) }
  if (weekdays && dows.length >= 3 && fits((d) => d >= 1 && d <= 5)) return { every: 'weekday' }
  if (!weekdays && fits(() => true)) return { every: 'day' }
  return null
}

// routines: the ones there are ({ command, cwd, to }), so one that's already a routine isn't offered.
export async function suggestions({ routines = [], now = new Date() } = {}) {
  const map = await one(load)
  const from = cutoff(now.getTime())
  const gone = await dismissed()
  const groups = []
  const all = [...map.values()].filter((r) => new Date(r.at).getTime() >= from).sort((a, b) => (a.at < b.at ? -1 : 1))
  for (const r of all) {
    if (r.text.split(/\s+/).length < 3 && !/^\/[\w:-]+/.test(r.text)) continue // "yes", "go on": not a routine
    const w = wordsOf(r.text)
    const place = placeOf(r.to)
    const g = groups.find((x) => x.place === place && alike(x.words, w))
    if (g) g.items.push(r)
    else groups.push({ place, words: w, items: [r] })
  }
  const out = []
  for (const g of groups) {
    // A day's first time only: asked twice in a morning is still once that day.
    const byDay = new Map()
    for (const r of g.items) { const d = new Date(r.at); const n = dayNo(d); if (!byDay.has(n)) byDay.set(n, d) }
    if (byDay.size < 3) continue
    const days = [...byDay.keys()].sort((a, b) => a - b)
    const mins = [...byDay.values()].map((d) => d.getHours() * 60 + d.getMinutes()).sort((a, b) => a - b)
    if (mins.at(-1) - mins[0] > 120) continue
    const when = patternOf(days)
    if (!when) continue
    if (dayNo(now) - days.at(-1) > periodOf(when) * 2) continue // it stopped
    const mid = Math.round(mins[Math.floor((mins.length - 1) / 2)] / 15) * 15 % 1440 // the earlier middle one, to the quarter hour
    const latest = g.items.at(-1)
    const key = keyOf(latest.text, latest.to)
    if (gone.has(key)) continue
    const isRoutine = routines.some((x) => (x.to === 'chief' ? 'chief' : `dir:${x.cwd || ''}`) === g.place && alike(wordsOf(x.command), g.words))
    if (isRoutine) continue
    out.push({
      key, text: latest.text, to: latest.to, count: byDay.size, first: g.items[0].at, last: latest.at,
      when: { ...when, at: `${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}` },
    })
  }
  return out.sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1)).slice(0, 3)
}
