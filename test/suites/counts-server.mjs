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
//
// The update channel (stable or early, with who an early-access code is for) and the rollout
// bucket are kept with the version and nothing else, a week's, a day's with whether it crashed and
// a crash report's; a pre-release's version as itself; anything else as "other", none as "unknown".
// Time in use and time open are kept as their ranges. Crash reports, at crashes.boldbridge.ai: one
// made by Bridge AI's own send() is kept with what's personal stripped again on the server, grouped
// with the same crash elsewhere (line numbers and numbers don't split a group) and apart from a
// different one; what isn't a crash report is turned away; the day's ceiling, the kill switch (the
// app turns crash reports off and keeps the reason) and 90 days' keeping.
//
// Running your own: one setting (stats.url, or BRIDGE_STATS_URL) says where all of it goes, the
// public list's address by default; an empty one sends nothing and one that isn't https says why. A
// fork's server at one name of its own (workers.dev) gets the week's, the day's and crash reports
// from the app's own send(), Settings names it, and turning them off is still one click.
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
const rows = (db, table) => { try { return db.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => ({ ...r })) } catch (e) { if (/no such table/.test(e.message)) return []; throw e } }
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
  ok(/counts\.boldbridge\.ai/.test(privacy) && /keeps only totals/.test(privacy) && /counts\/worker\.js/.test(privacy), 'PRIVACY.md names the server, says only totals are kept, and where its code is')
  const page = await worker.fetch(new Request('https://counts.boldbridge.ai/'), {})
  ok(page.status === 301 && page.headers.get('location') === 'https://boldbridge.ai/privacy#usage-stats-on-unless-you-turn-them-off' && !(await page.text()), 'its own address shows nothing: it sends a browser to the privacy policy\'s Usage stats', page.headers.get('location'))
  const privacyHeads = [...privacy.matchAll(/^## (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-'))
  ok(privacyHeads.includes('usage-stats-on-unless-you-turn-them-off') && privacyHeads.includes('crash-reports-on-unless-you-turn-them-off'), 'and both addresses\' anchors are headings in PRIVACY.md', privacyHeads)
  ok((await worker.fetch(new Request('https://counts.boldbridge.ai/v1/stats'), {})).status === 404 && (await worker.fetch(new Request('https://counts.boldbridge.ai/v1/week'), {})).status === 405, 'nothing can be read back: no other path, and a GET of /v1/week is refused')

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
    c.configure(settings, { about: async () => ({ app: '3.9.2', os: 'linux', osVersion: 'Ubuntu 24.04', arch: 'x64', chip: 'AMD Ryzen 7', memory: '32-63 GB', cores: '9-12', install: 'docker', layout: 'everything', runtime: 'builtin', phone: 'none', phones: '0', computers: '2', agents: ['claude', 'codex', 'not-an-agent'], features: { chief: 'claude', relay: 'own', planUsage: 'on', secretPath: ['', 'home', 'x'].join('/') } }), save: (patch) => { settings = { ...settings, ...patch }; c.configure(settings) } })
    // A week that's over, as Bridge AI writes it down.
    const kept = { week: lastWeek, counts: { 'agents.started.codex': 3, 'voice.transcribed': 40 }, days: [1, 2, 5], nonce: 'b'.repeat(24), installAge: '13+ weeks', about: { app: '3.9.2', os: 'linux', osVersion: 'Ubuntu 24.04', arch: 'x64', chip: 'AMD Ryzen 7', memory: '32-63 GB', cores: '9-12', install: 'docker', layout: 'everything', runtime: 'builtin', phone: 'none', phones: '0', computers: '2', agents: ['claude', 'codex', 'not-an-agent'], features: { chief: 'claude', relay: 'own', planUsage: 'on', secretPath: ['', 'home', 'x'].join('/') } } }
    fs.mkdirSync(path.join(home, 'telemetry'), { recursive: true })
    fs.writeFileSync(path.join(home, 'telemetry', `${lastWeek}.json`), JSON.stringify(kept))
    const sent = await c.send()
    const r = rows(db, 'reports')
    const cs = rows(db, 'counts')
    ok(sent.sent.join() === lastWeek && fs.existsSync(path.join(home, 'telemetry', 'sent', `${lastWeek}.json`)), 'Bridge AI\'s own send() delivers a week that\'s over, and keeps its copy of what went', sent)
    ok(r.length === 1 && r[0].os === 'linux' && r[0].install === 'docker' && r[0].install_age === '13+ weeks' && r[0].days_active === 3 && cs.find((x) => x.name === 'agents.started.codex')?.bucket === '2-5' && cs.find((x) => x.name === 'voice.transcribed')?.bucket === '21-100', 'and the server keeps it as totals, in the same ranges the app showed', { r, cs })
    const dims = Object.fromEntries(rows(db, 'dims').map((x) => [`${x.dim}=${x.value}`, x.n]))
    ok(dims['osVersion=Ubuntu 24.04'] === 1 && dims['chip=AMD Ryzen 7'] === 1 && dims['memory=32-63 GB'] === 1 && dims['cores=9-12'] === 1 && dims['computers=2'] === 1 && dims['phones=0'] === 1 && dims['agent=claude'] === 1 && dims['agent=codex'] === 1 && dims['feature.relay=own'] === 1 && dims['feature.planUsage=on'] === 1, 'the system\'s version, chip, memory, cores, linked computers, phones, agents installed and features on are each kept as their own total', dims)
    ok(!Object.keys(dims).some((k) => /not-an-agent|secretPath|home/.test(k)), 'and what isn\'t on the public list never leaves the computer', Object.keys(dims))
    // A day that's over: its version, the one it updated from, and that it crashed.
    const yesterday = c.dayOf(new Date(Date.now() - 864e5))
    fs.mkdirSync(path.join(home, 'telemetry', 'days'), { recursive: true })
    fs.writeFileSync(path.join(home, 'telemetry', 'days', `${yesterday}.json`), JSON.stringify({ day: yesterday, app: '3.9.2', from: '3.9.1', starts: 3, crashed: true, nonce: 'd'.repeat(24), about: { os: 'linux', arch: 'x64', install: 'docker' } }))
    const sentDays = await c.send()
    const daily = rows(db, 'daily')
    const updates = rows(db, 'daily_updates')
    ok(sentDays.days.join() === yesterday && daily.length === 1 && daily[0].app === '3.9.2' && daily[0].crashed === 1 && daily[0].starts === '2-5' && updates[0]?.from_app === '3.9.1' && fs.existsSync(path.join(home, 'telemetry', 'sent', 'days', `${yesterday}.json`)), 'a day\'s report: the version it ran, the update that day, how often it started and that it crashed, with a copy kept', { sentDays, daily, updates })
    // The project stops collecting: the app turns sharing off and says why.
    env.COUNTS_OFF = 'Paused for now.'
    fs.writeFileSync(path.join(home, 'telemetry', `${weekOf(new Date(+now - 14 * 864e5))}.json`), JSON.stringify({ ...kept, week: weekOf(new Date(+now - 14 * 864e5)), nonce: 'c'.repeat(24) }))
    await c.send()
    ok(settings.counts?.share === false && settings.counts?.stopped === 'Paused for now.', 'when the server answers "stop", Bridge AI turns sharing off and keeps the reason to show', settings.counts)
    srv.close()
  }
  // ---------- A day's reports ----------
  {
    const db = d1()
    const env = { DB: db }
    const dayPost = (body) => worker.fetch(new Request('https://counts.boldbridge.ai/v1/day', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env)
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    const day = (over = {}) => ({ schema: 1, day: y, app: '3.9.2', from: null, os: 'mac', arch: 'arm64', install: 'desktop', starts: '1', crashed: false, nonce: nonce(40), ...over })
    for (const [i, over] of [[0, {}], [1, { crashed: true }], [2, { from: '3.9.1' }], [3, { app: '3.9.1', os: 'windows' }]]) await dayPost(day({ ...over, nonce: nonce(40 + i) }))
    await dayPost(day({ nonce: nonce(40) }))
    const d = rows(db, 'daily')
    const n = (f) => d.filter(f).reduce((a, x) => a + x.n, 0)
    ok(n((x) => x.app === '3.9.2') === 3 && n((x) => x.app === '3.9.2' && x.crashed === 1) === 1 && n((x) => x.app === '3.9.1') === 1 && rows(db, 'daily_updates')[0]?.from_app === '3.9.1', 'day reports: installs on each version, how many crashed, and updates from which version; one sent twice counts once', d)
    for (const [what, body] of [['a day long ago', day({ day: '2020-01-01', nonce: nonce(50) })], ['not a day', day({ day: 'yesterday', nonce: nonce(51) })], ['no nonce', day({ nonce: undefined })]]) {
      const a = await answer(await dayPost(body))
      ok(a.status === 400, `${what}: turned away`, a)
    }
  }

  // ---------- What the admin view can change ----------
  {
    const db = d1()
    const env = { DB: db, SETTINGS_CACHE_MS: '0', COUNTS_OFF: '0', CRASHES_PER_DAY: '1000' }
    await post(env, report())
    db.sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('countsOff', 'Moving house.')
    const s1 = await answer(await post(env, report({ nonce: nonce(60) })))
    ok(s1.body?.stop === true && s1.body.why === 'Moving house.', 'a kill switch set from the admin view (the settings table) works without a deploy', s1)
    db.sql.prepare('UPDATE settings SET value = ? WHERE key = ?').run('0', 'countsOff')
    db.sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('crashesPerDay', '0')
    const c1 = await answer(await worker.fetch(new Request('https://crashes.boldbridge.ai/v1/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema: 1, kind: 'ui', title: 'x', details: 'Error: x' }) }), env))
    ok((await answer(await post(env, report({ nonce: nonce(61) })))).body?.ok === true && c1.status === 429, 'and so does the daily ceiling for crash reports', c1)
  }

  // ---------- Time in use and open ----------
  {
    const db = d1()
    await post({ DB: db }, report({ activeTime: '5-10 hours', openTime: '40+ hours' }))
    await post({ DB: db }, report({ nonce: nonce(2), activeTime: 'three days', openTime: undefined }))
    const r = rows(db, 'reports').map((x) => [x.active_time, x.open_time])
    ok(JSON.stringify(r) === JSON.stringify([['5-10 hours', '40+ hours'], ['other', 'unknown']]), 'time in use and time open are kept as their ranges; anything else as "other" or "unknown"', r)
  }

  // ---------- Crash reports ----------
  const crashPost = (env, body, host = 'crashes.boldbridge.ai') => worker.fetch(new Request(`https://${host}/v1/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env)
  const crash = (over = {}) => ({ schema: 1, kind: 'server', app: '3.9.2', os: 'mac', arch: 'arm64', install: 'desktop', title: 'The server stopped: Cannot read properties of undefined (reading \'id\')', details: "Bridge AI: 3.9.2 (desktop app)\nSystem: darwin 15.1 arm64\nWhat crashed: the server\n\nError: Cannot read properties of undefined (reading 'id')\n\nTypeError: Cannot read properties of undefined (reading 'id')\n    at relink (<app>/server/machines.js:412:19)\n    at Hub.onMessage (<app>/server/relay.js:88:7)", ...over })
  {
    const db = d1()
    const env = { DB: db }
    const page = await worker.fetch(new Request('https://crashes.boldbridge.ai/'), env)
    ok(page.status === 301 && page.headers.get('location') === 'https://boldbridge.ai/privacy#crash-reports-on-unless-you-turn-them-off', 'crashes.boldbridge.ai shows nothing: it sends a browser to the privacy policy\'s Crash reports', page.headers.get('location'))
    ok((await worker.fetch(new Request('https://crashes.boldbridge.ai/v1/reports'), env)).status === 404 && (await worker.fetch(new Request('https://crashes.boldbridge.ai/v1/report'), env)).status === 405, 'and no crash report can be read back from it')
    const a = await answer(await crashPost(env, crash()))
    ok(a.status === 200 && a.body?.ok === true, 'a crash report is taken', a)
    // Made of parts, as the other tests do, so the repo's own check doesn't take them for real ones.
    const mail = ['priya.raman', 'gmail.com'].join('@')
    const key = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'].join('-')
    const file = ['', 'Users', 'priya', 'secret-project', 'x.js'].join('/')
    const typed = await answer(await crashPost(env, crash({ what: `I was pairing my phone. Mail me at ${mail}, key ${key}`, details: `${crash().details}\n\nLast lines of server.log:\nopened ${file}\nfrom 203.0.113.77` })))
    const kept = rows(db, 'crash_reports')
    ok(typed.status === 200 && kept.length === 2 && !/priya|gmail\.com|sk-ant|secret-project|203\.0\.113\.77/i.test(JSON.stringify(kept)), 'what\'s personal that got into one is stripped again on the server: emails, keys, home folders, addresses', kept[1])
    ok(kept[0].kind === 'server' && kept[0].app === '3.9.2' && /machines\.js/.test(kept[0].details) && kept[0].day === new Date().toISOString().slice(0, 10) && Object.keys(kept[0]).join() === 'id,day,app,os,arch,install,kind,fingerprint,title,what,details', 'and kept with its kind, version, system and day, and nothing about who sent it', Object.keys(kept[0]))
    const moved = await answer(await crashPost(env, crash({ app: '3.9.3', details: crash().details.replace('412:19', '430:5').replace('88:7', '91:2') })))
    const other = await answer(await crashPost(env, crash({ title: 'The server stopped: EADDRINUSE', details: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:7420\n    at Server.setupListenHandle (node:net:1817:16)' })))
    const groups = [...new Set(rows(db, 'crash_reports').map((x) => x.fingerprint))]
    ok(moved.body?.ok && other.body?.ok && groups.length === 2 && rows(db, 'crash_reports').filter((x) => x.fingerprint === groups[0]).length === 3 && rows(db, 'crash_reports')[3].fingerprint !== groups[0], 'the same crash in another version (its line numbers moved) is in the same group; a different one is apart', groups)
    for (const [what, body, status] of [['not a kind of crash', crash({ kind: 'oops' }), 400], ['no details', crash({ details: '' }), 400], ['not JSON', 'crash!', 400], ['too big', crash({ details: 'x'.repeat(40000) }), 413]]) {
      const r = await answer(await crashPost(env, body))
      ok(r.status === status, `${what}: turned away (${status})`, r)
    }
    const onCounts = await crashPost(env, crash(), 'counts.boldbridge.ai')
    const weekOnCrashes = await worker.fetch(new Request('https://crashes.boldbridge.ai/v1/week', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report()) }), env)
    ok(onCounts.status === 404 && weekOnCrashes.status === 404, 'each address takes only its own: counts at counts., crash reports at crashes.', [onCounts.status, weekOnCrashes.status])
    const capped = await answer(await crashPost({ DB: db, CRASHES_PER_DAY: '4' }, crash()))
    ok(capped.status === 429, 'past the day\'s ceiling, reports are turned away (429)', capped)
    const stop = await answer(await crashPost({ DB: db, CRASHES_OFF: 'Paused for a move.' }, crash()))
    ok(stop.body?.stop === true && stop.body.why === 'Paused for a move.', 'CRASHES_OFF: every report is answered "stop", with the reason', stop)
    db.sql.prepare('UPDATE crash_reports SET day = ? WHERE rowid = 1').run('2020-01-01')
    await worker.scheduled({}, { DB: db })
    ok(rows(db, 'crash_reports').length === 3 && rows(db, 'crash_channels').length === 3, 'once a day, crash reports older than 90 days go, with their channel')
  }

  // ---------- The update channel ----------
  // Stable or Early Access (and who the code is for) and the rollout bucket, kept with the version
  // and nothing else: a week's, a day's with whether it crashed, and a crash report's. A
  // pre-release's version is kept as itself; a report from before channels says unknown.
  {
    const db = d1()
    const env = { DB: db }
    const mail = ['priya', 'example.com'].join('@')
    await post(env, report({ app: '3.13.0-beta.1', channel: 'early', tester: 'Sam', rollout: 80 }))
    await post(env, report({ nonce: nonce(2), channel: 'stable', tester: 'Sam', rollout: 7 }))
    await post(env, report({ nonce: nonce(3), channel: 'nightly', tester: 'Sam', rollout: 120 }))
    await post(env, report({ nonce: nonce(4) }))
    await post(env, report({ nonce: nonce(5), app: '3.13.0-beta.1', channel: 'early', tester: mail, rollout: 3 }))
    await post(env, report({ nonce: nonce(6), app: '3.13.0-nightly.1', channel: 'early', tester: 'Sam', rollout: 3.5 }))
    const ch = rows(db, 'channels').map((x) => `${x.app} ${x.channel} "${x.tester}" ${x.rollout} ${x.n}`)
    ok(JSON.stringify(ch) === JSON.stringify(['3.13.0-beta.1 early "Sam" 80 1', '3.9.2 stable "" 7 1', '3.9.2 other "" -1 1', '3.9.2 unknown "" -1 1', '3.13.0-beta.1 early "other" 3 1', 'other early "Sam" -1 1']), 'a week\'s channel, tester (on Early Access only) and bucket, kept with the version: anything else as "other", a report from before channels as "unknown"', ch)
    ok(rows(db, 'reports').some((x) => x.app === '3.13.0-beta.1') && !new RegExp(mail.replace('.', '\\.')).test(JSON.stringify([rows(db, 'channels'), rows(db, 'reports'), rows(db, 'dims')])), 'a pre-release\'s version is kept as itself; a tester that isn\'t a name is never kept', rows(db, 'reports').map((x) => x.app))
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    const dayPost = (body) => worker.fetch(new Request('https://counts.boldbridge.ai/v1/day', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env)
    await dayPost({ schema: 1, day: y, app: '3.13.0-beta.1', from: '3.12.0', channel: 'early', tester: 'Sam', rollout: 80, os: 'mac', arch: 'arm64', install: 'desktop', starts: '1', crashed: true, nonce: nonce(70) })
    await dayPost({ schema: 1, day: y, app: '3.12.0', from: null, os: 'mac', arch: 'arm64', install: 'desktop', starts: '1', crashed: false, nonce: nonce(71) })
    const dc = rows(db, 'daily_channels').map((x) => `${x.app} ${x.channel} "${x.tester}" ${x.rollout} ${x.crashed} ${x.n}`)
    ok(JSON.stringify(dc) === JSON.stringify(['3.13.0-beta.1 early "Sam" 80 1 1', '3.12.0 unknown "" -1 0 1']) && rows(db, 'daily_updates')[0]?.app === '3.13.0-beta.1', 'a day\'s: each version on each channel, and whether it crashed', dc)
    const crashPostHere = (body) => worker.fetch(new Request('https://crashes.boldbridge.ai/v1/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env)
    await crashPostHere({ schema: 1, kind: 'ui', app: '3.13.0-beta.1', channel: 'early', tester: 'Sam', os: 'mac', arch: 'arm64', install: 'desktop', title: 'x', details: 'Error: x' })
    const cr = rows(db, 'crash_reports')[0]
    const cc = rows(db, 'crash_channels')[0]
    ok(cr?.app === '3.13.0-beta.1' && cc?.id === cr.id && cc.channel === 'early' && cc.tester === 'Sam', 'a crash report\'s channel and tester, by its id', { cr, cc })
  }

  // ---------- Bridge AI's own crash report, end to end ----------
  {
    const db = d1()
    const env = { DB: db }
    const port = await freePort()
    const srv = http.createServer(async (req, res) => {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const r = await worker.fetch(new Request(`https://crashes.boldbridge.ai${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] || '' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }), env)
      res.writeHead(r.status, Object.fromEntries(r.headers))
      res.end(Buffer.from(await r.arrayBuffer()))
    }).listen(port, '127.0.0.1')
    process.env.BRIDGE_CRASHES_URL = `http://127.0.0.1:${port}/v1/report`
    const home = process.env.BRIDGE_HOME
    fs.mkdirSync(home, { recursive: true })
    const cr = await import('../../server/crashes.js')
    let settings = { crashReports: { send: false } }
    cr.configure(settings, { about: async () => ({ version: '3.9.2', settings: { runtime: 'builtin' }, names: [['Priya Raman', '<name>'], ['acme-checkout', '<project>']] }), save: (p) => { settings = { ...settings, ...p }; cr.configure(settings) } })
    ok((await cr.auto({ kind: 'ui', where: 'Files', message: 'boom', stack: 'Error: boom' })).sent === false && rows(db, 'crash_reports').length === 0, 'with Send crash reports off, a crash sends nothing by itself')
    const out = await cr.send({ title: 'The window hit an error: x is undefined', what: 'Priya Raman was opening acme-checkout', details: 'Error: x is undefined\n    at Files (<app>/src/components/Files.jsx:10:2)' }, 'ui')
    const kept = rows(db, 'crash_reports')
    ok(out.sent && kept.length === 1 && kept[0].kind === 'ui' && /<name> was opening <project>/.test(kept[0].what) && !/Priya|acme-checkout/.test(JSON.stringify(kept)), 'Send to Bold Bridge sends the report as the person left it, with their names taken out on the computer', kept[0])
    const copy = await cr.sentReport(out.id)
    ok(copy.report.title === kept[0].title && copy.byItself === false && (await cr.sending()).sent.length === 1, 'and keeps a copy of exactly what went, listed in Settings', copy)
    settings = { crashReports: { send: true } }
    cr.configure(settings)
    // Two of the same crash at the same moment (a slow computer): still sent once.
    const same = { kind: 'ui', where: 'Board', message: 'y is null', stack: 'TypeError: y is null\n    at Board (<app>/src/components/whiteboard/Board.jsx:5:5)' }
    const [a1, a2] = await Promise.all([cr.auto(same), cr.auto(same)])
    ok(a1.sent && !a2.sent && rows(db, 'crash_reports').length === 2, 'with it on, a crash sends itself, and the same crash only once a day, even two at the same moment', [a1, a2])
    env.CRASHES_OFF = 'Paused for a move.'
    await cr.auto({ kind: 'ui', where: 'Mail', message: 'z', stack: 'Error: z' })
    ok(settings.crashReports?.send === false && settings.crashReports?.stopped === 'Paused for a move.', 'when the server answers "stop", Bridge AI turns crash reports off and keeps the reason to show', settings.crashReports)
    srv.close()
  }

  // ---------- Running your own: where reports go ----------
  // One setting, stats.url (config.json, config.example.json for a build) or BRIDGE_STATS_URL, says
  // which counts server gets the week's, the day's and crash reports; the public list's is the default.
  {
    delete process.env.BRIDGE_COUNTS_URL
    delete process.env.BRIDGE_CRASHES_URL
    delete process.env.BRIDGE_STATS_URL
    const c = await import('../../server/counts.js')
    const cr = await import('../../server/crashes.js')
    const w = (url) => c.where(url === undefined ? {} : { stats: { url } })
    const own = w()
    ok(own.week === SCHEMA.endpoint && own.crashes === SCHEMA.crashReports.endpoint && own.from === 'build', 'with nothing set, reports go where the public list says: the project\'s server', own)
    const fork = w('https://counts.example.org')
    ok(fork.week === 'https://counts.example.org/v1/week' && fork.crashes === 'https://crashes.example.org/v1/report', 'stats.url at a counts. name: the week\'s report there, crash reports at the same server\'s crashes. name', fork)
    const one = w('https://stats.example.org/bridge/')
    ok(one.week === 'https://stats.example.org/bridge/v1/week' && one.crashes === 'https://stats.example.org/bridge/v1/report', 'at any other address, both under it', one)
    ok(w('https://counts.example.org/v1/week').week === 'https://counts.example.org/v1/week', 'and an address given with its /v1/week is taken as the server\'s')
    const none = w('')
    ok(none.week === '' && none.crashes === '' && !none.problem, 'an empty one turns sending off for everyone it applies to (a build\'s config.example.json, a company\'s config)', none)
    const plain = w('http://counts.example.org')
    ok(plain.week === '' && /isn't an https address/.test(plain.problem || ''), 'an address that isn\'t https goes nowhere, and says why', plain)
    process.env.BRIDGE_STATS_URL = 'https://counts.example.net'
    ok(w('https://counts.example.org').week === 'https://counts.example.net/v1/week' && w().from === 'BRIDGE_STATS_URL', 'BRIDGE_STATS_URL in the environment over the setting', w().week)
    delete process.env.BRIDGE_STATS_URL

    // End to end: a fork's server on one name of its own (workers.dev), the week's, the day's and a
    // crash report all reaching it, Settings saying where, and turning it off still one click.
    const db = d1()
    const env = { DB: db }
    const port = await freePort()
    const hosts = []
    const srv = http.createServer(async (req, res) => {
      const chunks = []
      for await (const ch of req) chunks.push(ch)
      const r = await worker.fetch(new Request(`https://bridge-counts.a-fork.workers.dev${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] || '' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }), env)
      hosts.push(`${req.method} ${req.url} ${r.status}`)
      res.writeHead(r.status, Object.fromEntries(r.headers))
      res.end(Buffer.from(await r.arrayBuffer()))
    }).listen(port, '127.0.0.1')
    const home = process.env.BRIDGE_HOME
    let settings = { counts: { share: true }, crashReports: { send: true }, stats: { url: `http://127.0.0.1:${port}/` } }
    const save = (p) => { settings = { ...settings, ...p }; c.configure(settings); cr.configure(settings) }
    c.configure(settings, { save })
    cr.configure(settings, { save })
    const st = await c.status()
    const cst = await cr.sending()
    ok(st.available && st.to === `127.0.0.1:${port}` && cst.available && cst.to === `127.0.0.1:${port}`, 'Settings says reports go to the address set, for usage stats and crash reports alike', { to: st.to, crashes: cst.to })
    const week = weekOf(new Date(+now - 21 * 864e5))
    fs.writeFileSync(path.join(home, 'telemetry', `${week}.json`), JSON.stringify({ week, counts: { 'agents.started.claude': 2 }, days: [2], nonce: 'e'.repeat(24), installAge: 'week 1', about: { app: '3.9.2', os: 'mac', arch: 'arm64', install: 'desktop', layout: 'simple', runtime: 'builtin', phone: 'none' } }))
    const yesterday = c.dayOf(new Date(Date.now() - 864e5))
    fs.mkdirSync(path.join(home, 'telemetry', 'days'), { recursive: true })
    fs.writeFileSync(path.join(home, 'telemetry', 'days', `${yesterday}.json`), JSON.stringify({ day: yesterday, app: '3.9.2', from: null, starts: 1, crashed: false, nonce: 'f'.repeat(24), about: { os: 'mac', arch: 'arm64', install: 'desktop' } }))
    const sent = await c.send()
    const crash = await cr.send({ title: 'The window hit an error: q is null', details: 'TypeError: q is null\n    at Files (<app>/src/components/Files.jsx:3:1)' }, 'ui')
    ok(sent.sent.includes(week) && sent.days.includes(yesterday) && crash.sent && rows(db, 'reports').some((x) => x.week === week) && rows(db, 'daily').length === 1 && rows(db, 'crash_reports').length === 1, 'a week\'s report, a day\'s and a crash report all reach the fork\'s server, at one name of its own', hosts)
    ok(hosts.includes('POST /v1/week 200') && hosts.includes('POST /v1/day 200') && hosts.includes('POST /v1/report 200'), 'at /v1/week, /v1/day and /v1/report', hosts)
    const offed = await c.setShare(false)
    const crOff = await cr.setSending(false)
    ok(offed.share === false && crOff.send === false && offed.to === `127.0.0.1:${port}`, 'and turning them off is the same one click, whatever the address', { offed: offed.share, crOff: crOff.send })
    process.env.DO_NOT_TRACK = '1'
    ok(!(await c.status()).available && (await c.status()).refused === 'DO_NOT_TRACK', 'DO_NOT_TRACK still keeps it off with a server of one\'s own')
    delete process.env.DO_NOT_TRACK
    settings = { ...settings, stats: { url: 'counts.example.org' } }
    c.configure(settings)
    const bad = await c.status()
    ok(!bad.available && /isn't an https address/.test(bad.problem || ''), 'a stats.url that isn\'t an address: Settings says so, rather than the section just going', bad.problem)
    srv.close()
    const page = read('src', 'components', 'settings', 'UsageCounts.jsx')
    ok(/s\?\.problem/.test(page) && /can\\'t be sent: \{why\}/.test(page), 'and Settings shows it')
  }
  // The counts server at a fork's one name takes crash reports too; the project's names stay apart.
  {
    const db = d1()
    const r = await answer(await worker.fetch(new Request('https://bridge-counts.a-fork.workers.dev/v1/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema: 1, kind: 'ui', title: 'x', details: 'Error: x' }) }), { DB: db }))
    const onCounts = await worker.fetch(new Request('https://counts.boldbridge.ai/v1/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), { DB: db })
    ok(r.status === 200 && rows(db, 'crash_reports').length === 1 && onCounts.status === 404, 'at one name of its own (workers.dev, a fork\'s) the counts server takes crash reports too; at counts. it still doesn\'t', [r.status, onCounts.status])
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
}

process.exit(done().fail ? 1 : 0)
