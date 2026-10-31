// The phone page (relay/web) in the browser named by BRIDGE_TEST_BROWSER, paired with a Bridge AI
// through a relay (stand-ins/relay.mjs) whose network is made like a phone's: 60 ms each way and
// 8 Mbit/s between the phone and the relay, 15 ms between the relay and the computer, so a request
// and its answer take about 150 ms there and back. How long the phone takes to open Bridge AI, to
// ask it something, and to get back to it when the connection breaks, each against a limit well
// above what it takes and below what it used to:
//   first open: the app's files come compressed (they were 2 MB over the link, now under 0.6)
//   opened again: the page's own files aren't downloaded again, and asked for at once
//   the relay drops everything: back in under 2.3 s (the computer waited 2 s before it tried again)
//   offline, then back: at once (the phone waited up to 30 s for its next try)
//   a connection that dies without a word: back once the app is on the screen again (it never was)
//   the computer's connection dies without a word: back in under 40 s (it took 50 to 100)
// Then the phone app (stood in for: the window.bridgeNative the iPhone app gives the page) paired with
// this computer and a second one, and this one away: offline, or its relay not answering. The start
// screen says so in a few seconds, with the other computer a tap away, what it last sent, Cloud
// Agents and the demo (it opened what it last sent instead, or waited on "Connecting…" for good).
// And the page in a browser, with its relay not answering: it says so (it waited for good).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, browser, sleep, shot } from '../lib/harness.mjs'

const { ok, skip, done } = checks('phone-link')
const NET = { ms: 60, host: 15, kbps: 8000 }
const RTT = 2 * (NET.ms + NET.host)
const say = (...a) => console.log(...a)

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
let kit = null
let relay = null
let kit2 = null
let relay2 = null
try {
  relay = await startRelay('phone-link')
  kit = await startKit('phone-link', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile)); return {} } })
  await kit.api('/setup', { name: 'Tester' })
  ok(!!(await until(async () => (await kit.api('/relay')).online, 20000)), 'Bridge AI connects to its relay')
  const code = (await kit.api('/relay/pair', {})).pairing.code
  const test = (what, q = '') => fetch(`${relay.url}/_test/${what}${q}`, { method: what === 'state' ? 'GET' : 'POST' }).then((r) => r.json())
  await test('net', `?ms=${NET.ms}&host=${NET.host}&kbps=${NET.kbps}`)

  // A phone of its own: no routes, which would turn the browser's cache off (harness page()).
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'light', theme: 'sky', text: 'm' })) } catch { /* no storage */ } })
  const errors = []
  let p = null
  const open = async (url) => {
    p = await ctx.newPage()
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(url, { waitUntil: 'commit' })
  }
  const app = () => p.frames().find((f) => f !== p.mainFrame() && f.url().startsWith(relay.url))
  // When the app inside has its first answers (the settings and your agents), from the moment `t0`.
  const answered = async (t0) => {
    const at = await until(() => app()?.evaluate(() => {
      const r = performance.getEntriesByType('resource')
      const end = (u) => r.find((x) => x.name === location.origin + u)?.responseEnd
      const t = Math.max(end('/api/config'), end('/api/fleet'))
      return Number.isFinite(t) ? performance.timeOrigin + t : null
    }), 30000, 50)
    return at ? Math.round(at - t0) : null
  }
  // A request from the app, through the link: whether it was answered (within `ms`).
  const asks = (u = '/api/version', ms = 4000) => app()?.evaluate(async ({ u, ms }) => {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), ms)
    try { return (await fetch(u, { signal: c.signal })).ok } catch { return false } finally { clearTimeout(t) }
  }, { u, ms }).catch(() => false)
  const backIn = async (limit) => { const t0 = Date.now(); const back = await until(() => asks(), limit, 50); return back ? Date.now() - t0 : null }
  const s = (ms) => (ms == null ? 'never' : `${(ms / 1000).toFixed(1)} s`)

  // ---------- the first time: pairing, then Bridge AI ----------
  await test('count')
  let t0 = Date.now()
  await open(`${relay.url}/#pair=${code}`)
  const first = await answered(t0)
  const firstBytes = (await test('state')).sent.downBytes
  say(`first open: answers at ${first} ms, ${Math.round(firstBytes / 1024)} KB over the link`)
  ok(first != null && first < 4000, `paired and opened: Bridge AI's first screen has its answers in ${s(first)} (limit 4 s)`, first)
  ok(firstBytes < 900 * 1024, `with ${Math.round(firstBytes / 1024)} KB over the link, its files compressed (limit 900 KB; 1.9 MB when they weren't)`, firstBytes)
  await app().locator('.tabbar button').first().waitFor({ timeout: 15000 }).catch(() => {})
  ok(await app().locator('.tabbar button').count() > 0, 'and the app works: its tabs are there')
  await shot(p, `${which === 'webkit' ? 'webkit-' : ''}phone-link`)
  // Only the app's own files are compressed: an answer about you goes as it is.
  await sleep(1500)
  await test('count')
  const settings = await app().evaluate(async () => (await (await fetch('/api/settings')).arrayBuffer()).byteLength)
  const settingsDown = (await test('state')).sent.downBytes
  ok(settings > 500 && settingsDown >= settings, 'an answer of the computer\'s own (Settings) isn\'t compressed', { settings, settingsDown })

  // ---------- opened again ----------
  await sleep(1500)
  await p.close()
  await test('count')
  t0 = Date.now()
  await open(`${relay.url}/`)
  const again = await answered(t0)
  const pageBytes = (await test('state')).sent.page
  const order = await p.evaluate(() => {
    const r = performance.getEntriesByType('resource')
    const at = (f) => r.find((x) => x.name.endsWith(f))
    return { shellDone: at('/shell.js')?.responseEnd, linkAsked: at('/link.js')?.startTime, offlineAsked: at('/offline.js')?.startTime }
  })
  say(`reopen: answers at ${again} ms, page files ${pageBytes} bytes`, order)
  ok(again != null && again < 2500, `opened again: answers in ${s(again)} (limit 2.5 s)`, again)
  // (Playwright's WebKit keeps nothing in its cache from one page to the next; Safari does.)
  if (which === 'webkit') skip('the page\'s own files aren\'t downloaded again', 'Playwright\'s WebKit keeps no cache between pages')
  else ok(pageBytes < 20 * 1024, `the page's own files aren't downloaded again (${pageBytes} bytes; they were 210 KB each time)`, pageBytes)
  ok(order.linkAsked < order.shellDone && order.offlineAsked < order.shellDone, 'what the page needs is asked for with it, not after it', order)

  // ---------- asking ----------
  const timed = (n, parallel) => app().evaluate(async ({ n, parallel }) => {
    const one = async () => { const r = await fetch('/api/version'); await r.arrayBuffer() }
    const t = performance.now()
    if (parallel) await Promise.all(Array.from({ length: n }, one))
    else for (let i = 0; i < n; i++) await one()
    return Math.round((performance.now() - t) / (parallel ? 1 : n))
  }, { n, parallel })
  const one = await timed(5, false)
  const ten = await timed(10, true)
  say(`a request: ${one} ms; ten at once: ${ten} ms (network ${RTT} ms)`)
  ok(one < RTT + 250, `a request is answered in ${one} ms, the network itself ${RTT} (limit ${RTT + 250})`, one)
  ok(ten < RTT * 2 + 300, `ten at once in ${ten} ms, not one after another (limit ${RTT * 2 + 300})`, ten)

  // ---------- live: typing in a terminal on the computer ----------
  const sh = await kit.api('/agents/launch', { kind: 'shell', cwd: kit.home, label: 'Terminal', newSpace: 'Terminals' })
  // Once the shell shows its prompt (PowerShell can take a while to start on a CI runner).
  const screen = async () => ((await kit.api(`/agents/${encodeURIComponent(sh.paneId)}/screen?lines=50`)).ansi || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  await until(async () => /[$#%>]$/.test((await screen()).trimEnd().split('\n').pop() || ''), 30000)
  const keys = await p.evaluate(async (pane) => {
    const ws = new window.bridgeRelay.WebSocket(`/api/panes/${encodeURIComponent(pane)}/attach?cols=80&rows=24`)
    ws.binaryType = 'arraybuffer'
    let seen = ''
    const dec = new TextDecoder()
    ws.onmessage = (e) => { seen += typeof e.data === 'string' ? e.data : dec.decode(e.data) }
    await new Promise((ok, no) => { ws.onopen = ok; setTimeout(() => no(new Error('the terminal didn\'t open')), 10000) })
    const wait = async (fn, ms) => { const t = performance.now(); while (!fn()) { if (performance.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 5)) } return true }
    // The shell is there once it has said anything (its prompt).
    await wait(() => seen.length > 0, 15000)
    await new Promise((r) => setTimeout(r, 500))
    const times = []
    for (const ch of 'bridge') {
      const n = seen.split(ch).length
      const t = performance.now()
      ws.send(ch)
      times.push((await wait(() => seen.split(ch).length > n, 5000)) ? Math.round(performance.now() - t) : null)
    }
    ws.close()
    return times
  }, sh.paneId).catch((e) => [String(e.message)])
  const slowest = keys.every((x) => typeof x === 'number') ? Math.max(...keys) : null
  say('keys back on screen (ms):', keys)
  ok(slowest != null && slowest < RTT + 600, `typing in a terminal on the computer: each key back on the screen in ${slowest} ms at most (limit ${RTT + 600})`, keys)

  // ---------- the relay drops every connection (a network that changed) ----------
  await sleep(1000)
  await test('drop')
  const dropped = await backIn(15000)
  say(`after a drop: ${dropped} ms`)
  ok(dropped != null && dropped < 2300, `the relay drops every connection: answering again in ${s(dropped)} (limit 2.3 s)`, dropped)

  // ---------- the phone offline for a while, then back ----------
  await sleep(1500)
  await ctx.setOffline(true)
  await test('drop')
  await sleep(16000)
  await ctx.setOffline(false)
  const online = await backIn(20000)
  say(`back online: ${online} ms`)
  ok(online != null && online < 4000, `16 s with no network, then back: answering again in ${s(online)} (limit 4 s)`, online)

  // ---------- its connection dies without a word, then Bridge AI is back on the screen ----------
  await sleep(1500)
  const visible = (on) => p.evaluate((on) => {
    for (const [k, v] of [['visibilityState', on ? 'visible' : 'hidden'], ['hidden', !on]]) Object.defineProperty(document, k, { configurable: true, get: () => v })
    document.dispatchEvent(new Event('visibilitychange'))
  }, on)
  await visible(false)
  await test('silence')
  await sleep(1500)
  await visible(true)
  const woke = await backIn(15000)
  say(`back on screen after a silent drop: ${woke} ms`)
  ok(woke != null && woke < 10000, `its connection died without a word, and it's back on the screen: answering again in ${s(woke)} (limit 10 s)`, woke)

  // ---------- the computer's connection dies without a word (it slept, or changed networks) ----------
  await sleep(1500)
  await test('silence', '?who=host')
  const host = await backIn(45000)
  say(`the computer's silent drop: ${host} ms`)
  ok(host != null && host < 40000, `the computer's connection died without a word: the phone reaches it again in ${s(host)} (limit 40 s)`, host)

  // (WebKit reports an answer the dropped link cut short, which the app is told of, as a page error.)
  const errs = errors.filter((e) => !(which === 'webkit' && /^Error: (Reconnecting to your computer|Connection lost)/.test(e)))
  ok(errs.length === 0, 'no page errors', errs)

  // ---------- two computers, and the one showing away ----------
  await test('net')
  relay2 = await startRelay('phone-link-2')
  kit2 = await startKit('phone-link-2', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay2.relayFile)); return {} } })
  await kit2.api('/setup', { name: 'Tester' })
  ok(!!(await until(async () => (await kit2.api('/relay')).online, 20000)), 'a second computer connects to a relay of its own')
  // The iPhone app, stood in for: what it gives the page, and what the page asks of it. Bridge AI in
  // the page's frame isn't needed here (and nothing would carry its requests): a stand-in page.
  const phoneApp = async (cfg) => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2 })
    await c.addInitScript((cfg) => {
      if (window !== window.top) return
      window.__posts = []
      window.bridgeNative = { platform: 'ios', bundled: ['demo', 'cloud'], ...cfg, post: (m) => window.__posts.push(m) }
    }, cfg)
    await c.route('**/*', (r) => (r.request().isNavigationRequest() && r.request().frame().parentFrame() ? r.fulfill({ contentType: 'text/html', body: '<p>Bridge AI</p>' }) : r.continue()))
    return { c, p: await c.newPage() }
  }
  // Paired, as the app does it: the page hands it the pairing to keep.
  const pairApp = async (rel, k) => {
    const a = await phoneApp({ relay: rel.url, pairing: null, computers: [] })
    await a.p.goto(`${rel.url}/#pair=${(await k.api('/relay/pair', {})).pairing.code}`)
    const kept = await until(() => a.p.evaluate(() => window.__posts.find((m) => m.type === 'keep' && m.pairing?.hostKey)?.pairing), 20000, 200)
    await a.c.close()
    return kept
  }
  const pair1 = await pairApp(relay, kit)
  const pair2 = await pairApp(relay2, kit2)
  ok(!!pair1 && !!pair2, 'the app pairs with both')
  const computers = [{ relay: relay.url, name: 'Studio' }, { relay: relay2.url, name: 'Desk' }]
  const look = (pg) => pg.evaluate(() => {
    const shown = (sel) => { const el = document.querySelector(sel); return !!el && !el.hidden }
    return { wait: shown('#wait'), app: shown('#app'), away: shown('#away'), more: shown('#away-more'), title: document.getElementById('wait-title')?.textContent, saved: shown('#saved-open'), others: [...document.querySelectorAll('#wait .others button')].map((x) => x.firstChild?.textContent), states: [...document.querySelectorAll('#wait .others button')].map((x) => x.textContent), cloud: shown('#wait .cloud-try'), demo: shown('#wait .demo-try') }
  })
  // How long until the start screen's title says `re`, and what it shows then.
  const saysIn = async (pg, re, t0, ms = 15000) => {
    const got = await until(async () => { const l = await look(pg); return l.wait && re.test(l.title) ? l : null }, ms, 100)
    return { ms: got ? Date.now() - t0 : null, l: got || await look(pg) }
  }

  // Studio offline, with what it last sent kept on the phone.
  kit.stop()
  ok(!!(await until(async () => (await test('state')).computers === 0, 15000)), 'Studio goes offline (its relay stays up)')
  const ph = await phoneApp({ relay: relay.url, pairing: pair1, computers })
  await ph.p.goto(`${relay.url}/manifest.webmanifest`)
  await ph.p.evaluate(() => new Promise((ok, no) => {
    const r = indexedDB.open('bridge-relay', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); const s = t.objectStore('kv'); s.put({ s: 200, h: [['content-type', 'text/html']], at: Date.now(), t: '<p>Bridge AI</p>' }, 'offline:saved:/'); s.put({ '/': [16, Date.now()] }, 'offline:index'); t.oncomplete = ok; t.onerror = no }
    r.onerror = no
  }))
  t0 = Date.now()
  await ph.p.goto(`${relay.url}/`)
  const off = await saysIn(ph.p, /^Studio is offline/, t0)
  say(`the app, Studio offline: ${off.ms} ms`, off.l)
  ok(off.ms != null && off.ms < 4000 && !off.l.app, `the app opening on Studio, offline: the start screen says so in ${s(off.ms)} (limit 4 s), rather than opening what it last sent`, off.l)
  const offers = await until(async () => { const l = await look(ph.p); return l.others.includes('Desk') && l.saved && l.cloud && l.demo ? l : null }, 2000, 100)
  ok(!!offers, 'with Desk a tap away, what Studio last sent, Cloud Agents and the demo', await look(ph.p))
  await shot(ph.p, `${tag}phone-computer-offline`)
  await ph.p.locator('#saved-open').click({ timeout: 3000 }).catch(() => {})
  const savedOpen = await until(async () => { const l = await look(ph.p); return l.app && l.away && l.more ? l : null }, 5000, 100)
  ok(!!savedOpen, 'Open what it last sent: Bridge AI from what Studio last sent, under a banner with a way back', await look(ph.p))
  await ph.p.locator('#away-more').click({ timeout: 3000 }).catch(() => {})
  const back = await look(ph.p)
  ok(back.wait && !back.app && !back.away && back.others.includes('Desk'), 'Start screen: back to it, with Desk', back)
  await ph.p.locator('#wait .others button', { hasText: 'Desk' }).click({ timeout: 3000 }).catch(() => {})
  ok((await ph.p.evaluate(() => window.__posts)).some((m) => m.type === 'switch' && m.url === relay2.url), 'Desk: the app switches to it')

  // On Desk, which is on: what Bridge AI's menu asks of the page (bridgeRelay).
  const dk = await phoneApp({ relay: relay2.url, pairing: pair2, computers })
  await dk.p.goto(`${relay2.url}/`)
  ok(!!(await until(async () => (await look(dk.p)).app, 15000, 100)), 'the app on Desk: Bridge AI opens')
  const listed = await until(() => dk.p.evaluate(() => new Promise((ok) => {
    const l = () => window.bridgeRelay.computers.list()
    const studio = () => l().find((c) => c.name === 'Studio')
    if (studio().online != null) return ok(l())
    const stop = window.bridgeRelay.computers.subscribe(() => { if (studio().online != null) { stop(); ok(l()) } })
    setTimeout(() => ok(null), 8000)
  })), 10000, 200)
  const desk = listed?.find((c) => c.name === 'Desk')
  const studio = listed?.find((c) => c.name === 'Studio')
  ok(desk?.current && desk.online === true && studio?.online === false && studio.lastSeen > 0, 'bridgeRelay.computers.list(): Desk is the one showing and online; Studio offline, with when it was last seen (subscribe hears it)', listed)
  await dk.p.evaluate(() => window.bridgeRelay.start())
  const st = await until(async () => { const l = await look(dk.p); return l.wait && /^Connected to Desk/.test(l.title) && l.states.some((x) => /^Studio · offline/.test(x)) ? l : null }, 5000, 100)
  ok(!!st && st.cloud && st.demo && await dk.p.locator('#app-open').isVisible(), 'bridgeRelay.start(): the start screen over Bridge AI, with Back to Desk, Studio (offline), Cloud Agents and the demo', st || await look(dk.p))
  await shot(dk.p, `${tag}phone-start-screen`)
  await dk.p.locator('#app-open').click({ timeout: 3000 }).catch(() => {})
  ok((await look(dk.p)).app, 'Back to Desk: Bridge AI again')
  await dk.p.evaluate(() => window.bridgeRelay.openCloud())
  ok((await dk.p.evaluate(() => window.__posts)).some((m) => m.type === 'open' && m.name === 'cloud'), 'bridgeRelay.openCloud(): the app opens Cloud Agents')
  ok(await p.evaluate(() => window.bridgeRelay.openCloud === null && window.bridgeRelay.start === null && window.bridgeRelay.computers === null), 'in a browser, which has neither, the page offers no Cloud Agents or start screen to Bridge AI')
  await dk.c.close()

  // Studio's relay not answering (it takes the connection, then nothing gets through).
  await test('freeze')
  t0 = Date.now()
  await ph.p.goto(`${relay.url}/`)
  const frozen = await saysIn(ph.p, /^Can't reach Studio/, t0)
  say(`the app, Studio's relay not answering: ${frozen.ms} ms`, frozen.l)
  ok(frozen.ms != null && frozen.ms < 7000 && frozen.l.others.includes('Desk') && frozen.l.cloud, `the app opening on Studio, its relay not answering: the start screen says so in ${s(frozen.ms)} (limit 7 s), with Desk and Cloud Agents, instead of "Connecting…"`, frozen.l)
  await ph.c.close()

  // The page in a browser (Safari), paired with Studio alone, its relay not answering: what it
  // last sent, under a banner saying so.
  t0 = Date.now()
  await p.reload({ waitUntil: 'commit' })
  const safari = await until(async () => {
    const l = await look(p)
    const awayTitle = await p.locator('#away-title').innerText().catch(() => '')
    return (l.app && l.away && /Can't reach/.test(awayTitle)) || (l.wait && /^Can't reach/.test(l.title)) ? { ...l, awayTitle } : null
  }, 15000, 100)
  const safariMs = safari ? Date.now() - t0 : null
  say(`the browser, its relay not answering: ${safariMs} ms`, safari)
  ok(safariMs != null && safariMs < 9000, `in a browser, the relay not answering: it says so in ${s(safariMs)} (limit 9 s), instead of "Connecting…"`, safari || await look(p))
  await test('thaw')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  if (kit) console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit?.stop()
  relay?.stop()
  kit2?.stop()
  relay2?.stop()
}
process.exit(done().fail ? 1 : 0)
