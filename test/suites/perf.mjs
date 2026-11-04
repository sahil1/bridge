// Bridge AI stays quick with two windows open and agents busy, on any platform. Six agents with
// long conversations (2 MB session logs each), a terminal printing fast and two windows (one on the
// agents, one on the busy terminal), measured for 15 s:
// - the server's CPU, how long its event loop was ever held up, and its costliest requests;
// - each window's main thread, and its requests per minute.
// The budgets are generous, for a slow CI computer; a change that blows one is a slowdown to look
// at, not a flake to try again. Also: one herdr read shared by everyone who asks at once (a
// stand-in herdr that counts its reads, not on Windows), and a terminal drawn by the GPU where
// there's one, falling back to elements where there isn't.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, browser, page, TEST, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('perf')
const T = 15
const kit = await startKit('perf')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
kit.program('busy', "let i = 0; setInterval(() => { process.stdout.write('\\x1b[2K\\r\\x1b[36m* working\\x1b[0m ' + (i++) + ' ' + 'x'.repeat(60) + '\\n') }, 15)")
const { b, which } = await browser()
const pages = []
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  for (let n = 0; n < 6; n++) {
    const d = path.join(kit.home, 'code', `p${n}`)
    fs.mkdirSync(d, { recursive: true })
    await kit.api('/agents/launch', { kind: 'claude', cwd: d, label: `Project ${n}`, newSpace: n < 3 ? 'Work' : 'Side', prompt: 'idle' })
  }
  const logs = () => { try { return fs.readdirSync(path.join(kit.home, '.claude', 'projects'), { recursive: true }).map(String).filter((x) => /[0-9a-f-]{36}\.jsonl$/.test(x) && !/subagents/.test(x)) } catch { return [] } }
  await until(async () => logs().length >= 6, 30000)
  const line = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is what I changed in the billing export and why. '.repeat(40) }] }, timestamp: new Date().toISOString() })
  for (const f of logs()) fs.appendFileSync(path.join(kit.home, '.claude', 'projects', f), `${Array.from({ length: Math.ceil(2e6 / line.length) }, () => line).join('\n')}\n`)
  const sh = await kit.api('/agents/launch', { kind: 'shell', cwd: kit.home, label: 'Build', newSpace: 'Work' })
  await sleep(1500)
  await kit.api(`/panes/${encodeURIComponent(sh.paneId)}/text`, { text: 'busy', enter: true })

  const wins = []
  for (let i = 0; i < 2; i++) {
    const w = await page(b, kit.url, { width: 1440, height: 900 })
    pages.push(w)
    const reqs = []
    w.p.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) reqs.push(r.url()) })
    const cdp = which === 'chromium' ? await w.ctx.newCDPSession(w.p) : null
    if (cdp) await cdp.send('Performance.enable')
    wins.push({ ...w, reqs, cdp })
  }
  await wins[1].p.locator('.tab-main', { hasText: 'Build' }).first().click({ timeout: 20000 })
  await sleep(5000)
  const metric = async (w) => (w.cdp ? Object.fromEntries((await w.cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])) : null)
  const before = await Promise.all(wins.map(metric))
  for (const w of wins) w.reqs.length = 0
  await kit.api('/perf?reset=1')
  await sleep(T * 1000)
  const srv = await kit.api('/perf')
  const after = await Promise.all(wins.map(metric))
  const top = srv.requests.slice(0, 5).map((r) => `${r.route} ${r.n}× ${r.avg} ms`)
  ok(srv.cpu < 30, `the server, two windows on busy agents: under 30% of a core (${srv.cpu}%)`, { cpu: srv.cpu, top })
  ok(srv.loop.max < 300, `its event loop never held up for long (longest ${srv.loop.max} ms)`, srv.loop)
  ok(srv.requests.every((r) => r.avg < 150), 'no request it answers takes long on average', top)
  if (which === 'chromium') {
    const share = (i) => Math.round(((after[i].TaskDuration - before[i].TaskDuration) / T) * 1000) / 10
    ok(share(0) < 5, `a window on the agents, idle, keeps its main thread free (${share(0)}% busy)`, share(0))
    ok(share(1) < 45, `a window on a terminal printing fast stays responsive (${share(1)}% busy, drawn as elements; less on a GPU)`, share(1))
  } else skip("each window's main thread", "Chromium's own measures")
  const perMin = wins.map((w) => Math.round((w.reqs.length / T) * 60))
  ok(perMin.every((n) => n <= 90), `each window asks the server at most 90 times a minute (${perMin.join(' and ')})`, wins.map((w) => [...new Set(w.reqs.map((u) => new URL(u).pathname))]))

  // A terminal drawn by the GPU where there is one, else as before; either way, it shows.
  const g = await page(b, kit.url, { width: 1200, height: 800, store: { 'cc-term-dom': false } })
  pages.push(g)
  await g.p.locator('.tab-main', { hasText: 'Build' }).first().click({ timeout: 20000 })
  const drawn = await until(() => g.p.evaluate(() => { const x = document.querySelector('.xterm'); return x && (x.querySelector('canvas') ? 'gpu' : x.querySelector('.xterm-rows')?.textContent.includes('working') ? 'elements' : null) }), 10000)
  ok(!!drawn, `the busy terminal shows, drawn by the GPU or, without one, as elements (${drawn})`, drawn)
  ok(g.errors.length === 0, 'and no page errors', g.errors)

  // herdr: one read, however many ask at once.
  if (IS_WIN) skip('one herdr read for everyone who asks at once', 'Bridge AI drives herdr over a Unix socket')
  else {
    const h = await startKit('perf-herdr', {
      config: { runtime: 'herdr' },
      env: ({ bin }) => {
        fs.writeFileSync(path.join(bin, 'herdr.cjs'), `const fs = require('node:fs'), path = require('node:path'), a = process.argv.slice(2)
if (a[0] === '--version') { console.log('herdr 0.9.4'); process.exit(0) }
if (a[0] === 'api' && a[1] === 'snapshot') { fs.appendFileSync(path.join(__dirname, 'snapshots.log'), Date.now() + '\\n'); setTimeout(() => { console.log(JSON.stringify({ snapshot: { workspaces: [{ workspace_id: 'w1', label: 'Work' }], tabs: [{ tab_id: 't1', workspace_id: 'w1', label: 'api' }], agents: [{ pane_id: 'p1', tab_id: 't1', workspace_id: 'w1', agent: 'claude', agent_status: 'idle' }], panes: [{ pane_id: 'p1', tab_id: 't1', workspace_id: 'w1', agent: 'claude', agent_status: 'idle', cwd: '/tmp' }], layouts: [] } })) }, 80); return }
console.log('{}')`)
        fs.writeFileSync(path.join(bin, 'herdr'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'herdr.cjs')}" "$@"\n`, { mode: 0o755 })
        return { HERDR_BIN: path.join(bin, 'herdr'), HERDR_SOCKET_PATH: path.join(bin, 'herdr.sock') }
      },
    })
    try {
      const snaps = () => { try { return fs.readFileSync(path.join(h.bin, 'snapshots.log'), 'utf8').split('\n').filter(Boolean).length } catch { return 0 } }
      await sleep(2500) // the server's own first looks
      const was = snaps()
      const all = await Promise.all(Array.from({ length: 12 }, () => h.api('/fleet').catch((e) => ({ error: e.message }))))
      const n = snaps() - was
      ok(all.every((f) => Array.isArray(f.agents)) && n <= 2, `twelve windows asking for the agents at once: herdr read ${n} time${n === 1 ? '' : 's'}, not 24`, { n, sample: all[0] })
    } finally { h.stop() }
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
