// The phone page's service worker (relay/web/sw.js), which every request Bridge AI makes in its
// frame goes through, not getting there. Bridge AI waits for it before it opens in the frame
// (relay/web/shell.js showApp), and a browser can leave it installing for good: the frame then stayed
// at about:blank, a blank page with nothing said. Now, 10 s on:
//   one the browser made active, though it never said it was ready: Bridge AI opens with it;
//   none: the page says Bridge AI is taking a while to open, why, and what to do, with Try again,
//     which loads the page afresh, and Bridge AI then opens (the phone is paired already).
// Paired with a pairing link (the QR code), at a phone's size, in Chromium (the Android app's
// WebView) and WebKit (Safari, the iPhone app's engine).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, browser, shot, sleep, browserNotice, phoneSaw } from '../lib/harness.mjs'

const { ok, done } = checks('phone-worker')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const relay = await startRelay('phone-worker')
const kit = await startKit('phone-worker', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile)); return { BRIDGE_COMPUTER_NAME: 'Studio' } } })
// A reload cuts off the page's requests, which WebKit reports as errors.
const real = (errors) => errors.filter((e) => !/\/api\/\S+ due to access control checks|^Error: (Reconnecting to your computer|Connection lost)/.test(e) && !browserNotice(e))

// A phone, its page's service worker held back by `hold` (in the phone page alone, not Bridge AI's
// frame): 'never' (it never registers, the first time the page opens) or 'unsaid' (it registers and
// is active, but the browser never says it's ready).
async function phone(hold) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...(which === 'chromium' ? { isMobile: true } : {}), hasTouch: true, deviceScaleFactor: 2 })
  await ctx.addInitScript((hold) => {
    try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })) } catch { /* no storage */ }
    if (window !== window.top || !window.ServiceWorkerContainer) return
    if (hold === 'unsaid') {
      Object.defineProperty(ServiceWorkerContainer.prototype, 'ready', { configurable: true, get: () => new Promise(() => {}) })
    } else if (hold === 'never' && !sessionStorage.getItem('held')) {
      sessionStorage.setItem('held', '1')
      ServiceWorkerContainer.prototype.register = () => new Promise(() => {})
      ServiceWorkerContainer.prototype.getRegistration = async () => undefined
    }
  }, hold)
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto((await kit.api('/relay/pair', {})).pairing.link, { waitUntil: 'commit' })
  await p.locator('#pair-go').click({ timeout: 15000 }) // a pairing link asks first: one tap
  const frame = () => p.frames().find((f) => f !== p.mainFrame() && f.url().startsWith(relay.url))
  const opened = () => until(() => frame()?.locator('.settings-btn').count(), 30000, 200)
  return { ctx, p, errors, frame, opened }
}
const shown = (p) => p.evaluate(() => ({ wait: !document.getElementById('wait').hidden, title: document.getElementById('wait-title').textContent, text: document.getElementById('wait-text').textContent, retry: !document.getElementById('retry').hidden, frame: document.getElementById('app').getAttribute('src'), frameHidden: document.getElementById('app').hidden }))

try {
  await kit.api('/setup', { name: 'Tester' })
  ok(!!(await until(async () => (await kit.api('/relay')).online, 20000)), 'Studio is on its relay')

  // ---------- active, never said ready ----------
  let ph = await phone('unsaid')
  const t0 = Date.now()
  let open = await ph.opened()
  const saw = open ? null : { shown: await shown(ph.p), page: await phoneSaw(ph.p) }
  ok(!!open, 'a service worker the browser made active but never said was ready: Bridge AI opens with it all the same', saw || undefined)
  ok(!open || Date.now() - t0 < 40000, `within the wait for it (${Math.round((Date.now() - t0) / 1000)} s)`)
  if (open) ok(await ph.frame().evaluate(() => !!navigator.serviceWorker?.controller), 'and the worker carries what it asks for (its frame is in its hands)')
  ok(!real(ph.errors).length, 'no page errors', ph.errors)
  await ph.ctx.close()

  // ---------- never there ----------
  ph = await phone('never')
  const said = await until(async () => { const x = await shown(ph.p); return x.wait && /taking a while/.test(x.title) ? x : null }, 40000, 200)
  ok(!!said && /hasn't finished setting up this page/.test(said.text) && /Try again/.test(said.text) && said.retry, 'a service worker that never gets there: not a blank page, but why, and what to do, with Try again', said || await shown(ph.p))
  ok(!!said && !said.frame && said.frameHidden, 'Bridge AI\'s frame isn\'t shown blank meanwhile', said)
  await shot(ph.p, `${tag}phone-worker-slow`)
  // The link dropping and coming back meanwhile (Bridge AI would show again): still said, not blank.
  await relay.drop()
  await sleep(6000)
  const again = await until(async () => { const x = await shown(ph.p); return x.wait && /taking a while/.test(x.title) && x.frameHidden ? x : null }, 20000, 200)
  ok(!!again, 'the link dropping and coming back meanwhile: still said, never a blank frame', again || await shown(ph.p))
  const box = await ph.p.locator('#retry').boundingBox()
  ok(box && box.height >= 40 && box.x >= 0 && box.x + box.width <= 390, 'Try again is a whole 40 px target on the screen', box)
  await ph.p.locator('#retry').click()
  open = await ph.opened()
  ok(!!open, 'Try again loads the page afresh, and Bridge AI opens (the phone is paired already)', open ? undefined : { shown: await shown(ph.p), page: await phoneSaw(ph.p) })
  ok(!real(ph.errors).length, 'no page errors', ph.errors)
  await ph.ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
  relay.stop()
}
process.exit(done().fail ? 1 : 0)
