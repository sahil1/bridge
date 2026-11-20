// Bridge AI's hosted relay in the app, in the browser named by BRIDGE_TEST_BROWSER, with the real
// Worker and the real accounts service stood in for on this computer (stand-ins/hosted-relay.mjs,
// stand-ins/accounts.mjs): MAX_ACCOUNTS at 1 with another account on it already, and a window of 50
// messages. Settings › Devices & Access › Phone: Bridge AI's relay needs a Bold Bridge account and
// says what's missing with the button that fixes it: signed out, the sign-in right there; signed in
// without it, Request access; asked, that it's waiting. Approved while it's full: Use Bridge AI's relay says it's
// full for now and that the phone can still reach the computer, with your own Cloudflare and
// Tailscale a click each and Try again, said once; the relay marked Full for now among the ways,
// your own Cloudflare picked when Settings opens again, and it fits a phone. The server: the
// refusal with its code, and /api/relay saying so. `bridge-ai relay setup --hosted`: full, the reason
// and the other ways; signed out, to sign in first. Once there's room, Try again sets it up and the
// computer connects with its relay token, the Account tab showing the account's use (said there
// only) and that it's on for this computer; the account's window used up
// (by its other computers) is said with when it resets and the way to your own Cloudflare, and
// lifted when it resets (the relay's clock moved on); a suspension is said too, with the way to your
// own Cloudflare however the computer heard it first, and lifted. Stop using the relay gives the
// place back at once, or, stopped while the relay can't be reached, once it can. The servers can't look up `<id>.localhost` (stand-ins/no-localhost-names.mjs, as on macOS and
// Windows), so they reach a computer's address on the stand-in the way Bridge AI does everywhere.
// The Account tab's Use it on this computer sets the relay up right there, each step said (full for
// now with the other ways, connecting and why not yet, on with the pairing code), never another
// tab; a computer with nothing else set up starts on it by itself once the account has it, saying
// so; one on a relay of its own moves with Use Bridge AI's relay instead, and a computer linked to
// it says which relay it uses.
// First-run setup on a new computer asks for nothing: with the hosted relay there, it says Settings ›
// Devices & Access › Phone sets the phone up, and nothing is asked of the relay or the accounts
// service; with no hosted relay, it says nothing about it, and nor do Settings › Devices & Access and
// Notifications once set up.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, TEST, startKit, startHostedRelay, startAccounts, startRelay, checks, until, browser, page, shot, phoneFaults } from '../lib/harness.mjs'

const { ok, done } = checks('relay-hosted-ui')
const kits = []
const relays = []
const devices = (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'phone' } })))
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

  // ---------- Settings › Devices & Access › Phone: what the relay needs ----------
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
  // What to do comes first: the sign-in, then what the relay can see and fair use, folded until opened.
  const facts = s.p.locator('.relay-box details.relay-facts')
  const folded = await s.p.evaluate(() => { const b = document.querySelector('.relay-box'); const a = b?.querySelector('.relay-needs'); const d = b?.querySelector('details.relay-facts'); return { first: !!(a && d && (a.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING)), open: d?.open, summary: d?.querySelector('summary')?.innerText.trim() } })
  ok(folded.first && folded.open === false && folded.summary === 'What Bold Bridge can see, and fair use' && !(await facts.locator('.ph-facts').isVisible()) && (await s.p.locator('.st-tabs [aria-selected="true"]').innerText()) === 'Phone', 'on the Phone tab, the sign-in comes before what Bold Bridge can see and fair use, which are folded away', folded)
  await needs.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}relay-hosted-signin`)
  await facts.locator('summary').click()
  ok(!!(await until(() => facts.locator('.ph-facts').isVisible(), 3000, 100)) && await facts.locator('.ph-facts li').count() === 3 && /What it can see:[\s\S]*Fair use:[\s\S]*Open source:/.test(await facts.innerText()), 'opened: what it can see, fair use and open source, as they were', await facts.innerText())
  await facts.locator('summary').click()
  // The one path: your email, the code it's sent, and the relay is asked for by itself.
  await needs.locator('input[type=email]').fill('sam@example.com')
  await needs.locator('button', { hasText: 'Email me a code' }).click()
  await needs.locator('.acct-code').waitFor({ timeout: 10000 })
  ok((await s.p.locator('.st-tabs [aria-selected="true"]').innerText().catch(() => '')) === 'Phone', 'the code is asked for there too: Settings stays on the Phone tab')
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
  // The account's use is said once, on the Account tab; the Phone tab points there.
  ok(!(await s.p.locator('.acct-use').count()) && await s.p.locator('button', { hasText: 'Your account\'s allowance, on the Account tab' }).count() === 1, 'the Phone tab doesn\'t say the allowance again: it points to the Account tab')
  // (Account is Account & Backup's tab, Phone Devices & Access': each section opens at it.)
  const tab = (pg, name) => pg.locator('.st-nav-item', { hasText: name === 'Account' ? 'Account & Backup' : 'Devices & Access' }).click()
  await s.p.locator('button', { hasText: 'Your account\'s allowance, on the Account tab' }).click()
  ok(!!(await until(async () => (await s.p.locator('.st-tabs [aria-selected="true"]').innerText().catch(() => '')) === 'Account' && (await s.p.locator('.st-head h3').innerText()) === 'Account & Backup', 5000)), 'and that button goes there: Account & Backup, at Account')
  const use = s.p.locator('.acct-relay .acct-use')
  ok(!!(await until(async () => { const x = await use.innerText(); return /8-hour window/i.test(x) && /this week/i.test(x) && /100%/.test(x) }, 15000)) && /On for this computer/.test(await s.p.locator('.acct-here').innerText()), 'the Account tab shows the account\'s use, the 8-hour window and the week, as the usage chip shows a plan\'s, and that the relay is on for this computer', await s.p.locator('.acct-relay').innerText().catch(() => ''))
  await tab(s.p, 'Phone')
  // The phone page it serves to browsers, checked against this version's (server/relaycheck.js).
  const check = s.p.locator('[data-check="page"]')
  ok(!!(await until(async () => /phone page is Bridge AI [\d.]+(-[\w.]+)?'s, unchanged \(checked /.test(await check.innerText().catch(() => '')), 15000)), 'Settings › Devices & Access › Phone says the phone page the relay serves is this version\'s, unchanged, and when it checked', await check.innerText().catch(() => ''))
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
  await limit.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}relay-hosted-window`)
  await tab(s.p, 'Account')
  ok(!!(await until(async () => /\b0%/.test(await use.innerText()) && /allowance/i.test(await s.p.locator('.acct-here-note').innerText().catch(() => '')), 8000)), 'and the Account tab shows the window with nothing left, saying so', await s.p.locator('.acct-relay').innerText())
  await tab(s.p, 'Phone')
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

  // ---------- The Account tab: Use it on this computer, right there ----------
  // Stopped by hand, it doesn't start by itself again: the button, which sets it up where it is, each
  // step said (full for now, with the other ways; connecting, and why not yet; on), never another tab.
  ok((await k.api('/relay')).autoNext === false && !(await k.api('/relay')).configured, 'stopped by hand, Bridge AI\'s relay doesn\'t start here by itself again', await k.api('/relay'))
  const a = await page(b, k.url, { mode: 'dark', theme: 'midnight' })
  pages.push(a)
  await a.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await a.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'account' } })))
  const here = a.p.locator('.acct-here')
  await here.waitFor({ timeout: 10000 })
  const where = async (pg) => ({ section: (await pg.locator('.st-nav-item.on').innerText().catch(() => '')).trim(), tab: (await pg.locator('.st-tabs [aria-selected="true"]').innerText().catch(() => '')).trim() })
  const onAccount = async (pg) => { const w = await where(pg); return w.section === 'Account & Backup' && w.tab === 'Account' }
  ok(await onAccount(a.p) && await here.locator('button', { hasText: 'Use it on this computer' }).count() === 1, 'Settings › Account & Backup › Account: approved, with Use it on this computer right under the allowance', { ...(await where(a.p)), here: await here.innerText() })
  await hr.vars({ MAX_ACCOUNTS: '1' })
  await here.locator('button', { hasText: 'Use it on this computer' }).click()
  const fullHere = here.locator('.hosted-full')
  ok(!!(await fullHere.waitFor({ timeout: 15000 }).then(() => true, () => false)) && /full for now/.test(await fullHere.innerText()) && await fullHere.locator('button', { hasText: 'Use your own Cloudflare' }).count() === 1 && await fullHere.locator('button', { hasText: 'Try again' }).count() === 1 && !(await a.p.locator('.acct-here-bad').count()) && await onAccount(a.p), 'full for now: said right there, once, with the other ways and Try again, still on the Account tab', await here.innerText().catch(() => ''))
  await fullHere.locator('button', { hasText: 'Use your own Cloudflare' }).click()
  ok(!!(await until(async () => (await where(a.p)).section === 'Devices & Access' && (await where(a.p)).tab === 'Phone' && /Your own Cloudflare/.test(await a.p.locator('.ph-way.on').innerText().catch(() => '')) && await a.p.locator('button', { hasText: 'Sign in with Cloudflare' }).count() === 1, 8000)), 'Use your own Cloudflare: the Phone tab, with it picked and Sign in with Cloudflare', await where(a.p))
  await hr.vars({ MAX_ACCOUNTS: '5' })
  await hr.down()
  await tab(a.p, 'Account')
  await a.p.locator('.acct-here .hosted-full button', { hasText: 'Try again' }).click()
  const step = () => here.getAttribute('data-here').catch(() => null)
  ok(!!(await until(async () => (await step()) === 'connecting' && /Connecting…/.test(await here.innerText()) && /reach the relay/i.test(await here.innerText()), 15000)) && await onAccount(a.p), 'set up right there; while its address can\'t be reached it says Connecting…, and why', await here.innerText().catch(() => ''))
  await here.scrollIntoViewIfNeeded()
  await shot(a.p, `${tag}relay-account-connecting-dark`)
  await hr.up()
  ok(!!(await until(async () => (await step()) === 'on' && /On for this computer/.test(await here.innerText()) && await here.locator('.ph-pair .ph-qr').count() === 1, 20000)) && await onAccount(a.p), 'then On for this computer, with the pairing code right there for a phone, still on the Account tab', await here.innerText().catch(() => ''))
  ok((await k.api('/relay')).hosted && (await k.api('/relay')).online, 'and this computer is on Bridge AI\'s relay, connected')
  await here.scrollIntoViewIfNeeded()
  await shot(a.p, `${tag}relay-account-on-dark`)

  // ---------- Starts by itself once the account has it ----------
  // Signed in with nothing else set up for the phone: asked, it says it starts by itself; given, it
  // does, says so on both tabs, and Pair a phone is right there.
  const au = await startKit('relay-hosted-ui-auto', { env, config: { relay: { hostedUrl: hr.url }, account: acc.accountConfig } })
  kits.push(au)
  await au.api('/setup', { name: 'Tester' })
  await au.api('/account/code', { email: 'kim@example.com' })
  await au.api('/account/verify', { email: 'kim@example.com', code: await acc.code('kim@example.com') })
  await au.api('/account/request', { kind: 'relay' })
  ok((await au.api('/relay')).autoNext === true && !(await au.api('/relay')).configured, 'signed in, asked, nothing set up: it would start by itself', await au.api('/relay'))
  const u = await page(b, au.url, { mode: 'light', theme: 'sky' })
  pages.push(u)
  await u.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await u.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'account-backup' } })))
  const urow = u.p.locator('.acct-relay')
  ok(!!(await until(async () => /starts using it by itself/.test(await urow.innerText().catch(() => '')), 10000)) && await onAccount(u.p), 'Account & Backup opens at its Account tab; asked for, the relay says this computer starts using it by itself', await urow.innerText().catch(() => ''))
  await acc.admin('POST', `/admin/accounts/${(await au.api('/account')).account.id}`, { relay: 'approved' })
  await u.p.evaluate(() => window.dispatchEvent(new Event('focus')))
  const uhere = u.p.locator('.acct-here')
  ok(!!(await until(async () => /On for this computer/.test(await uhere.innerText().catch(() => '')) && /started by itself/.test(await uhere.innerText()), 20000)) && (await au.api('/relay')).auto?.ok === true && (await au.api('/relay')).hosted, 'given while it\'s open: it started by itself, and says so plainly, On for this computer', await uhere.innerText().catch(() => ''))
  await uhere.locator('button', { hasText: 'Pair a phone' }).click()
  ok(!!(await until(async () => (await uhere.locator('.ph-pair .ph-qr').count()) === 1, 10000)) && await onAccount(u.p), 'Pair a phone: its code right there, on the Account tab')
  await uhere.scrollIntoViewIfNeeded()
  await shot(u.p, `${tag}relay-account-auto`)
  await tab(u.p, 'Phone')
  ok(!!(await until(async () => /started by itself/.test(await u.p.locator('[data-setting="relay"]').innerText().catch(() => '')), 8000)), 'the Phone tab says it started by itself too', await u.p.locator('[data-setting="relay"]').innerText().catch(() => ''))
  const uph = await page(b, au.url, { phone: true, mode: 'dark', theme: 'midnight' })
  pages.push(uph)
  await uph.p.waitForSelector('.tabbar button', { timeout: 15000 })
  await uph.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'account' } })))
  await uph.p.locator('.acct-here .ph-pair, .acct-here button:has-text("Pair")').first().waitFor({ timeout: 10000 })
  const uf = await phoneFaults(uph.p, '.st-scroll')
  ok(!Object.keys(uf).length, 'on a phone: the Account tab with the relay on for this computer fits, every target whole', uf)
  await shot(uph.p, `${tag}relay-account-phone-dark`)

  // ---------- From a relay of your own; your other computers ----------
  // Desk, on a relay of its own, signed in to the same account as k, which links to it: k's Account
  // tab says which relay Desk uses and that Desk moves itself; on Desk, Use Bridge AI's relay instead
  // moves it, right there. (A link here goes one way, k to Desk: a link follows only https relays,
  // and this stand-in's are http.)
  const rd = await startRelay('relay-hosted-ui-desk')
  relays.push(rd)
  const desk = await startKit('relay-hosted-ui-desk', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rd.relayFile)); return { ...env, BRIDGE_COMPUTER_NAME: 'Desk', BRIDGE_LINK_PING_MS: '1500' } }, config: { relay: { hostedUrl: hr.url }, account: acc.accountConfig } })
  kits.push(desk)
  await desk.api('/setup', { name: 'Tester' })
  await desk.api('/account/code', { email: 'sam@example.com' })
  await desk.api('/account/verify', { email: 'sam@example.com', code: await acc.code('sam@example.com') })
  ok(!(await desk.api('/relay')).autoNext && (await desk.api('/relay')).configured && !(await desk.api('/relay')).hosted, 'Desk, signed in with the relay given, keeps its own relay: it has one set up, so nothing starts by itself')
  await until(async () => (await desk.api('/relay')).online, 15000)
  await k.api('/machines', { link: (await desk.api('/relay/pair', {})).pairing.link })
  ok(!!(await until(async () => (await k.api('/machines')).machines.find((m) => m.name === 'Desk')?.online, 30000)), 'this computer is linked to Desk, reaching it')
  await a.p.reload()
  await a.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await a.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'account' } })))
  const others = a.p.locator('.acct-others')
  ok(!!(await until(async () => /Desk/.test(await others.innerText().catch(() => '')) && /Its own relay/.test(await others.innerText()) && /Also on Desk\?/.test(await others.innerText()), 20000)), 'Your Other Computers: Desk, signed in, on its own relay, and how to have Bridge AI\'s relay there too', await others.innerText().catch(() => ''))
  const d = await page(b, desk.url, { mode: 'light', theme: 'sky' })
  pages.push(d)
  d.p.on('dialog', (x) => x.accept())
  await d.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await d.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'account' } })))
  const dhere = d.p.locator('.acct-here')
  await dhere.waitFor({ timeout: 10000 })
  ok(/uses a relay on your own Cloudflare account/.test(await dhere.innerText()) && await dhere.locator('button', { hasText: 'Use Bridge AI\'s relay instead' }).count() === 1, 'on Desk: it says it uses a relay of its own, with Use Bridge AI\'s relay instead', await dhere.innerText())
  await dhere.locator('button', { hasText: 'Use Bridge AI\'s relay instead' }).click()
  ok(!!(await until(async () => /On for this computer/.test(await dhere.innerText().catch(() => '')), 20000)) && (await desk.api('/relay')).hosted && await onAccount(d.p), 'Use Bridge AI\'s relay instead (asked first): Desk is on it, right there', await dhere.innerText().catch(() => ''))
  await dhere.scrollIntoViewIfNeeded()
  await shot(d.p, `${tag}relay-account-moved`)

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
  ok(/Use Bridge AI on your phone/.test(await note.innerText()) && /Settings › Devices & Access › Phone/.test(await note.innerText()) && !(await note.locator('input').count()), 'first-run setup says where to set up the phone (Settings › Devices & Access › Phone), with nothing to tick', await note.innerText())
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
  // Nor do Settings › Devices & Access, all of it, Link a device included, and Notifications, once set up.
  await none.api('/setup', { name: 'Tester' })
  await h.p.reload()
  await h.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  // (Each of its tabs, one after the other.)
  await devices(h.p)
  let devText = ''
  for (const [tab, re] of [['Phone', /Sign in with Cloudflare/], ['Computers', /Link a device[\s\S]*isn't set up yet/], ['Remote Access', /Which Devices May Connect/], ['Share Links', /Share Links|shared/]]) {
    await h.p.locator('.st-tabs [role="tab"]', { hasText: tab }).click()
    devText += (await until(async () => { const x = await h.p.locator('.modal.settings').innerText().catch(() => ''); return re.test(x) && x }, 10000)) || `(${tab} never showed)`
  }
  await h.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'notifications' } })))
  devText += (await until(async () => { const x = await h.p.locator('.modal.settings').innerText().catch(() => ''); return /What to notify about/.test(x) && x }, 10000)) || '(Notifications never showed)'
  ok(!/never showed/.test(devText) && !/Bridge AI's relay|Bold Bridge/.test(devText) && /sign in to Cloudflare in the Phone tab/.test(devText), 'and Settings › Devices & Access and Notifications name no hosted relay and no account anywhere, Link a device included', devText && devText.slice(-600))
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
  for (const r of relays) r.stop()
  hr?.stop()
  acc?.stop()
}
process.exit(done().fail ? 1 : 0)
