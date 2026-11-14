// Everything a computer can open has a way in on a phone. Below is every place the desktop opens
// (the views in tabs, App.jsx VIEWS; ⌘K's actions; Settings' sections; the sidebar's rows and
// tools) with the taps that reach it on a phone, or why a phone has no use for it. This fails when
// the desktop has a place that isn't listed here, so nothing new can ship on the desktop alone: give
// it a phone path (a row in the More tab, src/components/More.jsx, or a place in another tab) and
// add it here. Each path is then followed on a phone, 375 and 430 px wide: every tap is there, and
// the place opens. Usage has a row of its own in More (Home on or off), opening it straight away, not
// through Today, and ⌘K's Show usage and Usage stats and history open it there on a phone. Then
// Whiteboards on the phone: the list, a board opened from it (with its own way back), and AI Assist's Draw this;
// a phone that had the old Terminals tab open gets Terminals in More.
//
// Then Settings, as a phone's settings: it opens at the list of every section (a whole row each,
// with its icon and what's in it), a section opens full width under ‹ Settings and its name, with
// one close for the whole of Settings, and ‹ Settings goes back to the list. Opened at a section
// (a link to it, ⌘K, a link from inside Settings, even to the section it opened at), it lands there
// with ‹ Settings. Nothing wider than the phone, cut off or smaller than a 40 px target. On a
// desktop it's as it was: General, with the sections down the left.
//
// A path is what's tapped, from the tab bar: a tab (Chief, Agents, Meetings, Today, More), then the
// buttons in it by name. A beta feature's paths (trial: its id) are followed with it on; with Home
// on, Home is the first tab and Today is in More, which is checked then too. One marked mac (Mail,
// its ⌘K actions and Settings › Mail) is only there, and followed, on a Mac. "Search › x" types x in the top bar's search, which must offer it (for
// actions rather than places); "Settings › x" is the top bar's Settings, then its section x.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, phoneFaults, ROOT, IS_MAC } from '../lib/harness.mjs'

const { ok, done } = checks('phone-parity')

const PATHS = {
  // The views in tabs (App.jsx VIEWS).
  'view:home': { phone: 'Home', shows: '.hm', trial: 'home' },
  'view:everything': { phone: 'Home › See everything', shows: '.ey', trial: 'home' },
  'view:new': { phone: 'Agents › New', shows: '.home-title' },
  'view:meetings': { phone: 'Meetings', shows: '.m-meetings' },
  'view:dictations': { phone: 'Meetings › Dictations', shows: '.dc-home, .dc-empty, .dc-body' },
  'view:whiteboards': { phone: 'More › Whiteboards', shows: '.wb-home' },
  'view:studio': { phone: 'More › Studio', shows: '.sd-home' },
  'view:files': { phone: 'More › Files', shows: '.fx' },
  'view:map': { phone: 'Agents › Map', shows: '.am' },
  // ⌘K's actions (App.jsx paletteActions).
  'a:homeview': { phone: 'Home', shows: '.hm', trial: 'home' },
  'a:everything': { phone: 'Home › See everything', shows: '.ey', trial: 'home' },
  'a:edithome': { phone: 'Search › Edit Home', trial: 'home' },
  'a:home': { phone: 'Agents › New', shows: '.home-title' },
  'a:new': { phone: 'Agents › New › More options', shows: '.modal.new-agent' },
  'a:record': { phone: 'Meetings', shows: '.m-meetings button:has-text("Start recording")' },
  'a:meetings': { phone: 'Meetings', shows: '.m-meetings' },
  'a:insights': { phone: 'Meetings › Insights', shows: '.m-meetings :is(.mi, .mi-empty)' },
  'a:people': { phone: 'Meetings › People', shows: '.m-meetings .mi-people' },
  'a:dictations': { phone: 'More › Dictations', shows: '.dc-home, .dc-empty, .dc-body' },
  'a:memory': { phone: 'Meetings › Memory', shows: '.m-meetings .mt-view .mm-page' },
  'a:boards': { phone: 'More › Whiteboards', shows: '.wb-home' },
  'a:studio': { phone: 'More › Studio', shows: '.sd-home' },
  'a:files': { phone: 'More › Files', shows: '.fx' },
  'a:map': { phone: 'More › Agent Map', shows: '.am' },
  'a:needs': { phone: 'More › Needs You', shows: '.ny-panel' },
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
  'a:topbar': { none: 'What\'s pinned to the desktop\'s top bar; a phone\'s bar keeps to what needs you now, the rest in Today and a line under it' },
  'a:theme': { phone: 'Search › Color mode' },
  'a:ideas': { phone: 'Search › Add an idea' },
  'a:cal': { phone: 'Today › Calendar', mac: true }, // the calendar reads macOS Calendar
  'a:mail': { phone: 'Today › Mail', mac: true },
  'a:triage': { phone: 'Search › Triage my inbox', mac: true },
  'a:mail-done': { phone: 'Today › Mail', mac: true },
  'a:mail-later': { phone: 'Today › Mail', mac: true },
  'a:mail-reply': { phone: 'Today › Mail', mac: true },
  'a:mail-keys': { none: 'Keys are for a keyboard; on a phone the open message has Done, Remind me and AI Assist as buttons' },
  'a:markets': { phone: 'Today › Markets' },
  'a:routines': { phone: 'Search › Show routines' },
  'a:new-routine': { phone: 'Search › New routine' },
  'a:usage': { phone: 'More › Usage', shows: '.m-more-view .ustats' },
  'a:stats': { phone: 'More › Usage', shows: '.m-more-view .ustats' },
  'a:tour': { phone: 'Search › Take the tour' },
  // Settings' sections (Settings.jsx SECTIONS).
  'settings:general': { phone: 'Settings › General' },
  'settings:agents': { phone: 'Settings › Agents' },
  'settings:providers': { phone: 'Settings › Model Providers' },
  // Voice & Meetings, and its tabs (their ids open it at each).
  'settings:voice-meetings': { phone: 'Settings › Voice & Meetings' },
  'settings:meetings': { phone: 'Settings › Voice & Meetings › Meetings' },
  'settings:dictation': { phone: 'Settings › Voice & Meetings › Dictation' },
  'settings:voice': { phone: 'Settings › Voice & Meetings › Speech to Text' },
  'settings:mail': { phone: 'Settings › Mail', mac: true },
  'settings:mcp': { phone: 'Settings › MCP Servers' },
  // Devices, and its tabs.
  'settings:devices': { phone: 'Settings › Devices' },
  'settings:phone': { phone: 'Settings › Devices › Phone' },
  'settings:machines': { phone: 'Settings › Devices › Computers' },
  'settings:notifications': { phone: 'Settings › Devices › Notifications' },
  // (There only once Bold Bridge accounts exist, server/account.js: account-ui follows it on a phone.)
  'settings:account': { phone: 'Settings › Account', accounts: true },
  'settings:appearance': { phone: 'Settings › Appearance' },
  'settings:config': { phone: 'Settings › Config File' },
  'settings:about': { phone: 'Settings › About & Updates' },
  // The sidebar's rows and tools, by their names (Rail.jsx).
  'rail:Home': { phone: 'Home', shows: '.hm', trial: 'home' },
  'rail:New': { phone: 'Agents › New', shows: '.home-title' },
  'rail:Chief of Staff': { phone: 'Chief', shows: '.mate-hero, .console' },
  'rail:Meetings': { phone: 'Meetings', shows: '.m-meetings' },
  'rail:Record a meeting now': { phone: 'Meetings', shows: '.m-meetings button:has-text("Start recording")' },
  'rail:Dictations': { phone: 'Meetings › Dictations', shows: '.dc-home, .dc-empty, .dc-body' },
  'rail:Whiteboards': { phone: 'More › Whiteboards', shows: '.wb-home' },
  'rail:Studio': { phone: 'More › Studio', shows: '.sd-home' },
  'rail:Files': { phone: 'More › Files', shows: '.fx' },
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
// Each section's name and what's in it, as the phone's list of them shows them.
// (One marked mac, Mail, is there only where Apple Mail can be read.)
const named = [...(/export const SECTIONS = \[([\s\S]*?)\n\]/.exec(settings)?.[1] || '').matchAll(/label: tx\('([^']+)'\), icon: '[\w-]+', hint: tx\('([^']+)'\)(, mac: true)?/g)].filter((m) => !m[3] || IS_MAC).map((m) => ({ name: m[1], hint: m[2] }))
ok(views.length >= 5 && views.includes('view:whiteboards'), 'the desktop\'s views are read from App.jsx', views)
ok(actions.length >= 30 && actions.includes('a:boards'), 'and ⌘K\'s actions', actions.length)
ok(sections.length >= 8, 'and Settings\' sections', sections)
const missing = (ids) => ids.filter((id) => !PATHS[id])
for (const [what, ids] of [['view', views], ['⌘K action', actions], ['Settings section', sections]]) {
  ok(!missing(ids).length, `every desktop ${what} has a way in on a phone, or says why not (add it to PATHS here)`, missing(ids))
}

const kit = await startKit('phone-parity', { config: { trials: { studio: true, 'meeting-insights': true, routines: true, files: true } } }) // the beta features on: their ways in are checked too
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
  await desk.p.keyboard.press('Escape')
  // Settings on the desktop, to see it's as it was: General, with the sections down the left.
  await desk.p.locator('.settings-btn').click()
  await desk.p.locator('.modal.settings .st-nav').waitFor({ timeout: 8000 })
  const deskSettings = await desk.p.evaluate(() => ({ title: document.querySelector('.st-head h3')?.innerText.trim(), nav: [...document.querySelectorAll('.st-nav .st-nav-item')].map((e) => e.innerText.trim()), bar: !!document.querySelector('.st-bar, .st-back, .st-list') }))
  await desk.p.keyboard.press('Escape')
  ok(!desk.errors.length, 'no page errors on the desktop', desk.errors)
  await desk.ctx.close()

  // ---------- each path, followed on a phone ----------
  const TABS = ['Chief', 'Agents', 'Meetings', 'Today', 'More']
  // Settings showing a section on a phone: its name over it, with ‹ Settings beside.
  const at = (p, name, ms) => until(async () => (await p.locator('.st-bar h3').innerText().catch(() => '')).trim() === name && p.locator('.st-bar .st-back').isVisible(), ms)
  const follow = async (p, route, tabs = TABS) => {
    const [first, ...rest] = route.split(' › ')
    if (first === 'Search') {
      await p.locator('.search-btn').click()
      await p.locator('.palette input').fill(rest.join(' › '))
      return p.locator('.pal-item', { hasText: rest.join(' › ') }).first().waitFor({ timeout: 4000 }).then(() => null, () => `Search doesn't offer "${rest.join(' › ')}"`)
    }
    if (first === 'Settings') {
      await p.locator('.settings-btn').click()
      const row = p.locator('.modal.settings .st-list').getByText(rest[0], { exact: true })
      if (!(await row.first().waitFor({ timeout: 4000 }).then(() => true, () => false))) return `Settings lists no "${rest[0]}"`
      await row.first().click()
      return (await at(p, rest[0], 4000)) ? null : `Settings doesn't open at "${rest[0]}" with ‹ Settings`
    }
    if (!tabs.includes(first)) return `"${first}" isn't a tab`
    // Tapped twice, as a tab tapped while it's open goes back to its top: More keeps the view it
    // last showed across a reload, which isn't where a path starts.
    await p.locator('.tabbar button', { hasText: first }).click()
    await p.locator('.tabbar button', { hasText: first }).click()
    for (const name of rest) {
      const btn = p.locator(`.m-body button:visible, .m-body a:visible`, { hasText: name })
      if (!(await btn.first().waitFor({ timeout: 4000 }).then(() => true, () => false))) return `no "${name}" to tap`
      // A row of More by its name, before anything else that has the word in it (Today's "…and usage").
      const row = p.locator('.m-body .m-more-row:visible', { has: p.locator('.m-more-text > b', { hasText: new RegExp(`^${name}$`) }) })
      await ((await row.count()) ? row : btn).first().click()
    }
    return null
  }
  for (const width of [375, 430]) {
    const ph = await page(b, kit.url, { phone: true })
    await ph.p.setViewportSize({ width, height: 860 })
    await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
    const tabs = (await ph.p.locator('.tabbar button').allInnerTexts()).map((x) => x.trim())
    ok(tabs.join('|') === TABS.join('|'), `${width}: five tabs, the last one More`, tabs)
    const routes = [...new Map(Object.values(PATHS).filter((x) => x.phone && !x.trial && !x.accounts && (!x.mac || IS_MAC)).map((x) => [`${x.phone}|${x.shows || ''}`, x])).values()]
    const bad = []
    for (const r of routes) {
      await ph.p.goto(kit.url)
      await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
      const why = await follow(ph.p, r.phone).catch((e) => e.message)
      if (why) { bad.push(`${r.phone}: ${why}`); continue }
      if (r.shows && !(await ph.p.locator(r.shows).first().waitFor({ timeout: 8000 }).then(() => true, () => false))) bad.push(`${r.phone}: ${r.shows} doesn't show`)
    }
    ok(!bad.length, `${width}: every path is there on the phone and opens its place (${routes.length} of them)`, bad)
    // More itself: every row whole, what each holds said in full, nothing cut off.
    await ph.p.goto(kit.url)
    await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.locator('.m-more-row[data-id="settings"]').waitFor({ timeout: 8000 }).catch(() => {})
    const moreFaults = await phoneFaults(ph.p, '.m-body')
    ok(!Object.keys(moreFaults).length, `${width}: More fits, each row's words whole`, moreFaults)

    // ⌘K's usage on a phone: More › Usage, from another tab.
    const notThere = []
    for (const label of ['Show usage', 'Usage stats and history']) {
      await ph.p.goto(kit.url)
      await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
      await ph.p.locator('.tabbar button', { hasText: 'Chief' }).click()
      await ph.p.locator('.search-btn').click()
      await ph.p.locator('.palette input').fill(label)
      await ph.p.locator('.pal-item', { hasText: label }).first().click({ timeout: 4000 }).catch(() => {})
      const there = await until(async () => (await ph.p.locator('.tabbar button.on').innerText()).trim() === 'More' && ph.p.locator('.m-more-view .ustats').isVisible(), 8000)
      if (!there) notThere.push(label)
    }
    ok(!notThere.length, `${width}: ⌘K's Show usage and Usage stats and history open Usage in More`, notThere)

    // ---------- Settings, as a phone's settings ----------
    await ph.p.goto(kit.url)
    await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.locator('.m-more-row', { hasText: 'Settings' }).click()
    await ph.p.locator('.modal.settings .st-list-row').first().waitFor({ timeout: 8000 }).catch(() => {})
    const sheet = () => ph.p.evaluate(() => {
      const m = document.querySelector('.modal.settings')
      const r = m?.getBoundingClientRect()
      return {
        title: document.querySelector('.st-bar h3')?.innerText.trim() || null,
        back: document.querySelector('.st-bar .st-back')?.innerText.trim() || null,
        closes: m ? m.querySelectorAll('[aria-label="Close settings"]').length : 0,
        tabs: !!m?.querySelector('.st-nav-item'),
        full: !!r && Math.round(r.left) === 0 && Math.round(r.width) === innerWidth,
        lede: m?.querySelector('.st-lede')?.innerText.trim() || null,
        rows: [...(m?.querySelectorAll('.st-list-row') || [])].map((e) => { const b = e.getBoundingClientRect(); return { name: e.querySelector('b')?.innerText.trim(), hint: e.querySelector('.m-more-text > span')?.innerText.trim(), icon: !!e.querySelector('.m-more-ico svg'), h: Math.round(b.height), inside: b.left >= 0 && b.right <= innerWidth } }),
      }
    })
    const list = await sheet()
    const listed = list.rows.length === named.length && named.every((s, i) => list.rows[i].name === s.name && list.rows[i].hint === s.hint)
    const desktopAsBefore = deskSettings.title === 'General' && deskSettings.nav.join('|') === named.map((s) => s.name).join('|') && !deskSettings.bar
    ok(listed && list.rows.every((x) => x.icon && x.h >= 44 && x.inside) && list.title === 'Settings' && !list.back && list.closes === 1 && !list.tabs && list.full && desktopAsBefore,
      `${width}: Settings opens at the list of its sections in Title Case, a whole row each (44 px or more) with its icon and what's in it, under Settings and its one close, rather than a strip of tabs (on a desktop: General, with the sections down the left, as before)`, { list, named, deskSettings })
    let f = await phoneFaults(ph.p, '.modal.settings')
    ok(!Object.keys(f).length, `${width}: the list fits the phone (nothing wider, past its edge, sideways or cut off; each target 40 px and uncovered)`, f)
    await shot(ph.p, `${tag}phone-settings-${width}`)
    // (Each tap gives up after a moment, so a missing control fails its own check below.)
    const tap = (l) => l.click({ timeout: 4000 }).catch(() => {})
    await tap(ph.p.locator('.modal.settings .st-list').getByText('Agents', { exact: true }))
    await at(ph.p, 'Agents', 4000)
    const voice = await sheet()
    ok(voice.title === 'Agents' && voice.back === 'Settings' && voice.closes === 1 && !voice.rows.length && !voice.tabs && voice.full && voice.lede === named.find((s) => s.name === 'Agents')?.hint,
      `${width}: a section opens full width, its name over it with ‹ Settings beside and the same one close, and what's in it at the top`, voice)
    f = await phoneFaults(ph.p, '.modal.settings .st-bar')
    ok(!Object.keys(f).length, `${width}: its bar fits the phone (‹ Settings, the name and the close, each a whole target, nothing cut off)`, f)
    await shot(ph.p, `${tag}phone-settings-voice-${width}`)
    await tap(ph.p.locator('.st-bar .st-back'))
    const backed = await sheet()
    await tap(ph.p.locator('.modal.settings [aria-label="Close settings"]'))
    const closed = !!(await until(async () => !(await ph.p.locator('.modal.settings').count()), 4000))
    ok(backed.title === 'Settings' && backed.rows.length === named.length && !backed.back && closed, `${width}: ‹ Settings goes back to the list, and its close closes the whole of Settings`, { backed, closed })
    await ph.p.keyboard.press('Escape')

    // Opened at a section: there, with ‹ Settings back to the list. A link to it (from Meetings, the
    // tour, a fix), ⌘K, a link from inside Settings, and a link to the section it opened at.
    const deep = [['voice', 'Voice & Meetings'], ['dictation', 'Voice & Meetings'], ['accounts', 'Model Providers'], ['machines', 'Devices'], ['notify', 'Devices'], ['permissions', 'General'], ['about', 'About & Updates']]
    const missed = []
    const open = (section) => ph.p.evaluate((section) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section } })), section)
    for (const [section, name] of deep) {
      await open(section)
      if (!(await at(ph.p, name, 4000))) { missed.push(`${section}: ${JSON.stringify(await sheet())}`); continue }
      // Back to the list, then a link to the same section again: there again.
      await tap(ph.p.locator('.st-bar .st-back'))
      await open(section)
      if (!(await at(ph.p, name, 4000))) missed.push(`${section}, again from the list: ${JSON.stringify(await sheet())}`)
      // A link from inside Settings, to another section.
      await open('mcp')
      if (!(await at(ph.p, 'MCP Servers', 4000))) missed.push(`${section}, then a link to MCP Servers: ${JSON.stringify(await sheet())}`)
      await tap(ph.p.locator('.modal.settings [aria-label="Close settings"]'))
      await until(async () => !(await ph.p.locator('.modal.settings').count()), 4000)
    }
    await ph.p.keyboard.press('Escape')
    await tap(ph.p.locator('.search-btn'))
    await ph.p.locator('.palette input').fill('Model Providers', { timeout: 4000 }).catch(() => {})
    await tap(ph.p.locator('.pal-item[data-id="a:providers"]'))
    if (!(await at(ph.p, 'Model Providers', 4000))) missed.push(`⌘K's Model Providers: ${JSON.stringify(await sheet())}`)
    ok(!missed.length, `${width}: Settings opened at a section lands on it with ‹ Settings (a link to it, again from the list, a link from inside Settings, ⌘K)`, missed)
    await shot(ph.p, `${tag}phone-settings-providers-${width}`)

    // The More tab: a whole thumb-sized row each, nothing cut off or wider than the phone.
    await ph.p.goto(kit.url)
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.waitForSelector('.m-more-row')
    const rows = await ph.p.evaluate(() => [...document.querySelectorAll('.m-more-row')].map((e) => { const r = e.getBoundingClientRect(); return { name: e.querySelector('b').innerText, h: Math.round(r.height), inside: r.left >= 0 && r.right <= window.innerWidth } }))
    ok(rows.length >= 6 && rows.every((r) => r.h >= 44 && r.inside), `${width}: More's rows are each at least 44 px tall, within the screen`, rows)
    ok(rows[0]?.name === 'Usage' && !rows.some((r) => r.name === 'Today'), `${width}: Usage is More's first row (Today is a tab of its own)`, rows.map((r) => r.name))
    ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}: nothing wider than the phone`)
    await shot(ph.p, `${tag}phone-more-${width}`)

    // Whiteboards: the list, a board from it, its own way back, and AI Assist's Draw this.
    await ph.p.locator('.m-more-row', { hasText: 'Whiteboards' }).click()
    await ph.p.waitForSelector('.wb-home', { timeout: 15000 })
    ok(await ph.p.locator('.m-more-view > .m-view-back', { hasText: 'More' }).isVisible(), `${width}: Whiteboards opens in More, with Back to More`)
    await ph.p.locator('.wb-card', { hasText: board }).click()
    ok(!!(await until(() => ph.p.locator('.excalidraw canvas').count(), 30000)), `${width}: a board opens from the list, in More`)
    ok((await ph.p.locator('.tabbar button.on').innerText()).trim() === 'More' && !(await ph.p.locator('.m-more-view > .m-view-back').count()), `${width}: still in More, with the board's own way back only`)
    await ph.p.locator('.wb-view .pane-extras button[aria-label="AI Assist"]').click()
    await ph.p.locator('.ai-menu button', { hasText: 'Draw this' }).click()
    ok(!!(await until(() => ph.p.locator('.wb-draw textarea').isVisible(), 8000)), `${width}: AI Assist's Draw this opens on the board`)
    await shot(ph.p, `${tag}phone-board-${width}`)
    await ph.p.locator('.wb-view button[aria-label="All whiteboards"]').click()
    ok(!!(await until(() => ph.p.locator('.wb-home').isVisible(), 8000)), `${width}: and its Back goes to the list`)
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    ok(!!(await until(() => ph.p.locator('.m-more-row').first().isVisible(), 4000)), `${width}: More again goes back to its list`)
    // (Going from one path to the next loads the page again, cutting off its requests and any part of
    // the app still loading, which WebKit reports as errors. A part that can't load at all fails the
    // path's own check above.)
    ok(!ph.errors.filter((e) => !/\/api\/\S+ due to access control checks|^TypeError: Importing a module script failed\.$/.test(e)).length, `${width}: no page errors`, ph.errors)
    await ph.ctx.close()
  }

  // ---------- Home, a beta feature, on ----------
  // Home is the first tab and where the phone opens, and Today is in More: each of Home's paths, and
  // Today's from More.
  await kit.api('/settings', { trials: { home: true } }, 'PATCH')
  {
    const HOME_TABS = ['Home', 'Chief', 'Agents', 'Meetings', 'More']
    const ph = await page(b, kit.url, { phone: true })
    await ph.p.setViewportSize({ width: 375, height: 860 })
    await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
    // (The tabs are the usual ones until the page has its settings, a moment after it opens.)
    const tabNames = async () => (await ph.p.locator('.tabbar button').allInnerTexts()).map((x) => x.trim().split('\n').pop().trim())
    await until(async () => (await tabNames()).join('|') === HOME_TABS.join('|'), 10000)
    const tabs = await tabNames()
    ok(tabs.join('|') === HOME_TABS.join('|'), 'Home on: Home is the first tab, Today is not a tab', tabs)
    ok(!!(await until(() => ph.p.locator('.hm').isVisible(), 10000)), 'and the phone opens at Home')
    const today = [['More › Today', '.m-more-view .m-today'], ...(IS_MAC ? [['More › Today › Calendar', '.m-more-view .m-today'], ['More › Today › Mail', '.m-more-view .m-today']] : []),
      ['More › Usage', '.m-more-view > .ustats']].map(([phone, shows]) => ({ phone, shows }))
    const routes = [...new Map([...Object.values(PATHS).filter((x) => x.trial === 'home'), ...today].map((x) => [`${x.phone}|${x.shows || ''}`, x])).values()]
    const bad = []
    for (const r of routes) {
      await ph.p.goto(kit.url)
      await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
      // Opened again, it has the usual tabs (Today one of them, not in More) until its settings come.
      await until(async () => (await tabNames()).join('|') === HOME_TABS.join('|'), 10000)
      const why = await follow(ph.p, r.phone, HOME_TABS).catch((e) => e.message)
      if (why) { bad.push(`${r.phone}: ${why}`); continue }
      if (r.shows && !(await ph.p.locator(r.shows).first().waitFor({ timeout: 8000 }).then(() => true, () => false))) bad.push(`${r.phone}: ${r.shows} doesn't show`)
    }
    ok(!bad.length, `Home on: each of its paths, and Today and Usage from More, is there on the phone and opens its place (${routes.length} of them)`, bad)
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
    await ph.p.waitForSelector('.m-more-row')
    const names = (await ph.p.locator('.m-more-row .m-more-text > b').allInnerTexts()).map((x) => x.trim())
    ok(names[0] === 'Today' && names[1] === 'Usage', 'Home on: More has Today, then Usage, a row of its own', names)
    // The desktop's Edit in Home's header: on a phone, a long press on a section's name (as on an
    // iPhone's home screen), besides Search's Edit Home above. It fits the phone.
    // (Opened again, it's at the tab it last showed: Home's tapped.)
    await ph.p.goto(kit.url)
    await ph.p.waitForSelector('.tabbar button', { timeout: 20000 })
    await until(async () => (await tabNames()).join('|') === HOME_TABS.join('|'), 10000)
    await follow(ph.p, 'Home', HOME_TABS)
    const name = ph.p.locator('.hm .hm-sec h3').first()
    await name.waitFor({ timeout: 15000 })
    const box = await name.boundingBox()
    const finger = { pointerType: 'touch', pointerId: 5, isPrimary: true, clientX: box.x + 12, clientY: box.y + box.height / 2 }
    await name.dispatchEvent('pointerdown', finger)
    await ph.p.waitForTimeout(700)
    await name.dispatchEvent('pointerup', finger).catch(() => {})
    const edit = !!(await until(() => ph.p.locator('.hm-edit').isVisible(), 4000))
    const f = edit ? await phoneFaults(ph.p, '.hm') : {}
    ok(edit && !Object.keys(f).length && !(await ph.p.locator('.hm-edit-btn').count()), 'Home on: a long press on a section\'s name is the phone\'s Edit Home, and it fits', { edit, f })
    await shot(ph.p, `${tag}phone-edit-home`)
    await ph.p.locator('.hm-done').click({ force: true })
    ok(!ph.errors.filter((e) => !/\/api\/\S+ due to access control checks|^TypeError: Importing a module script failed\.$/.test(e)).length, 'Home on: no page errors', ph.errors)
    await ph.ctx.close()
  }
  await kit.api('/settings', { trials: { home: false } }, 'PATCH')

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
