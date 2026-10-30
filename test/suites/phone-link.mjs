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
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, browser, sleep, shot } from '../lib/harness.mjs'

const { ok, skip, done } = checks('phone-link')
const NET = { ms: 60, host: 15, kbps: 8000 }
const RTT = 2 * (NET.ms + NET.host)
const say = (...a) => console.log(...a)

const { b, which } = await browser()
let kit = null
let relay = null
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
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  if (kit) console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit?.stop()
  relay?.stop()
}
process.exit(done().fail ? 1 : 0)
