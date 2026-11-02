// Everything a computer can open has a way in on a phone. Below is every place the desktop opens
// (the views in tabs, App.jsx VIEWS; ⌘K's actions; Settings' sections; the sidebar's rows and
// tools) with the taps that reach it on a phone, or why a phone has no use for it. This fails when
// the desktop has a place that isn't listed here, so nothing new can ship on the desktop alone: give
// it a phone path (a row in the More tab, src/components/More.jsx, or a place in another tab) and
// add it here. Each path is then followed on a phone, 375 and 430 px wide: every tap is there, and
// the place opens. Then Whiteboards on the phone: the list, a board opened from it (with its own way
// back), and Draw this; a phone that had the old Terminals tab open gets Terminals in More.
//
// A path is what's tapped, from the tab bar: a tab (Chief, Agents, Meetings, Today, More), then the
// buttons in it by name. "Search › x" types x in the top bar's search, which must offer it (for
// actions rather than places); "Settings › x" is the top bar's Settings at its section x.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('phone-parity')

const PATHS = {
  // The views in tabs (App.jsx VIEWS).
  'view:new': { phone: 'Agents › New', shows: '.home-title' },
  'view:meetings': { phone: 'Meetings', shows: '.m-meetings' },
  'view:dictations': { phone: 'Meetings › Dictations', shows: '.dc-home, .dc-empty, .dc-body' },
  'view:whiteboards': { phone: 'More › Whiteboards', shows: '.wb-home' },
  'view:map': { phone: 'Agents › Map', shows: '.am' },
  // ⌘K's actions (App.jsx paletteActions).
  'a:home': { phone: 'Agents › New', shows: '.home-title' },
  'a:new': { phone: 'Agents › New › More options', shows: '.modal.new-agent' },
  'a:record': { phone: 'Meetings', shows: '.m-meetings button:has-text("Start recording")' },
  'a:meetings': { phone: 'Meetings', shows: '.m-meetings' },
  'a:dictations': { phone: 'More › Dictations', shows: '.dc-home, .dc-empty, .dc-body' },
  'a:boards': { phone: 'More › Whiteboards', shows: '.wb-home' },
  'a:map': { phone: 'More › Agent Map', shows: '.am' },
  'a:needs': { phone: 'More › Needs you', shows: '.ny-panel' },
  'a:history': { phone: 'More › History', shows: '.modal.history' },
  'a:cloud': { phone: 'Search › New cloud agent' },
  'a:chat': { phone: 'Search › New chat' },
  'a:terminal': { phone: 'Search › New terminal' },
  'a:settings': { phone: 'More › Settings', shows: '.modal.settings' },
  'a:providers': { phone: 'Settings › Model Providers' },
  'a:accounts': { phone: 'Settings › Model Providers' },
  'a:add-account': { phone: 'Search › Add another account' },
  'a:mcp': { phone: 'Settings › MCP Servers' },
  'a:config': { phone: 'Settings › Config File' },
  'a:mate': { phone: 'Chief', shows: '.mate-hero, .console' },
  'a:view': { none: 'The live Herdr view needs a wide screen; a phone has every terminal in More › Terminals' },
  'a:rail': { none: 'The sidebar is the desktop\'s; on a phone its rows are the tabs and More' },
  'a:appearance': { phone: 'Settings › Appearance' },
  'a:theme': { phone: 'Search › Color mode' },
  'a:ideas': { phone: 'Search › Add an idea' },
  'a:cal': { phone: 'Today › Calendar' },
  'a:mail': { phone: 'Today › Mail' },
  'a:triage': { phone: 'Search › Triage my inbox' },
  'a:markets': { phone: 'Today › Markets' },
  'a:routines': { phone: 'Search › Show routines' },
  'a:usage': { phone: 'Today › Usage' },
  'a:stats': { phone: 'Today › Usage' },
  'a:tour': { phone: 'Search › Take the tour' },
  // Settings' sections (Settings.jsx SECTIONS).
  'settings:general': { phone: 'Settings › General' },
  'settings:agents': { phone: 'Settings › Agents' },
  'settings:providers': { phone: 'Settings › Model Providers' },
  'settings:voice': { phone: 'Settings › Voice' },
  'settings:meetings': { phone: 'Settings › Meetings' },
  'settings:mcp': { phone: 'Settings › MCP Servers' },
  'settings:phone': { phone: 'Settings › Devices' },
  'settings:appearance': { phone: 'Settings › Appearance' },
  'settings:config': { phone: 'Settings › Config File' },
  'settings:about': { phone: 'Settings › About & Updates' },
  // The sidebar's rows and tools, by their names (Rail.jsx).
  'rail:New': { phone: 'Agents › New', shows: '.home-title' },
  'rail:Chief of Staff': { phone: 'Chief', shows: '.mate-hero, .console' },
  'rail:Meetings': { phone: 'Meetings', shows: '.m-meetings' },
  'rail:Record a meeting now': { phone: 'Meetings', shows: '.m-meetings button:has-text("Start recording")' },
  'rail:Dictations': { phone: 'Meetings › Dictations', shows: '.dc-home, .dc-empty, .dc-body' },
  'rail:Whiteboards': { phone: 'More › Whiteboards', shows: '.wb-home' },
  'rail:New space': { phone: 'Search › New agent with all the options' },
  'rail:New terminal': { phone: 'Search › New terminal' },
  'rail:History': { phone: 'More › History', shows: '.modal.history' },
  'rail:Collapse all spaces': { none: 'Spaces fold in the sidebar; a phone lists the agents in Agents' },
  'rail:Expand all spaces': { none: 'Spaces fold in the sidebar; a phone lists the agents in Agents' },
}

// ---------- every desktop place is listed ----------
// Read with \n line ends, as a Windows checkout may have them \r\n.
const source = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')
const app = source('src', 'App.jsx')
const views = Object.keys(Function(`return ${/const VIEWS = (\{[^\n]*\})\n/.exec(app)?.[1].replace(/tx\(('[^']*')\)/g, '$1') || '{}'}`)())
const actions = [...app.matchAll(/\{ id: '(a:[\w-]+)'/g)].map((m) => m[1])
const settings = source('src', 'components', 'Settings.jsx')
const sections = [...(/export const SECTIONS = \[([\s\S]*?)\n\]/.exec(settings)?.[1] || '').matchAll(/\{ id: '([\w-]+)'/g)].map((m) => `settings:${m[1]}`)
ok(views.length >= 5 && views.includes('view:whiteboards'), 'the desktop\'s views are read from App.jsx', views)
ok(actions.length >= 30 && actions.includes('a:boards'), 'and ⌘K\'s actions', actions.length)
ok(sections.length >= 8, 'and Settings\' sections', sections)
const missing = (ids) => ids.filter((id) => !PATHS[id])
for (const [what, ids] of [['view', views], ['⌘K action', actions], ['Settings section', sections]]) {
  ok(!missing(ids).length, `every desktop ${what} has a way in on a phone, or says why not (add it to PATHS here)`, missing(ids))
}

const kit = await startKit('phone-parity')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  await kit.api('/setup', { name: 'Tester' })
  // A dictation and a board, so Dictations and the sidebar's Dictations show, and a board opens.
  await kit.api('/dictations', { text: 'A note to self', ms: 1200 }).catch(() => {})
  const board = (await kit.api('/boards', { title: 'Parity board' })).id

  // ---------- the desktop's sidebar and ⌘K, as they are ----------
  const desk = await page(b, kit.url)
  await desk.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await until(() => desk.p.locator('.rail-nav-btn', { hasText: 'Dictations' }).count(), 8000)
  const rail = await desk.p.evaluate(() => [
    ...[...document.querySelectorAll('.rail-nav .rail-nav-btn')].map((e) => e.innerText.split('\n')[0].trim()),
    ...[...document.querySelectorAll('.rail-tools .rail-tool, .rail-nav .rail-rec')].map((e) => e.getAttribute('aria-label')),
  ].filter(Boolean))
  ok(rail.includes('Whiteboards') && rail.includes('History'), 'the desktop\'s sidebar rows and tools are read', rail)
  ok(!missing(rail.map((r) => `rail:${r}`)).length, 'every row and tool in the desktop\'s sidebar has a way in on a phone, or says why not', missing(rail.map((r) => `rail:${r}`)))
  await desk.p.keyboard.press('ControlOrMeta+k')
  await desk.p.waitForSelector('.pal-item', { timeout: 5000 })
  const shown = await desk.p.evaluate(() => [...document.querySelectorAll('.pal-item[data-id^="a:"]')].map((e) => e.dataset.id))
  ok(shown.length >= 20 && !missing(shown).length, 'and every action ⌘K offers on the desktop', missing(shown))
  ok(!desk.errors.length, 'no page errors on the desktop', desk.errors)
  await desk.ctx.close()

  // ---------- each path, followed on a phone ----------
  const TABS = ['Chief', 'Agents', 'Meetings', 'Today', 'More']
  const follow = async (p, route) => {
    const [first, ...rest] = route.split(' › ')
    if (first === 'Search') {
      await p.locator('.search-btn').click()
      await p.locator('.palette input').fill(rest.join(' › '))
      return p.locator('.pal-item', { hasText: rest.join(' › ') }).first().waitFor({ timeout: 4000 }).then(() => null, () => `Search doesn't offer "${rest.join(' › ')}"`)
    }
    if (first === 'Settings') {
      await p.locator('.settings-btn').click()
      const chip = p.locator('.st-nav-item', { hasText: rest[0] })
      if (!(await chip.first().waitFor({ timeout: 4000 }).then(() => true, () => false))) return `Settings has no "${rest[0]}"`
      await chip.first().click()
      return (await until(async () => (await p.locator('.st-head h3').innerText()).trim() === rest[0], 4000)) ? null : `Settings doesn't open at "${rest[0]}"`
    }
    if (!TABS.includes(first)) return `"${first}" isn't a tab`
    await p.locator('.tabbar button', { hasText: first }).click()
    for (const name of rest) {
      const btn = p.locator(`.m-body button:visible, .m-body a:visible`, { hasText: name }).first()
      if (!(await btn.waitFor({ timeout: 4000 }).then(() => true, () => false))) return `no "${name}" to tap`
      await btn.click()
    }
    return null
  }
  for (const width of [375, 430]) {
    const ph = await page(b, kit.url, { phone: true })
    await ph.p.setViewportSize({ width, height: 860 })
    await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
    const tabs = (await ph.p.locator('.tabbar button').allInnerTexts()).map((x) => x.trim())
    ok(tabs.join('|') === TABS.join('|'), `${width}: five tabs, the last one More`, tabs)
    const routes = [...new Map(Object.values(PATHS).filter((x) => x.phone).map((x) => [`${x.phone}|${x.shows || ''}`, x])).values()]
    const bad = []
    for (const r of routes) {
      await ph.p.goto(kit.url)
      await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
      const why = await follow(ph.p, r.phone).catch((e) => e.message)
      if (why) { bad.push(`${r.phone}: ${why}`); continue }
      if (r.shows && !(await ph.p.locator(r.shows).first().waitFor({ timeout: 8000 }).then(() => true, () => false))) bad.push(`${r.phone}: ${r.shows} doesn't show`)
    }
    ok(!bad.length, `${width}: every path is there on the phone and opens its place (${routes.length} of them)`, bad)

    // The More tab: a whole thumb-sized row each, nothing cut off or wider than the phone.
    await ph.p.goto(kit.url)
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.waitForSelector('.m-more-row')
    const rows = await ph.p.evaluate(() => [...document.querySelectorAll('.m-more-row')].map((e) => { const r = e.getBoundingClientRect(); return { name: e.querySelector('b').innerText, h: Math.round(r.height), inside: r.left >= 0 && r.right <= window.innerWidth } }))
    ok(rows.length >= 6 && rows.every((r) => r.h >= 44 && r.inside), `${width}: More's rows are each at least 44 px tall, within the screen`, rows)
    ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}: nothing wider than the phone`)
    await shot(ph.p, `${tag}phone-more-${width}`)

    // Whiteboards: the list, a board from it, its own way back, and Draw this.
    await ph.p.locator('.m-more-row', { hasText: 'Whiteboards' }).click()
    await ph.p.waitForSelector('.wb-home', { timeout: 15000 })
    ok(await ph.p.locator('.m-more-view > .m-view-back', { hasText: 'More' }).isVisible(), `${width}: Whiteboards opens in More, with Back to More`)
    await ph.p.locator('.wb-card', { hasText: board }).click()
    ok(!!(await until(() => ph.p.locator('.excalidraw canvas').count(), 30000)), `${width}: a board opens from the list, in More`)
    ok((await ph.p.locator('.tabbar button.on').innerText()).trim() === 'More' && !(await ph.p.locator('.m-more-view > .m-view-back').count()), `${width}: still in More, with the board's own way back only`)
    await ph.p.locator('.wb-view .pane-extras button[aria-pressed]').click()
    ok(!!(await until(() => ph.p.locator('.wb-draw textarea').isVisible(), 8000)), `${width}: Draw this opens on the board`)
    await shot(ph.p, `${tag}phone-board-${width}`)
    await ph.p.locator('.wb-view button[aria-label="All whiteboards"]').click()
    ok(!!(await until(() => ph.p.locator('.wb-home').isVisible(), 8000)), `${width}: and its Back goes to the list`)
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    ok(!!(await until(() => ph.p.locator('.m-more-row').first().isVisible(), 4000)), `${width}: More again goes back to its list`)
    // (Going from one path to the next cuts off the page's requests, which WebKit reports as errors.)
    ok(!ph.errors.filter((e) => !/\/api\/\S+ due to access control checks/.test(e)).length, `${width}: no page errors`, ph.errors)
    await ph.ctx.close()
  }

  // A phone that had the Terminals tab open (before More): Terminals, in More.
  const old = await page(b, kit.url, { phone: true, store: { 'cc-mtab': 'herdr' } })
  await old.p.waitForSelector('.tabbar button', { timeout: 20000 })
  ok(!!(await until(async () => (await old.p.locator('.tabbar button.on').innerText()).trim() === 'More' && old.p.locator('.m-more-view .terms').count(), 8000)), 'a phone that had the Terminals tab open opens on Terminals, in More')
  ok(!old.errors.length, 'no page errors there', old.errors)
  await old.ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
