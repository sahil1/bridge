// Bridge AI's hosted relay in the app when it's full, in the browser named by BRIDGE_TEST_BROWSER:
// the Worker itself (stand-ins/hosted-relay.mjs, with HOSTED on and MAX_COMPUTERS at 1) with one
// computer on it already. Settings › Devices: Use Bridge AI's relay says it's full for now and that
// the phone can still reach this computer, with your own Cloudflare and Tailscale a click each and
// Try again, said once; the relay marked Full for now among the ways, your own Cloudflare picked when
// Settings opens again, and it fits a phone; Try again once there's room sets it up. The server: the
// refusal with its code, and /api/relay saying so. `bridge-ai relay setup --hosted`: the reason and
// the other ways, and it fails. First-run setup on a new computer: Use Bridge AI on your phone,
// ticked; Continue says it's full and where the other ways are, and setup goes on to the end.
// Unticked, the relay isn't asked; with no hosted relay at all, setup doesn't offer it.
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, startKit, startHostedRelay, checks, until, browser, page, shot } from '../lib/harness.mjs'

const { ok, done } = checks('relay-hosted-ui')
const kits = []
const devices = (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))
const HOSTED = 'Bridge AI\'s relay'
const TOKEN = 'stats-for-tests'

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
let hr = null
const pages = []
try {
  hr = await startHostedRelay('relay-hosted-ui', { MAX_COMPUTERS: '1', STATS_TOKEN: TOKEN })
  const first = await hr.register()
  ok(first.status === 200 && !!first.id, 'the hosted relay takes one computer, and has one', first)

  // ---------- Settings › Devices ----------
  const k = await startKit('relay-hosted-ui', { config: { relay: { hostedUrl: hr.url } } })
  kits.push(k)
  await k.api('/setup', { name: 'Tester' })
  const s = await page(b, k.url, { mode: 'light', theme: 'sky' })
  pages.push(s)
  const openWays = async (pg) => {
    await pg.waitForSelector('.rail-nav-btn, .tabbar button', { timeout: 15000 })
    await devices(pg)
    await pg.locator('.ph-ways').waitFor({ timeout: 10000 })
  }
  await openWays(s.p)
  const way = (pg, title) => pg.locator('.ph-way', { hasText: title })
  ok(/Recommended/.test(await way(s.p, HOSTED).innerText()) && /true/.test(await way(s.p, HOSTED).getAttribute('aria-checked')), 'with Bridge AI\'s relay offered and nothing set up, it\'s picked, as recommended')
  await s.p.locator('button', { hasText: 'Use Bridge AI\'s relay' }).click()
  const box = s.p.locator('.hosted-full')
  await box.waitFor({ timeout: 15000 })
  const said = await box.innerText()
  ok(/full for now, so it can't take this computer/.test(said) && /your own Cloudflare account/.test(said) && /Tailscale/.test(said), 'Use Bridge AI\'s relay while it\'s full: it says so, and that the phone can still reach this computer another way', said)
  ok(await box.locator('button', { hasText: 'Use your own Cloudflare' }).count() === 1 && await box.locator('button', { hasText: 'Use Tailscale' }).count() === 1 && await box.locator('button', { hasText: 'Try again' }).count() === 1, 'with each other way a click away, and Try again')
  const sec = s.p.locator('.st-sec', { has: s.p.locator('.ph-ways') })
  ok(await sec.locator('.st-note.bad').count() === 0, 'said once: no error line under it as well', await sec.locator('.st-note.bad').allInnerTexts())
  ok(/Full for now/.test(await way(s.p, HOSTED).innerText()) && !/Recommended/.test(await way(s.p, HOSTED).innerText()), 'and Bridge AI\'s relay is marked Full for now among the ways', await way(s.p, HOSTED).innerText())
  await sec.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}relay-hosted-full`)

  // The server says the same, with its code, and remembers it.
  const st = await k.api('/relay')
  ok(!st.configured && /full for now/.test(st.hostedFull || ''), '/api/relay says Bridge AI\'s relay was full just now, and nothing is set up', { configured: st.configured, hostedFull: st.hostedFull })
  const refused = await k.api('/relay/deploy', { method: 'hosted' }).then(() => null, (e) => e)
  ok(refused?.j?.code === 'hostedFull' && /full for now/.test(refused.message), 'asked again, the refusal carries its code (hostedFull) and the relay\'s own words', refused?.j)

  // The other ways.
  await box.locator('button', { hasText: 'Use your own Cloudflare' }).click()
  ok(/Your own Cloudflare/.test(await s.p.locator('.ph-way.on').innerText()) && await s.p.locator('button', { hasText: 'Sign in with Cloudflare' }).count() === 1, 'Use your own Cloudflare: picked, with Sign in with Cloudflare', await s.p.locator('.ph-way.on').innerText())
  await way(s.p, HOSTED).click()
  await box.locator('button', { hasText: 'Use Tailscale' }).click()
  ok(!!(await until(async () => (await s.p.locator('h4', { hasText: 'Through Tailscale' }).count()) === 1, 5000)) && /Tailscale/.test(await s.p.locator('.ph-way.on').innerText()), 'Use Tailscale: picked, with Tailscale\'s steps')
  await s.p.reload()
  await openWays(s.p)
  ok(/Your own Cloudflare/.test(await s.p.locator('.ph-way.on').innerText()) && /Full for now/.test(await way(s.p, HOSTED).innerText()), 'Settings opened again soon after: your own Cloudflare is the one picked, and Bridge AI\'s relay is still marked full', await s.p.locator('.ph-ways').innerText())

  // On a phone, it fits.
  const ph = await page(b, k.url, { phone: true, mode: 'dark', theme: 'midnight' })
  pages.push(ph)
  await openWays(ph.p)
  await way(ph.p, HOSTED).click()
  await ph.p.locator('.hosted-full').waitFor({ timeout: 10000 })
  await ph.p.locator('.hosted-full').scrollIntoViewIfNeeded()
  ok((await ph.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'on a 390 px phone, the same box fits, with nothing sideways')
  await shot(ph.p, `${tag}relay-hosted-full-phone`)

  // `bridge-ai relay setup --hosted`, against this computer's Bridge AI (its own folders).
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'cli.js'), 'relay', 'setup', '--hosted'], { env: { ...process.env, HOME: k.home, BRIDGE_HOME: k.data, BRIDGE_URL: k.url }, encoding: 'utf8', timeout: 30000 })
  const out = `${cli.stdout}\n${cli.stderr}`
  ok(cli.status === 1 && /full for now/.test(out) && /bridge-ai relay setup\s+a relay on your own Cloudflare account/.test(out) && /bridge-ai start phone\s+through Tailscale/.test(out), 'bridge-ai relay setup --hosted: it fails saying the relay is full for now, with the other ways and their commands', out)

  // Room again: Try again sets it up.
  await hr.vars({ MAX_COMPUTERS: '5' })
  await way(s.p, HOSTED).click()
  await s.p.locator('.hosted-full button', { hasText: 'Try again' }).click()
  ok(!!(await until(async () => (await s.p.locator('h4', { hasText: 'From anywhere, through Bridge AI\'s relay' }).count()) === 1, 15000)), 'once there\'s room, Try again sets it up: this computer is on Bridge AI\'s relay', (await k.api('/relay')).error)
  ok(!(await k.api('/relay')).hostedFull, 'and it no longer says it was full', null)
  // Stop using it: its place there is given back.
  await k.api('/relay/forget', {})
  ok(!!(await until(async () => (await hr.stats(TOKEN)).computers.registered === 1, 10000)), 'and Stop using the relay gives its place back', (await hr.stats(TOKEN)).computers)
  await hr.vars({ MAX_COMPUTERS: '1' }) // full again

  // ---------- First-run setup ----------
  const fresh = async (name, config) => { const x = await startKit(`relay-hosted-ui-${name}`, { config }); kits.push(x); return x }
  const level = async (pg) => { if (await pg.locator('input[name="wiz-level"][value="later"]').count()) await pg.check('input[name="wiz-level"][value="later"]') }
  const n = await fresh('new', { relay: { hostedUrl: hr.url } })
  const f = await page(b, n.url, { mode: 'dark', theme: 'midnight' })
  pages.push(f)
  await f.p.waitForSelector('.wiz-levels, .sa-all', { timeout: 20000 })
  const tick = f.p.locator('.wiz-phone')
  await tick.waitFor({ timeout: 10000 })
  ok(await tick.locator('input').isChecked() && /Use Bridge AI on your phone/.test(await tick.innerText()), 'first-run setup offers Bridge AI on your phone, through its relay, ticked', await tick.innerText())
  await level(f.p)
  await f.p.click('.wiz-foot .btn.primary')
  const full = f.p.locator('.onb-phone .hosted-full')
  await full.waitFor({ timeout: 20000 })
  const fullText = await full.innerText()
  ok(/full for now/.test(fullText) && /Settings › Devices/.test(fullText) && /your own Cloudflare account/.test(fullText) && /Tailscale/.test(fullText), 'Continue: it says the relay is full for now, and that Settings › Devices has the other ways', fullText)
  await shot(f.p, `${tag}relay-hosted-full-setup`)
  await f.p.click('.wiz-foot button:has-text("Continue")')
  ok(!!(await f.p.waitForSelector('.wiz-agents li', { timeout: 15000 }).catch(() => null)), 'and setup carries on: Continue goes on to your AI')
  await f.p.click('.wiz-foot button:has-text("Continue")')
  await f.p.waitForSelector('.wiz-foot .btn.primary:not([disabled])', { timeout: 15000 })
  await f.p.click('.wiz-foot .btn.primary')
  ok(!!(await until(async () => !(await f.p.locator('.wiz').count()) && (await n.api('/config')).setupDone, 20000)), 'to the end: setup is done and the app is open', null)

  // Unticked: the relay isn't asked.
  const refusedBefore = (await hr.stats(TOKEN)).days[0].refused
  const u = await fresh('untick', { relay: { hostedUrl: hr.url } })
  const g = await page(b, u.url, { mode: 'light', theme: 'sky' })
  pages.push(g)
  await g.p.locator('.wiz-phone').waitFor({ timeout: 20000 })
  await g.p.locator('.wiz-phone input').uncheck()
  await level(g.p)
  await g.p.click('.wiz-foot .btn.primary')
  ok(!!(await g.p.waitForSelector('.wiz-agents li', { timeout: 15000 }).catch(() => null)) && !(await g.p.locator('.onb-phone').count()), 'unticked: Continue goes straight on to your AI, with nothing about the phone', null)
  ok((await hr.stats(TOKEN)).days[0].refused === refusedBefore && !(await u.api('/relay')).configured, 'and nothing was asked of the relay', null)

  // No hosted relay at all (HOSTED_URL empty): setup doesn't offer it.
  const none = await fresh('none', {})
  const h = await page(b, none.url, { mode: 'light', theme: 'sky' })
  pages.push(h)
  await h.p.waitForSelector('.wiz-levels, .sa-all', { timeout: 20000 })
  await h.p.waitForTimeout(1500)
  ok(!(await h.p.locator('.wiz-phone').count()) && !(await none.api('/relay')).hostedAvailable, 'with no hosted relay, first-run setup doesn\'t offer it', null)

  const errs = pages.flatMap((x) => x.errors).filter((e) => !/\/api\/[\w/.-]+ due to access control checks|WebSocket|_relay/.test(e))
  ok(errs.length === 0, 'no page errors', errs)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await b.close()
  for (const k of kits) k.stop()
  hr?.stop()
}
process.exit(done().fail ? 1 : 0)
