// Moving to another relay keeps everything paired. A Bridge AI ("Studio") on a relay of its own
// (stand-ins/relay.mjs) moves to Bridge AI's relay (stand-ins/hosted-relay.mjs, with the accounts
// stand-in) with Use Bridge AI's relay, nothing stopped first, with another computer ("Laptop")
// linked to it, two phones spoken for in Node (lib/linkclient.mjs: one connected as it moves, one
// not), and two phone pages in the browser named by BRIDGE_TEST_BROWSER: one as the page is now, and
// one as it was before a computer could say it moved (as an app that brings its own copy has it).
// Studio keeps its key and every device; the phone connected then is told the new address at once,
// sealed (MOVE), and gets in there with what it has; the one that wasn't finds Studio at the old
// address, which Studio stays connected to, and is told there; a phone whose key belongs to the old
// address pairs again at the new one with the code made for it alone, as the same device, once;
// Laptop follows Studio by itself; the page as it is now follows Studio to the new address; Bridge AI
// in the older page moves the iPhone app itself (its pairing kept under the new address, the old one
// let go); Settings says where it moved from; and the old address goes once every device has moved.
// Then Stop using the relay: asked first in words that say exactly what it does; the phone connected
// is told, sealed, that Studio forgot it; Studio has a new key, forgets its phones, keeps Laptop and
// which Worker was its own on Cloudflare (only the sign-in goes); Laptop says Studio stopped using
// its relay (not just "offline"), takes Studio's new key from Studio itself, and is back with it,
// with nothing done there, once Studio has a relay again. And a phone page connected as its computer
// stops using the relay says so, with how to pair again.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { K, json } from '../../relay/web/link.js'
import { ROOT, TEST, startKit, startRelay, startHostedRelay, startAccounts, checks, until, browser, shot } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, done } = checks('relay-move')
// The servers can't look up <id>.localhost (as on macOS and Windows): they reach Bridge AI's relay
// stood in for the way Bridge AI does everywhere.
const env = { NODE_OPTIONS: `--import ${pathToFileURL(path.join(TEST, 'stand-ins', 'no-localhost-names.mjs')).href}` }
const kits = []
const relays = []
const pages = []
let hr = null
let acc = null
const relayJson = (k) => JSON.parse(fs.readFileSync(path.join(k.data, 'relay.json'), 'utf8'))
const other = async (k, name) => (await k.api('/machines')).machines.find((m) => m.name === name) || null
// The next sealed record of a kind, from a phone spoken for in Node.
const word = async (c, kind, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { const r = await c.next(end - Date.now()).catch(() => null); if (!r) return null; if (r.kind === kind) return json(r.body) }
  return null
}
const codeOf = (link) => new URLSearchParams(new URL(link).hash.slice(1)).get('pair')
// The phone page as it was before MOVE: it ignores the computer's word, and offers Bridge AI no way
// to follow (bridgeRelay.move).
const shellNow = fs.readFileSync(path.join(ROOT, 'relay', 'web', 'shell.js'), 'utf8').replace(/\r\n/g, '\n') // (as git checks it out on Windows: CRLF)
const shellBefore = shellNow.replace(/\n {2}if \(kind === K\.MOVE\)[^\n]*/, '').replace(/\n {2}relay: \(\) => relay,\n {2}move: \(m\) => moved\(m\),/, '')

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  ok(shellBefore !== shellNow && !/K\.MOVE/.test(shellBefore) && !/move: \(m\)/.test(shellBefore), 'the phone page from before MOVE, for the older page below')
  acc = await startAccounts('relay-move')
  hr = await startHostedRelay('relay-move', {}, acc)
  const ra = await startRelay('relay-move-own')
  const rb = await startRelay('relay-move-laptop')
  relays.push(ra, rb)
  // Studio, on its own relay, with the Worker it deployed on Cloudflare noted (and its API token).
  const cf = { account: 'acct-1', accountName: 'Mine', script: 'bridge-0123456789', apiToken: 'not-a-real-token' }
  const a = await startKit('relay-move-studio', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify({ ...ra.relayFile, cf })); return { ...env, BRIDGE_COMPUTER_NAME: 'Studio', BRIDGE_LINK_PING_MS: '1500' } }, config: { relay: { hostedUrl: hr.url }, account: acc.accountConfig } })
  const l = await startKit('relay-move-laptop', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rb.relayFile)); return { ...env, BRIDGE_COMPUTER_NAME: 'Laptop', BRIDGE_LINK_PING_MS: '1500' } } })
  kits.push(a, l)
  await a.api('/setup', { name: 'Tester' })
  await l.api('/setup', { name: 'Tester' })
  ok(!!(await until(async () => (await a.api('/relay')).online && (await l.api('/relay')).online, 20000)), 'Studio and Laptop are each on a relay of their own')
  await l.api('/machines', { link: (await a.api('/relay/pair', {})).pairing.link })
  ok(!!(await until(async () => (await other(l, 'Studio'))?.online && (await other(a, 'Laptop'))?.online, 30000)), 'Laptop is linked with Studio, each reaching the other')

  // Two phones: Pocket stays connected, Spare is put away.
  const pairPhone = async (name) => linkAs(ra.url, { code: (await a.api('/relay/pair', {})).pairing.code, name, about: { name } })
  const pocket = await pairPhone('Pocket')
  const spare = await pairPhone('Spare')
  ok(!!pocket.welcome && !!spare.welcome, 'two phones pair with Studio')
  spare.close()

  // Two phone pages in the browser, paired with Studio, Bridge AI open in each.
  const phonePage = async (before) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2 })
    await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })) } catch { /* no storage */ } })
    if (before) await ctx.route(`${ra.url}/shell.js`, (r) => r.fulfill({ contentType: 'text/javascript; charset=utf-8', body: shellBefore }))
    // Bridge AI's relay, here, is <id>.localhost: what opens there is said to have opened.
    await ctx.route(/^http:\/\/[a-z2-7]{12}\.localhost:\d+\//, (r) => r.fulfill({ contentType: 'text/html', body: '<p>Bridge AI at its new address</p>' }))
    const p = await ctx.newPage()
    const x = { ctx, p, errors: [] }
    p.on('pageerror', (e) => x.errors.push(e.message))
    pages.push(x)
    await p.goto((await a.api('/relay/pair', {})).pairing.link)
    await p.locator('#pair-go').click({ timeout: 15000 })
    const shown = await until(async () => {
      if (await p.locator('#home').isVisible().catch(() => false)) await p.locator('#skip').click().catch(() => {})
      return p.frameLocator('#app').locator('.tabbar button').first().isVisible().catch(() => false)
    }, 40000, 300)
    return shown ? x : null
  }
  const now = await phonePage(false)
  const older = await phonePage(true)
  ok(!!now && !!older, 'two phone pages pair with Studio, Bridge AI open in each: one as the page is now, one from before')
  // The older page is the iPhone app's (as it brings its own): what it gives Bridge AI, stood in for.
  await older.p.evaluate(() => { window.__posts = []; window.bridgeNative = { platform: 'ios', relay: location.origin, pairing: { hostKey: 'kept', code: 'kept' }, post: (m) => window.__posts.push(m) } })
  const paired = (await a.api('/relay')).devices
  const keyBefore = relayJson(a).key.public

  // ---------- Use Bridge AI's relay, from a relay of its own ----------
  await a.api('/account/code', { email: 'pat@example.com' })
  await a.api('/account/verify', { email: 'pat@example.com', code: await acc.code('pat@example.com') })
  await a.api('/account/request', { kind: 'relay' })
  await acc.admin('POST', `/admin/accounts/${(await a.api('/account')).account.id}`, { relay: 'approved' })
  const moved = await a.api('/relay/deploy', { method: 'hosted' })
  const at = moved.url
  ok(moved.hosted && new RegExp(`^http://[a-z2-7]{12}\\.localhost:${hr.port}$`).test(at || '') && moved.moved?.from === ra.url, 'Studio moves to Bridge AI\'s relay, saying where from', { url: at, moved: moved.moved })
  ok(relayJson(a).key.public === keyBefore && JSON.stringify(moved.devices.map((d) => d.id).sort()) === JSON.stringify(paired.map((d) => d.id).sort()), 'with the same key, and every phone and computer still paired (none to pair again)', moved.devices.map((d) => d.name))

  // The phone connected as it moved: told at once, sealed, and in at the new address with what it has.
  const told = await word(pocket, K.MOVE)
  ok(told?.url === at && told.name === 'Studio' && told.hosted === true && told.link?.startsWith(`${at}/#pair=`), 'the phone connected as Studio moved is told the new address, sealed (MOVE), with a code for it alone', told)
  const pocketThere = await until(async () => { const c = await linkAs(at, { device: pocket.device, hostKey: pocket.hostKey, about: { name: 'Pocket' } }); return c.welcome ? c : (c.close?.(), null) }, 20000, 500)
  ok(!!pocketThere && (await pocketThere.request('GET', '/api/version'))?.status === 200, 'and gets in there with its own key and Studio\'s, as before', null)

  // The phone that was put away finds Studio at the old address, and is told there.
  ok((await ra.state()).computers === 1, 'Studio stays connected at its old address for the rest', await ra.state())
  const spareBack = await until(async () => { const c = await linkAs(ra.url, { device: spare.device, hostKey: spare.hostKey, about: { name: 'Spare' } }); return c.welcome ? c : (c.close?.(), null) }, 20000, 500)
  const toldThere = spareBack && await word(spareBack, K.MOVE)
  ok(toldThere?.url === at && toldThere.link?.startsWith(`${at}/#pair=`), 'the phone that wasn\'t connected gets in at the old address and is told the new one there, sealed', toldThere)
  ok((await spareBack?.request('GET', '/api/version'))?.status === 200, 'and Studio still answers it there meanwhile')
  spareBack?.close()
  // A browser's (or the Android app's) key belongs to the old address: the code pairs it at the new one, as the same device.
  const spareId = paired.find((d) => d.name === 'Spare').id
  const spareNew = await linkAs(at, { code: codeOf(toldThere.link), name: 'Spare', about: { name: 'Spare' } })
  const afterSpare = (await a.api('/relay')).devices
  ok(!!spareNew.welcome && spareNew.deviceId === spareId && afterSpare.length === paired.length && afterSpare.find((d) => d.id === spareId)?.name === 'Spare', 'its code pairs it at the new address as the same device, not a second one', { id: spareNew.deviceId, spareId, names: afterSpare.map((d) => d.name) })
  const left = await spareNew.request('GET', '/api/relay')
  ok(left?.json?.here === spareId && left.json.left === ra.url, 'and Studio says where it moved from, for the app there to let go of', left?.json && { here: left.json.here, left: left.json.left })
  spareNew.close()
  // Its key at the old address isn't Spare's any more. A page that follows the word (moved) is let in
  // only to be told, sealed, where Studio is now (MOVE again), with no code; a page from before is
  // turned away in the clear, as it was.
  const fromBefore = await linkAs(ra.url, { device: spare.device, hostKey: spare.hostKey, about: { name: 'Spare' } })
  ok(fromBefore.refused?.why === 'not-paired' && !fromBefore.welcome, 'Spare\'s key from the old address, from a page from before: turned away in the clear, as before', fromBefore.refused)
  const retired = await linkAs(ra.url, { device: spare.device, hostKey: spare.hostKey, hello: { moved: 1 } })
  const toldAgain = retired.welcome && await word(retired, K.MOVE)
  ok(toldAgain?.again === true && toldAgain.url === at && toldAgain.name === 'Studio' && toldAgain.hosted === true && !toldAgain.link, 'from a page that follows it: told sealed where Studio is now (MOVE again), with no code', toldAgain)
  const answered = await retired.request?.('GET', '/api/version').catch((e) => ({ error: e.message }))
  ok(!answered?.status && (await a.api('/relay')).devices.find((d) => d.id === spareId)?.connected === false, 'and nothing it asks is answered, nor does it count as Spare connected', answered)
  retired.close?.()
  const here = await linkAs(at, { device: spare.device, hostKey: spare.hostKey, hello: { moved: 1 } })
  const hereAgain = here.welcome && await word(here, K.MOVE)
  ok(hereAgain?.again === true && hereAgain.url === at, 'the same at the new address: told, sealed, that Studio is there (its page there pairs again)', hereAgain)
  here.close?.()
  const again = await linkAs(at, { code: codeOf(toldThere.link), name: 'Someone' })
  ok(!!again.refused && !again.welcome, 'a code made for a move works once', again.refused)
  const asked = await fetch(`${a.url}/api/relay/move`, { method: 'POST' }).then((r) => r.json())
  ok(/Only a device paired/.test(asked.error || ''), 'and only a paired phone can ask for one', asked)

  // The pages: as it is now, it follows Studio; Bridge AI in the older one moves the app itself.
  const followed = await until(() => now.p.url().startsWith(`${at}/#pair=`), 20000, 200)
  ok(!!followed && /&name=Studio$/.test(now.p.url()), 'the phone page follows Studio to its new address, to pair there with one tap', now.p.url())
  const posts = await until(() => older.p.evaluate(() => (window.__posts.some((m) => m.type === 'switch') ? window.__posts : null)), 40000, 300)
  const seq = (posts || []).map((m) => m.type).join(' ')
  ok(seq === 'relay keep name forget switch' && posts[0].url === at && posts[1].pairing?.hostKey === 'kept' && posts[2].name === 'Studio' && posts[3].url === ra.url && posts[4].url === at, 'Bridge AI in a page from before moves the iPhone app itself: its pairing kept under the new address, the old one let go, the app opened there', posts)

  // Laptop follows Studio by itself.
  ok(!!(await until(async () => { const m = await other(l, 'Studio'); return m?.relay === at && m.online }, 40000, 300)), 'Laptop follows Studio to its new address by itself, and reaches it there', await other(l, 'Studio'))

  // Settings says where it moved from, and which phones haven't come along yet.
  const s = await b.newContext({ viewport: { width: 1280, height: 860 } })
  const sp = await s.newPage()
  pages.push({ ctx: s, p: sp, errors: [] })
  await sp.goto(a.url)
  await sp.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await sp.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'phone' } })))
  const note = sp.locator('[data-setting="relay"] [data-moved]')
  ok(!!(await note.waitFor({ timeout: 10000 }).then(() => true, () => false)) && new RegExp(`Moved here from ${ra.url.replace(/^http:\/\//, '').replace(/\./g, '\\.')}\\. Phones paired there follow this computer here`).test(await note.innerText()), 'Settings › Phone says where Studio moved from, and that its phones follow it', await note.innerText().catch(() => ''))
  ok(await sp.locator('.ph-devices .st-chip', { hasText: 'Not moved yet' }).count() >= 2, 'with the phones not seen at the new address yet', await sp.locator('.ph-devices').innerText().catch(() => ''))
  await shot(sp, `${tag}relay-moved`)

  // The page left at the old address. The phone pairs at the new address with the code it followed
  // (as the page there does, with one tap), so its key at the old one isn't its own any more; opened
  // there again, the page says Studio moved, with the way on (Studio says so, sealed: MOVE again),
  // not that the answer couldn't be checked.
  const nowThere = await linkAs(at, { code: codeOf(now.p.url()), name: 'Now', about: { name: 'Now' } })
  ok(!!nowThere.welcome, '(the code the page followed pairs it at the new address)', nowThere.refused)
  nowThere.close?.()
  const movedScreen = async (p) => (await p.locator('#moved-open').isVisible().catch(() => false)) ? { title: await p.locator('#wait-title').innerText(), text: await p.locator('#wait-text').innerText(), again: await p.locator('#pair-again').isVisible() } : null
  await now.p.goto(ra.url)
  const oldPage = await until(() => movedScreen(now.p), 20000, 200)
  ok(oldPage?.title === 'Studio moved to Bridge AI\'s relay' && oldPage.text.includes(`Studio is at ${new URL(at).host} now: open it there.`) && !/couldn't be checked/.test(oldPage.text) && oldPage.again, 'the page left at the old address, opened again, says Studio moved, with its new address and Pair again (not that the answer couldn\'t be checked)', oldPage)
  await shot(now.p, `${tag}relay-moved-old-page`)
  await now.p.locator('#moved-open').click()
  ok(!!(await until(() => now.p.url() === `${at}/`, 10000, 200)), 'Open it there goes to the new address, where the page has its own pairing', now.p.url())

  // The old address goes once every device has moved (here, the page from before, put away).
  for (const d of (await a.api('/relay')).devices.filter((x) => x.moving)) await a.api(`/relay/devices/${d.id}`, null, 'DELETE')
  ok(!!(await until(async () => !(await a.api('/relay')).moved && (await ra.state()).computers === 0, 15000)), 'once every device has been seen at the new address, Studio lets go of the old one', { moved: (await a.api('/relay')).moved, ra: await ra.state() })
  // Studio isn't at the old address to say it any more: the page there says it from what it kept.
  await now.p.goto(ra.url)
  const kept = await until(() => movedScreen(now.p), 20000, 200)
  ok(kept?.title === 'Studio moved to Bridge AI\'s relay' && kept.again, 'and once Studio has left the old address, the page there still says where it went (kept from Studio\'s sealed word), not just offline', kept)

  // ---------- Stop using the relay ----------
  let asksFirst = ''
  sp.once('dialog', (d) => { asksFirst = d.message(); d.dismiss() })
  await sp.locator('button', { hasText: 'Stop using the relay' }).click()
  ok(/Every paired phone is forgotten/.test(asksFirst) && /this computer gets a new key/.test(asksFirst) && /address on the relay is removed/.test(asksFirst) && /other computers stay linked/.test(asksFirst) && /To move to another relay instead, use Change how your phone connects: your phones come along/.test(asksFirst), 'Stop asks first, saying exactly what it does, and that moving needs none of it', asksFirst)
  const laptopId = (await a.api('/relay')).devices.find((d) => d.kind === 'computer').id
  await a.api('/relay/forget', {})
  const forgot = await word(pocketThere, K.MOVE)
  ok(forgot?.forgot === true && forgot.name === 'Studio', 'the phone connected is told, sealed, that Studio forgot it', forgot)
  const conf = relayJson(a)
  ok(conf.key.public !== keyBefore && !conf.url && !conf.hosted && (conf.devices || []).map((d) => d.id).join() === laptopId, 'Studio has a new key, and forgets its phones but not Laptop', { devices: conf.devices?.map((d) => d.name), url: conf.url })
  ok(JSON.stringify(conf.cf) === JSON.stringify({ account: cf.account, accountName: cf.accountName, script: cf.script }), 'it keeps which Worker was its own on Cloudflare (the same address when it\'s set up again), and drops only the sign-in', conf.cf)
  ok(!!(await until(() => !relayJson(a).leaving, 15000)), 'and its address on Bridge AI\'s relay is removed there', relayJson(a).leaving)
  const newSafety = (await a.api('/machines')).here.safety
  const said = await until(async () => { const m = await other(l, 'Studio'); return m && /stopped using its relay/.test(m.error || '') && m.safety === newSafety ? m : null }, 30000, 300)
  ok(!!said && said.state === 'linked', 'Laptop says Studio stopped using its relay (not just offline), and has Studio\'s new key from Studio itself, still linked', await other(l, 'Studio'))
  // A relay again: Laptop is back with Studio, nothing done there.
  const back = await a.api('/relay/deploy', { method: 'hosted' })
  ok(!!(await until(async () => { const m = await other(l, 'Studio'); return m?.relay === back.url && m.online && !m.error }, 40000, 300)), 'Studio on a relay again: Laptop finds it there with its new key, by itself', await other(l, 'Studio'))

  // ---------- A phone page as its computer stops using the relay ----------
  const rc = await startRelay('relay-move-desk')
  relays.push(rc)
  const desk = await startKit('relay-move-desk', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rc.relayFile)); return { BRIDGE_COMPUTER_NAME: 'Desk' } } })
  kits.push(desk)
  await desk.api('/setup', { name: 'Tester' })
  await until(async () => (await desk.api('/relay')).online, 20000)
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true })
  await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })) } catch { /* no storage */ } })
  const dp = await ctx.newPage()
  pages.push({ ctx, p: dp, errors: [] })
  await dp.goto((await desk.api('/relay/pair', {})).pairing.link)
  await dp.locator('#pair-go').click({ timeout: 15000 })
  await until(async () => { if (await dp.locator('#home').isVisible().catch(() => false)) await dp.locator('#skip').click().catch(() => {}); return dp.frameLocator('#app').locator('.tabbar button').first().isVisible().catch(() => false) }, 40000, 300)
  await desk.api('/relay/forget', {})
  const err = await until(async () => (await dp.locator('#pair').isVisible() ? dp.locator('#pair-err').innerText() : null), 15000, 200)
  ok(/^Desk stopped using its relay, so it forgot this phone\. To use it again: on Desk, set up the phone in Settings › Account & Devices, click Pair a device, and scan its code with this phone's camera\.$/.test(err || ''), 'a phone page connected as its computer stops using the relay says so, with how to pair again', err)
  await shot(dp, `${tag}relay-forgot-phone`)

  // (WebKit reports what the phone page was waiting on when its link dropped, as a computer moving
  // away from an address drops it, as errors: phone-fresh.mjs says so too.)
  const errs = pages.flatMap((x) => x.errors).filter((e) => !/\/api\/\S+ due to access control checks|^Error: (Your computer is offline|Reconnecting to your computer|Connection lost)/.test(e))
  ok(!errs.length, 'no page errors', errs)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-2000))
} finally {
  await b.close().catch(() => {})
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  hr?.stop()
  acc?.stop()
}
process.exit(done().fail ? 1 : 0)
