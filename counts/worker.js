// Bridge AI's usage counts server (counts.boldbridge.ai): a Cloudflare Worker, run once by the
// project, where a week's report goes from each Bridge AI that has Share anonymous usage counts
// turned on (server/counts.js; off unless someone turns it on).
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
import SCHEMA from '../shared/telemetry-schema.json' with { type: 'json' }

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
}
const MAX_BYTES = 16 * 1024
const KEEP_NONCES_DAYS = 70 // Bridge AI gives up on a week after eight
const DAY = 24 * 3600 * 1000

// The tables, made the first time they're needed (so a new database needs nothing run by hand).
export const TABLES = [
  'CREATE TABLE IF NOT EXISTS seen (nonce TEXT PRIMARY KEY, day TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS reports (week TEXT NOT NULL, app TEXT NOT NULL, os TEXT NOT NULL, arch TEXT NOT NULL,
    install TEXT NOT NULL, layout TEXT NOT NULL, runtime TEXT NOT NULL, phone TEXT NOT NULL, install_age TEXT NOT NULL,
    days_active INTEGER NOT NULL, n INTEGER NOT NULL,
    PRIMARY KEY (week, app, os, arch, install, layout, runtime, phone, install_age, days_active))`,
  `CREATE TABLE IF NOT EXISTS counts (week TEXT NOT NULL, name TEXT NOT NULL, bucket TEXT NOT NULL, os TEXT NOT NULL,
    install_age TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (week, name, bucket, os, install_age))`,
]
const ready = new WeakMap() // a database whose tables are made
function tables(db) {
  if (!ready.has(db)) ready.set(db, db.batch(TABLES.map((s) => db.prepare(s))).catch((e) => { ready.delete(db); throw e }))
  return ready.get(db)
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const off = (env) => { const v = String(env.COUNTS_OFF ?? '0').trim(); return v && v !== '0' ? (v === '1' ? 'Bridge AI\'s project has stopped collecting usage counts.' : v.slice(0, 300)) : null }

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
  return { week: r.week, nonce: r.nonce, about, counts, dropped }
}

async function take(req, env) {
  const stop = off(env)
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
    db.prepare(`INSERT INTO reports (week, app, os, arch, install, layout, runtime, phone, install_age, days_active, n)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1`)
      .bind(r.week, a.app, a.os, a.arch, a.install, a.layout, a.runtime, a.phone, a.installAge, a.daysActive),
    ...Object.entries(r.counts).map(([name, bucket]) => db.prepare(`INSERT INTO counts (week, name, bucket, os, install_age, n)
      VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1`).bind(r.week, name, bucket, a.os, a.installAge)),
  ])
  return json({ ok: true, ...(r.dropped ? { dropped: r.dropped } : {}) })
}

const PAGE = (stop) => `Bridge AI's usage counts server.

If you turn on Share anonymous usage counts in Bridge AI (Settings > About & Updates; off unless you
do), it sends a week's counts here once the week is over: numbers in ranges, with no name and no ID
for you or your computer. Only weekly totals are kept, and IP addresses aren't stored.
${stop ? `\nIt isn't collecting anything now: ${stop}\n` : ''}
What can be counted: https://github.com/sahil1/bridge/blob/main/shared/telemetry-schema.json
This server's code: https://github.com/sahil1/bridge/tree/main/counts
Privacy: https://github.com/sahil1/bridge/blob/main/PRIVACY.md
`

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url)
    if (pathname === '/v1/week') {
      if (req.method !== 'POST') return json({ ok: false, error: 'POST a report' }, 405)
      return take(req, env)
    }
    if (pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) return new Response(PAGE(off(env)), { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    return new Response('Not found\n', { status: 404 })
  },
  // Once a day: nonces past ten weeks go.
  async scheduled(_event, env) {
    await tables(env.DB)
    await env.DB.prepare('DELETE FROM seen WHERE day < ?').bind(new Date(Date.now() - KEEP_NONCES_DAYS * DAY).toISOString().slice(0, 10)).run()
  },
}
