// Settings › Devices, in the browser named by BRIDGE_TEST_BROWSER, with two Bridge AIs ("Studio"
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
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, browser, page, shot, noServiceWorker, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('devices-ui')
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
const devices = (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))

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
      await cx.route(/\/api\/machines(\?|$)/, async (r) => { const real = await (await r.fetch()).json(); await r.fulfill({ json: { ...real, machines: [...real.machines, laptop()] } }) })
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
  ok(/Online/.test(await setRow.innerText().catch(() => '')), 'and so does Settings › Devices')
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
  await devices(s.p)
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

  // ---------- a phone paired with both offers to link them ----------
  // The phone app's page: Bridge AI from Desk inside it, and the computers the phone is paired with.
  const ph = await page(b, `${c.url}/api/config`, { phone: true, mode: 'dark', theme: 'midnight' })
  await ph.p.evaluate(({ desk, studio }) => {
    window.opened = []
    window.bridgeRelay = {
      WebSocket: class extends WebSocket { constructor(u) { super(`ws://${location.host}${u}`) } },
      computers: { list: () => [{ relay: desk, name: 'Desk', current: true }, { relay: studio, name: 'Studio', current: false }], open: (r) => window.opened.push(r), add: () => {}, forget: async () => {} },
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
  ok(!!(await until(async () => !(await app.locator('.ask-banner').count()), 15000)), 'and the phone stops offering')

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
  ok((await frame.getAttribute('src')) === `/m/${deskId}/?window=${encodeURIComponent(launched.paneId)}` && /On Desk/.test(await s.p.innerText('.remote-bar')), 'Desk\'s agent in the sidebar opens in a tab here, with Desk\'s own view of it', await frame.getAttribute('src'))
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
  const keys = await s.p.evaluate((id) => ({ here: JSON.parse(localStorage.getItem('cc-ws') || '{}').tabs || [], desk: !!localStorage.getItem(`cc-ws@${id}`) }), deskId)
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
  await deskRow.locator('button', { hasText: 'Details' }).click()
  const about = deskRow.locator('.mch-about')
  await about.locator('.mch-facts').waitFor({ timeout: 10000 })
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
  await devices(narrow.p)
  // (The code from above is still showing: it lasts 15 minutes.)
  await narrow.p.waitForSelector('.ph-pair', { timeout: 10000 })
  ok((await narrow.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'Pair a device fits a phone')
  await shot(narrow.p, `${tag}devices-pair-phone`)
  const errs = [...fresh.errors, ...s.errors, ...narrow.errors, ...ph.errors].filter((e) => !/\/api\/[\w/.-]+ due to access control checks|WebSocket|_relay/.test(e))
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
