// Settings › Account, in the browser named by BRIDGE_TEST_BROWSER, in a light and a dark theme and at
// phone width, with Bold Bridge's accounts service stood in for (stand-ins/accounts.mjs: the real
// Worker, signed with a key made for the run) and two Bridge AIs, "Studio" and "Desk", linked through
// relays of their own (stand-ins/relay.mjs), as devices-ui links them. No accounts service: no
// Account section at all. Then signing in on Studio: a throwaway address refused saying why; the
// code step; a wrong code with the tries left; one that ran out (the service's clock moved on), Send
// a new code, signed in. Signed in: the email, this computer among the account's devices, Early
// Access and Bridge AI's relay each to ask for; asked, Requested; approved, On, with the relay's use
// in its 8-hour window and its week as the usage chip shows it. Linked computers follow: "Also sign
// in Desk?", Sign it in, and Desk is signed in without the email, saying Studio did it, and can sign
// itself out again, after which Studio's list says Desk said no. Five devices: a sixth sign-in (on
// Desk) lists them, and one is removed to sign in there; Remove takes one off from Studio. Sign out,
// and Delete account (the email typed again) with nothing left of it on the service. The section on
// a phone: nothing past its edge, every target whole, fields iOS doesn't zoom into.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, startAccounts, checks, until, browser, page, shot, phoneFaults } from '../lib/harness.mjs'

const { ok, done } = checks('account-ui')
const kits = []
const relays = []
const pages = []
const MIN = 60000
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const openAccount = (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'account' } })))
let acc = null
try {
  acc = await startAccounts('account-ui')
  const kitWith = async (name, rel, config = {}) => {
    const k = await startKit(`account-ui-${name.toLowerCase()}`, {
      env: ({ data }) => { if (rel) fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_LINK_PING_MS: '1500' } },
      config,
    })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }

  // ---------- No accounts service: no Account section ----------
  const plain = await kitWith('Plain', null)
  const pp = await page(b, plain.url, { mode: 'light', theme: 'sky' })
  pages.push(pp)
  await pp.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await pp.p.locator('.settings-btn').click()
  await pp.p.locator('.st-nav').waitFor({ timeout: 8000 })
  ok(!(await pp.p.locator('.st-nav-item', { hasText: 'Account' }).count()) && (await plain.api('/account')).available === false && !(await plain.api('/config')).accounts, 'with no accounts service, Settings has no Account section, and nothing about accounts shows', await pp.p.locator('.st-nav').innerText())
  await pp.ctx.close()

  // ---------- Signing in ----------
  const ra = await startRelay('account-ui-studio')
  const rd = await startRelay('account-ui-desk')
  relays.push(ra, rd)
  const studio = await kitWith('Studio', ra, { account: acc.accountConfig })
  const desk = await kitWith('Desk', rd, { account: acc.accountConfig })
  await until(async () => (await studio.api('/relay')).online && (await desk.api('/relay')).online, 20000)
  await desk.api('/machines', { link: (await studio.api('/relay/pair', {})).pairing.link })
  ok(!!(await until(async () => (await studio.api('/machines')).machines.find((m) => m.name === 'Desk')?.online && (await desk.api('/machines')).machines.find((m) => m.name === 'Studio')?.online, 30000)), 'Studio and Desk are linked, each reaching the other')
  const s = await page(b, studio.url, { mode: 'light', theme: 'sky' })
  pages.push(s)
  s.p.on('dialog', (d) => d.accept())
  await s.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await s.p.locator('.settings-btn').click()
  const nav = s.p.locator('.st-nav-item', { hasText: 'Account' })
  await nav.waitFor({ timeout: 10000 })
  await nav.click()
  const form = s.p.locator('.acct-in')
  await form.waitFor({ timeout: 10000 })
  ok(/Sign in to Bold Bridge/.test(await form.innerText()) && /no password/.test(await form.innerText()) && /Never anything from this computer/.test(await form.innerText()), 'Settings › Account: Sign in to Bold Bridge, with no password, and what it keeps (never anything from this computer)', await form.innerText())
  await shot(s.p, `${tag}account-signin`)
  const email = s.p.locator('.acct-email')
  await email.fill('sam@mailinator.com') // private-ok: a made-up address at a throwaway domain
  await s.p.locator('button', { hasText: 'Email me a code' }).click()
  const problem = s.p.locator('.acct-problem')
  ok(!!(await until(async () => /throwaway addresses \(mailinator\.com\)/.test(await problem.innerText().catch(() => '')), 8000)), 'a throwaway address: refused, naming the domain and why', await problem.innerText().catch(() => ''))
  await email.fill('Sam@Example.com')
  await s.p.locator('button', { hasText: 'Email me a code' }).click()
  const code = s.p.locator('.acct-code')
  await code.waitFor({ timeout: 10000 })
  ok(/A code is on its way to sam@example\.com/.test(await s.p.locator('.acct-sent').innerText()) && !!(await acc.code('sam@example.com')), 'a code is emailed, and it says where it went', await s.p.locator('.acct-sent').innerText())
  await code.fill('000000')
  await s.p.locator('.acct-form button', { hasText: 'Sign in' }).click()
  ok(!!(await until(async () => /That code isn't right\. 4 more tries/.test(await problem.innerText().catch(() => '')), 8000)), 'a wrong code: it says so, with the tries left', await problem.innerText().catch(() => ''))
  await acc.clock(11 * MIN)
  await code.fill(await acc.code('sam@example.com'))
  await s.p.locator('.acct-form button', { hasText: 'Sign in' }).click()
  ok(!!(await until(async () => /ran out \(a code lasts 10 minutes\)/.test(await problem.innerText().catch(() => '')), 8000)) && await problem.locator('button', { hasText: 'Send a new code' }).count() === 1, 'one that ran out: it says so, with Send a new code right there', await problem.innerText().catch(() => ''))
  await shot(s.p, `${tag}account-expired`)
  const sentBefore = (await acc.mail()).length
  await problem.locator('button', { hasText: 'Send a new code' }).click()
  await until(async () => (await acc.mail()).length > sentBefore, 8000)
  await code.fill(await acc.code('sam@example.com'))
  await s.p.locator('.acct-form button', { hasText: 'Sign in' }).click()
  const who = s.p.locator('.acct-who')
  await who.waitFor({ timeout: 10000 })
  ok(/sam@example\.com/.test(await who.innerText()) && /Signed in/.test(await who.innerText()), 'the new code signs in: the account\'s email, signed in', await who.innerText())
  const devs = s.p.locator('.acct-devices')
  ok(/Studio/.test(await devs.innerText()) && /This computer/.test(await devs.innerText()) && /1 of 5 devices/.test(await devs.innerText()), 'this computer among the account\'s devices, of 5', await devs.innerText())
  ok(await s.p.locator('.acct-early button', { hasText: 'Request Early Access' }).count() === 1 && await s.p.locator('.acct-relay button', { hasText: 'Request access' }).count() === 1, 'Early Access and Bridge AI\'s relay, each to ask for')

  // ---------- Linked computers follow ----------
  const offer = s.p.locator('.acct-offer')
  await offer.waitFor({ timeout: 15000 })
  ok(/Also sign in Desk\?/.test(await offer.innerText()) && /without the email/.test(await offer.innerText()), 'it offers to sign in Desk too, the computer linked to this one', await offer.innerText())
  await offer.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}account-others`)
  await offer.locator('button', { hasText: 'Sign it in' }).click()
  const result = s.p.locator('.acct-result')
  ok(!!(await result.waitFor({ timeout: 30000 }).then(() => true, () => false)) && /Desk is signed in/.test(await result.innerText()), 'Sign it in: Desk is signed in, it says', await result.innerText().catch(() => ''))
  const dst = await desk.api('/account')
  ok(dst.signedIn && dst.account.email === 'sam@example.com' && dst.signedInBy?.name === 'Studio', 'Desk is signed in to the same account, without the email, and knows Studio did it', { signedIn: dst.signedIn, by: dst.signedInBy })
  const d = await page(b, desk.url, { mode: 'dark', theme: 'midnight' })
  pages.push(d)
  d.p.on('dialog', (x) => x.accept())
  await d.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await openAccount(d.p)
  const followed = d.p.locator('.acct-followed')
  await followed.waitFor({ timeout: 10000 })
  ok(/Studio signed this computer in to your Bold Bridge account/.test(await followed.innerText()) && await followed.locator('button', { hasText: 'Sign this computer out' }).count() === 1, 'on Desk, it says Studio signed it in, and it can sign itself out', await followed.innerText())
  await shot(d.p, `${tag}account-followed-dark`)
  await followed.locator('button', { hasText: 'Sign this computer out' }).click()
  ok(!!(await d.p.locator('.acct-in').waitFor({ timeout: 10000 }).then(() => true, () => false)) && !(await desk.api('/account')).signedIn && (await desk.api('/account')).declined, 'Sign this computer out: Desk is signed out, and says no to the next one', null)
  await s.p.reload()
  await s.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await openAccount(s.p)
  const others = s.p.locator('.acct-others')
  ok(!!(await until(async () => /Said not to be signed in from here/.test(await others.innerText().catch(() => '')), 15000)) && !(await s.p.locator('.acct-offer').count()), 'Studio\'s list says Desk said no, and offers it no more', await others.innerText().catch(() => ''))

  // ---------- Requests, and the relay's use ----------
  await s.p.locator('.acct-relay button', { hasText: 'Request access' }).click()
  ok(!!(await until(async () => /Requested/.test(await s.p.locator('.acct-relay').innerText()), 8000)), 'Request access: the relay says Requested', await s.p.locator('.acct-relay').innerText())
  await s.p.locator('.acct-early button', { hasText: 'Request Early Access' }).click()
  ok(!!(await until(async () => /Requested/.test(await s.p.locator('.acct-early').innerText()), 8000)), 'and Early Access too', await s.p.locator('.acct-early').innerText())
  const sam = (await acc.admin('GET', '/admin/accounts?q=sam@')).accounts[0]
  ok((await acc.admin('GET', '/admin/requests')).requests.filter((r) => r.email === 'sam@example.com').length === 2, 'both are in the admin view')
  await acc.admin('POST', `/admin/accounts/${sam.id}`, { relay: 'approved', tester: 'yes' })
  const week = new Date(Date.now() + 11 * MIN + 3 * 864e5).toISOString()
  await acc.admin('POST', '/internal/usage', { a: sam.id, window: { messages: 75000, resetsAt: new Date(Date.now() + 11 * MIN + 2 * 3600000).toISOString() }, week: { messages: 250000, resetsAt: week }, days: {}, limits: { window: { hours: 8, messages: 150000 }, week: { messages: 1000000 } } })
  await s.p.reload()
  await s.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await openAccount(s.p)
  const relayRow = s.p.locator('.acct-relay')
  ok(!!(await until(async () => /On/.test(await relayRow.innerText()) && /50%/.test(await relayRow.innerText()) && /75%/.test(await relayRow.innerText()), 10000)), 'approved: the relay is On, with its 8-hour window half used and the week a quarter, as the usage chip shows it', await relayRow.innerText())
  ok(/75,000 of 150,000 messages in this window/.test(await relayRow.innerText()), 'and the counts across the account\'s computers', await relayRow.innerText())
  ok(/On/.test(await s.p.locator('.acct-early').innerText()), 'Early Access is On too', await s.p.locator('.acct-early').innerText())
  const early = (await studio.api('/settings')).user.earlyAccess
  ok(early?.from === 'account' && /^ea1\./.test(early.code || ''), 'and the updater\'s Early Access takes the account\'s code by itself (kept as the account\'s)', early)
  await relayRow.scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}account-relay`)

  // ---------- Five devices ----------
  for (const [i, n] of ['Laptop', 'Phone', 'Air', 'Mini'].entries()) {
    if (i === 2) await acc.clock(11 * MIN + 61 * MIN) // (5 codes an hour for an email)
    await acc.call('POST', '/v1/code', { email: 'sam@example.com' })
    await acc.call('POST', '/v1/verify', { email: 'sam@example.com', code: await acc.code('sam@example.com'), device: { name: n, kind: n === 'Phone' ? 'phone' : 'computer', platform: n === 'Phone' ? 'ios' : 'mac' } })
  }
  await d.p.reload()
  await d.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await openAccount(d.p)
  await d.p.locator('.acct-email').fill('sam@example.com')
  const mailed = (await acc.mail()).length
  await d.p.locator('button', { hasText: 'Email me a code' }).click()
  await d.p.locator('.acct-code').fill(await until(async () => (await acc.mail()).length > mailed && acc.code('sam@example.com'), 8000))
  await d.p.locator('.acct-form button', { hasText: 'Sign in' }).click()
  const fullBox = d.p.locator('.acct-full')
  await fullBox.waitFor({ timeout: 10000 })
  ok(/5 devices, as many as it takes/.test(await fullBox.innerText()) && await fullBox.locator('li').count() === 5 && /Mini/.test(await fullBox.innerText()), 'a sixth device (Desk): refused, listing the five, each with a way to make room', await fullBox.innerText())
  await shot(d.p, `${tag}account-five-dark`)
  await fullBox.locator('li', { hasText: 'Air' }).locator('button').click()
  await d.p.locator('.acct-who').waitFor({ timeout: 10000 })
  const deskDevs = await d.p.locator('.acct-devices').innerText()
  ok(/Desk/.test(deskDevs) && !/\bAir\b/.test(deskDevs) && /5 of 5/.test(deskDevs) && !(await desk.api('/account')).declined, 'Remove it and sign in here: Air is out, Desk is in (signed in by hand, it may follow again)', deskDevs)
  await s.p.reload()
  await s.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await openAccount(s.p)
  const mini = s.p.locator('.acct-devices li', { hasText: 'Mini' })
  await mini.waitFor({ timeout: 10000 })
  await mini.locator('button', { hasText: 'Remove' }).click()
  ok(!!(await until(async () => !(await s.p.locator('.acct-devices li', { hasText: 'Mini' }).count()) && /4 of 5/.test(await s.p.locator('.acct-devices').innerText()), 8000)), 'Remove (from Studio): Mini is off the account', await s.p.locator('.acct-devices').innerText())

  // ---------- On a phone ----------
  const ph = await page(b, studio.url, { phone: true, mode: 'dark', theme: 'midnight' })
  pages.push(ph)
  await ph.p.waitForSelector('.tabbar button', { timeout: 15000 })
  await openAccount(ph.p)
  await ph.p.locator('.acct-who').waitFor({ timeout: 10000 })
  const faults = await phoneFaults(ph.p, '.st-scroll')
  ok(!Object.keys(faults).length, 'on a phone: nothing past its edge or sideways, every button a whole 40 px target', faults)
  ok(/Account/.test(await ph.p.locator('.st-bar h3').innerText()), 'under ‹ Settings and its name', await ph.p.locator('.st-bar h3').innerText())
  await shot(ph.p, `${tag}account-phone-dark`)
  await ph.ctx.close()

  // ---------- Sign out, and delete ----------
  await s.p.locator('.acct-leave button', { hasText: 'Sign out' }).click()
  await s.p.locator('.acct-in').waitFor({ timeout: 10000 })
  ok(!(await studio.api('/account')).signedIn && (await acc.admin('GET', `/admin/accounts/${sam.id}`)).devices.every((x) => x.name !== 'Studio') && !(await studio.api('/settings')).user.earlyAccess, 'Sign out: signed out here, off the account\'s devices, and the account\'s Early Access code gone', null)
  const phF = await page(b, studio.url, { phone: true, mode: 'light', theme: 'sky' })
  pages.push(phF)
  await phF.p.waitForSelector('.tabbar button', { timeout: 15000 })
  await openAccount(phF.p)
  await phF.p.locator('.acct-in').waitFor({ timeout: 10000 })
  const signFaults = await phoneFaults(phF.p, '.st-scroll')
  ok(!Object.keys(signFaults).length, 'signing in on a phone fits too, with a field iOS doesn\'t zoom into', signFaults)
  await shot(phF.p, `${tag}account-signin-phone`)
  await phF.ctx.close()
  await d.p.locator('.acct-leave button', { hasText: 'Delete account…' }).click()
  const del = d.p.locator('.acct-delete')
  await del.locator('input').fill('someone@example.com')
  ok(await del.locator('button', { hasText: 'Delete account' }).isDisabled(), 'Delete account stays off until the account\'s email is typed')
  await del.locator('input').fill('sam@example.com')
  await shot(d.p, `${tag}account-delete-dark`)
  await del.locator('button', { hasText: 'Delete account' }).click()
  await d.p.locator('.acct-in').waitFor({ timeout: 10000 })
  ok(!(await desk.api('/account')).signedIn && (await acc.admin('GET', '/admin/accounts?q=sam@')).total === 0 && (await acc.admin('GET', `/admin/accounts/${sam.id}`)).code === 'none', 'deleted: Desk is signed out, and the service has nothing of the account', null)
  ok(!!(await until(async () => !(await studio.api('/account?fresh=1')).signedIn, 5000)), 'and Studio, asked, isn\'t signed in either')

  const errs = pages.flatMap((x) => x.errors).filter((e) => !/\/api\/\S+ due to access control checks|WebSocket|_relay/.test(e))
  ok(errs.length === 0, 'no page errors', errs)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await b.close()
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  acc?.stop()
}
process.exit(done().fail ? 1 : 0)
