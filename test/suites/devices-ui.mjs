// Settings › Devices & Access, in the browser named by BRIDGE_TEST_BROWSER, with two Bridge AIs ("Studio"
// and "Desk") on relays of their own (stand-ins/relay.mjs). Pair a device shows a QR code, the
// address and the code; a phone app paired with both offers to link them, and the whole thing is
// done from the phone (the app is stood in for: the page it shows Bridge AI in, with the computers
// it's paired with); phones and computers are listed apart; and Fix says where a connection stops,
// then that it's back. First, a device online with its agents not in yet (as just after Bridge AI
// restarts): listed as Online, and the window doesn't break; and one whose answer the sidebar can't
// draw: your devices there step aside, the rest of the window carries on, and they come back by
// themselves. Once linked: the sidebar's Devices arrow points down when open; Desk's agent opens in
// a tab on Studio (Desk's own view of it), with Desk's page in another window keeping its own tabs;
// Details shows what Desk is, with the security code Desk shows for itself; and Desk is renamed
// from Studio (on Desk itself), Studio renamed, and both back to their own names.
// A code pairs one device: once a phone has paired with it, its QR code goes, Studio says which
// device paired with Keep and Remove (without stopping anything), and Add another device makes a new
// one. Scan QR code, on a phone: in the app (its scanner stood in for), the phone's menu opens the
// app's scanner, and Link a device links with the link it hands back; in a phone's browser, the
// camera in the page (a stand-in camera) reads the code with jsQR, says when it's the wrong one or the
// camera is turned down, and Link a device links with what it read, while the menu's opens the
// pairing link, which asks first. On a computer there's none.
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import { startKit, startRelay, checks, until, browser, page, shot, noServiceWorker, changeAnswer, TEST } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, skip, done } = checks('devices-ui')
// A phone's browser with a stand-in camera (Scan QR code): Safari on an iPhone, its camera showing
// window.__camera.svg on white (or turned down, with denied), and no BarcodeDetector, so jsQR reads it.
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const PHONE_CAMERA = (ua) => {
  Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ua, configurable: true })
  delete window.BarcodeDetector
  window.__camera = { svg: null, denied: false, stream: null }
  if (!navigator.mediaDevices) Object.defineProperty(Navigator.prototype, 'mediaDevices', { value: {}, configurable: true })
  // On MediaDevices itself: WebKit can make navigator.mediaDevices afresh, without what was put on it.
  const on = window.MediaDevices ? MediaDevices.prototype : navigator.mediaDevices
  on.getUserMedia = async () => {
    if (window.__camera.denied) throw new DOMException('Permission denied', 'NotAllowedError')
    const cv = Object.assign(document.createElement('canvas'), { width: 480, height: 640 })
    const g = cv.getContext('2d')
    const img = new Image()
    let shown = null
    const draw = () => {
      if (stream.getTracks().every((x) => x.readyState === 'ended')) return clearInterval(timer)
      if (window.__camera.svg !== shown) { shown = window.__camera.svg; img.src = shown ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shown)}` : '' }
      g.fillStyle = '#fff'
      g.fillRect(0, 0, cv.width, cv.height)
      if (shown && img.complete) g.drawImage(img, 60, 140, 360, 360)
    }
    const stream = cv.captureStream(10)
    window.__camera.stream = stream
    const timer = setInterval(draw, 100)
    draw()
    return stream
  }
}
const relays = []
const kits = []
const kitWith = async (name, rel) => {
  const k = await startKit(`devices-ui-${name.toLowerCase()}`, {
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_LINK_PING_MS: '1500' } },
  })
  kits.push(k)
  await k.api('/setup', { name: 'Tester' })
  return k
}
const other = async (k, name) => (await k.api('/machines')).machines.find((m) => m.name === name) || null
// Settings › Devices & Access (at one of its tabs), asked again if it doesn't open: just after a reload the
// page can show its tabs a moment before it listens for this (once in CI's macOS WebKit, after
// "after a reload, Desk's agent is still in its tab", Settings never opened in 10 s).
const devices = async (p, tab = 'machines') => {
  for (let i = 0; i < 4; i++) {
    await p.evaluate((section) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section } })), tab)
    if (await until(() => p.locator('.modal.settings').count(), 2500, 100)) return
  }
}

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  const ra = await startRelay('devices-ui-studio')
  const rc = await startRelay('devices-ui-desk')
  relays.push(ra, rc)
  const a = await kitWith('Studio', ra)
  const c = await kitWith('Desk', rc)
  await until(async () => (await a.api('/relay')).online && (await c.api('/relay')).online, 20000)

  // ---------- a device online, its agents not in yet ----------
  // A made-up Laptop added to what Studio says about its devices; `serve` is how it answers.
  let serve = { counts: null, agents: [] }
  const laptop = () => ({ id: 'test-laptop', name: 'Laptop', relay: 'https://relay.example.com', os: 'darwin', version: '3.2.1', state: 'linked', online: true, lastSeen: new Date().toISOString(), addedAt: new Date().toISOString(), code: null, error: null, ...serve })
  const fresh = await page(b, a.url, {
    mode: 'light', theme: 'sky',
    before: async (cx) => {
      await noServiceWorker(cx)
      await changeAnswer(cx, /\/api\/machines(\?|$)/, (real) => ({ ...real, machines: [...real.machines, laptop()] }))
    },
  })
  const fp = fresh.p
  const railRow = fp.locator('.rail-machines .rmc', { hasText: 'Laptop' })
  await railRow.waitFor({ timeout: 15000 }).catch(() => {})
  ok(await railRow.count() === 1 && /No agents/.test(await railRow.innerText()) && !(await fp.locator('.crash-screen').count()), 'a device online with its agents not in yet: the sidebar lists it, and the window doesn\'t break', await fp.locator('.crash-screen').innerText().catch(() => ''))
  await fp.locator('.mc-chip').click()
  ok(/Online/.test(await fp.locator('.mc-menu .mc-row', { hasText: 'Laptop' }).innerText().catch(() => '')), 'the top bar\'s devices say it\'s online')
  await fp.keyboard.press('Escape')
  await devices(fp)
  const setRow = fp.locator('#st-machines .mch-row', { hasText: 'Laptop' })
  await setRow.waitFor({ timeout: 10000 }).catch(() => {})
  ok(/Online/.test(await setRow.innerText().catch(() => '')), 'and so does Settings › Devices & Access')
  await fp.locator('button[aria-label="Close settings"]').click()
  // An answer the sidebar can't draw (agents not a list).
  serve = { counts: { working: 1 }, agents: 5 }
  await fp.evaluate(() => window.dispatchEvent(new Event('bridge-machines')))
  ok(!!(await until(async () => !(await fp.locator('.rail-machines').count()), 8000)), 'an answer the sidebar can\'t draw: your devices there step aside')
  ok(!(await fp.locator('.crash-screen, .crash').count()) && await fp.locator('.rail-nav-btn').count() > 0 && await fp.locator('.mc-chip').isVisible(), 'and the rest of the window carries on')
  await fp.waitForTimeout(6500) // past its first try again, which breaks the same way
  const uiLog = path.join(a.data, 'logs', 'ui-errors.log')
  const logged = fs.existsSync(uiLog) ? fs.readFileSync(uiLog, 'utf8').split('\n').filter((l) => l.includes('[Devices]')).length : 0
  ok(logged === 1, 'written down on the computer once, not on every try', logged)
  serve = { counts: { working: 1 }, agents: [] }
  ok(!!(await until(async () => /1 working/.test(await fp.locator('.rail-machines').innerText().catch(() => '')), 20000)), 'answered right again: they\'re back by themselves')
  await shot(fp, `${tag}devices-back`)
  await fresh.ctx.close()

  // ---------- Pair a device ----------
  const s = await page(b, a.url, { mode: 'light', theme: 'sky' })
  await s.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await devices(s.p, 'phone')
  const pairBtn = s.p.locator('button', { hasText: 'Pair a device' })
  await pairBtn.waitFor({ timeout: 10000 })
  await pairBtn.click()
  await s.p.waitForSelector('.ph-pair', { timeout: 10000 })
  const code = (await s.p.locator('.ph-code .mono').innerText()).trim()
  const addr = (await s.p.locator('.ph-code code').innerText()).trim()
  ok(await s.p.locator('.ph-qr svg').count() === 1 && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/.test(code) && addr === ra.url, 'Pair a device shows a QR code, the address and the code', { code, addr })
  ok(/Another computer/.test(await s.p.locator('.ph-pair').innerText()) && /A phone/.test(await s.p.locator('.ph-pair').innerText()), 'for a phone or another computer')
  await s.p.locator('.ph-pair').scrollIntoViewIfNeeded()
  await shot(s.p, `${tag}devices-pair`)
  // A phone pairs with it (spoken for here, as phones pair now).
  const pocket = await linkAs(ra.url, { code, name: 'Pocket', about: { name: 'Pocket' } })
  await pocket.request?.('GET', '/api/version')
  pocket.close?.()
  const another = s.p.locator('button', { hasText: 'Add another device' })
  await another.waitFor({ timeout: 10000 }).catch(() => {})
  ok(!(await s.p.locator('.ph-pair').count()) && /Pocket paired/.test(await s.p.locator('[data-setting="relay"]').innerText()) && await another.count() === 1, 'a code pairs one device: once Pocket has paired, its QR code goes, saying so, with Add another device', await s.p.locator('[data-setting="relay"]').innerText())
  const told = s.p.locator('.ask-banner .new-device', { hasText: 'Pocket' })
  await told.waitFor({ timeout: 10000 }).catch(() => {})
  ok(/Pocket paired with this computer/.test(await told.innerText().catch(() => '')) && await told.locator('button', { hasText: 'Keep' }).count() === 1 && await told.locator('button', { hasText: 'Remove' }).count() === 1, 'and Studio says a new device paired, with Keep and Remove', await told.innerText().catch(() => ''))
  await shot(s.p, `${tag}devices-new-device`)
  // (Settings is open over the notice: its list of phones offers Keep too.)
  const listed = s.p.locator('.ph-devices li', { hasText: 'Pocket' })
  ok(/New/.test(await listed.innerText().catch(() => '')) && await listed.locator('button', { hasText: 'Keep' }).count() === 1, 'Settings › Devices & Access lists it as new, with Keep beside Remove', await listed.innerText().catch(() => ''))
  await listed.locator('button', { hasText: 'Keep' }).click()
  ok(!!(await until(async () => !(await told.count()) && !(await a.api('/relay')).devices.find((d) => d.name === 'Pocket')?.fresh && !(await listed.locator('button', { hasText: 'Keep' }).count()), 10000)), 'Keep: it stays, and the notice goes')
  await another.click()
  await s.p.waitForSelector('.ph-pair', { timeout: 10000 })
  ok((await s.p.locator('.ph-code .mono').innerText()).trim() !== code, 'Add another device: a new code')

  // ---------- a phone paired with both offers to link them ----------
  // The phone app's page: Bridge AI from Desk inside it, and the computers the phone is paired with.
  const ph = await page(b, `${c.url}/api/config`, { phone: true, mode: 'dark', theme: 'midnight' })
  await ph.p.evaluate(({ desk, studio }) => {
    window.opened = []
    // The app's scanner: what it was asked for, and (for Link a device) what it hands back.
    window.scans = []
    window.scanned = null
    window.bridgeRelay = {
      WebSocket: class extends WebSocket { constructor(u) { super(`ws://${location.host}${u}`) } },
      computers: { list: () => [{ relay: desk, name: 'Desk', current: true }, { relay: studio, name: 'Studio', current: false }], open: (r) => window.opened.push(r), add: () => {}, forget: async () => {} },
      scan: { pair: () => { window.scans.push('pair') }, link: async () => { window.scans.push('link'); return window.scanned } },
    }
    document.open()
    document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe id="app" src="/"></iframe>')
    document.close()
  }, { desk: rc.url, studio: ra.url })
  const app = ph.p.frameLocator('#app')
  const offer = app.locator('.ask-banner', { hasText: 'paired with Studio too' })
  await offer.waitFor({ timeout: 20000 })
  ok(/Link Studio and Desk/.test(await offer.innerText()), 'Desk on the phone: it offers to link Studio, the other computer it\'s paired with', await offer.innerText())
  await shot(ph.p, `${tag}devices-phone-offer`)
  await offer.locator('button', { hasText: 'Link them' }).click()
  const asked = app.locator('.ask-banner', { hasText: 'Asked Studio to link' })
  await asked.waitFor({ timeout: 20000 })
  const digits = /(\d{3} \d{3})/.exec(await asked.innerText())?.[1]
  ok(!!digits, 'Link them: Desk asks Studio, and says to open Studio and allow it, with the six digits', await asked.innerText())
  await asked.locator('button', { hasText: 'Open Studio' }).click()
  ok((await ph.p.evaluate(() => window.opened)).includes(ra.url), 'Open Studio switches the phone to Studio')
  // ...where Studio asks, with the same digits.
  await s.p.reload()
  const ask = s.p.locator('.ask-banner', { hasText: 'Desk asks to link' })
  await ask.waitFor({ timeout: 20000 })
  ok((await ask.innerText()).includes(digits), 'Studio shows Desk asking, with the same six digits')
  await ask.locator('button', { hasText: 'Allow' }).click()
  ok(!!(await until(async () => (await other(c, 'Studio'))?.online && (await other(a, 'Desk'))?.online, 40000, 300)), 'allowed: Studio and Desk are linked, both ways')
  // Linked, each window says which computer it shows (the Dock and the Window menu list them by it).
  {
    const w = await page(b, a.url, { mode: 'light', theme: 'sky' })
    ok(!!(await until(async () => / · Studio$/.test(await w.p.title()), 15000)), "with another computer linked, the window's title says it's Studio", await w.p.title())
    await w.ctx.close()
  }
  ok(!!(await until(async () => !(await app.locator('.ask-banner').count()), 15000)), 'and the phone stops offering')

  // ---------- Scan QR code, in the app ----------
  // The phone's menu: Scan QR code beside Add a computer, and the app's own scanner opens (a pairing
  // link scanned there pairs, asking first: phone-link). Link a device: the app hands back the link
  // scanned, and it links as if pasted (Studio's own code here: they're linked already, so it says so).
  await app.locator('.mc-chip').click()
  const onPhone = app.locator('.mc-menu .menu-item')
  const items = (await onPhone.allInnerTexts()).map((x) => x.trim())
  ok(items.indexOf('Scan QR code') === items.indexOf('Add a computer') + 1 && items.indexOf('Add a computer') > 0, 'in the app, the phone\'s menu has Scan QR code beside Add a computer', items)
  await app.locator('.mc-menu .menu-item', { hasText: 'Scan QR code' }).click()
  ok(!!(await until(() => ph.p.evaluate(() => window.scans.join() === 'pair'), 3000, 100)) && !(await app.locator('.mc-menu').count()), 'Scan QR code opens the app\'s scanner, to pair this phone', await ph.p.evaluate(() => window.scans))
  const inApp = ph.p.frames().find((f) => f !== ph.p.mainFrame())
  await inApp.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))
  const linkSec = app.locator('[data-setting="link-device"]')
  const scanBtn = linkSec.locator('button', { hasText: 'Scan QR code' })
  await scanBtn.waitFor({ timeout: 10000 }).catch(() => {})
  ok(await scanBtn.count() === 1 && /then scan its QR code or paste its link here/.test(await linkSec.innerText()), 'Settings › Devices & Access › Link a device: Scan QR code beside the link', await linkSec.innerText().catch(() => ''))
  await scanBtn.click()
  await until(() => ph.p.evaluate(() => window.scans.includes('link')), 3000, 100)
  await ph.p.waitForTimeout(500)
  ok((await linkSec.locator('input').inputValue()) === '' && !/Linked|Asked/.test(await linkSec.innerText()), 'nothing scanned (the scanner closed): nothing changes', await linkSec.innerText())
  const studioLink = (await a.api('/relay/pair', {})).pairing.link
  await ph.p.evaluate((l) => { window.scanned = l }, studioLink)
  await scanBtn.click()
  ok(!!(await until(async () => /Linked with Studio\./.test(await linkSec.innerText()), 20000, 200)), 'Studio\'s code scanned: Desk links with it as with its link pasted (they\'re linked, so it says so)', await linkSec.innerText())
  await shot(ph.p, `${tag}devices-phone-scan`)
  // Settings › Devices & Access › Phone, the app's computers: Scan QR code beside Add a computer too.
  await app.locator('[role="tab"][data-tab="phone"]').click()
  const theirs = app.locator('[data-setting="relay"] button', { hasText: 'Scan QR code' })
  await theirs.waitFor({ timeout: 10000 }).catch(() => {})
  ok(await theirs.count() === 1 && /Add a computer/.test(await app.locator('[data-setting="relay"]').innerText()), 'Settings › Devices & Access › Phone: Scan QR code beside Add a computer', await app.locator('[data-setting="relay"]').innerText().catch(() => ''))
  await theirs.click()
  ok(!!(await until(() => ph.p.evaluate(() => window.scans.filter((x) => x === 'pair').length === 2), 3000, 100)), 'which opens the app\'s scanner to pair, as the menu\'s does', await ph.p.evaluate(() => window.scans))
  await inApp.evaluate(() => document.querySelector('button[aria-label="Close settings"]')?.click())

  // ---------- the sidebar's Devices: the arrow says whether it's open ----------
  await s.p.reload()
  const fold = s.p.locator('.rail-machines .rail-nav-fold')
  await fold.waitFor({ timeout: 20000 })
  const arrow = async () => (await fold.locator('svg').getAttribute('class')) || ''
  ok((await fold.getAttribute('aria-expanded')) === 'true' && !(await arrow()).includes('rot-up'), 'the sidebar\'s Devices, open: its arrow points down', await arrow())
  await fold.click()
  ok((await arrow()).includes('rot-up'), 'closed: it points to the side', await arrow())
  await fold.click()

  // ---------- Desk's agent, in a tab on Studio ----------
  c.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await c.api('/agents/catalog')
  const work = path.join(c.home, 'desk-work')
  fs.mkdirSync(work, { recursive: true })
  const launched = await c.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Desk work', newSpace: 'Desk work', prompt: 'idle' })
  const deskId = (await other(a, 'Desk')).id
  const deskAgent = s.p.locator('.rail-machines .rmc-agent').first()
  await deskAgent.waitFor({ timeout: 45000 })
  await deskAgent.click()
  const remoteTab = s.p.locator('.ws-tab', { hasText: 'Desk' })
  await remoteTab.waitFor({ timeout: 10000 })
  const frame = s.p.locator('.remote-frame')
  // Sent to Desk's own port here (server/machinepages.js), with what Studio passes it after the #.
  const deskAt = `http://127.0.0.1:${(await a.api('/machines')).machines.find((m) => m.id === deskId)?.port}`
  const deskFrame = () => s.p.frames().find((f) => f.url().startsWith(`${deskAt}/m/${deskId}/`))
  ok((await frame.getAttribute('src')).startsWith(`/m/${deskId}/?window=${encodeURIComponent(launched.paneId)}#`) && !!(await until(deskFrame, 15000, 200)) && /On Desk/.test(await s.p.innerText('.remote-bar')), 'Desk\'s agent in the sidebar opens in a tab here, with Desk\'s own view of it, at Desk\'s own port', [await frame.getAttribute('src'), s.p.frames().map((f) => f.url())])
  const inside = s.p.frameLocator('.remote-frame')
  await inside.locator('.solo', { hasText: 'Desk work' }).waitFor({ timeout: 30000 }).catch(() => {})
  ok(/Desk work/.test(await inside.locator('.solo').innerText().catch(() => '')), 'its view works inside the tab: the agent, its chat and message box', await inside.locator('body').innerText().catch(() => ''))
  ok(await inside.locator('button', { hasText: 'Bring back' }).count() === 0, 'with nothing to close or bring back (it isn\'t a window)')
  await shot(s.p, `${tag}devices-remote-tab`)
  // Desk's page in another window keeps its own tabs: Studio's are as they were.
  const other2 = await s.ctx.newPage()
  await other2.goto(`${a.url}/m/${deskId}/`)
  await other2.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await other2.waitForTimeout(1500)
  ok(other2.url().startsWith(`${deskAt}/m/${deskId}/`), 'Desk\'s page in another window: at Desk\'s own port too', other2.url())
  const keys = { here: await s.p.evaluate(() => JSON.parse(localStorage.getItem('cc-ws') || '{}').tabs || []), desk: await other2.evaluate((id) => !!localStorage.getItem(`cc-ws@${id}`), deskId) }
  ok(keys.here.some((x) => x.startsWith('remote:')) && keys.desk, 'Desk\'s page in another window keeps its tabs apart: Studio\'s are as they were', keys)
  const look = (pg) => pg.evaluate(() => ({ mode: document.documentElement.getAttribute('data-theme'), chrome: document.documentElement.style.getPropertyValue('--chrome') }))
  const [lookHere, lookDesk] = [await look(s.p), await look(other2)]
  ok(!!lookHere.chrome && lookDesk.chrome === lookHere.chrome && lookDesk.mode === lookHere.mode, 'with the same look as this window', { lookHere, lookDesk })
  await other2.close()
  await s.p.reload()
  ok(!!(await until(async () => (await s.p.locator('.ws-tab', { hasText: 'Desk' }).count()) === 1, 15000)), 'after a reload, Desk\'s agent is still in its tab')

  // ---------- phones and computers apart ----------
  await devices(s.p)
  await s.p.waitForSelector('#st-machines .mch-row', { timeout: 10000 })
  ok(await s.p.locator('#st-machines .mch-row', { hasText: 'Desk' }).count() === 1 && await s.p.locator('.ph-devices li', { hasText: 'Desk' }).count() === 0, 'Desk is under Your devices, not among the paired phones')

  // ---------- Details, and a new name ----------
  const deskRow = s.p.locator('#st-machines .mch-row', { hasText: 'Desk' })
  // What the window showed if Desk's details don't open (once, on CI's macOS WebKit runner, they
  // didn't in 10 seconds; here they show in well under a second): whether Settings › Devices & Access is
  // still open, Desk's row and whether its Details says it's open, a section that broke, and what
  // the window wrote down or threw.
  const detailsShown = async () => ({
    ...(await s.p.evaluate(() => {
      const row = [...document.querySelectorAll('#st-machines .mch-row')].find((r) => r.innerText.includes('Desk'))
      const btn = row && [...row.querySelectorAll('button')].find((x) => x.innerText.includes('Details'))
      return { settings: !!document.querySelector('.modal.settings'), devices: !!document.querySelector('#st-machines'), desk: row ? row.innerText.replace(/\s+/g, ' ').slice(0, 200) : null,
        expanded: btn?.getAttribute('aria-expanded') ?? null, about: !!row?.querySelector('.mch-about'), broke: document.querySelector('.modal.settings .crash, .crash-screen')?.innerText.slice(0, 200) ?? null }
    }).catch((e) => ({ page: e.message }))),
    uiErrors: fs.existsSync(uiLog) ? fs.readFileSync(uiLog, 'utf8').split('\n').filter((l) => /^\d{4}-\d\d-\d\dT/.test(l)).slice(-3) : [],
    pageErrors: s.errors.slice(-3),
  })
  await deskRow.locator('button', { hasText: 'Details' }).click()
  const about = deskRow.locator('.mch-about')
  await about.locator('.mch-facts').waitFor({ timeout: 10000 }).catch(async (e) => {
    await shot(s.p, `${tag}devices-details-missing`)
    throw new Error(`Desk's Details didn't open: ${JSON.stringify(await detailsShown())}`, { cause: e })
  })
  const facts = await about.innerText()
  const deskSelf = (await c.api('/machines')).here
  ok(['System', 'Memory', 'Bridge AI', 'Relay', 'Linked', 'Security code'].every((x) => facts.includes(x)), 'Details: what Desk is, how it\'s reached and since when', facts)
  ok(!!deskSelf.safety && facts.includes(deskSelf.safety), 'with the security code Desk shows for itself', { shown: facts, desk: deskSelf.safety })
  await shot(s.p, `${tag}devices-details`)
  await about.locator('input').fill('Desk Mini')
  await about.locator('button', { hasText: 'Rename' }).click()
  ok(!!(await until(async () => (await c.api('/machines')).here.name === 'Desk Mini', 10000)), 'renamed from Studio: Desk is called Desk Mini, on Desk itself')
  ok(!!(await until(async () => !!(await other(a, 'Desk Mini')), 15000)), 'and on Studio')
  ok(!!(await until(async () => /Desk Mini/.test(await s.p.innerText('.rail-machines').catch(() => '')), 15000)), 'the sidebar says so too')
  const hereRow = s.p.locator('#st-machines .mch-row.here')
  await hereRow.locator('button', { hasText: 'Details' }).click()
  await hereRow.locator('.mch-about input').fill('Studio Pro')
  await hereRow.locator('.mch-about button', { hasText: 'Rename' }).click()
  ok(!!(await until(async () => (await a.api('/machines')).here.name === 'Studio Pro', 10000)), 'this device renamed: Studio Pro')
  ok(!!(await until(async () => !!(await other(c, 'Studio Pro')), 30000, 500)), 'and Desk shows the new name')
  // Empty: back to their own names.
  await a.api('/machines/name', { name: '' })
  await a.api(`/machines/${deskId}/name`, { name: '' })
  ok((await a.api('/machines')).here.name === 'Studio' && (await c.api('/machines')).here.name === 'Desk', 'an empty name: back to the computer\'s own')
  await until(async () => !!(await other(a, 'Desk')) && !!(await other(c, 'Studio')), 30000, 500)

  // ---------- Fix ----------
  c.stop()
  const row = s.p.locator('#st-machines .mch-row', { hasText: 'Desk' })
  await row.locator('button', { hasText: 'Fix' }).waitFor({ timeout: 20000 })
  await row.locator('button', { hasText: 'Fix' }).click()
  await row.locator('.mch-fix').waitFor({ timeout: 30000 })
  const found = await row.locator('.mch-fix').innerText()
  ok(/Desk's relay .* answers/.test(found) && /isn't connected to its relay/.test(found), 'Fix with Desk closed: its relay answers, and Desk isn\'t there', found)
  const offRename = await a.api(`/machines/${deskId}/name`, { name: 'Away' }).then(() => null, (e) => e.message)
  ok(/offline\. Rename it once it's back/.test(offRename || ''), 'renaming Desk while it\'s closed says to wait until it\'s back', offRename)
  await shot(s.p, `${tag}devices-fix`)
  await c.restart()
  await row.locator('button', { hasText: 'Fix' }).click().catch(() => {})
  ok(!!(await until(async () => /Back online/.test(await row.innerText().catch(() => '')) || (await other(a, 'Desk'))?.online, 40000, 300)), 'Desk open again: back online')

  // ---------- on a phone ----------
  const narrow = await page(b, a.url, { phone: true, mode: 'dark', theme: 'midnight' })
  await narrow.p.waitForSelector('.tabbar button', { timeout: 15000 })
  await devices(narrow.p, 'phone')
  // (The code from above is still showing: it lasts 15 minutes.)
  await narrow.p.waitForSelector('.ph-pair', { timeout: 10000 })
  ok((await narrow.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'Pair a device fits a phone')
  await shot(narrow.p, `${tag}devices-pair-phone`)

  // ---------- Scan QR code, in a phone's browser ----------
  // The camera in the page: a stand-in camera showing a QR code, read with jsQR (no BarcodeDetector,
  // as in Safari). On a computer there's no Scan QR code: Copy link is the way.
  const linkHere = s.p.locator('[data-setting="link-device"]')
  ok(await linkHere.locator('input').count() === 1 && !(await linkHere.locator('button', { hasText: 'Scan QR code' }).count()), 'on a computer, Link a device has no Scan QR code', await linkHere.innerText().catch(() => ''))
  const deskLink = (await c.api('/relay/pair', {})).pairing.link
  const qr = async (text) => (await QRCode.toString(text, { type: 'svg', margin: 1 })).replace('<svg ', '<svg width="330" height="330" ')
  const cam = await page(b, a.url, { phone: true, mode: 'light', theme: 'sky', before: (cx) => cx.addInitScript(PHONE_CAMERA, IPHONE) })
  await cam.p.waitForSelector('.tabbar button', { timeout: 15000 })
  if (!(await cam.p.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream === 'function'))) skip('Scan QR code in a phone\'s browser', `${which} can't stand in a camera here (no canvas captureStream)`)
  else {
    await cam.p.evaluate((svg) => { window.__camera.svg = svg }, await qr('https://example.com/not-a-pairing-code'))
    await devices(cam.p)
    const sec = cam.p.locator('[data-setting="link-device"]')
    const scanIt = sec.locator('button', { hasText: 'Scan QR code' })
    await scanIt.waitFor({ timeout: 10000 }).catch(() => {})
    ok(await scanIt.count() === 1, 'in a phone\'s browser, Link a device has Scan QR code', await sec.innerText().catch(() => ''))
    await scanIt.click()
    const sheet = cam.p.getByRole('dialog', { name: 'Scan QR code' })
    ok(!!(await until(async () => /isn't a Bridge AI pairing code/.test(await sheet.innerText().catch(() => '')), 15000, 200)), 'it opens the camera in the page; another QR code is said to be the wrong one, and it keeps looking', await sheet.innerText().catch(() => ''))
    ok((await cam.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'the camera fits the phone')
    await shot(cam.p, `${tag}devices-scan-camera`)
    await cam.p.evaluate((svg) => { window.__camera.svg = svg }, await qr(deskLink))
    ok(!!(await until(async () => !(await sheet.count()) && /Linked with Desk\./.test(await sec.innerText()), 20000, 200)), 'Desk\'s code: read, the camera closes, and Studio links with it as with its link pasted (they\'re linked, so it says so)', await sec.innerText())
    const off = () => cam.p.evaluate(() => window.__camera.stream.getTracks().map((x) => x.readyState))
    ok((await off()).every((x) => x === 'ended'), 'and the camera is off once it has read it', await off())
    await cam.p.evaluate(() => { window.__camera.denied = true })
    await scanIt.click()
    ok(!!(await until(async () => /camera wasn't allowed/.test(await sheet.innerText().catch(() => '')), 5000, 100)), 'the camera turned down: it says so, and what to do instead', await sheet.innerText().catch(() => ''))
    await sheet.getByRole('button', { name: 'Cancel' }).click()
    ok(!!(await until(async () => !(await sheet.count()), 3000, 100)), 'and Cancel closes it')
    await cam.p.locator('button[aria-label="Close settings"]').first().click()
    // The phone's menu: Scan QR code pairs this browser with the computer whose code it is, by opening
    // its link as the phone's camera would, and the relay page there asks first. Read here with a
    // BarcodeDetector, as Chrome on Android has.
    await cam.p.evaluate((link) => {
      window.__camera.denied = false
      window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code'] } async detect() { return [{ rawValue: link }] } }
    }, deskLink)
    await cam.p.locator('.mc-chip').click()
    const scanMenu = cam.p.locator('.mc-menu .menu-item', { hasText: 'Scan QR code' })
    ok(await scanMenu.count() === 1 && !(await cam.p.locator('.mc-menu .menu-item', { hasText: 'Add a computer' }).count()), 'the phone\'s menu has Scan QR code (a browser has no Add a computer)', await cam.p.locator('.mc-menu').innerText().catch(() => ''))
    await scanMenu.click()
    const asked = await until(async () => (cam.p.url().startsWith(rc.url) && await cam.p.locator('#pair').isVisible() ? await cam.p.locator('#pair h1').innerText() : null), 20000, 200)
    ok(asked === 'Pair with Desk?' && /#pair=/.test(cam.p.url()), 'Desk\'s code from the menu: this browser goes to Desk\'s pairing link, which asks first (Pair with Desk?)', { asked, url: cam.p.url() })
    await shot(cam.p, `${tag}devices-scan-pair`)
  }
  const errs = [...fresh.errors, ...s.errors, ...narrow.errors, ...ph.errors, ...cam.errors].filter((e) => !/\/api\/\S+ due to access control checks|WebSocket|_relay/.test(e))
  ok(errs.length === 0, 'no page errors', errs)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await b.close()
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
