// The usage counts server (counts/worker.js), run in Node with a real SQLite database standing in
// for D1, so nothing reaches Cloudflare. A report made by Bridge AI's own code (server/counts.js),
// sent by its own send() once its week is over, is taken and kept only as weekly totals: how many
// reports said each thing, and each count's range. Sent again (its answer lost on the way), it
// counts once. A name that isn't on the public list, or a value that isn't a range, is dropped and
// never kept; something unknown about the install is kept as "other". What isn't a report from the
// last ten weeks is turned away. Nothing about who sent it is kept (IP address, browser, the report
// as it came). The kill switch answers "stop", and Bridge AI turns sharing off and shows the
// reason. Once a day, nonces older than ten weeks go. And the public list, wrangler.toml and
// PRIVACY.md say where it is: counts.boldbridge.ai, with the Worker's logs off.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { ROOT, checks, freePort } from '../lib/harness.mjs'

const { ok, done } = checks('counts-server')
const read = (...p) => { try { return fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
const SCHEMA = JSON.parse(read('shared', 'telemetry-schema.json'))
const worker = (await import('../../counts/worker.js')).default
const { weekOf } = await import('../../counts/worker.js')

// D1 as Workers see it, on SQLite: prepare(sql).bind(...).run() / first() / all(), and batch().
function d1() {
  const db = new DatabaseSync(':memory:')
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } } },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  })
  return {
    sql: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN')
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out } catch (e) { db.exec('ROLLBACK'); throw e }
    },
  }
}
const rows = (db, table) => db.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => ({ ...r }))
const everything = (db) => JSON.stringify(['seen', 'reports', 'counts'].map((t) => { try { return rows(db, t) } catch { return [] } }))
const post = (env, body, headers = {}) => worker.fetch(new Request('https://counts.boldbridge.ai/v1/week', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env)
const answer = async (res) => ({ status: res.status, body: await res.json().catch(() => null) })

const now = new Date()
const lastWeek = weekOf(new Date(+now - 7 * 864e5))
const nonce = (n) => n.toString(16).padStart(24, 'a')
const report = (over = {}) => ({ schema: 1, week: lastWeek, app: '3.9.2', os: 'mac', arch: 'arm64', install: 'desktop', layout: 'simple', runtime: 'builtin', phone: 'paired', installAge: '2-4 weeks', daysActive: 4, counts: { 'agents.started.claude': '6-20', 'meetings.recorded': '1' }, nonce: nonce(1), ...over })

try {
  // ---------- Where it is ----------
  const toml = read('counts', 'wrangler.toml')
  ok(SCHEMA.endpoint === 'https://counts.boldbridge.ai/v1/week', 'the public list sends reports to https://counts.boldbridge.ai/v1/week', SCHEMA.endpoint)
  ok(/pattern = "counts\.boldbridge\.ai", custom_domain = true/.test(toml) && /\[observability\]\nenabled = false/.test(toml) && /binding = "DB"/.test(toml), 'wrangler.toml puts it on counts.boldbridge.ai, with its D1 database and the Worker\'s logs off')
  const privacy = read('PRIVACY.md')
  ok(/counts\.boldbridge\.ai/.test(privacy) && /weekly totals/.test(privacy) && /counts\/worker\.js/.test(privacy), 'PRIVACY.md names the server, says only weekly totals are kept, and where its code is')
  const page = await worker.fetch(new Request('https://counts.boldbridge.ai/'), {})
  const pageText = await page.text()
  ok(page.status === 200 && /usage counts/.test(pageText) && /telemetry-schema\.json/.test(pageText) && /PRIVACY\.md/.test(pageText), 'its own address shows what it is, what can be counted and the privacy policy', pageText.slice(0, 200))

  // ---------- A report, kept as totals ----------
  {
    const db = d1()
    const env = { DB: db, COUNTS_OFF: '0' }
    const first = await answer(await post(env, report(), { 'cf-connecting-ip': '203.0.113.77', 'user-agent': 'bridge-ai', 'x-forwarded-for': '198.51.100.9' }))
    ok(first.status === 200 && first.body?.ok === true && !first.body.duplicate, 'a report from the last week is taken', first)
    const r = rows(db, 'reports')
    ok(r.length === 1 && r[0].week === lastWeek && r[0].app === '3.9.2' && r[0].os === 'mac' && r[0].install_age === '2-4 weeks' && r[0].days_active === 4 && r[0].n === 1, 'what it says about the install is kept as one more report with those answers', r)
    const c = rows(db, 'counts')
    ok(c.length === 2 && c.every((x) => x.week === lastWeek && x.n === 1 && x.os === 'mac') && c.find((x) => x.name === 'agents.started.claude')?.bucket === '6-20' && c.find((x) => x.name === 'meetings.recorded')?.bucket === '1', 'and each count as one more report in its range', c)
    const all = everything(db)
    ok(!/203\.0\.113\.77|198\.51\.100\.9|bridge-ai"/.test(all), 'nothing about who sent it is kept: no IP address, no browser', all.slice(0, 300))
    const again = await answer(await post(env, report()))
    ok(again.status === 200 && again.body?.duplicate === true && rows(db, 'reports')[0].n === 1 && rows(db, 'counts').every((x) => x.n === 1), 'sent again with the same nonce (its answer lost on the way), it counts once, and the app is told it arrived', again)
    await post(env, report({ nonce: nonce(2), counts: { 'agents.started.claude': '6-20' } }))
    ok(rows(db, 'reports')[0].n === 2 && rows(db, 'counts').find((x) => x.name === 'agents.started.claude').n === 2 && rows(db, 'counts').find((x) => x.name === 'meetings.recorded').n === 1, 'another install\'s report with the same answers adds to the same totals')

    // Every name on the list, each range.
    const names = Object.keys(SCHEMA.counters)
    const ranges = SCHEMA.buckets.filter((b) => b !== '0')
    const full = await answer(await post(env, report({ nonce: nonce(3), counts: Object.fromEntries(names.map((n, i) => [n, ranges[i % ranges.length]])) })))
    ok(full.body?.ok === true && !full.body.dropped && names.every((n) => rows(db, 'counts').some((x) => x.name === n)), `every name on the public list is taken (${names.length})`, full)
  }

  // ---------- What isn't on the list ----------
  {
    const db = d1()
    const env = { DB: db }
    const odd = await answer(await post(env, report({ os: 'freebsd', arch: 'riscv', app: 'my fork', layout: undefined, daysActive: 12, extra: 'secret-project/notes-of-priya.txt', counts: { 'agents.started.claude': '2-5', 'repo.name': 'acme/secret', 'meetings.recorded': '7', 'prs.opened': '0' } })))
    const r = rows(db, 'reports')[0]
    ok(odd.status === 200 && odd.body?.dropped === 3 && r.os === 'other' && r.arch === 'other' && r.app === 'other' && r.layout === 'unknown' && r.days_active === -1, 'something unknown about the install is kept as "other" (or "unknown" when it isn\'t said), never as sent', { odd, r })
    const all = everything(db)
    ok(rows(db, 'counts').length === 1 && !/secret|priya|freebsd|riscv|my fork|repo\.name/.test(all), 'a name that isn\'t on the list, or a value that isn\'t a range (or 0), is dropped and never kept', all)
  }

  // ---------- Turned away ----------
  {
    const db = d1()
    const env = { DB: db }
    const cases = [
      ['no nonce', report({ nonce: undefined }), 400],
      ['a nonce that isn\'t random hex', report({ nonce: 'priya@example.com' }), 400],
      ['no schema number', report({ schema: 'one' }), 400],
      ['a week from long ago', report({ week: '2020-W10' }), 400],
      ['a week that hasn\'t come yet', report({ week: weekOf(new Date(+now + 21 * 864e5)) }), 400],
      ['a week that isn\'t one', report({ week: '2026-W99' }), 400],
      ['a list, not a report', [report()], 400],
      ['not JSON', 'week=2026-W40', 400],
    ]
    for (const [what, body, status] of cases) {
      const a = await answer(await post(env, body))
      ok(a.status === status && a.body?.ok === false, `${what}: turned away (${status})`, a)
    }
    const big = await answer(await post(env, report({ counts: { pad: 'x'.repeat(20000) } })))
    ok(big.status === 413, 'something bigger than any report could be: turned away (413)', big)
    const form = await answer(await worker.fetch(new Request('https://counts.boldbridge.ai/v1/week', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(report()) }), env))
    ok(form.status === 415, 'not sent as JSON: turned away (415)', form)
    const get = await worker.fetch(new Request('https://counts.boldbridge.ai/v1/week'), env)
    const other = await worker.fetch(new Request('https://counts.boldbridge.ai/admin'), env)
    ok(get.status === 405 && other.status === 404, 'reading the reports address, or any other, gives nothing', { get: get.status, other: other.status })
    ok(everything(db) === '[[],[],[]]', 'and none of it was kept', everything(db))
  }

  // ---------- The kill switch ----------
  {
    const db = d1()
    const stop = await answer(await post({ DB: db, COUNTS_OFF: '1' }, report()))
    ok(stop.body?.stop === true && /stopped collecting/.test(stop.body.why) && everything(db) === '[[],[],[]]', 'COUNTS_OFF=1: every report is answered "stop", with nothing kept', stop)
    const said = await answer(await post({ DB: db, COUNTS_OFF: 'Paused while we move to a new database.' }, report()))
    ok(said.body?.why === 'Paused while we move to a new database.', 'COUNTS_OFF with a sentence of its own: that sentence is the reason', said)
    const page = await (await worker.fetch(new Request('https://counts.boldbridge.ai/'), { COUNTS_OFF: '1' })).text()
    ok(/isn't collecting anything now/.test(page), 'and its page says it isn\'t collecting', page)
  }

  // ---------- Once a day ----------
  {
    const db = d1()
    await post({ DB: db }, report())
    db.sql.prepare('INSERT INTO seen (nonce, day) VALUES (?, ?)').run(nonce(9), '2020-01-01')
    await worker.scheduled({}, { DB: db })
    const seen = rows(db, 'seen').map((x) => x.nonce)
    ok(seen.length === 1 && seen[0] === nonce(1), 'once a day, nonces older than ten weeks go and recent ones stay', seen)
  }

  // ---------- Bridge AI's own send(), end to end ----------
  {
    const db = d1()
    const env = { DB: db }
    const port = await freePort()
    const srv = http.createServer(async (req, res) => {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const r = await worker.fetch(new Request(`https://counts.boldbridge.ai${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] || '' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }), env)
      res.writeHead(r.status, Object.fromEntries(r.headers))
      res.end(Buffer.from(await r.arrayBuffer()))
    }).listen(port, '127.0.0.1')
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-counts-server-'))
    process.env.BRIDGE_HOME = home
    process.env.BRIDGE_COUNTS_URL = `http://127.0.0.1:${port}/v1/week`
    delete process.env.DO_NOT_TRACK
    delete process.env.BRIDGE_TELEMETRY
    const c = await import('../../server/counts.js')
    let settings = { counts: { share: true } }
    c.configure(settings, { about: async () => ({ app: '3.9.2', os: 'linux', arch: 'x64', install: 'docker', layout: 'everything', runtime: 'builtin', phone: 'none' }), save: (patch) => { settings = { ...settings, ...patch }; c.configure(settings) } })
    // A week that's over, as Bridge AI writes it down.
    const kept = { week: lastWeek, counts: { 'agents.started.codex': 3, 'voice.transcribed': 40 }, days: [1, 2, 5], nonce: 'b'.repeat(24), installAge: '13+ weeks', about: { app: '3.9.2', os: 'linux', arch: 'x64', install: 'docker', layout: 'everything', runtime: 'builtin', phone: 'none' } }
    fs.mkdirSync(path.join(home, 'telemetry'), { recursive: true })
    fs.writeFileSync(path.join(home, 'telemetry', `${lastWeek}.json`), JSON.stringify(kept))
    const sent = await c.send()
    const r = rows(db, 'reports')
    const cs = rows(db, 'counts')
    ok(sent.sent.join() === lastWeek && fs.existsSync(path.join(home, 'telemetry', 'sent', `${lastWeek}.json`)), 'Bridge AI\'s own send() delivers a week that\'s over, and keeps its copy of what went', sent)
    ok(r.length === 1 && r[0].os === 'linux' && r[0].install === 'docker' && r[0].install_age === '13+ weeks' && r[0].days_active === 3 && cs.find((x) => x.name === 'agents.started.codex')?.bucket === '2-5' && cs.find((x) => x.name === 'voice.transcribed')?.bucket === '21-100', 'and the server keeps it as totals, in the same ranges the app showed', { r, cs })
    // The project stops collecting: the app turns sharing off and says why.
    env.COUNTS_OFF = 'Paused for now.'
    fs.writeFileSync(path.join(home, 'telemetry', `${weekOf(new Date(+now - 14 * 864e5))}.json`), JSON.stringify({ ...kept, week: weekOf(new Date(+now - 14 * 864e5)), nonce: 'c'.repeat(24) }))
    await c.send()
    ok(settings.counts?.share === false && settings.counts?.stopped === 'Paused for now.', 'when the server answers "stop", Bridge AI turns sharing off and keeps the reason to show', settings.counts)
    srv.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
}

process.exit(done().fail ? 1 : 0)
