// The built Mac app itself, its windows and the line between them and its own server
// (desktop/servergate.js): SMOKE_WINDOWS=1 node scripts/smoke.js, after the app is built. It opens
// the app's windows on the screen for a few minutes. The app runs with a data folder of its own (in
// the system's temporary folder: TMPDIR), at a port of its own (SMOKE_APP_PORT, else 7597), with
// Chromium's own stand-in for the keychain (--use-mock-keychain: nothing in or from the Keychain) and
// the tests' stand-in for the signing helper (test/stand-ins/bridgesign.cjs: no Touch ID asked), and
// is driven through Chromium's DevTools port (as Playwright does, connectOverCDP). Those two switches
// work only in a Mac build made for it, by its bundle id (desktop/startgate.js: electron-builder ...
// -c.appId=dev.bridge-ai.smoke); a release build doesn't start with any switch (smoke.js checks
// that). Signals go only to the app it started and that app's own children (its server, a window's
// renderer), never to a process found by name. Checked:
//   - it opens on Bridge AI, not the page saying another program answers; a reload (what ⌘R does),
//     a page whose renderer was killed, a popout, this computer in a window of its own and the
//     floating card each open; how long the server's proof holds a page back;
//   - its server killed: started again by the app, and the window back without that page; a reload
//     while it's down; held up for 5 s during a reload (SIGSTOP): no such page and no restart;
//   - a service worker (an older version's): its requests go once the server is proven, and it still
//     answers offline; gone the next time the app starts;
//   - its server stopped and another program at its address: refused (a page, its API, a terminal's
//     WebSocket, the app's own windows), its feed never asked for, and the app's key, cookie and
//     window MAC never sent it; then the app's own server started again;
//   - another program at [::1] at the app's port, and a frame sending the window there: refused;
//   - signing a PDF of 79 MB (signed) and one of 81 MB (refused, said with its size);
//   - Start Over, the app's keys file unreadable at two starts.
// Not opened: the dictation window and the capture window, whose pages ask for the microphone and
// the screen at once, which macOS would ask you to allow for a build like this.
import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 20000, step = 150) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(step) } }
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const listen = (fn, port, host) => new Promise((resolve) => { const s = http.createServer(fn); s.once('error', () => resolve(null)); s.listen(port, host, () => resolve(s)) })
const close = (s) => new Promise((r) => (s ? s.close(() => r()) : r()))
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
// A PNG of a line, for a signature (as the tests draw one).
function png(w = 240, h = 80) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, c]) }
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(y - (x * h) / w) < 3) raw.writeUInt32BE(0x101820ff, y * (w * 4 + 1) + 1 + x * 4)
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export async function windows({ app, step, ROOT }) {
  // SMOKE_ONLY=<pattern>: only the steps it names (and the first, which opens the app).
  const pick = process.env.SMOKE_ONLY ? new RegExp(process.env.SMOKE_ONLY, 'i') : null
  let first = true
  const only = (name, fn) => {
    const go = !pick || first || pick.test(name)
    first = false
    // (Each step given two minutes at most, so one that hangs fails by itself and the app is still
    // quit and its folder removed at the end.)
    const bounded = () => Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error('no answer in 2 minutes')), 120000))])
    return go ? step(name, bounded) : console.log(`--   ${name}: not asked for (SMOKE_ONLY)`)
  }
  const need = createRequire(path.join(ROOT, 'package.json'))
  const { chromium } = need('playwright-core')
  const { PDFDocument } = need('pdf-lib')
  const PORT = Number(process.env.SMOKE_APP_PORT) || 7597
  const BASE = `http://127.0.0.1:${PORT}`
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-smoke-app-'))
  const keysFile = path.join(data, 'desktop', 'signing-keys')
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ keepAgents: false, updates: { auto: false, check: false }, meetings: { detect: false } }))
  // The signing helper's stand-in (no Touch ID, no window over the screen), as the tests run it.
  const helper = path.join(data, 'bridgesign')
  fs.writeFileSync(helper, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'test', 'stand-ins', 'bridgesign.cjs')}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(data, 'bridgesign.json'), JSON.stringify({ probe: { trackpad: false, touchID: true, auth: true, parent: true }, auth: { ok: true, how: 'touchid' } }))
  const env = { ...process.env, BRIDGE_HOME: data, BRIDGE_PORT: String(PORT), BRIDGE_FIX_DRYRUN: '1', BRIDGE_SIGNHELPER: helper, BRIDGESIGN_STATE: path.join(data, 'bridgesign.json'), BRIDGESIGN_LOG: path.join(data, 'bridgesign.log') }
  // (SMOKE_APP_TMPDIR: the app's own temporary folder, when this run's is too deep for the terminal
  // host's socket, as a socket's path can't be longer than 104 bytes.)
  if (process.env.SMOKE_APP_TMPDIR) env.TMPDIR = process.env.SMOKE_APP_TMPDIR
  delete env.ELECTRON_RUN_AS_NODE
  const out = []
  let proc = null
  let browser = null
  let cdp = 0
  const said = (s) => { try { return decodeURIComponent(s) } catch { return s } }
  const notOurs = (u) => /^data:text\/html/.test(u) && /Another program is answering/.test(said(u))
  const starting = (u) => /^data:text\/html/.test(u) && /Starting Bridge AI/.test(said(u))
  // Every page target, as DevTools lists them, looked at all the time: any that ever showed
  // another program's page.
  const list = async () => (await (await fetch(`http://127.0.0.1:${cdp}/json/list`, { signal: AbortSignal.timeout(2000) })).json()).filter((t) => t.type === 'page')
  let seenNotOurs = []
  let seenStarting = 0
  let watching = null
  const watch = () => {
    const tick = async () => { try { for (const t of await list()) { if (notOurs(t.url)) seenNotOurs.push(Date.now()); if (starting(t.url)) seenStarting++ } } catch { /* between runs */ } }
    watching = setInterval(tick, 100)
  }
  const key = () => fs.readFileSync(path.join(data, 'api-token'), 'utf8').trim()
  const api = async (method, p, body) => {
    const r = await fetch(BASE + '/api' + p, { method, headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, j: await r.json().catch(() => null) }
  }
  const serverPid = () => { try { return Number(fs.readFileSync(path.join(data, 'cache', 'server.pid'), 'utf8')) || null } catch { return null } }

  async function launch() {
    cdp = await freePort()
    proc = spawn(app.exe, ['--use-mock-keychain', `--remote-debugging-port=${cdp}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout.on('data', (d) => out.push(String(d)))
    proc.stderr.on('data', (d) => out.push(String(d)))
    browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${cdp}`, { timeout: 3000 }), 30000, 300)
    if (!browser) throw new Error('its DevTools port never answered')
    // (Connected again only when a window's page has gone unseen for a while, not as it first opens: a
    // second connection left beside the first holds a service worker back as it starts.)
    connectedAt = Date.now()
  }
  // A signal only to a process of the app this smoke started: its server (by the app's pid file) or a
  // window's renderer (by DevTools' own list), each checked to be a child of that app right then.
  // Nothing found by name.
  const parentOf = (pid) => { try { return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim()) } catch { return null } }
  const signalChild = (pid, sig) => {
    if (!proc || !Number.isInteger(pid) || parentOf(pid) !== proc.pid) throw new Error(`pid ${pid} isn't a process of the app this smoke started`)
    process.kill(pid, sig)
  }
  const signalServer = (sig) => { const pid = serverPid(); signalChild(pid, sig); return pid }
  const renderers = async () => {
    const s = await browser.newBrowserCDPSession()
    const { processInfo } = await s.send('SystemInfo.getProcessInfo')
    await s.detach().catch(() => {})
    return processInfo.filter((x) => x.type === 'renderer').map((x) => x.id).filter((pid) => parentOf(pid) === proc.pid)
  }
  // Quit as the app quits (SIGTERM), not through DevTools; its server (which outlives it, by design)
  // stopped first when asked, while it's still the app's.
  async function quit({ server = false } = {}) {
    if (server && proc) {
      const pid = serverPid()
      if (pid && alive(pid) && parentOf(pid) === proc.pid) { process.kill(pid, 'SIGTERM'); await until(async () => !alive(pid), 10000) }
    }
    browser = null
    if (proc && proc.exitCode == null) {
      proc.kill('SIGTERM')
      await until(async () => proc.exitCode != null || proc.signalCode != null, 15000)
      if (proc.exitCode == null && proc.signalCode == null) proc.kill('SIGKILL')
    }
    proc = null
  }
  const pages = () => browser.contexts().flatMap((c) => c.pages())
  let reconnects = 0
  let connectedAt = 0
  const pageAt = (want, ms = 20000) => until(async () => {
    const hit = (u) => (typeof want === 'function' ? want(u) : u === want)
    const p = pages().find((x) => hit(x.url()))
    if (p) return p
    // (DevTools lists it but this connection hasn't seen it, as after a window's process changed:
    // connected again.)
    if (Date.now() - connectedAt > 5000 && (await list()).some((t) => hit(t.url))) {
      connectedAt = Date.now()
      reconnects++
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`, { timeout: 3000 }).catch(() => browser)
    }
    return null
  }, ms)
  // A page of the app's own: Bridge AI's page drawn (its root has something in it), in the app (its
  // preload there), not the page saying another program answers.
  const look = (p) => p.evaluate(() => ({ url: location.href, title: document.title, drawn: (document.getElementById('root')?.childElementCount || 0) > 0, app: !!window.bridgeApp })).catch((e) => ({ error: e.message }))
  const isApp = async (p) => { const l = await look(p); return l.drawn && l.app && /Bridge AI/.test(l.title) && l.url.startsWith(BASE) ? l : null }
  const main = (ms) => pageAt(`${BASE}/`, ms)
  // A page left still: no load of its own for `ms` (after its server is back, the app may open the
  // window's page again once it has the proof; a step after that starts on the page it then has).
  async function still(p, ms = 2000, max = 20000) {
    let last = Date.now()
    const moved = (f) => { if (f === p.mainFrame()) last = Date.now() }
    p.on('framenavigated', moved)
    try {
      const end = Date.now() + max
      while (Date.now() < end && Date.now() - last < ms) await sleep(200)
      return Date.now() - last >= ms
    } finally { p.off('framenavigated', moved) }
  }
  // How long a page was held back before its request went (the proof, for a page), from DevTools'
  // own timing: requestWillBeSent, then when the network stack took it (requestTime).
  async function held(p, go) {
    const s = await p.context().newCDPSession(p)
    await s.send('Network.enable')
    const sent = new Map()
    const got = []
    s.on('Network.requestWillBeSent', (e) => sent.set(e.requestId, { at: e.timestamp, url: e.request.url, type: e.type }))
    s.on('Network.responseReceived', (e) => { const w = sent.get(e.requestId); if (w && e.response.timing) got.push({ url: w.url, type: w.type, ms: Math.round((e.response.timing.requestTime - w.at) * 1000) }) })
    await go()
    await sleep(300)
    await s.detach().catch(() => {})
    return got
  }

  try {
    // ---------- Opening ----------
    await only('the app opens on Bridge AI', async () => {
      await launch()
      watch()
      const p = await main()
      const l = p && await until(() => isApp(p), 60000)
      if (!l) throw new Error(`its window shows ${JSON.stringify(p ? await look(p) : (await list()).map((t) => t.url.slice(0, 80)))}`)
      if (seenNotOurs.length) throw new Error('it showed the page saying another program answers')
      const n = await p.evaluate(() => { const e = performance.getEntriesByType('navigation')[0]; return { held: Math.round(e.requestStart - e.fetchStart), load: Math.round(e.loadEventEnd || e.domContentLoadedEventEnd) } })
      const sw = await p.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))
      if (sw) throw new Error(`${sw} service worker(s) in its window`)
      return `first page held ${n.held} ms before it went (and one proof before it was asked for), loaded in ${n.load} ms; no service worker`
    })
    await only('a reload (what ⌘R does) proves the server again and shows Bridge AI', async () => {
      const p = await main()
      const holds = []
      const base = []
      for (let i = 0; i < 5; i++) {
        const got = await held(p, async () => { await p.reload({ waitUntil: 'load' }); await p.evaluate(() => fetch('/api/health').then((r) => r.status)) })
        const doc = got.find((g) => g.type === 'Document')
        const xhr = got.find((g) => /\/api\/health$/.test(g.url))
        if (doc) holds.push(doc.ms)
        if (xhr) base.push(xhr.ms)
        if (!(await until(() => isApp(p), 20000))) throw new Error(`reload ${i + 1}: ${JSON.stringify(await look(p))}`)
      }
      if (seenNotOurs.length) throw new Error('a reload showed the page saying another program answers')
      const m = median(holds)
      return `the proof held a reload ${m} ms (median of 5: ${holds.join(', ')}); a request with no proof ${median(base)} ms${m > 200 ? ' — over 200 ms' : ''}`
    })
    await only('a page whose renderer was killed opens again', async () => {
      const before = (await list()).length
      // (Its renderers by DevTools' own list of the app's processes, each a child of the app.)
      const ids = await renderers()
      if (!ids.length) throw new Error('no renderer found')
      for (const pid of ids) { try { signalChild(pid, 'SIGKILL') } catch { /* gone */ } }
      await sleep(1500)
      // (A new connection: the old one is left, as closing it could close the app.)
      browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${cdp}`, { timeout: 3000 }), 20000, 300)
      const p = await main()
      if (!p || !(await until(() => isApp(p), 30000))) throw new Error(`after: ${JSON.stringify(p ? await look(p) : null)}`)
      return `${ids.length} renderer(s) killed (${before} page(s)); the main window's page opened again`
    })
    await only('a popout opens and loads', async () => {
      const p = await main()
      const asked = await p.evaluate(() => window.bridgeApp.popOut('smoke-pane', 'Smoke'))
      const w = await pageAt(`${BASE}/?window=smoke-pane`)
      if (!asked || !w || !(await until(() => isApp(w), 30000))) throw new Error(`asked: ${asked}; ${JSON.stringify(w ? await look(w) : null)}`)
      await w.close().catch(() => {})
      return 'an agent\'s own window'
    })
    await only('this computer in a window of its own opens and loads', async () => {
      const p = await main()
      const asked = await p.evaluate(() => window.bridgeApp.openMachine(null, null, ''))
      const w = await until(async () => { const all = pages().filter((x) => x.url() === `${BASE}/`); return all.length > 1 ? all.find((x) => x !== p) : null })
      if (!asked || !w || !(await until(() => isApp(w), 30000))) throw new Error(`asked: ${asked}; ${JSON.stringify(w ? await look(w) : null)}`)
      await w.close().catch(() => {})
      return 'a device\'s window'
    })
    await only('the floating card opens and loads', async () => {
      const set = await api('PATCH', '/settings', { meetings: { detect: false, floatCard: 'always' } })
      if (set.status !== 200) throw new Error(`settings: ${set.status}`)
      const w = await pageAt(`${BASE}/?float=1`)
      const l = w && await until(async () => { const x = await look(w); return x.drawn && x.app ? x : null }, 30000)
      await api('PATCH', '/settings', { meetings: { detect: false, floatCard: 'meetings' } })
      if (!l) throw new Error(JSON.stringify(w ? await look(w) : (await list()).map((t) => t.url.slice(0, 60))))
      return 'shown with the card set to always, hidden again'
    })
    console.log('--   the dictation window and the capture window: not opened here (their pages ask for the microphone and the screen at once, which macOS would ask you to allow for this build)')

    // ---------- Its server gone, and back ----------
    await only('its server killed: started again by the app, the window back without saying another program answers', async () => {
      const p = await main()
      const was = serverPid()
      seenNotOurs = []
      const t = Date.now()
      signalChild(was, 'SIGKILL')
      const now = await until(async () => { const n = serverPid(); return n && n !== was && alive(n) ? n : null }, 30000)
      if (!now) throw new Error('not started again')
      const back = await until(() => p.evaluate(() => fetch('/api/config').then((r) => r.status === 200, () => false)), 30000, 300)
      if (!back) throw new Error('the window\'s page never reached it again')
      if (!(await isApp(p))) throw new Error(JSON.stringify(await look(p)))
      await p.reload({ waitUntil: 'load' })
      if (!(await until(() => isApp(p), 20000)) || seenNotOurs.length) throw new Error(`after a reload: ${JSON.stringify(await look(p))}; another program's page shown: ${seenNotOurs.length}`)
      return `pid ${was} → ${now}; the window's page reached it again ${Date.now() - t} ms after`
    })
    await only('a reload while its server is down: Bridge AI starting, then Bridge AI', async () => {
      const p = await main()
      const was = serverPid()
      seenNotOurs = []
      seenStarting = 0
      signalChild(was, 'SIGKILL')
      await sleep(50)
      await p.reload({ waitUntil: 'load', timeout: 5000 }).catch(() => {})
      const w = await until(async () => { const x = pages().find((q) => q.url() === `${BASE}/`); return x && await isApp(x) ? x : null }, 45000, 300)
      if (!w || seenNotOurs.length) throw new Error(`${w ? 'back' : 'not back'}; another program's page shown: ${seenNotOurs.length}`)
      return `back on pid ${serverPid()}${seenStarting ? ', "Starting Bridge AI…" between' : ''}`
    })
    await only('its server held up for 5 s during a reload (SIGSTOP): no page saying another program answers, no restart', async () => {
      const p = await main()
      const was = serverPid()
      seenNotOurs = []
      const t = Date.now()
      signalChild(was, 'SIGSTOP')
      const r = p.reload({ waitUntil: 'load', timeout: 40000 }).catch((e) => e)
      await sleep(5000)
      signalChild(was, 'SIGCONT')
      await r
      const w = await until(async () => { const x = pages().find((q) => q.url() === `${BASE}/`); return x && await isApp(x) ? x : null }, 30000, 300)
      if (!w || seenNotOurs.length || serverPid() !== was || !alive(was)) throw new Error(`${w ? 'back' : 'not back'}; another program's page: ${seenNotOurs.length}; pid ${was} → ${serverPid()}`)
      await still(w)
      if (!(await isApp(w))) throw new Error(`after it: ${JSON.stringify(await look(w))}`)
      return `the reload finished ${Date.now() - t} ms after, on the same server (pid ${was})`
    })

    // ---------- A service worker an older version left ----------
    let sw = null
    await only('a service worker: its requests go once the server is proven', async () => {
      const p = await main()
      await still(p)
      // (What Chromium says of the worker as it goes, for a failure's message.)
      const swSession = await p.context().newCDPSession(p)
      const swSaid = []
      swSession.on('ServiceWorker.workerErrorReported', (e) => swSaid.push(`error: ${e.errorMessage?.errorMessage} (${e.errorMessage?.sourceURL}:${e.errorMessage?.lineNumber})`))
      swSession.on('ServiceWorker.workerVersionUpdated', (e) => { for (const v of e.versions || []) swSaid.push(`${v.status}/${v.runningStatus}`) })
      await swSession.send('ServiceWorker.enable').catch((e) => swSaid.push(`enable: ${e.message}`))
      const reg = await p.evaluate(() => Promise.race([
        navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => 'ready', (e) => `refused: ${e.message}`),
        new Promise((r) => setTimeout(() => r('not ready in 15 s'), 15000)),
      ]))
      if (reg !== 'ready') {
        const state = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); return r ? { installing: r.installing?.state || null, waiting: r.waiting?.state || null, active: r.active?.state || null } : 'none' }).catch((e) => e.message)
        const script = await p.evaluate(() => fetch('/sw.js').then((r) => `${r.status} ${r.headers.get('content-type')}`, (e) => `refused: ${e.message}`))
        throw new Error(`registering /sw.js: ${reg} (${JSON.stringify(state)}; the page's own fetch of it: ${script}; Chromium: ${[...new Set(swSaid)].join(", ") || "nothing"})`)
      }
      await p.reload({ waitUntil: 'load' })
      const c = await until(() => p.evaluate(() => (navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null)), 15000)
      const viaWorker = await p.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/assets\//.test(e.name) && e.workerStart > 0).length)
      if (!c || !(await isApp(p))) throw new Error(`controlled: ${c}; ${JSON.stringify(await look(p))}`)
      sw = c
      return `the page controlled by ${c.replace(BASE, '')}, ${viaWorker} built file(s) through it, the page drawn`
    })

    // ---------- Its server stopped, another program at its address ----------
    let pane = null
    await only('a terminal opens from the window and runs a command, with only the environment the app gives its server', async () => {
      const r = await api('POST', '/agents/launch', { kind: 'shell', cwd: os.homedir(), label: 'smoke' })
      pane = r.j?.paneId
      if (!pane) throw new Error(`a terminal: ${JSON.stringify(r)}`)
      const p = await main()
      const ran = await p.evaluate((u) => new Promise((res) => {
        let seen = ''
        const s = new WebSocket(u)
        s.onopen = () => setTimeout(() => s.send('echo bridge-$((6*7))-ok $HOME\r'), 1500)
        s.onmessage = async (e) => { seen += typeof e.data === 'string' ? e.data : await e.data.text(); if (/bridge-42-ok \//.test(seen)) { s.close(); res('ran') } }
        s.onerror = () => res('refused')
        setTimeout(() => res(`no answer: ${seen.slice(-200)}`), 30000)
      }), `ws://127.0.0.1:${PORT}/api/panes/${encodeURIComponent(pane)}/attach?cols=80&rows=24`)
      if (ran !== 'ran') throw new Error(ran)
      // (The terminal host that runs it started as the server is: lockdown.js first, SIGUSR1 opening
      // nothing. What it says it was started with, in the data folder: its title hides it from ps.)
      let host = null
      try { host = JSON.parse(fs.readFileSync(path.join(data, 'host', 'host.json'), 'utf8')) } catch { /* none */ }
      const line = (host?.execArgv || []).join(' ')
      if (!/--disable-sigusr1/.test(line) || !/--import \S*\/server\/lockdown\.js/.test(line)) throw new Error(`the terminal host (pid ${host?.pid}) started with: ${line.slice(0, 300) || 'nothing said'}`)
      return 'its WebSocket open, the command run, HOME set; the terminal host started with lockdown.js and SIGUSR1 opening nothing'
    })
    await only('its server stopped and another program at its address: nothing of the app\'s goes to it, nothing from it is shown or heard', async () => {
      const p = await main()
      const was = serverPid()
      const keysBefore = fs.readFileSync(keysFile).toString('base64')
      const cookieName = `bridge-ai-${PORT}`
      signalChild(was, 'SIGTERM')
      if (!(await until(async () => !alive(was), 15000))) throw new Error('it didn\'t stop')
      await sleep(3500) // (the app sees its feed end)
      // Offline: the service worker answers the page with its own (as it does on a phone).
      let offline = null
      if (sw) {
        await p.reload({ waitUntil: 'load', timeout: 20000 }).catch(() => {})
        offline = await p.evaluate(() => document.body?.innerText || '').catch(() => '')
        await p.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister())))).catch(() => {})
      }
      // Another program (here) at the app's address, answering everything as if it were Bridge AI.
      const heard = []
      const other = await listen((q, s) => {
        heard.push({ m: q.method, u: q.url, auth: q.headers.authorization || null, cookie: q.headers.cookie || '', mac: q.headers['x-bridge-window'] || null })
        if (q.url.startsWith('/api/health')) { s.setHeader('content-type', 'application/json'); return s.end('{"ok":true,"app":"Bridge AI","version":"0.0.0"}') }
        if (q.url.startsWith('/api/window/proof')) { s.setHeader('content-type', 'application/json'); return s.end('{"mac":"not-it"}') }
        if (q.url.startsWith('/api/events')) { s.writeHead(200, { 'content-type': 'text/event-stream' }); s.write('event: sign-start-over\ndata: {}\n\nevent: fleet\ndata: {"agents":[]}\n\n'); return }
        s.setHeader('content-type', 'text/html'); s.end('<!doctype html><title>Bridge AI</title><div id="root"><b>another program</b></div>')
      }, PORT, '127.0.0.1')
      if (!other) throw new Error(`couldn't listen at ${BASE}`)
      const upgrades = []
      other.on('upgrade', (q, sock) => { upgrades.push(q.url); sock.destroy() })
      await sleep(4000)
      // The page left open from before, as it tries again (its API, its terminal, a popout, a device's
      // window): refused, and nothing opens.
      const targets = (await list()).length
      const tries = await p.evaluate(([port, id]) => new Promise((res) => {
        const o = {}
        fetch('/api/config').then((r) => { o.api = r.status }, () => { o.api = 'refused' })
        const s = new WebSocket(`ws://127.0.0.1:${port}/api/panes/${encodeURIComponent(id)}/attach?cols=80&rows=24`); s.onopen = () => { o.ws = 'open'; s.close() }; s.onerror = () => { o.ws = 'refused' }
        Promise.all([window.bridgeApp?.popOut('smoke-2', 'x'), window.bridgeApp?.openMachine(null, null, '')]).then((a) => { o.windows = a }, (e) => { o.windows = e.message })
        setTimeout(() => res(o), 3000)
      }), [PORT, pane || 'none']).catch((e) => ({ error: e.message }))
      await sleep(1000)
      const opened = (await list()).length - targets
      // A reload: that program's page refused, and said as another program's in the main window.
      await p.goto(`${BASE}/`, { waitUntil: 'load', timeout: 20000 }).catch(() => {})
      await sleep(2500)
      const shown = (await list()).map((t) => t.url)
      const theirs = []
      for (const q of pages()) { if (/another program/.test(await q.evaluate(() => document.body?.innerText || '').catch(() => ''))) theirs.push(q.url()) }
      await close(other)
      const sent = { key: heard.filter((h) => h.auth && h.auth.includes(key())).length, cookie: heard.filter((h) => h.cookie.includes(cookieName)).length, mac: heard.filter((h) => h.mac).length }
      const asked = [...new Set(heard.map((h) => h.u.split('?')[0]))]
      const keysAfter = fs.readFileSync(keysFile).toString('base64')
      const problems = []
      if (!shown.some(notOurs)) problems.push(`the main window shows ${shown.map((u) => u.slice(0, 60)).join(', ')}`)
      if (theirs.length) problems.push(`that program's page shown: ${theirs.join(', ')}`)
      if (tries.api !== 'refused' || tries.ws !== 'refused' || !Array.isArray(tries.windows) || tries.windows.some(Boolean) || opened > 0) problems.push(`from the page left open: ${JSON.stringify({ ...tries, opened })}`)
      if (sent.key || sent.cookie || sent.mac) problems.push(`sent it: ${JSON.stringify(sent)}`)
      if (asked.includes('/api/events')) problems.push('its feed was asked for')
      if (upgrades.length) problems.push(`WebSockets: ${upgrades.join(', ')}`)
      if (keysAfter !== keysBefore) problems.push('the app\'s keys changed (Start Over from its feed)')
      if (problems.length) throw new Error(problems.join('; '))
      return `${offline != null ? `offline, the service worker's own page ("${offline.split('\n')[0].slice(0, 40)}"); ` : ''}then that program: from the page left open its API, its terminal and two windows refused; a reload refused and said as another program's; it was asked only ${asked.join(', ')}, without the app's key, cookie or MAC; no feed, no WebSocket; the keys as they were`
    })
    await only('...and the app\'s own server started again when the window opens its page', async () => {
      const p = pages().find((x) => x.url().startsWith('data:')) || pages()[0]
      await p.goto(`${BASE}/`, { timeout: 20000 }).catch(() => {})
      const w = await until(async () => { const x = pages().find((q) => q.url() === `${BASE}/`); return x && await isApp(x) ? x : null }, 60000, 300)
      if (!w) throw new Error(JSON.stringify((await list()).map((t) => t.url.slice(0, 80))))
      return `pid ${serverPid()}`
    })

    // ---------- Another program at [::1], and a frame sending the window there ----------
    await only('another program at [::1] at the app\'s port, and a frame sending the window there: refused', async () => {
      const p = await main()
      const heard = []
      const other = await listen((q, s) => { heard.push(q.url); s.setHeader('content-type', 'text/html'); s.end('<!doctype html><title>Bridge AI</title><div id="root">another program</div>') }, PORT, '::1')
      if (!other) return 'skipped: no IPv6 loopback here'
      const upgrades = []
      other.on('upgrade', (q, sock) => { upgrades.push(q.url); sock.destroy() })
      // A project's app (another port), framed in the page as Preview frames one, sending the window to
      // the app's own address when clicked. (Sent anywhere else, the window stays and the address opens
      // in the browser, as a link does: not tried here.)
      const project = await listen((q, s) => { const to = new URL(q.url, 'http://x').searchParams.get('to') || ''; s.setHeader('content-type', 'text/html'); s.end(`<!doctype html><body style="margin:0"><div style="width:400px;height:300px" onclick="top.location = ${JSON.stringify(to).replace(/"/g, '&quot;')}">click</div>`) }, 0)
      const Q = project.address().port
      await p.evaluate((src) => { const f = document.createElement('iframe'); f.id = 'smoke-frame'; f.src = src; f.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;border:0;z-index:2147483647'; document.body.appendChild(f); return new Promise((r) => { f.onload = r; setTimeout(r, 3000) }) }, `http://localhost:${Q}/frame?to=${encodeURIComponent(`${BASE}/?from-frame=1`)}`)
      await p.mouse.click(100, 100)
      await sleep(1500)
      const framed = p.url()
      await p.evaluate(() => document.getElementById('smoke-frame')?.remove()).catch(() => {})
      const direct = await p.evaluate((port) => new Promise((res) => {
        const o = {}
        fetch(`http://[::1]:${port}/api/config`).then(() => { o.api = 'reached' }, () => { o.api = 'refused' })
        const s = new WebSocket(`ws://localhost:${port}/api/panes/none/attach`); s.onopen = () => { o.ws = 'open'; s.close() }; s.onerror = () => { o.ws = 'refused' }
        setTimeout(() => res(o), 2500)
      }), PORT)
      // The window sent there itself (as the app loads a page): refused, then the app's page again.
      await p.goto(`http://[::1]:${PORT}/`, { timeout: 10000 }).catch(() => {})
      const back = await until(async () => { const x = pages().find((q) => q.url() === `${BASE}/`); return x && await isApp(x) ? x : null }, 30000, 300)
      await close(other); await close(project)
      if (framed !== `${BASE}/` || heard.length || upgrades.length || direct.api !== 'refused' || direct.ws !== 'refused' || !back) throw new Error(JSON.stringify({ framed, heard, upgrades, direct, back: !!back }))
      return 'a frame\'s click sending the window to the app\'s own address left it where it was; the page\'s request and WebSocket at [::1] and localhost refused; the window sent to [::1] refused, then back on Bridge AI; that program heard nothing'
    })

    // ---------- Signing ----------
    await only('signing a PDF of 79 MB: signed; one of 81 MB: refused, said with its size', async () => {
      const p = await main()
      await api('POST', '/setup', { name: 'Smoke' })
      const dir = path.join(data, 'Deals')
      fs.mkdirSync(dir, { recursive: true })
      const fromWindow = (u, body) => p.evaluate(([url, b]) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) })), [u, body])
      const place = await fromWindow('/api/places', { path: dir })
      const root = place.j?.place?.id ? `place:${place.j.place.id}` : null
      if (!root) throw new Error(`a place for it: ${JSON.stringify(place)}`)
      const sig = await fromWindow('/api/studio/signatures', { kind: 'signature', name: 'Smoke', png: `data:image/png;base64,${png(250, 80).toString('base64')}`, default: true })
      if (sig.status !== 200) throw new Error(`a signature: ${JSON.stringify(sig)}`)
      const make = async (name, mib) => {
        const d = await PDFDocument.create()
        d.addPage([612, 792])
        const fill = Math.floor(mib * 1024 * 1024) - 128 * 1024
        await d.attach(crypto.randomBytes(fill), 'fill.bin', { mimeType: 'application/octet-stream' })
        let bytes = Buffer.from(await d.save({ useObjectStreams: false }))
        const want = Math.floor(mib * 1024 * 1024)
        if (bytes.length > want) throw new Error(`${name}: ${bytes.length} bytes, over ${want}`)
        fs.writeFileSync(path.join(dir, name), bytes)
        bytes = null
        return { size: fs.statSync(path.join(dir, name)).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') }
      }
      const marks = [{ kind: 'signature', page: 1, x: 10, y: 10, w: 300, h: 90 }]
      const small = await make('seventy-nine.pdf', 79)
      const t = Date.now()
      const signed = await fromWindow(`/api/studio/sign?root=${encodeURIComponent(root)}&path=seventy-nine.pdf`, { sha256: small.sha256, marks })
      const took = Date.now() - t
      const copy = signed.j?.path ? path.join(dir, signed.j.path) : null
      if (signed.status !== 200 || !copy || !fs.existsSync(copy)) throw new Error(`79 MB: ${JSON.stringify({ status: signed.status, j: signed.j && { ...signed.j, record: undefined } })}`)
      const big = await make('eighty-one.pdf', 81.3)
      const refused = await fromWindow(`/api/studio/sign?root=${encodeURIComponent(root)}&path=eighty-one.pdf`, { sha256: big.sha256, marks })
      if (refused.status !== 413 || refused.j?.code !== 'too-big' || !/81 MB/.test(refused.j?.error || '')) throw new Error(`81 MB: ${JSON.stringify(refused)}`)
      fs.rmSync(dir, { recursive: true, force: true })
      return `${(small.size / 1048576).toFixed(1)} MB signed in ${took} ms (${path.basename(copy)}); ${(big.size / 1048576).toFixed(1)} MB: "${refused.j.error}"`
    })

    // ---------- Start Over ----------
    await only('the app\'s keys file unreadable at two starts: said, then Start Over (after the helper\'s yes) makes new keys and keeps the old', async () => {
      await quit()
      fs.writeFileSync(keysFile, crypto.randomBytes(200))
      await launch()
      let p = await main(60000)
      if (!p || !(await until(() => isApp(p), 60000))) throw new Error(`first start: ${JSON.stringify(p ? await look(p) : (await list()).map((t) => said(t.url).slice(0, 160)))}`)
      const swAfter = await p.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))
      const setup = (q, n = 0) => q.evaluate(() => fetch('/api/studio/sign/setup').then((r) => r.json())).catch(async (e) => (n < 10 ? (await sleep(500), setup(q, n + 1)) : { error: e.message, tries: n }))
      const first = await setup(p)
      await quit()
      await launch()
      p = await main(60000)
      if (!p || !(await until(() => isApp(p), 60000))) throw new Error(`second start: ${JSON.stringify(p ? await look(p) : (await list()).map((t) => said(t.url).slice(0, 160)))}`)
      const second = await setup(p)
      if (!first.keysUnreadable || first.canStartOver || !second.keysUnreadable || !second.canStartOver) throw new Error(JSON.stringify({ first: { unreadable: first.keysUnreadable, offered: first.canStartOver, error: first.error }, second: { unreadable: second.keysUnreadable, offered: second.canStartOver, error: second.error } }))
      const was = serverPid()
      const done = await p.evaluate(async () => {
        const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }), (e) => ({ error: e.message }))
        const g = await post('/api/studio/sign/ask', { purpose: 'start-over' })
        const r = await post('/api/studio/sign/start-over', { grant: g.j?.grant })
        return { grant: !!g.j?.grant, ask: g.error || g.status, status: r.status, error: r.error }
      })
      if (!done.grant || done.status !== 200) throw new Error(`Start Over: ${JSON.stringify(done)}`)
      const now = await until(async () => { const n = serverPid(); return n && n !== was && alive(n) ? n : null }, 30000)
      const w = await until(async () => { const x = pages().find((q) => q.url() === `${BASE}/`); return x && await isApp(x) ? x : null }, 60000, 300)
      const after = w && await setup(w)
      const kept = fs.readdirSync(path.dirname(keysFile)).filter((f) => f.startsWith('signing-keys.unreadable-'))
      if (!now || !w || after?.keysUnreadable || !fs.existsSync(keysFile) || !kept.length) throw new Error(JSON.stringify({ now, back: !!w, after: after && { unreadable: after.keysUnreadable }, kept }))
      return `first start: said, not offered; second: offered; after it: the server started again (pid ${was} → ${now}), new keys, the old kept (${kept.length}); service workers at that start: ${swAfter}${reconnects ? ` (DevTools connected again ${reconnects} time(s))` : ""}`
    })
  } finally {
    clearInterval(watching)
    // (The server outlives the app by design: stopped first, while it's still the app's; its
    // terminals end with it, keepAgents being off.)
    await quit({ server: true }).catch(() => {})
    const left = serverPid()
    if (left && alive(left)) console.log(`--   the app's server (pid ${left}) was left running: it wasn't the app's own child by then, so it wasn't stopped here`)
    if (process.env.SMOKE_KEEP) console.log(`kept: ${data}`)
    else fs.rmSync(data, { recursive: true, force: true })
    if (out.length && process.env.SMOKE_VERBOSE) console.log(out.join('').slice(-3000))
  }
}
