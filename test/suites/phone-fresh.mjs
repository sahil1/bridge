// The phone keeps up with the computer. A phone keeps Bridge AI's page open for days, and the
// computer can update under it; the page went on as the old version (no Whiteboards after 3.8) until
// the app was closed for good. Here the computer serves a copy of the built UI (BRIDGE_UI_DIR) that
// the test updates as a new version would: a new entry file, as a new build's hash names it (one
// that loads the same code, which the other files load by its own name).
//   /api/version says which UI the computer hands out (its entry file) and the computer's name.
//   On a phone: back on the screen after an update, the page loads the new version by itself; in
//   the middle of something (just tapped, typing, a dialog open) it says "Bridge AI on <computer>
//   was updated" with Reload instead, a whole 40px line, and loads it by itself the next time it's
//   back on the screen with nothing under way; a reload that brings the same page back isn't tried
//   again (no going round in circles), it only says so. On a wide screen, the top bar's Updated ·
//   Reload.
//   The phone apps: one older than this page needs says so, with the App Store or TestFlight on an
//   iPhone and the website's APK on Android; a new enough one, or a browser, says nothing.
//   Through the relay (the phone page, stand-ins/relay.mjs): an older UI in the frame, from before
//   pages kept themselves up to date, is loaded anew by the phone page when the link comes back
//   (as it does after the computer starts again on its new version), or the phone page's bar says
//   so with Reload when something's being typed in it; the frame alone reloads, not the phone page.
//   A UI that keeps itself up to date does it through the relay too.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, browser, page, sleep, shot, noServiceWorker, OUT, ROOT } from '../lib/harness.mjs'

const { ok, skip, done } = checks('phone-fresh')
const COMPUTER = 'Studio Mac'

// The copy of the UI, and its updates: a new entry file that loads the same code, which the other
// files load by its own name (a copy under the new name would be a second app in the same page).
const ui = path.join(OUT, 'kits', `phone-fresh-ui-${process.pid}`)
fs.rmSync(ui, { recursive: true, force: true })
fs.cpSync(path.join(ROOT, 'dist'), ui, { recursive: true })
const html0 = fs.readFileSync(path.join(ui, 'index.html'), 'utf8')
const entry0 = /src="\.\/assets\/([^"]+\.js)"/.exec(html0)[1]
let n = 0
const update = () => {
  const name = entry0.replace(/\.js$/, `-v${++n}.js`)
  fs.writeFileSync(path.join(ui, 'assets', name), `import './${entry0}'\n`)
  fs.writeFileSync(path.join(ui, 'index.html'), html0.replace(entry0, name))
  return name
}
// An older UI, from before pages kept themselves up to date (it has no window.bridgeFresh).
const serveOld = (k) => {
  fs.writeFileSync(path.join(ui, 'assets', `old-ui-${k}.js`), `document.body.innerHTML = '<main id="old"><h1>Bridge AI ${k}</h1><input id="note" aria-label="Note"></main>'\n`)
  fs.writeFileSync(path.join(ui, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><script type="module" src="./assets/old-ui-${k}.js"></script></head><body></body></html>`)
}
// The server reads which UI it hands out at most every 2 s.
const settle = () => sleep(2300)

// The phone's screen, on cue: off (locked, or another app in front) and back on.
const hooks = () => {
  window.__hidden = false
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__hidden })
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') })
}
const screen = (p, on) => p.evaluate((on) => { window.__hidden = !on; document.dispatchEvent(new Event('visibilitychange')) }, on)
const entryOf = (f) => f.evaluate(() => [...document.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute('src')).find((x) => /assets\//.test(x))?.split('/').pop()).catch(() => null)
// A reload cuts off the page's requests, which WebKit reports as errors (and the link dropping on
// cue, the phone page's waiting ones).
const real = (errors) => errors.filter((e) => !/\/api\/\S+ due to access control checks|^Error: (Reconnecting to your computer|Connection lost)/.test(e))
const fits = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { h: Math.round(r.height), inside: r.left >= 0 && r.right <= window.innerWidth } }, sel)

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const relay = await startRelay('phone-fresh')
const kit = await startKit('phone-fresh', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile)); return { BRIDGE_UI_DIR: ui, BRIDGE_COMPUTER_NAME: COMPUTER } } })
try {
  await kit.api('/setup', { name: 'Tester' })
  const v0 = await kit.api('/version')
  ok(v0.ui === entry0, '/api/version says which UI the computer hands out: its entry file', v0)
  ok(v0.computer === COMPUTER, 'and the computer\'s name', v0)

  // ---------- on a phone ----------
  const ph = await page(b, kit.url, { phone: true, before: (c) => c.addInitScript(hooks) })
  let loads = 0
  ph.p.on('load', () => loads++)
  await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
  ok(await entryOf(ph.p) === entry0, 'the phone opens on the computer\'s UI')

  // Off the screen meanwhile, the computer updates; back on it: the new one, by itself.
  await screen(ph.p, false)
  const v1 = update()
  await settle()
  let before = loads
  // Counted once the reload's own load event has come: the new page's entry file is in its DOM as
  // soon as the page is read, and on a busy machine its load event can come a second after that.
  const reloaded = ph.p.waitForEvent('load', { timeout: 15000 }).then(() => true, () => false)
  await screen(ph.p, true)
  ok(await reloaded && (await entryOf(ph.p)) === v1, 'back on the screen after the computer updated, the phone loads the new version by itself', await entryOf(ph.p))
  await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
  await until(() => ph.p.evaluate(() => typeof window.bridgeFresh?.check === 'function'), 10000)
  ok(loads === before + 1, 'once', { loads, before })
  ok(!(await ph.p.locator('.fresh-note').count()), 'and says nothing about it')

  // In the middle of something (just tapped a tab): it says so, with Reload.
  await ph.p.locator('.tabbar button', { hasText: 'Today' }).click()
  const v2 = update()
  await settle()
  before = loads
  await ph.p.evaluate(() => window.dispatchEvent(new Event('bridge-settings')))
  const note = ph.p.locator('.top-note.fresh-note')
  ok(!!(await until(() => note.isVisible(), 8000)), 'just tapped: no reload, a line under the top bar instead')
  ok(loads === before && (await entryOf(ph.p)) === v1, 'and the page stays as it was', { loads, before })
  ok(/Bridge AI on Studio Mac was updated/.test(await note.innerText()) && /Reload/.test(await note.innerText()), 'it names the computer, with Reload', await note.innerText())
  const nf = await fits(ph.p, '.top-note.fresh-note')
  ok(nf?.h >= 40 && nf.inside, 'a whole 40px line, within the screen', nf)
  ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nothing wider than the phone')
  await shot(ph.p, `${tag}phone-fresh-note`)
  await note.click()
  ok(!!(await until(async () => (await entryOf(ph.p)) === v2, 10000)), 'Reload loads the new version', await entryOf(ph.p))
  await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
  ok(!(await ph.p.locator('.fresh-note').count()), 'and the line goes')

  // Typing, in a dialog: the line again; then off the screen and back with nothing under way, the
  // new one by itself.
  await ph.p.locator('.search-btn').click()
  await ph.p.locator('.palette input').fill('whiteboard')
  const v3 = update()
  await settle()
  await ph.p.evaluate(() => window.dispatchEvent(new Event('bridge-settings')))
  ok(!!(await until(() => note.isVisible(), 8000)) && (await entryOf(ph.p)) === v2, 'typing in a dialog: no reload, the line says so')
  await ph.p.keyboard.press('Escape')
  await screen(ph.p, false)
  await screen(ph.p, true)
  ok(!!(await until(async () => (await entryOf(ph.p)) === v3, 10000)), 'then off the screen and back on with nothing under way: the new version, by itself', await entryOf(ph.p))
  ok(!real(ph.errors).length, 'no page errors on the phone', ph.errors)
  await ph.ctx.close()

  // A reload that brings the same page back (something on the way keeps the old one): tried once,
  // then only said.
  const loop = await page(b, kit.url, {
    phone: true,
    before: async (c) => {
      await noServiceWorker(c)
      await c.addInitScript(hooks)
      await c.route(/\/api\/version$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '9.9.9', ui: 'index-never.js', computer: COMPUTER }) }))
    },
  })
  let loopLoads = 0
  loop.p.on('load', () => loopLoads++)
  await loop.p.waitForSelector('.tabbar button', { timeout: 20000 })
  await screen(loop.p, false)
  await screen(loop.p, true)
  ok(!!(await until(() => loopLoads >= 1, 8000)), 'a version the page can\'t get: it reloads once')
  await loop.p.waitForSelector('.tabbar button', { timeout: 20000 })
  await screen(loop.p, false)
  await screen(loop.p, true)
  await loop.p.evaluate(() => window.dispatchEvent(new Event('bridge-settings')))
  ok(!!(await until(() => loop.p.locator('.top-note.fresh-note').isVisible(), 8000)), 'then only says so')
  await sleep(1500)
  ok(loopLoads === 1, 'and doesn\'t go round in circles', loopLoads)
  await loop.ctx.close()

  // ---------- on a wide screen ----------
  const wide = await page(b, kit.url)
  await wide.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await wide.p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
  const v4 = update()
  await settle()
  await wide.p.evaluate(() => window.dispatchEvent(new Event('bridge-settings')))
  const chip = wide.p.locator('.fresh-chip')
  ok(!!(await until(() => chip.isVisible(), 8000)), 'on a wide screen, the top bar says Updated, with Reload')
  ok(/Studio Mac was updated/.test(await chip.getAttribute('title')), 'naming the computer', await chip.getAttribute('title'))
  await shot(wide.p, `${tag}fresh-chip`, { clip: { x: 0, y: 0, width: 1440, height: 120 } })
  await chip.click()
  ok(!!(await until(async () => (await entryOf(wide.p)) === v4, 10000)), 'and Reload loads the new version')
  ok(!real(wide.errors).length, 'no page errors on a wide screen', wide.errors)
  await wide.ctx.close()

  // ---------- the phone apps themselves ----------
  const IPHONE = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) BridgeAIApp/${v} Mobile/15E148 Safari/604.1`
  const ANDROID = (v) => `Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 BridgeAIApp/${v}`
  const inApp = async (ua) => {
    const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, userAgent: ua, ...(which === 'chromium' ? { isMobile: true } : {}), hasTouch: true, deviceScaleFactor: 2 })
    await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })) } catch { /* no storage */ } })
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(kit.url)
    await p.waitForSelector('.tabbar button', { timeout: 20000 })
    await sleep(800)
    return { ctx, p, errors }
  }
  const old = await inApp(IPHONE('3.7.1'))
  const line = old.p.locator('.app-note')
  ok(!!(await until(() => line.isVisible(), 5000)), 'an iPhone app older than this page needs: a line says so')
  const said = await line.innerText().catch(() => '')
  ok(/iPhone app is older than Bridge AI on Studio Mac needs \(3\.8\.0 or later\)/.test(said) && /App Store/.test(said) && /TestFlight/.test(said), 'naming the computer, the version it needs, the App Store and TestFlight', said)
  const lf = await fits(old.p, '.app-note')
  ok(lf?.h >= 40 && lf.inside && await old.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'whole on a 375 px screen', lf)
  await shot(old.p, `${tag}phone-fresh-old-iphone-app`)
  await old.p.locator('.app-note .top-note-x').click()
  ok(!(await line.count()), 'Not now puts it away')
  await old.p.reload()
  await old.p.waitForSelector('.tabbar button', { timeout: 20000 })
  await sleep(800)
  ok(!(await line.count()), 'for good, for that version')
  ok(!real(old.errors).length, 'no page errors in the old iPhone app', old.errors)
  await old.ctx.close()
  const droid = await inApp(ANDROID('3.4.0'))
  const link = droid.p.locator('.app-note a')
  ok(!!(await until(() => link.isVisible(), 5000)) && (await link.getAttribute('href')) === 'https://boldbridge.ai/#android' && (await link.getAttribute('target')) === '_blank', 'an older Android app: a link to the website\'s APK, opened outside the app')
  ok(/Android app is older than Bridge AI on Studio Mac needs/.test(await link.innerText()), 'saying why', await link.innerText())
  await shot(droid.p, `${tag}phone-fresh-old-android-app`)
  await droid.ctx.close()
  for (const [what, ua] of [['a new enough iPhone app', IPHONE('3.8.2')], ['a new enough Android app', ANDROID('3.8.2')], ['a phone\'s browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1']]) {
    const x = await inApp(ua)
    ok(!(await x.p.locator('.app-note').count()), `${what}: nothing said`)
    await x.ctx.close()
  }

  // ---------- through the relay, the phone page ----------
  ok(!!(await until(async () => (await kit.api('/relay')).online, 20000)), 'Bridge AI connects to its relay')
  serveOld(1)
  await settle()
  const code = (await kit.api('/relay/pair', {})).pairing.code
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...(which === 'chromium' ? { isMobile: true } : {}), hasTouch: true, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })) } catch { /* no storage */ } })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(`${relay.url}/#pair=${code}`)
  await p.locator('#pair-go').click({ timeout: 15000 }) // a pairing link asks first: one tap
  const frame = () => p.frames().find((f) => f !== p.mainFrame() && f.url().startsWith(relay.url))
  ok(!!(await until(() => frame()?.locator('#old').count(), 30000)), 'paired: the phone page shows the computer\'s UI, an older one')
  await p.evaluate(() => { window.__same = true })

  // The computer updates and starts again (its link to the phone drops, and comes back).
  fs.writeFileSync(path.join(ui, 'index.html'), html0.replace(entry0, v4))
  await settle()
  await relay.drop()
  ok(!!(await until(() => frame()?.locator('.tabbar button').count(), 30000)), 'the link back, the phone page loads the computer\'s new UI in place of the older one')
  ok(await p.evaluate(() => window.__same === true), 'only the frame: the phone page itself stays (and its link)')

  // An older one being typed in: the phone page's bar says so, with Reload.
  serveOld(1)
  await settle()
  await frame().evaluate(() => location.reload())
  await until(() => frame()?.locator('#note').count(), 20000)
  await frame().locator('#note').fill('a draft')
  serveOld(2)
  await settle()
  await relay.drop()
  ok(!!(await until(() => p.locator('#bar-go').isVisible(), 30000)), 'typing in it: no reload, the phone page\'s bar says so, with Reload')
  ok(/Bridge AI on Studio Mac was updated/.test(await p.locator('#bar-text').innerText()), 'naming the computer', await p.locator('#bar-text').innerText())
  ok(await frame().locator('#note').inputValue() === 'a draft', 'and what was typed is still there')
  const go = await fits(p, '#bar-go')
  ok(go?.h >= 40 && go.inside, 'Reload is a whole 40px target', go)
  await shot(p, `${tag}phone-fresh-relay-bar`)
  await p.locator('#bar-go').click()
  ok(!!(await until(async () => (await entryOf(frame())) === 'old-ui-2.js', 15000)), 'Reload loads the new one')
  ok(await p.locator('#bar-go').isHidden() && await p.evaluate(() => window.__same === true), 'the bar goes, and the phone page stayed')

  // A UI that keeps itself up to date, through the relay: the link back, it loads the new one itself.
  fs.writeFileSync(path.join(ui, 'index.html'), html0.replace(entry0, v4))
  await settle()
  await frame().evaluate(() => location.reload())
  ok(!!(await until(() => frame()?.locator('.tabbar button').count(), 30000)) && await frame().evaluate(() => typeof window.bridgeFresh?.check === 'function'), 'the new UI looks after itself (window.bridgeFresh)')
  const v5 = update()
  await settle()
  await relay.drop()
  ok(!!(await until(async () => (await entryOf(frame())) === v5, 30000)), 'the link back after an update: it loads the new version by itself, through the relay', await entryOf(frame()))
  ok(await p.evaluate(() => window.__same === true), 'the frame only, the relay page unchanged')
  ok(!real(errors).length, 'no page errors through the relay', errors)
  await ctx.close()
  skip('the iPhone app\'s own copy of the phone page', 'it needs the app (its Tunnel); the phone page there is the same file, relay/web/shell.js')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
  relay.stop()
  fs.rmSync(ui, { recursive: true, force: true })
}
process.exit(done().fail ? 1 : 0)
