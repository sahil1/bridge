// Usage counts, off unless you turn them on (server/counts.js, shared/telemetry-schema.json), with
// the project's endpoint stood in for on this computer. The list: every name the code counts is on
// it, and so is every kind of agent; counts go in ranges; weeks are ISO weeks. Not offered with no
// endpoint, nor with DO_NOT_TRACK=1. Off (as it starts): agents started, errors and tasks count for
// nothing, nothing is written down and nothing is sent, and what would be sent is a week with no
// counts. On: they're counted, What would be sent shows the week so far, and once the week is over
// the report that goes is exactly that, with nothing personal in it (no name, path, folder, user or
// computer name, no ID: its nonce is new each week), kept in telemetry/sent. The endpoint saying
// stop turns sharing off and says why; turning it off forgets what wasn't sent. In the app, Settings ›
// About & Updates: nothing with no endpoint, a line with DO_NOT_TRACK, and the switch off with What
// would be sent, then on.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { ROOT, TEST, startKit, checks, until, browser, page, shot, freePort } from '../lib/harness.mjs'

const { ok, done } = checks('usage-counts')
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'telemetry-schema.json'), 'utf8'))
const NAMES = new Set(Object.keys(SCHEMA.counters))

// ---------- The list ----------
{
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(m?js|jsx)$/.test(e.name) ? [path.join(d, e.name)] : []))
  const used = new Set()
  for (const f of [...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'shared'))]) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/counts\.(?:add|most)\(\s*(?:'([^']+)'|([^,)]+\?[^)]*))/g)) {
      if (m[1]) used.add(m[1])
      else for (const q of m[2].matchAll(/'([^']+)'/g)) used.add(q[1])
    }
  }
  const off = [...used].filter((n) => !NAMES.has(n))
  ok(used.size >= 10 && off.length === 0, 'every name the code counts is on the public list (shared/telemetry-schema.json)', { used: [...used], off })
  const { AGENTS, CHAT } = await import('../../server/agents.js')
  const kinds = [...AGENTS, CHAT].map((a) => a.kind)
  ok(kinds.every((k) => NAMES.has(`agents.started.${k}`)), 'and every kind of agent has its own counter (a new one is added to the list in public)', kinds.filter((k) => !NAMES.has(`agents.started.${k}`)))
  ok(SCHEMA.buckets.join() === '0,1,2-5,6-20,21-100,100+' && Object.keys(SCHEMA.report).join() === 'schema,week,app,os,arch,install,layout,runtime,phone,installAge,daysActive,counts,nonce', 'the list says what a report has, field by field, and its ranges')
}
process.env.BRIDGE_HOME = path.join(os.tmpdir(), `bridge-counts-rules-${process.pid}`)
const c = await import('../../server/counts.js')
ok([0, 1, 2, 5, 6, 20, 21, 100, 101, 5000].map(c.bucket).join() === '0,1,2-5,2-5,6-20,6-20,21-100,21-100,100+,100+', 'counts go in ranges: 0, 1, 2-5, 6-20, 21-100, 100+')
ok(c.weekOf(new Date(2026, 9, 31)) === '2026-W44' && c.weekOf(new Date(2026, 0, 1)) === '2026-W01' && c.weekOf(new Date(2027, 0, 1)) === '2026-W53' && c.weekOf(new Date(2026, 10, 2)) === '2026-W45', 'weeks are ISO weeks (Monday to Sunday, the year their Thursday is in)')

// ---------- The project's endpoint, stood in for ----------
const got = []
let answer = { ok: true }
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', (d) => { b += d })
  req.on('end', () => { got.push({ method: req.method, path: req.url, type: req.headers['content-type'], cookie: req.headers.cookie || null, body: b }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer)) })
})
const port = await freePort()
await new Promise((r) => srv.listen(port, '127.0.0.1', r))
const URL_ = `http://127.0.0.1:${port}/v1/week`
const kits = []
const kitWith = async (name, env, config = {}) => { const k = await startKit(`usage-counts-${name}`, { env: { BRIDGE_COUNTS_WRITE_MS: '100', BRIDGE_COUNTS_FIRST_MS: '300', ...env }, config }); kits.push(k); return k }
const weekFiles = (data) => { try { return fs.readdirSync(path.join(data, 'telemetry')).filter((f) => /^\d{4}-W\d\d\.json$/.test(f)) } catch { return [] } }
// Features used: two Claude Code agents (a stand-in), three of the window's errors and a task for the chief.
const use = async (k, n = 1) => {
  // Looked for again, as the app does after an install: the server looked before the stand-in was there.
  if (!(await k.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed)) throw new Error('the stand-in Claude Code isn\'t found')
  const dir = path.join(k.home, 'code', 'acme-billing')
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < 2; i++) await k.api('/agents/launch', { kind: 'claude', cwd: dir, label: `Fix ${n}-${i}`, newSpace: 'acme-billing', prompt: 'idle' })
  for (let i = 0; i < 3; i++) await k.api('/ui-error', { where: 'Settings', message: `broke in ${dir}`, stack: '', url: '/' })
  await k.api('/chief/tasks', { title: 'Ship the acme-billing fix for Priya' }).catch(() => {})
}

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
// Days far enough apart for two weeks, the first one's Wednesday at noon.
const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 14); monday.setHours(12, 0, 0, 0)
const day = (n) => new Date(monday.getTime() + n * 864e5).toISOString()
try {
  // Not offered: no endpoint, or DO_NOT_TRACK.
  const none = await kitWith('none', { BRIDGE_COUNTS_URL: '' })
  const n0 = await none.api('/counts')
  ok(n0.available === false && n0.share === false && await none.api('/counts', { share: true }).then(() => false, () => true), 'no endpoint set: not offered, and it can\'t be turned on', n0)
  const dnt = await kitWith('dnt', { BRIDGE_COUNTS_URL: URL_, DO_NOT_TRACK: '1' })
  const d0 = await dnt.api('/counts')
  ok(d0.available === false && d0.refused === 'DO_NOT_TRACK' && await dnt.api('/counts', { share: true }).then(() => false, () => true), 'DO_NOT_TRACK=1: off, and it can\'t be turned on', d0)

  // Off, as it starts.
  const k = await kitWith('on', { BRIDGE_COUNTS_URL: URL_, BRIDGE_COUNTS_NOW: day(2) }, { name: 'Priya Raman' })
  k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await k.api('/setup', { name: 'Priya Raman' })
  const s0 = await k.api('/counts')
  ok(s0.available === true && s0.share === false && s0.to === `127.0.0.1:${port}` && s0.sent.length === 0, 'with an endpoint: offered, and off', s0)
  await use(k, 1)
  await new Promise((r) => setTimeout(r, 900))
  const p0 = await k.api('/counts/preview')
  ok(weekFiles(k.data).length === 0 && !fs.existsSync(path.join(k.data, 'telemetry')), 'off: agents, errors and a task count for nothing, and nothing is written down', fs.existsSync(path.join(k.data, 'telemetry')) && fs.readdirSync(path.join(k.data, 'telemetry')))
  ok(got.length === 0, 'and nothing is sent', got)
  ok(p0.share === false && JSON.stringify(p0.report.counts) === '{}' && p0.report.daysActive === 0 && p0.report.nonce === '(new for each report)' && p0.report.app && p0.report.os, 'what would be sent: a week with no counts, what it says about this computer and nothing else', p0)

  // On.
  const s1 = await k.api('/counts', { share: true })
  ok(s1.share === true, 'turned on')
  await use(k, 2)
  await new Promise((r) => setTimeout(r, 600))
  const p1 = await k.api('/counts/preview')
  const r1 = p1.report
  ok(p1.share && p1.goes === 'after this week' && r1.counts['agents.started.claude'] === '2-5' && r1.counts['errors.window'] === '2-5' && r1.counts['chief.tasks'] === '1' && r1.daysActive === 1 && r1.installAge === 'week 1', 'on: what would be sent is this week so far, in ranges (agents started, errors, a task)', p1)
  ok(got.length === 0 && weekFiles(k.data).length === 1, 'kept on this computer until the week is over', { got, files: weekFiles(k.data) })
  const gone = async (kit) => { kit.stop(); await until(async () => !(await fetch(`${kit.url}/api/config`).then(() => true, () => false)), 10000, 100) }
  await gone(k)

  // The next week: the report goes, exactly as shown.
  const next = await kitWith('next', { BRIDGE_COUNTS_URL: URL_, BRIDGE_COUNTS_NOW: day(9), BRIDGE_HOME: k.data })
  next.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  const went = await until(() => got.length > 0, 8000)
  const sent = went ? JSON.parse(got[0].body) : null
  ok(went && got[0].method === 'POST' && got[0].path === '/v1/week' && /application\/json/.test(got[0].type) && !got[0].cookie, 'once the week is over: one POST of JSON to the endpoint, no cookies', got)
  ok(JSON.stringify(sent) === JSON.stringify(r1), 'and it is exactly what What would be sent showed', { sent, shown: r1 })
  const all = JSON.stringify(sent)
  const personal = ['Priya', 'acme', 'Fix ', k.home, os.homedir(), os.userInfo().username, os.hostname().replace(/\.local$/, '')].filter((v) => v && all.includes(v))
  ok(!!sent && Object.keys(sent).join() === Object.keys(SCHEMA.report).join() && Object.keys(sent.counts).every((n) => NAMES.has(n)) && Object.values(sent.counts).every((v) => SCHEMA.buckets.includes(v)) && personal.length === 0, 'nothing personal in it: the fields on the list, counts on the list in ranges, no name, path, project, user or computer', { personal, sent })
  ok(/^[0-9a-f]{24}$/.test(sent?.nonce || '') && !/"\w*id"\s*:/i.test(all) && !/[\\/]/.test(all), 'and no ID (only a nonce for this report) and nothing like a path', all)
  const kept = (() => { try { return JSON.parse(fs.readFileSync(path.join(k.data, 'telemetry', 'sent', `${sent.week}.json`), 'utf8')) } catch { return null } })()
  const s2 = await next.api('/counts')
  ok(JSON.stringify(kept) === JSON.stringify(sent) && s2.sent.join() === sent.week && JSON.stringify(await next.api(`/counts/sent/${sent.week}`)) === JSON.stringify(sent) && weekFiles(k.data).length === 0, 'a copy of what went is kept, and listed', { kept, s2 })
  // A new week, a new nonce.
  await use(next, 3)
  await new Promise((r) => setTimeout(r, 600))
  const p2 = await next.api('/counts/preview')
  ok(p2.report?.nonce && p2.report.nonce !== sent.nonce && p2.report.week !== sent.week, 'next week\'s report has a nonce of its own: nothing ties the two together', [p2.report?.nonce, sent.nonce])
  await gone(next)

  // The endpoint says stop: sharing turns off, and says why.
  answer = { stop: true, why: 'The project has stopped collecting usage counts.' }
  const later = await kitWith('stop', { BRIDGE_COUNTS_URL: URL_, BRIDGE_COUNTS_NOW: day(16), BRIDGE_HOME: k.data })
  later.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  const stopped = await until(async () => { const s = await later.api('/counts'); return s.share === false && s.stopped && s }, 8000)
  ok(!!stopped && /stopped collecting/.test(stopped.stopped) && weekFiles(k.data).length === 0, 'the endpoint says stop: sharing turns off, saying why, and what wasn\'t sent is forgotten', stopped)
  answer = { ok: true }
  // Turned off by you: what wasn't sent is forgotten.
  await later.api('/counts', { share: true })
  await use(later, 4)
  await new Promise((r) => setTimeout(r, 600))
  const before = weekFiles(k.data).length
  await later.api('/counts', { share: false })
  ok(before === 1 && weekFiles(k.data).length === 0 && (await later.api('/counts/preview')).share === false, 'turned off: what was counted and not sent is forgotten', { before, after: weekFiles(k.data) })

  // ---------- In the app: Settings › About & Updates ----------
  const about = async (kit, name) => {
    const { ctx, p } = await page(b, kit.url)
    await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
    await until(async () => /Report a problem/.test(await p.locator('.st-body').innerText().catch(() => '')), 8000)
    await p.waitForTimeout(800)
    return { ctx, p, text: await p.locator('.st-body').innerText().catch(() => ''), name }
  }
  {
    const { ctx, text } = await about(none)
    ok(/Report a problem/.test(text) && !/Usage counts/.test(text), 'no endpoint: About & Updates says nothing about usage counts', text.slice(-400))
    await ctx.close()
  }
  {
    const { ctx, text } = await about(dnt)
    ok(/Usage counts/.test(text) && /Off on this computer: DO_NOT_TRACK is set\./.test(text) && !/Share anonymous usage counts/.test(text), 'DO_NOT_TRACK: a line saying it\'s off, and no switch', text.slice(-400))
    await ctx.close()
  }
  {
    const { ctx, p, text } = await about(later)
    const box = p.locator('label', { hasText: 'Share anonymous usage counts' }).locator('input')
    ok(/Usage counts/.test(text) && await box.count() === 1 && !(await box.isChecked()), 'with an endpoint: the switch, off', text.slice(-600))
    await p.locator('button', { hasText: 'See exactly what would be sent' }).click()
    const shown = await until(async () => { const x = await p.locator('.counts-doc').innerText().catch(() => ''); return /Nothing is counted while this is off/.test(x) && /"counts": \{\}/.test(x) && x }, 5000)
    ok(!!shown, 'See exactly what would be sent: nothing is counted while it\'s off, and the report it would be', await p.locator('.counts-doc').innerText().catch(() => ''))
    await p.locator('.counts-doc summary').click()
    ok(/agents\.started\.claude/.test(await p.locator('.counts-list').innerText().catch(() => '')), 'with everything that can be counted')
    await box.click()
    const on = await until(async () => (await later.api('/counts')).share === true && /so far/.test(await p.locator('.counts-doc').innerText().catch(() => '')), 5000)
    ok(!!on && await box.isChecked(), 'turned on there, it shows this week so far')
    await p.waitForTimeout(300)
    await shot(p, `${tag}usage-counts`)
    await box.click()
    ok(!!(await until(async () => (await later.api('/counts')).share === false, 4000)), 'and off again')
    await ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  for (const k of kits) k.stop()
  srv.close()
  await b.close()
  fs.rmSync(process.env.BRIDGE_HOME, { recursive: true, force: true })
}

process.exit(done().fail ? 1 : 0)
