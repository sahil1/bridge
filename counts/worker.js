// Bridge AI's usage stats server (counts.boldbridge.ai): a Cloudflare Worker, run once by the
// project, where a week's report (and a day's, /v1/day) goes from each Bridge AI that has Share
// anonymous usage counts on (server/counts.js; on unless someone turns it off).
//
// A report is checked against the public list (shared/telemetry-schema.json): a name that isn't on
// it, or a value that isn't one of its ranges, is dropped, never kept. What's kept is only totals
// per week, in D1: how many reports said each thing (version, system, layout, how long installed,
// days used) and how many said each count was in each range. A report as it came is never stored,
// and neither is anything about who sent it: the IP address isn't read, and the Worker's logs are
// off (wrangler.toml). The report's nonce, random and new for each report, is kept for ten weeks so
// a report sent twice (its answer lost on the way) counts once.
//
// COUNTS_OFF stops it: every report is answered "stop" (with COUNTS_OFF's words if it isn't "1"),
// and Bridge AI turns sharing off and says why in Settings. README.md has the rest.
//
// The same Worker, at crashes.boldbridge.ai, takes crash reports from Bridge AIs with Send crash
// reports on (or a person clicking Send to Bold Bridge): the text Report on GitHub shows, already
// stripped of names, folders, emails and keys on the computer, and stripped again here with the
// same code (shared/crashreport.js). Each is kept for 90 days, grouped by what crashed and where,
// with nothing about who sent it. CRASHES_OFF stops it as COUNTS_OFF stops the counts.
import SCHEMA from '../shared/telemetry-schema.json' with { type: 'json' }
import { scrub } from '../shared/crashreport.js'

const NAMES = new Set(Object.keys(SCHEMA.counters))
const BUCKETS = new Set(SCHEMA.buckets.filter((b) => b !== '0'))
// What a report may say about the install; anything else is kept as "other".
const ONE_OF = {
  os: ['mac', 'windows', 'linux'],
  arch: ['arm64', 'x64'],
  install: ['desktop', 'source', 'docker'],
  layout: ['simple', 'everything'],
  runtime: ['builtin', 'herdr'],
  phone: ['paired', 'none'],
  installAge: ['week 1', '2-4 weeks', '5-12 weeks', '13+ weeks'],
  activeTime: SCHEMA.timeRanges,
  openTime: SCHEMA.timeRanges,
}
const MAX_BYTES = 16 * 1024
const KEEP_NONCES_DAYS = 70 // Bridge AI gives up on a week after eight
const KEEP_CRASHES_DAYS = 90 // unless the admin view says otherwise (settings, crashDays)
const DAY = 24 * 3600 * 1000

// The tables, made the first time they're needed (so a new database needs nothing run by hand).
export const TABLES = [
  'CREATE TABLE IF NOT EXISTS seen (nonce TEXT PRIMARY KEY, day TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS reports (week TEXT NOT NULL, app TEXT NOT NULL, os TEXT NOT NULL, arch TEXT NOT NULL,
    install TEXT NOT NULL, layout TEXT NOT NULL, runtime TEXT NOT NULL, phone TEXT NOT NULL, install_age TEXT NOT NULL,
    days_active INTEGER NOT NULL, active_time TEXT NOT NULL, open_time TEXT NOT NULL, n INTEGER NOT NULL,
    PRIMARY KEY (week, app, os, arch, install, layout, runtime, phone, install_age, days_active, active_time, open_time))`,
  `CREATE TABLE IF NOT EXISTS counts (week TEXT NOT NULL, name TEXT NOT NULL, bucket TEXT NOT NULL, os TEXT NOT NULL,
    install_age TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (week, name, bucket, os, install_age))`,
  // Each other answer a week's report gives (system version, chip, memory, cores, phones, computers,
  // each feature, each agent installed), as its own total: never the answers together.
  'CREATE TABLE IF NOT EXISTS dims (week TEXT NOT NULL, dim TEXT NOT NULL, value TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (week, dim, value))',
  // A day's reports: installs that ran each version that day, by system and whether they crashed,
  // and the updates that day, from which version.
  'CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, app TEXT NOT NULL, os TEXT NOT NULL, install TEXT NOT NULL, crashed INTEGER NOT NULL, starts TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, app, os, install, crashed, starts))',
  'CREATE TABLE IF NOT EXISTS daily_updates (day TEXT NOT NULL, app TEXT NOT NULL, from_app TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, app, from_app))',
  // What the admin view can change without a deploy: countsOff, crashesOff, crashesPerDay, crashDays.
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS crash_reports (id TEXT PRIMARY KEY, day TEXT NOT NULL, app TEXT NOT NULL, os TEXT NOT NULL,
    arch TEXT NOT NULL, install TEXT NOT NULL, kind TEXT NOT NULL, fingerprint TEXT NOT NULL, title TEXT NOT NULL,
    what TEXT NOT NULL, details TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS crash_reports_by_group ON crash_reports (fingerprint, day)',
]
const ready = new WeakMap() // a database whose tables are made
function tables(db) {
  if (!ready.has(db)) ready.set(db, db.batch(TABLES.map((s) => db.prepare(s))).catch((e) => { ready.delete(db); throw e }))
  return ready.get(db)
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
// The admin view's settings (the settings table), over wrangler.toml's vars; read again each minute
// (SETTINGS_CACHE_MS: the tests').
let kept = { at: 0, db: null, v: {} }
export async function settingsOf(env) {
  if (!env.DB) return {}
  if (kept.db === env.DB && Date.now() - kept.at < Number(env.SETTINGS_CACHE_MS ?? 60000)) return kept.v
  await tables(env.DB)
  const rows = (await env.DB.prepare('SELECT key, value FROM settings').all()).results || []
  kept = { at: Date.now(), db: env.DB, v: Object.fromEntries(rows.map((r) => [r.key, r.value])) }
  return kept.v
}
const stopped = (v, what) => { v = String(v ?? '0').trim(); return v && v !== '0' ? (v === '1' ? `Bridge AI's project has stopped collecting ${what}.` : v.slice(0, 300)) : null }
const off = async (env) => stopped((await settingsOf(env)).countsOff ?? env.COUNTS_OFF, 'usage stats')

// The ISO week a moment is in, in UTC: '2026-W45'.
export function weekOf(t) {
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3) // that week's Thursday decides the year
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const n = 1 + Math.round(((d - first) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(n).padStart(2, '0')}`
}

// A report as it's kept, or why it can't be. Weeks are compared to now, a day either side for the
// sender's time zone: one that's over, from the last ten weeks.
export function check(r, now = new Date()) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'Not a report' }
  if (!Number.isInteger(r.schema) || r.schema < 1) return { error: 'No schema number' }
  if (typeof r.nonce !== 'string' || !/^[0-9a-f]{16,64}$/.test(r.nonce)) return { error: 'No nonce' }
  const m = typeof r.week === 'string' && /^(\d{4})-W(\d\d)$/.exec(r.week)
  if (!m || +m[2] < 1 || +m[2] > 53) return { error: 'No week' }
  if (r.week > weekOf(new Date(+now + DAY)) || r.week < weekOf(new Date(+now - KEEP_NONCES_DAYS * DAY))) return { error: 'Not a recent week' }
  const about = {}
  for (const [k, allowed] of Object.entries(ONE_OF)) about[k] = r[k] == null ? 'unknown' : allowed.includes(r[k]) ? r[k] : 'other'
  about.app = typeof r.app === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r.app) ? r.app : 'other'
  about.daysActive = Number.isInteger(r.daysActive) && r.daysActive >= 0 && r.daysActive <= 7 ? r.daysActive : -1
  const counts = {}
  let dropped = 0
  for (const [k, v] of Object.entries(r.counts && typeof r.counts === 'object' ? r.counts : {})) {
    if (NAMES.has(k) && BUCKETS.has(v)) counts[k] = v
    else dropped++
  }
  // The rest, each kept as its own total (dims).
  const dims = []
  for (const k of ['memory', 'cores', 'phones', 'computers']) if (r[k] != null) dims.push([k, VALUES[k]?.includes(r[k]) ? r[k] : 'other'])
  if (r.osVersion != null) dims.push(['osVersion', textOf(r.osVersion)])
  if (r.chip != null) dims.push(['chip', textOf(r.chip)])
  for (const [k, v] of Object.entries(r.features && typeof r.features === 'object' && !Array.isArray(r.features) ? r.features : {})) {
    if (FEATURES[k]?.values?.includes(v)) dims.push([`feature.${k}`, v])
    else dropped++
  }
  for (const k of new Set(Array.isArray(r.agents) ? r.agents : [])) {
    if (AGENTS.has(k)) dims.push(['agent', k])
    else dropped++
  }
  return { week: r.week, nonce: r.nonce, about, counts, dims, dropped }
}
// A system's version or a chip's family, as the app writes them, or "other".
const textOf = (v) => (typeof v === 'string' && /^[A-Za-z][\w .,()+-]{0,39}$/.test(v) ? v : 'other')
const VALUES = SCHEMA.values || {}
const FEATURES = SCHEMA.features || {}
const AGENTS = new Set(SCHEMA.agents || [])

async function take(req, env) {
  const stop = await off(env)
  if (stop) return json({ ok: false, stop: true, why: stop })
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return json({ ok: false, error: 'Send JSON' }, 415)
  const text = await req.text()
  if (text.length > MAX_BYTES) return json({ ok: false, error: 'Too big' }, 413)
  let body
  try { body = JSON.parse(text) } catch { return json({ ok: false, error: 'Not JSON' }, 400) }
  const r = check(body)
  if (r.error) return json({ ok: false, error: r.error }, 400)
  const db = env.DB
  await tables(db)
  // Counted once: a nonce already seen is a report sent again.
  const first = await db.prepare('INSERT OR IGNORE INTO seen (nonce, day) VALUES (?, ?)').bind(r.nonce, new Date().toISOString().slice(0, 10)).run()
  if (!first.meta?.changes) return json({ ok: true, duplicate: true })
  const a = r.about
  await db.batch([
    db.prepare(`INSERT INTO reports (week, app, os, arch, install, layout, runtime, phone, install_age, days_active, active_time, open_time, n)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1`)
      .bind(r.week, a.app, a.os, a.arch, a.install, a.layout, a.runtime, a.phone, a.installAge, a.daysActive, a.activeTime, a.openTime),
    ...Object.entries(r.counts).map(([name, bucket]) => db.prepare(`INSERT INTO counts (week, name, bucket, os, install_age, n)
      VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1`).bind(r.week, name, bucket, a.os, a.installAge)),
    ...r.dims.map(([dim, value]) => db.prepare('INSERT INTO dims (week, dim, value, n) VALUES (?, ?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1').bind(r.week, dim, value)),
  ])
  return json({ ok: true, ...(r.dropped ? { dropped: r.dropped } : {}) })
}

// ---------- A day's report ----------
const DAY_RE = /^\d{4}-\d\d-\d\d$/
export function checkDay(r, now = new Date()) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'Not a report' }
  if (!Number.isInteger(r.schema) || r.schema < 1) return { error: 'No schema number' }
  if (typeof r.nonce !== 'string' || !/^[0-9a-f]{16,64}$/.test(r.nonce)) return { error: 'No nonce' }
  if (typeof r.day !== 'string' || !DAY_RE.test(r.day) || Number.isNaN(Date.parse(r.day))) return { error: 'No day' }
  // A day that's over, from the last two weeks (a day either side for the sender's time zone).
  if (r.day > new Date(+now + DAY).toISOString().slice(0, 10) || r.day < new Date(+now - 15 * DAY).toISOString().slice(0, 10)) return { error: 'Not a recent day' }
  const version = (v) => (typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : 'other')
  return {
    day: r.day, nonce: r.nonce, app: version(r.app), from: r.from == null ? null : version(r.from),
    os: ONE_OF.os.includes(r.os) ? r.os : 'other', install: ONE_OF.install.includes(r.install) ? r.install : 'other',
    crashed: r.crashed === true ? 1 : 0, starts: BUCKETS.has(r.starts) ? r.starts : 'other',
  }
}
async function takeDay(req, env) {
  const stop = await off(env)
  if (stop) return json({ ok: false, stop: true, why: stop })
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return json({ ok: false, error: 'Send JSON' }, 415)
  const text = await req.text()
  if (text.length > 4096) return json({ ok: false, error: 'Too big' }, 413)
  let body
  try { body = JSON.parse(text) } catch { return json({ ok: false, error: 'Not JSON' }, 400) }
  const r = checkDay(body)
  if (r.error) return json({ ok: false, error: r.error }, 400)
  const db = env.DB
  await tables(db)
  const first = await db.prepare('INSERT OR IGNORE INTO seen (nonce, day) VALUES (?, ?)').bind(r.nonce, new Date().toISOString().slice(0, 10)).run()
  if (!first.meta?.changes) return json({ ok: true, duplicate: true })
  await db.batch([
    db.prepare('INSERT INTO daily (day, app, os, install, crashed, starts, n) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1').bind(r.day, r.app, r.os, r.install, r.crashed, r.starts),
    ...(r.from && r.from !== r.app ? [db.prepare('INSERT INTO daily_updates (day, app, from_app, n) VALUES (?, ?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1').bind(r.day, r.app, r.from)] : []),
  ])
  return json({ ok: true })
}

// ---------- Crash reports ----------
const KINDS = ['ui', 'server', 'window', 'gpu']
const offCrashes = async (env) => stopped((await settingsOf(env)).crashesOff ?? env.CRASHES_OFF, 'crash reports')
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
// What a crash is, whoever had it: its kind, the error's first line with numbers and names taken
// out, and the first frames of its stack in Bridge AI's own code, without line numbers. Reports
// with the same fingerprint are the same crash.
export async function fingerprint(kind, title, details) {
  const plain = (s) => String(s || '').replace(/<[^>]+>/g, '<>').replace(/\b0x[0-9a-f]+\b/gi, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
  const error = /^Error: (.*)$/m.exec(details)?.[1] || title
  const frames = String(details || '').split('\n').filter((l) => /^\s*at /.test(l)).slice(0, 4).map((l) => plain(l.replace(/:\d+:\d+\)?$/, '')))
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([kind, plain(error).slice(0, 160), ...frames].join('\n')))).slice(0, 16)
}
export function checkCrash(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'Not a report' }
  if (!Number.isInteger(r.schema) || r.schema < 1) return { error: 'No schema number' }
  if (!KINDS.includes(r.kind)) return { error: 'Not a kind of crash' }
  if (typeof r.title !== 'string' || !r.title.trim() || typeof r.details !== 'string' || !r.details.trim()) return { error: 'No title or details' }
  const one = (k, allowed) => (allowed.includes(r[k]) ? r[k] : r[k] == null ? 'unknown' : 'other')
  // Stripped again, with the same code the computer used (without its names, which only it knows).
  const clean = (s, n) => scrub(String(s || '')).slice(0, n)
  return {
    kind: r.kind,
    app: typeof r.app === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r.app) ? r.app : 'other',
    os: one('os', ONE_OF.os), arch: one('arch', ONE_OF.arch), install: one('install', ONE_OF.install),
    title: clean(r.title, 200), what: clean(r.what, 2000), details: clean(r.details, 12000),
  }
}
async function takeCrash(req, env) {
  const stop = await offCrashes(env)
  if (stop) return json({ ok: false, stop: true, why: stop })
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return json({ ok: false, error: 'Send JSON' }, 415)
  const text = await req.text()
  if (text.length > 32 * 1024) return json({ ok: false, error: 'Too big' }, 413)
  let body
  try { body = JSON.parse(text) } catch { return json({ ok: false, error: 'Not JSON' }, 400) }
  const r = checkCrash(body)
  if (r.error) return json({ ok: false, error: r.error }, 400)
  const db = env.DB
  await tables(db)
  const day = new Date().toISOString().slice(0, 10)
  // A ceiling a day, so a flood can't fill the database; Bridge AI lets a report go when it's hit.
  const cap = Number((await settingsOf(env)).crashesPerDay ?? env.CRASHES_PER_DAY ?? 1000)
  const today = (await db.prepare('SELECT COUNT(*) AS n FROM crash_reports WHERE day = ?').bind(day).first())?.n || 0
  if (today >= cap) return json({ ok: false, error: 'Enough reports for today' }, 429)
  const id = hex(crypto.getRandomValues(new Uint8Array(8)))
  const fp = await fingerprint(r.kind, r.title, r.details)
  await db.prepare('INSERT INTO crash_reports (id, day, app, os, arch, install, kind, fingerprint, title, what, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, day, r.app, r.os, r.arch, r.install, r.kind, fp, r.title, r.what, r.details).run()
  return json({ ok: true })
}

// Nothing is read from here: these addresses only take reports. Anyone who opens one in a browser
// goes to what the privacy policy says about it (its headings' anchors, as GitHub makes them).
const PRIVACY = {
  counts: 'https://boldbridge.ai/privacy#usage-stats-on-unless-you-turn-them-off',
  crashes: 'https://boldbridge.ai/privacy#crash-reports-on-unless-you-turn-them-off',
}
const away = (to) => new Response(null, { status: 301, headers: { location: to, 'cache-control': 'public, max-age=3600' } })

export default {
  async fetch(req, env) {
    const { pathname, hostname } = new URL(req.url)
    // At the project's names each takes only its own (counts., crashes.), so either can be blocked
    // alone. At any other (a fork's one name, or workers.dev), both are there.
    const neither = !hostname.startsWith('counts.') && !hostname.startsWith('crashes.')
    if (hostname.startsWith('crashes.') || (neither && pathname === '/v1/report')) {
      if (pathname === '/v1/report') return req.method === 'POST' ? takeCrash(req, env) : json({ ok: false, error: 'POST a report' }, 405)
      if (pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) return away(PRIVACY.crashes)
      return new Response('Not found\n', { status: 404 })
    }
    if (pathname === '/v1/week') {
      if (req.method !== 'POST') return json({ ok: false, error: 'POST a report' }, 405)
      return take(req, env)
    }
    if (pathname === '/v1/day') return req.method === 'POST' ? takeDay(req, env) : json({ ok: false, error: 'POST a report' }, 405)
    if (pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) return away(PRIVACY.counts)
    return new Response('Not found\n', { status: 404 })
  },
  // Once a day: nonces past ten weeks go, and crash reports past 90 days.
  async scheduled(_event, env) {
    await tables(env.DB)
    await env.DB.prepare('DELETE FROM seen WHERE day < ?').bind(new Date(Date.now() - KEEP_NONCES_DAYS * DAY).toISOString().slice(0, 10)).run()
    const days = Math.max(1, Number((await settingsOf(env)).crashDays ?? KEEP_CRASHES_DAYS) || KEEP_CRASHES_DAYS)
    await env.DB.prepare('DELETE FROM crash_reports WHERE day < ?').bind(new Date(Date.now() - days * DAY).toISOString().slice(0, 10)).run()
  },
}
