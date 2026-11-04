// Usage counts: which of Bridge AI's features get used, as numbers, only if you turn on Share
// anonymous usage counts (Settings › About & Updates; off unless you do, and never asked at setup).
// While it's on, the names on the public list (shared/telemetry-schema.json) are counted on this
// computer, a week at a time (<data>/telemetry/<week>.json); once a week is over its report goes to
// the project's endpoint, in ranges ("2-5"), and a copy of what went stays in telemetry/sent.
// While it's off, nothing is counted and nothing is sent, and turning it off forgets what wasn't
// sent yet. A report never has a name, a path, a repo or branch, a prompt, a transcript, what an
// agent wrote, an email, a host, an account, an exact time, or an ID for you or this computer: its
// nonce is new for each report, so the same install can't be followed from one week to the next.
// DO_NOT_TRACK=1 or BRIDGE_TELEMETRY=0 keeps it off, and with no endpoint set it isn't offered.
//
// Time, too, a week at a time: how long Bridge AI was in use (a window of it in front, with someone
// typing, clicking or talking to it in the last two minutes: the window says so once a minute,
// activity()) and how long it was running at all, each sent as a range ("1-5 hours"), never as
// minutes or times of day.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA, ROOT, dataFile } from './paths.js'

export const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'telemetry-schema.json'), 'utf8'))
const NAMES = new Set(Object.keys(SCHEMA.counters))
const DIR = dataFile('telemetry')
const SENT = path.join(DIR, 'sent')
// BRIDGE_COUNTS_URL (tests, or the project's own trial): where reports go instead of the schema's.
const endpoint = () => (process.env.BRIDGE_COUNTS_URL ?? SCHEMA.endpoint ?? '').trim()
// Someone who said no to all of it, for every program on this computer.
const refused = () => (process.env.DO_NOT_TRACK === '1' || process.env.BRIDGE_TELEMETRY === '0' ? (process.env.DO_NOT_TRACK === '1' ? 'DO_NOT_TRACK' : 'BRIDGE_TELEMETRY=0') : null)

// "1-5 hours": how a week's minutes are sent.
export function timeRange(min) {
  const h = (min || 0) / 60
  return !(min > 0) ? '0' : h < 1 ? 'under 1 hour' : h < 5 ? '1-5 hours' : h < 10 ? '5-10 hours' : h < 20 ? '10-20 hours' : h < 40 ? '20-40 hours' : '40+ hours'
}
// "2-5": how a count is sent.
export function bucket(n) {
  if (!(n > 0)) return '0'
  if (n === 1) return '1'
  return n <= 5 ? '2-5' : n <= 20 ? '6-20' : n <= 100 ? '21-100' : '100+'
}
// The ISO week a moment is in, on this computer's calendar: '2026-W44'. BRIDGE_COUNTS_NOW (tests)
// stands in for now.
export const now = () => (process.env.BRIDGE_COUNTS_NOW ? new Date(process.env.BRIDGE_COUNTS_NOW) : new Date())
export function weekOf(d = now()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (t.getDay() + 6) % 7 // Monday 0
  t.setDate(t.getDate() - day + 3) // that week's Thursday decides the year
  const first = new Date(t.getFullYear(), 0, 4)
  const n = 1 + Math.round(((t - first) / 864e5 - 3 + ((first.getDay() + 6) % 7)) / 7)
  return `${t.getFullYear()}-W${String(n).padStart(2, '0')}`
}

let cfg = null // the server's settings: counts.share, counts.stopped
let context = async () => ({}) // what the report says about this install (index.js)
let saveSettings = () => {} // (patch) => saved
export function configure(c, { about, save } = {}) { cfg = c; if (about) context = about; if (save) saveSettings = save }
const sharing = () => !!(cfg?.counts?.share && endpoint() && !refused())

// This week's counts, in memory and written down a few seconds after they change.
let week = null // { week, counts: { name: n }, days: [1..7], active, open (minutes), nonce, installAge, about }
let writing = null
const fileOf = (w) => path.join(DIR, `${w}.json`)
let loading = null // two counts at once wait for the same week
function current() {
  const w = weekOf()
  if (week?.week === w) return Promise.resolve(week)
  loading ||= (async () => {
    if (week) await flush()
    const kept = await fs.promises.readFile(fileOf(w), 'utf8').then(JSON.parse, () => null)
    week = kept?.week === w ? kept : await fresh(w)
    return week
  })().finally(() => { loading = null })
  return loading
}
// A week with nothing counted yet. What it says about this install is taken when it starts and
// with each count, so the report sent after the week is the one shown during it.
const fresh = async (w) => ({ week: w, counts: {}, days: [], active: 0, open: 0, nonce: crypto.randomBytes(12).toString('hex'), installAge: await installAge(), about: await context() })
// A week with nothing in it isn't written down. One that was only open, never used, is kept while
// the week goes on (it may be used yet) but isn't sent (send()).
const used = (w) => !!(Object.keys(w.counts).length || w.active > 0)
async function flush() {
  if (!week || !(used(week) || week.open > 0)) return
  await fs.promises.mkdir(DIR, { recursive: true })
  await fs.promises.writeFile(fileOf(week.week), JSON.stringify(week))
}
const later = () => { clearTimeout(writing); writing = setTimeout(() => flush().catch(() => {}), Number(process.env.BRIDGE_COUNTS_WRITE_MS || 5000)); writing.unref?.() }
function today(w) { const d = ((now().getDay() + 6) % 7) + 1; if (!w.days.includes(d)) w.days.push(d) }

// One more of a feature used (name: on the list). While sharing is off, nothing at all.
export async function add(name, by = 1) {
  if (!sharing() || !NAMES.has(name)) return
  const w = await current()
  w.counts[name] = (w.counts[name] || 0) + by
  w.about = await context()
  today(w)
  later()
}
// The most of something at once this week (agents.peak).
export async function most(name, n) {
  if (!sharing() || !NAMES.has(name) || !(n > (week?.counts[name] || 0))) return
  const w = await current()
  if (n > (w.counts[name] || 0)) { w.counts[name] = n; later() }
}
// The kind of agent started, as the list names it.
export const started = (kind) => add(NAMES.has(`agents.started.${kind}`) ? `agents.started.${kind}` : 'agents.started.other')

// How long Bridge AI has been on this computer, from when its data folder was made.
async function installAge() {
  const st = await fs.promises.stat(DATA).catch(() => null)
  const born = st && (st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs)
  if (!born) return null
  const weeks = (now() - born) / (7 * 864e5)
  return weeks < 1 ? 'week 1' : weeks < 4 ? '2-4 weeks' : weeks < 12 ? '5-12 weeks' : '13+ weeks'
}
// A week's report, exactly as it's sent.
export function report(w) {
  const c = w.about || {}
  return {
    schema: SCHEMA.schema,
    week: w.week,
    app: c.app, os: c.os, arch: c.arch, install: c.install, layout: c.layout, runtime: c.runtime, phone: c.phone,
    installAge: w.installAge || null,
    daysActive: w.days.length,
    activeTime: timeRange(w.active),
    openTime: timeRange(w.open),
    counts: Object.fromEntries(Object.entries(w.counts).filter(([k, n]) => NAMES.has(k) && n > 0).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => [k, bucket(n)])),
    nonce: w.nonce,
  }
}

// What Settings shows: whether sharing is offered here and on, where reports go, what can be
// counted, and the reports sent.
export async function status() {
  const sent = await fs.promises.readdir(SENT).then((f) => f.filter((x) => /^\d{4}-W\d\d\.json$/.test(x)).map((x) => x.slice(0, -5)).sort().reverse(), () => [])
  let to = null
  try { to = endpoint() ? new URL(endpoint()).host : null } catch { /* not a link */ }
  return {
    available: !!to && !refused(),
    refused: refused(),
    share: sharing(),
    to,
    stopped: cfg?.counts?.stopped || null,
    counters: SCHEMA.counters,
    sent,
  }
}
// The next report, exactly as it would go: a week that's over and waiting first, else this week so
// far (it goes once the week is over). While sharing is off nothing is counted, so it's a week with
// no counts: what a report says about this install, and nothing else.
export async function preview() {
  if (!sharing()) return { share: false, week: weekOf(), report: report({ ...(await fresh(weekOf())), nonce: '(new for each report)' }) }
  const waiting = (await pending())[0]
  const w = waiting ? JSON.parse(await fs.promises.readFile(fileOf(waiting), 'utf8')) : await current()
  return { share: true, week: w.week, report: report(w), goes: waiting ? 'next' : 'after this week', empty: !used(w) }
}
export async function sentReport(w) {
  if (!/^\d{4}-W\d\d$/.test(String(w))) throw new Error('No such week')
  return JSON.parse(await fs.promises.readFile(path.join(SENT, `${w}.json`), 'utf8'))
}

// Turned on, or off. Off forgets what was counted and not sent yet.
export async function setShare(on) {
  if (on && (!endpoint() || refused())) throw new Error(refused() ? `Usage counts are off on this computer (${refused()})` : 'There\'s nowhere to send usage counts yet')
  saveSettings({ counts: { share: !!on, stopped: null } })
  if (!on) {
    clearTimeout(writing)
    week = null
    for (const f of await fs.promises.readdir(DIR).catch(() => [])) if (/^\d{4}-W\d\d\.json$/.test(f)) await fs.promises.rm(path.join(DIR, f), { force: true })
  }
  return status()
}

// Weeks that are over and not sent yet, oldest first.
async function pending() {
  const w = weekOf()
  return (await fs.promises.readdir(DIR).catch(() => [])).filter((f) => /^\d{4}-W\d\d\.json$/.test(f)).map((f) => f.slice(0, -5)).filter((x) => x < w).sort()
}
// Each week that's over goes, once, while sharing is on. The endpoint can say stop (the project
// stops collecting): sharing turns off and Settings says why. A week that can't go stays for the
// next try, and is forgotten after eight weeks.
export async function send() {
  if (!sharing()) return { sent: [] }
  if (week && week.week !== weekOf()) { await flush(); week = null }
  const out = []
  for (const w of await pending()) {
    const file = fileOf(w)
    const kept = await fs.promises.readFile(file, 'utf8').then(JSON.parse, () => null)
    if (!kept || !used({ counts: {}, ...kept })) { await fs.promises.rm(file, { force: true }); continue }
    const body = report(kept)
    let r
    try {
      r = await fetch(endpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bridge-ai' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
    } catch { break }
    const said = await r.json().catch(() => ({}))
    if (said?.stop) { saveSettings({ counts: { share: false, stopped: String(said.why || 'The project stopped collecting usage counts.').slice(0, 300) } }); await setShareOffQuietly(); break }
    if (!r.ok) { if (w < weekOf(new Date(now() - 8 * 7 * 864e5))) await fs.promises.rm(file, { force: true }); break }
    await fs.promises.mkdir(SENT, { recursive: true })
    await fs.promises.writeFile(path.join(SENT, `${w}.json`), JSON.stringify(body, null, 2))
    await fs.promises.rm(file, { force: true })
    out.push(w)
  }
  return { sent: out }
}
async function setShareOffQuietly() {
  week = null
  for (const f of await fs.promises.readdir(DIR).catch(() => [])) if (/^\d{4}-W\d\d\.json$/.test(f)) await fs.promises.rm(path.join(DIR, f), { force: true })
}

// A minute of Bridge AI in use, said by a window of it (POST /api/counts/active): counted once a
// minute, however many windows and phones say so.
let lastActive = -1
export async function activity() {
  if (!sharing()) return { counted: false }
  const minute = Math.floor(now() / 60000)
  if (minute === lastActive) return { counted: false }
  lastActive = minute
  const w = await current()
  w.active = (w.active || 0) + 1
  today(w)
  later()
  return { counted: true }
}
// A minute of Bridge AI running, once a minute (BRIDGE_COUNTS_MINUTE_MS: the tests' minute). A
// computer asleep doesn't run the timer, so the time it slept isn't counted.
const MINUTE_MS = Number(process.env.BRIDGE_COUNTS_MINUTE_MS || 60000)
let ticks = 0
async function running() {
  if (!sharing()) return
  const w = await current()
  w.open = (w.open || 0) + 1
  if (++ticks % 10 === 0) later() // written down every ten minutes, and as the server stops
}

// Looks for a week to send a minute after the server starts, then every six hours; and counts the
// minutes it runs.
export function start() {
  const tick = () => send().catch(() => {})
  setTimeout(tick, Number(process.env.BRIDGE_COUNTS_FIRST_MS || 60000)).unref?.()
  setInterval(tick, 6 * 3600 * 1000).unref?.()
  setInterval(() => running().catch(() => {}), MINUTE_MS).unref?.()
}
// Stopping: this week's counts are written down first (the server's last moment, so at once).
process.on('exit', () => { if (week && sharing() && (used(week) || week.open > 0)) try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(fileOf(week.week), JSON.stringify(week)) } catch { /* next time */ } })
