// Bridge AI's hosted relay in the app, in the browser named by BRIDGE_TEST_BROWSER, with the real
// Worker and the real accounts service stood in for on this computer (stand-ins/hosted-relay.mjs,
// stand-ins/accounts.mjs): MAX_ACCOUNTS at 1 with another account on it already, and a window of 50
// messages. Settings › Devices: Bridge AI's relay needs a Bold Bridge account and says what's missing
// with the button that fixes it: signed out, Sign in (Settings › Account); signed in without it,
// Request access; asked, that it's waiting. Approved while it's full: Use Bridge AI's relay says it's
// full for now and that the phone can still reach the computer, with your own Cloudflare and
// Tailscale a click each and Try again, said once; the relay marked Full for now among the ways,
// your own Cloudflare picked when Settings opens again, and it fits a phone. The server: the
// refusal with its code, and /api/relay saying so. `bridge-ai relay setup --hosted`: full, the reason
// and the other ways; signed out, to sign in first. Once there's room, Try again sets it up and the
// computer connects with its relay token, showing the account's use; the account's window used up
// (by its other computers) is said with when it resets and the way to your own Cloudflare, and
// lifted when it resets (the relay's clock moved on); a suspension is said too, with the way to your
// own Cloudflare however the computer heard it first, and lifted. Stop using the relay gives the
// place back at once, or, stopped while the relay can't be reached, once it can. The servers can't look up `<id>.localhost` (stand-ins/no-localhost-names.mjs, as on macOS and
// Windows), so they reach a computer's address on the stand-in the way Bridge AI does everywhere.
// First-run setup on a new computer asks for nothing: with the hosted relay there, it says Settings ›
// Devices sets the phone up, and nothing is asked of the relay or the accounts service; with no
// hosted relay, it says nothing about it, and nor does Settings › Devices once set up.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, TEST, startKit, startHostedRelay, startAccounts, checks, until, browser, page, shot } from '../lib/harness.mjs'

const { ok, done } = checks('relay-hosted-ui')
const kits = []
const devices = (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))
const HOSTED = 'Bridge AI\'s relay'
const TOKEN = 'stats-for-tests'
const env = { NODE_OPTIONS: `--import ${pathToFileURL(path.join(TEST, 'stand-ins', 'no-localhost-names.mjs')).href}` }
const HOUR = 3600000

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
let hr = null
let acc = null
const pages = []
try {
  acc = await startAccounts('relay-hosted-ui')
  hr = await startHostedRelay('relay-hosted-ui', { MAX_ACCOUNTS: '1', STATS_TOKEN: TOKEN, ACCOUNT_WINDOW_MESSAGES: '50' }, acc)
  // Another account, with the relay, on it already.
  await acc.call('POST', '/v1/code', { email: 'other@example.com' })
  const other = await acc.call('POST', '/v1/verify', { email: 'other@example.com', code: await acc.code('other@example.com'), device: { name: 'Elsewhere', kind: 'computer', platform: 'linux' } })
  await acc.admin('POST', `/admin/accounts/${other.account.id}`, { relay: 'approved' })
  const first = await hr.register((await acc.call('GET', '/v1/me', null, other.deviceToken)).relay.token)
  ok(first.status === 200 && !!first.id, 'the hosted relay takes one account, and has one', first)
  ok((await hr.register()).status === 401, 'and takes no computer without an account\'s relay token')

  // ---------- Settings › Devices: what the relay needs ----------
  const k = await startKit('relay-hosted-ui', { env, config: { relay: { hostedUrl: hr.url }, account: acc.accountConfig } })
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
  const needs = s.p.locator('.relay-needs')
  ok(/Recommended/.test(await way(s.p, HOSTED).innerText()) && /true/.test(await way(s.p, HOSTED).getAttribute('aria-checked')), 'with Bridge AI\'s relay offered and nothing set up, it\'s picked, as recommended')
  await needs.waitFor({ timeout: 10000 })
  ok(await needs.locator('.acct-in input[type=email]').count() === 1 && !(await s.p.locator('button', { hasText: 'Use Bridge AI\'s relay' }).count()), 'signed out: it asks for your email right there, with no Use button', await needs.innerText())
  await needs.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}relay-hosted-signin`)
  // The one path: your email, the code it's sent, and the relay is asked for by itself.
  await needs.locator('input[type=email]').fill('sam@example.com')
  await needs.locator('button', { hasText: 'Email me a code' }).click()
  await needs.locator('.acct-code').waitFor({ timeout: 10000 })
  ok((await s.p.locator('.st-head h3').innerText().catch(() => '')) !== 'Account', 'the code is asked for there too: Settings stays on Devices')
  await needs.locator('.acct-code').fill(await acc.code('sam@example.com'))
  await needs.locator('button', { hasText: 'Sign in' }).click()
  ok(!!(await until(async () => /You asked for Bridge AI's relay/.test(await needs.innerText().catch(() => '')) && /sam@example\.com/.test(await needs.innerText()), 10000)) && (await acc.admin('GET', '/admin/requests?kind=relay')).requests.some((r) => r.email === 'sam@example.com'), 'signed in: the relay is asked for without another click, the admin view has it, and it says it\'s waiting', await needs.innerText().catch(() => ''))
  const me = await k.api('/account')
  await needs.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}relay-hosted-requested`)
  // An account signed in before, that never asked: the button.
  await acc.admin('POST', `/admin/accounts/${me.account.id}`, { relay: 'none' })
  await s.p.reload()
  await openWays(s.p)
  await needs.waitFor({ timeout: 10000 })
  ok(/doesn't have Bridge AI's relay yet/.test(await needs.innerText()) && /sam@example\.com/.test(await needs.innerText()), 'signed in already, without it: says the account doesn\'t have it yet', await needs.innerText())
  await needs.locator('button', { hasText: 'Request access' }).click()
  ok(!!(await until(async () => /You asked for Bridge AI's relay/.test(await needs.innerText()), 8000)), 'Request access: asked, and it says it\'s waiting', await needs.innerText())

  // ---------- Approved, while it's full ----------
  // (Given while this is open: it hears as the window comes back, and sets the relay up itself.)
  await acc.admin('POST', `/admin/accounts/${me.account.id}`, { relay: 'approved' })
  await s.p.evaluate(() => window.dispatchEvent(new Event('focus')))
  const box = s.p.locator('.hosted-full')
  await box.waitFor({ timeout: 15000 })
  const said = await box.innerText()
  ok(/full for now, so it can't take this computer/.test(said) && /your own Cloudflare account/.test(said) && /Tailscale/.test(said), 'approved while Settings is open, it goes on to the relay by itself, which is full: it says so, and that the phone can still reach this computer another way', said)
  ok(await box.locator('button', { hasText: 'Use your own Cloudflare' }).count() === 1 && await box.locator('button', { hasText: 'Use Tailscale' }).count() === 1 && await box.locator('button', { hasText: 'Try again' }).count() === 1, 'with each other way a click away, and Try again')
  const sec = s.p.locator('.st-sec', { has: s.p.locator('.ph-ways') })
  ok(await sec.locator('.st-note.bad').count() === 0, 'said once: no error line under it as well', await sec.locator('.st-note.bad').allInnerTexts())
  ok(/Full for now/.test(await way(s.p, HOSTED).innerText()) && !/Recommended/.test(await way(s.p, HOSTED).innerText()), 'and Bridge AI\'s relay is marked Full for now among the ways', await way(s.p, HOSTED).innerText())
  await sec.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}relay-hosted-full`)
  const st = await k.api('/relay')
  ok(!st.configured && /full for now/.test(st.hostedFull || ''), '/api/relay says Bridge AI\'s relay was full just now, and nothing is set up', { configured: st.configured, hostedFull: st.hostedFull })
  const refused = await k.api('/relay/deploy', { method: 'hosted' }).then(() => null, (e) => e)
  ok(refused?.j?.code === 'hostedFull' && /full for now/.test(refused.message), 'asked again, the refusal carries its code (hostedFull) and the relay\'s own words', refused?.j)
  await box.locator('button', { hasText: 'Use your own Cloudflare' }).click()
  ok(/Your own Cloudflare/.test(await s.p.locator('.ph-way.on').innerText()) && await s.p.locator('button', { hasText: 'Sign in with Cloudflare' }).count() === 1, 'Use your own Cloudflare: picked, with Sign in with Cloudflare', await s.p.locator('.ph-way.on').innerText())
  await way(s.p, HOSTED).click()
  await box.locator('button', { hasText: 'Use Tailscale' }).click()
  ok(!!(await until(async () => (await s.p.locator('h4', { hasText: 'Through Tailscale' }).count()) === 1, 5000)) && /Tailscale/.test(await s.p.locator('.ph-way.on').innerText()), 'Use Tailscale: picked, with Tailscale\'s steps')
  await s.p.reload()
  await openWays(s.p)
  ok(/Your own Cloudflare/.test(await s.p.locator('.ph-way.on').innerText()) && /Full for now/.test(await way(s.p, HOSTED).innerText()), 'Settings opened again soon after: your own Cloudflare is the one picked, and Bridge AI\'s relay is still marked full', await s.p.locator('.ph-ways').innerText())
  const ph = await page(b, k.url, { phone: true, mode: 'dark', theme: 'midnight' })
  pages.push(ph)
  await openWays(ph.p)
  await way(ph.p, HOSTED).click()
  await ph.p.locator('.hosted-full').waitFor({ timeout: 10000 })
  await ph.p.locator('.hosted-full').scrollIntoViewIfNeeded()
  ok((await ph.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'on a 390 px phone, the same box fits, with nothing sideways')
  await shot(ph.p, `${tag}relay-hosted-full-phone`)
  const cli = (kit) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'cli.js'), 'relay', 'setup', '--hosted'], { env: { ...process.env, HOME: kit.home, BRIDGE_HOME: kit.data, BRIDGE_URL: kit.url }, encoding: 'utf8', timeout: 30000 }); return { status: r.status, out: `${r.stdout}\n${r.stderr}` } }
  const full = cli(k)
  ok(full.status === 1 && /full for now/.test(full.out) && /bridge-ai relay setup\s+a relay on your own Cloudflare account/.test(full.out) && /bridge-ai start phone\s+through Tailscale/.test(full.out), 'bridge-ai relay setup --hosted: it fails saying the relay is full for now, with the other ways and their commands', full.out)

  // ---------- Room again: on the relay, connected with its account ----------
  await hr.vars({ MAX_ACCOUNTS: '5' })
  await way(s.p, HOSTED).click()
  await s.p.locator('.hosted-full button', { hasText: 'Try again' }).click()
  ok(!!(await until(async () => (await s.p.locator('h4', { hasText: 'From anywhere, through Bridge AI\'s relay' }).count()) === 1, 15000)), 'once there\'s room, Try again sets it up: this computer is on Bridge AI\'s relay', (await k.api('/relay')).error)
  ok(!(await k.api('/relay')).hostedFull && !!(await until(async () => (await k.api('/relay')).online, 15000)), 'it no longer says it was full, and connects with its account\'s relay token', (await k.api('/relay')).error)
  ok(!!(await until(async () => (await s.p.locator('.ph-pair .ph-qr').count()) === 1, 15000)), 'and once it\'s connected the pairing code shows, without Pair a device being clicked')
  const use = s.p.locator('.acct-use')
  ok(!!(await until(async () => { const x = await use.innerText(); return /8-hour window/i.test(x) && /this week/i.test(x) && /100%/.test(x) }, 15000)), 'Settings shows the account\'s use, the 8-hour window and the week, as the usage chip shows a plan\'s', await use.innerText().catch(() => ''))
  // The phone page it serves to browsers, checked against this version's (server/relaycheck.js).
  const check = s.p.locator('[data-check="page"]')
  ok(!!(await until(async () => /phone page is Bridge AI [\d.]+(-[\w.]+)?'s, unchanged \(checked /.test(await check.innerText().catch(() => '')), 15000)), 'Settings › Devices says the phone page the relay serves is this version\'s, unchanged, and when it checked', await check.innerText().catch(() => ''))
  const shellJs = fs.readFileSync(path.join(ROOT, 'relay', 'web', 'shell.js'), 'utf8')
  await hr.page({ name: 'shell.js', text: `${shellJs}\n// changed for everyone\n` })
  await check.locator('button', { hasText: 'Check again' }).click()
  const changed = s.p.locator('.st-note.warn[data-check="page"]')
  ok(!!(await changed.waitFor({ timeout: 15000 }).then(() => true, () => false)) && /isn't Bridge AI [\d.]+(-[\w.]+)?'s: shell\.js differs/.test(await changed.innerText()) && /iPhone and Android apps carry their own copy and aren't affected/.test(await changed.innerText()) && await changed.locator('button', { hasText: 'Use your own Cloudflare' }).count() === 1 && await changed.locator('a', { hasText: 'Report it' }).count() === 1, 'a page changed for everyone: said plainly, which file, that the apps aren\'t affected, with your own Cloudflare and Report it', await changed.innerText().catch(() => ''))
  await changed.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}relay-hosted-page-changed`)
  await hr.page({ name: 'shell.js', text: shellJs })
  await changed.locator('button', { hasText: 'Check again' }).click()
  ok(!!(await until(async () => !(await changed.count()) && /unchanged/.test(await check.innerText().catch(() => '')), 15000)), 'put back: Check again says it\'s unchanged again', await check.innerText().catch(() => ''))
  // The account's window used up, by its other computers.
  await hr.use(me.account.id, 60)
  const limit = s.p.locator('.st-note.warn', { hasText: 'used its allowance' })
  ok(!!(await limit.waitFor({ timeout: 15000 }).then(() => true, () => false)) && /resets at/.test(await limit.innerText()) && await limit.locator('button', { hasText: 'Use your own Cloudflare' }).count() === 1, 'the window used up: said with when it resets, and the way to your own Cloudflare', await limit.innerText().catch(() => ''))
  ok(!!(await until(async () => /\b0%/.test(await use.innerText()), 8000)), 'and the window shows nothing left', await use.innerText())
  await limit.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}relay-hosted-window`)
  await hr.clock(8 * HOUR + 60000)
  await hr.use(me.account.id, 1)
  ok(!!(await until(async () => !(await k.api('/relay')).limit && !(await limit.count()), 10000)), 'reset (the relay\'s clock moved on): the limit is lifted', (await k.api('/relay')).limit)
  // Suspended: said, then restored.
  await acc.admin('POST', `/admin/accounts/${me.account.id}`, { status: 'suspended', note: 'Testing' })
  await hr.clock(8 * HOUR + 3 * 60000) // past the minute the relay keeps what the service said
  await hr.use(me.account.id, 1)
  // (The computer asks its account then, and says it the same way once it has heard it from there.)
  const stopped = s.p.locator('.st-note.warn', { hasText: 'account is suspended' })
  ok(!!(await until(async () => (await k.api('/account')).account?.status === 'suspended' && !(await k.api('/relay')).online, 10000)) && (await k.api('/relay')).limit?.why === 'suspended' && !!(await stopped.waitFor({ timeout: 8000 }).then(() => true, () => false)) && await stopped.locator('button', { hasText: 'Use your own Cloudflare' }).count() === 1, 'suspended: the relay lets the computer go, and Settings › Devices says why, with the way to your own Cloudflare', (await k.api('/relay')).limit)
  await acc.admin('POST', `/admin/accounts/${me.account.id}`, { status: 'active', note: 'Done' })
  await hr.clock(8 * HOUR + 5 * 60000) // (the relay hears it restored once what it kept is a minute old)
  await hr.use(me.account.id, 1)

  // ---------- Stop using it: the place given back ----------
  for (const x of [s, ph]) await x.ctx.close()
  await k.api('/relay/forget', {})
  ok(!!(await until(async () => (await hr.stats(TOKEN)).accounts.on === 1, 10000)), 'Stop using the relay gives the account\'s place back at once', (await hr.stats(TOKEN)).accounts)
  const relayFile = () => JSON.parse(fs.readFileSync(path.join(k.data, 'relay.json'), 'utf8'))
  await until(async () => (await k.api('/account?fresh=1')).relay?.on, 8000)
  await k.api('/relay/deploy', { method: 'hosted' })
  await hr.down()
  await k.api('/relay/forget', {})
  const held = await until(() => relayFile().leaving?.length === 1 && relayFile(), 10000, 200)
  ok(!!held && (await hr.stats(TOKEN)).accounts.on === 2 && !(await k.api('/relay')).configured, 'stopped while the relay can\'t be reached: it\'s stopped here, and Bridge AI keeps the address to tell the relay later', held?.leaving?.map((l) => l.url))
  await hr.up()
  await k.restart()
  ok(!!(await until(async () => (await hr.stats(TOKEN)).accounts.on === 1 && !relayFile().leaving, 15000)), 'once it can be reached (Bridge AI started again), the relay hears it and the place is given back', { accounts: (await hr.stats(TOKEN)).accounts, leaving: relayFile().leaving })

  // ---------- Signed out: the command line says to sign in first ----------
  const out = await startKit('relay-hosted-ui-out', { env, config: { relay: { hostedUrl: hr.url }, account: acc.accountConfig } })
  kits.push(out)
  const signin = cli(out)
  ok(signin.status === 1 && /Sign in first/.test(signin.out) && /Settings › Account/.test(signin.out) && /bridge-ai relay setup\s+a relay on your own Cloudflare account/.test(signin.out), 'bridge-ai relay setup --hosted, signed out: it fails saying to sign in first (Settings › Account), with the other ways', signin.out)

  // ---------- First-run setup asks for nothing ----------
  const fresh = async (name, config) => { const x = await startKit(`relay-hosted-ui-${name}`, { env, config }); kits.push(x); return x }
  const level = async (pg) => { if (await pg.locator('input[name="wiz-level"][value="later"]').count()) await pg.check('input[name="wiz-level"][value="later"]') }
  const refusedBefore = (await hr.stats(TOKEN)).days[0].refused
  const mailBefore = (await acc.mail()).length
  const n = await fresh('new', { relay: { hostedUrl: hr.url }, account: acc.accountConfig })
  const f = await page(b, n.url, { mode: 'dark', theme: 'midnight' })
  pages.push(f)
  await f.p.waitForSelector('.wiz-levels, .sa-all', { timeout: 20000 })
  const note = f.p.locator('.wiz-phone')
  await note.waitFor({ timeout: 10000 })
  ok(/Use Bridge AI on your phone/.test(await note.innerText()) && /Settings › Devices/.test(await note.innerText()) && !(await note.locator('input').count()), 'first-run setup says where to set up the phone (Settings › Devices), with nothing to tick', await note.innerText())
  await shot(f.p, `${tag}relay-hosted-setup`)
  await level(f.p)
  await f.p.click('.wiz-foot .btn.primary')
  ok(!!(await f.p.waitForSelector('.wiz-agents li', { timeout: 15000 }).catch(() => null)) && !(await f.p.locator('.onb-phone').count()), 'Continue goes straight on to your AI', null)
  await f.p.click('.wiz-foot button:has-text("Continue")')
  await f.p.waitForSelector('.wiz-foot .btn.primary:not([disabled])', { timeout: 15000 })
  await f.p.click('.wiz-foot .btn.primary')
  ok(!!(await until(async () => !(await f.p.locator('.wiz').count()) && (await n.api('/config')).setupDone, 20000)), 'to the end: setup is done and the app is open', null)
  ok((await hr.stats(TOKEN)).days[0].refused === refusedBefore && !(await n.api('/relay')).configured && (await acc.mail()).length === mailBefore && !(await n.api('/account')).signedIn, 'and nothing was asked of the relay or the accounts service', null)
  const none = await fresh('none', {})
  const h = await page(b, none.url, { mode: 'light', theme: 'sky' })
  pages.push(h)
  await h.p.waitForSelector('.wiz-levels, .sa-all', { timeout: 20000 })
  await h.p.waitForTimeout(1500)
  ok(!(await h.p.locator('.wiz-phone').count()) && !(await none.api('/relay')).hostedAvailable && !(await none.api('/account')).available, 'with no hosted relay and no accounts, first-run setup says nothing about it', null)
  // Nor does Settings › Devices, all of it, Link a device included, once set up.
  await none.api('/setup', { name: 'Tester' })
  await h.p.reload()
  await h.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await devices(h.p)
  const devText = await until(async () => { const x = await h.p.locator('.modal.settings').innerText().catch(() => ''); return /Link a device/.test(x) && /isn't set up yet/.test(x) && x }, 10000)
  ok(!!devText && !/Bridge AI's relay|Bold Bridge/.test(devText) && /sign in to Cloudflare at the top of this page/.test(devText), 'and Settings › Devices names no hosted relay and no account anywhere, Link a device included', devText && devText.slice(-600))
  ok(!(await h.p.locator('[data-check="page"]').count()) && (await none.api('/relay/pagecheck')).on === false, 'nor checks a phone page: there\'s no hosted relay in use', await none.api('/relay/pagecheck'))
  const noAcc = await fresh('noacc', { relay: { hostedUrl: hr.url } })
  ok(!(await noAcc.api('/relay')).hostedAvailable, 'and a hosted relay with no Bold Bridge accounts isn\'t offered at all (it can\'t work without one)')

  const errs = pages.flatMap((x) => x.errors).filter((e) => !/\/api\/\S+ due to access control checks|WebSocket|_relay/.test(e))
  ok(errs.length === 0, 'no page errors', errs)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await b.close()
  for (const k of kits) k.stop()
  hr?.stop()
  acc?.stop()
}
process.exit(done().fail ? 1 : 0)
