// Back and Forward (src/backForward.js, a beta feature on to start with), in the browser named by
// BRIDGE_TEST_BROWSER. Through several places (an agent's Chat and Terminal, Meetings found with
// ⌘K and its Memory, a meeting in Meetings' tab, Files and a folder in it, Today's Calendar, two
// sections of Settings), then back and forward again: by ‹ and › at the start of the top bar (each
// greyed with nowhere to go that way), by ⌘[ and ⌘] (Alt+← and Alt+→ off a Mac), but not while
// typing, by the mouse's back and forward buttons, by the browser's own Back and Forward, and as
// the desktop app asks (its mouse buttons on Windows, a swipe on a Mac). Each place comes back as it
// was: the agent's view, Meetings' tab, the meeting back in Meetings' tab, the folder, a long folder
// at its scroll. Held or right-clicked, ‹ and › list the places that way, and one picked is shown. A
// tab closed is passed over. On a phone nothing's added (its tabs, and the system's Back in the
// phone apps, are its way around), and with the beta feature off nothing changes, until it's turned
// on again in Settings › About & Updates › Beta Features.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, sleep, changeAnswer, TEST, IS_MAC } from '../lib/harness.mjs'

const { ok, done } = checks('back-forward')
const kit = await startKit('back-forward', { config: { trials: { studio: true, files: true } } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const BACK = IS_MAC ? 'Meta+BracketLeft' : 'Alt+ArrowLeft'
const FORWARD = IS_MAC ? 'Meta+BracketRight' : 'Alt+ArrowRight'
// Each part on its own: one that breaks is a failure, and the next part still runs.
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const site = path.join(kit.home, 'Projects', 'site')
  fs.mkdirSync(site, { recursive: true })
  fs.writeFileSync(path.join(site, 'notes.md'), '# Site notes\n')
  fs.mkdirSync(path.join(kit.home, 'Big'), { recursive: true })
  for (let i = 1; i <= 150; i++) fs.writeFileSync(path.join(kit.home, 'Big', `file-${String(i).padStart(3, '0')}.txt`), `${i}\n`)
  const launch = async (label, dir) => (await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: label })).paneId
  const SITE = await launch('Site', site)
  const DOCS = await launch('Docs', path.join(kit.home, 'Projects'))
  ok(!!(await until(async () => (await kit.api('/fleet')).agents.filter((a) => [SITE, DOCS].includes(a.paneId)).length === 2, 30000)), 'two agents, Site and Docs')
  const M = await kit.api('/meetings', { title: 'Quarterly plan', call: false })
  await kit.api(`/meetings/${M.id}/stop`, {})
  const today = new Date().toISOString().slice(0, 10)

  // ---------- on to start with ----------
  const conf = await kit.api('/config')
  ok(conf.trials?.['back-forward'] === true && conf.trials?.studio === true, 'Back and Forward is on to start with, beside the beta features this computer turned on', conf.trials)

  // A page at 1440 (or narrower), with Site's tab open (and more), Files' sidebar without this
  // computer's other drives (macOS asks before an app opens one).
  const open = async (o = {}) => {
    const pg = await page(b, kit.url, {
      mode: 'light', theme: 'sky', ...o,
      store: { 'cc-ws': { tabs: o.tabs || [SITE], active: SITE, side: null, split: false, group: 'main' }, ...(o.store || {}) },
      before: (c) => changeAnswer(c, /\/api\/files\/sidebar/, (j) => ({ ...j, drives: (j.drives || []).filter((d) => !d.guard) })),
    })
    if (!o.phone) await pg.p.waitForSelector('.console .seg [aria-selected="true"]', { timeout: 30000 })
    return pg
  }
  // Where the page is, as you'd say it.
  const here = (p) => p.evaluate(() => {
    const txt = (s) => document.querySelector(s)?.textContent?.trim() || ''
    const st = txt('.modal.settings .st-head h3')
    const stTab = txt('.modal.settings .st-tabs [aria-selected="true"]')
    if (st) return `Settings › ${st}${stTab ? ` › ${stTab}` : ''}`
    if (document.querySelector('.work.maxed .calv')) return 'Calendar'
    const tab = document.querySelector('.ws-tab.main')?.dataset.pane || ''
    if (tab === 'view:meetings') return `Meetings › ${txt('.mt-view .seg [aria-selected="true"]')}`
    if (tab.startsWith('view:meeting:')) return `the meeting ${txt('.ws-tab.main .ws-tab-name')}`
    if (tab === 'view:files') return `Files › ${txt('.fx-path [aria-current="location"]')}`
    if (tab.startsWith('view:')) return tab.slice(5)
    return `${txt('.ws-tab.main .ws-tab-name')} › ${txt('.console .seg [aria-selected="true"]')}`
  })
  const at = (p, want, ms = 6000) => until(async () => (await here(p)) === want, ms, 100)
  const settle = () => sleep(450) // a place is a step once it has stayed a moment
  const btn = (p, dir) => p.locator(`.topbar .nav-btn[data-dir="${dir}"]`)
  const greyed = async (p, dir) => btn(p, dir).isDisabled()
  const send = (p, e, detail) => p.evaluate(([e, d]) => window.dispatchEvent(new CustomEvent(e, { detail: d })), [e, detail])
  const tabs = (p) => p.evaluate(() => [...document.querySelectorAll('.ws-tabs-scroll > .ws-tab')].map((x) => x.dataset.pane))

  // Site's Chat → Terminal → Meetings (⌘K) → its Memory → the meeting → Files → Projects → Calendar.
  // The calendar reads macOS Calendar: off a Mac there's none, and the last place is Whiteboards.
  const LAST = IS_MAC ? 'Calendar' : 'whiteboards'
  const LAST_NAME = IS_MAC ? 'Calendar' : 'Whiteboards'
  const PLACES = ['Site › Chat', 'Site › Terminal', 'Meetings › Meetings', 'Meetings › Memory', 'the meeting Quarterly plan', 'Files › Home', 'Files › Projects', LAST]
  const walk = async (p) => {
    const went = [await here(p)]
    await p.locator('.console .seg [role="tab"]', { hasText: 'Terminal' }).click()
    await at(p, 'Site › Terminal'); await settle(); went.push(await here(p))
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').fill('Meetings')
    await p.locator('.palette input').press('Enter')
    await at(p, 'Meetings › Meetings'); await settle(); went.push(await here(p))
    await p.locator('.mt-view .seg [data-view="memory"]').click()
    await at(p, 'Meetings › Memory'); await settle(); went.push(await here(p))
    await send(p, 'bridge-open-meeting', { id: M.id })
    await at(p, 'the meeting Quarterly plan'); await settle(); went.push(await here(p))
    await send(p, 'bridge-open-agent', { paneId: 'view:files' })
    await p.locator('.fx-row[data-name="Projects"]').waitFor({ timeout: 10000 })
    await at(p, 'Files › Home'); await settle(); went.push(await here(p))
    await p.locator('.fx-row[data-name="Projects"]').dblclick()
    await p.locator('.fx-row[data-name="site"]').waitFor({ timeout: 10000 })
    await at(p, 'Files › Projects'); await settle(); went.push(await here(p))
    if (IS_MAC) await send(p, 'bridge-open-event', { date: today })
    else await send(p, 'bridge-open-agent', { paneId: 'view:whiteboards' })
    await at(p, LAST); await settle(); went.push(await here(p))
    return went
  }

  // ---------- by ‹ and › ----------
  await part('the buttons', async () => {
    const { ctx, p, errors } = await open()
    await btn(p, 'back').waitFor({ timeout: 10000 })
    ok(await greyed(p, 'back') && await greyed(p, 'forward'), 'a window just opened: ‹ and › at the start of the top bar, both greyed, with nowhere to go yet')
    const went = await walk(p)
    ok(JSON.stringify(went) === JSON.stringify(PLACES), `through eight places: Site's Chat and Terminal, Meetings found with ⌘K and its Memory, a meeting, Files and a folder in it, ${LAST_NAME}`, went)
    ok(!(await greyed(p, 'back')) && await greyed(p, 'forward'), 'at the last: ‹ ready, › greyed')
    const backs = []
    for (let i = PLACES.length - 2; i >= 0; i--) {
      await btn(p, 'back').click()
      backs.push(await at(p, PLACES[i]) ? PLACES[i] : await here(p))
      if (PLACES[i] === 'Meetings › Memory') {
        const strip = await tabs(p)
        ok(strip.includes('view:meetings') && !strip.some((x) => x.startsWith('view:meeting:')), '‹ from the meeting: Meetings again in the tab the meeting had taken, at its Memory', strip)
      }
    }
    ok(JSON.stringify(backs) === JSON.stringify(PLACES.slice(0, -1).reverse()), '‹ goes back through each, one at a time, each as it was', backs)
    ok(await greyed(p, 'back') && !(await greyed(p, 'forward')), 'at the first: ‹ greyed, › ready')
    const fwds = []
    for (let i = 1; i < PLACES.length; i++) {
      await btn(p, 'forward').click()
      fwds.push(await at(p, PLACES[i]) ? PLACES[i] : await here(p))
      if (PLACES[i] === 'the meeting Quarterly plan') {
        const strip = await tabs(p)
        ok(strip.includes(`view:meeting:${M.id}`) && !strip.includes('view:meetings'), '› to the meeting: it takes Meetings\' tab again', strip)
      }
      if (PLACES[i] === 'Files › Projects') ok(!!(await until(async () => (await p.locator('.fx-row[data-name="site"]').count()) === 1, 6000, 100)), '› to Files › Projects: that folder, its files listed')
    }
    ok(JSON.stringify(fwds) === JSON.stringify(PLACES.slice(1)), '› goes forward through each again', fwds)
    ok(!(await greyed(p, 'back')) && await greyed(p, 'forward'), 'at the last again: › greyed')

    // ---------- held or right-clicked: the places ----------
    await btn(p, 'back').click({ button: 'right' })
    const menu = p.locator('.nav-menu[role="menu"]')
    await menu.waitFor({ timeout: 3000 })
    const listed = await menu.locator('[role="menuitem"]').allInnerTexts()
    ok(listed.length === 7 && /Files › Projects/.test(listed[0]) && /Files › Home/.test(listed[1]) && /Quarterly plan/.test(listed[2]) && /Meetings › Memory/.test(listed[3]) && /Site › Terminal/.test(listed[5]) && /Site › Chat/.test(listed[6]),
      'right-clicking ‹ lists the places before, nearest first, each named', listed)
    await shot(p, `${tag}back-forward-list`, { clip: { x: 0, y: 0, width: 640, height: 360 } })
    await menu.locator('[role="menuitem"]', { hasText: 'Meetings › Memory' }).click()
    ok(!!(await at(p, 'Meetings › Memory')) && !(await menu.count()), 'one picked there is shown, and the list goes', await here(p))
    ok(!(await greyed(p, 'forward')), 'and › can go forward again from there')
    const box = await btn(p, 'forward').boundingBox()
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await p.mouse.down()
    await sleep(700)
    await p.mouse.up()
    const ahead = await menu.locator('[role="menuitem"]').allInnerTexts().catch(() => [])
    ok(ahead.length === 4 && /Quarterly plan/.test(ahead[0]) && new RegExp(LAST_NAME).test(ahead[3]) && (await here(p)) === 'Meetings › Memory', 'holding › lists the places after, without going on', ahead)
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => !(await menu.count()), 2000)), 'Esc closes the list')
    ok(errors.length === 0, 'the buttons: no page errors', errors)
    await ctx.close()
  })

  // ---------- the keys, the mouse, the browser and the desktop app ----------
  await part('keys, mouse, browser', async () => {
    const { ctx, p, errors } = await open()
    await walk(p)
    // Settings: two sections, a place each.
    await p.keyboard.press('ControlOrMeta+Comma')
    await at(p, 'Settings › General'); await settle()
    await p.locator('.st-nav-item', { hasText: 'Appearance' }).click()
    await at(p, 'Settings › Appearance'); await settle()
    await p.keyboard.press(BACK)
    ok(!!(await at(p, 'Settings › General')), `${BACK}: back to Settings › General`, await here(p))
    await p.keyboard.press(BACK)
    ok(!!(await at(p, LAST)), `${BACK} again: Settings closes, back at ${LAST_NAME}`, await here(p))
    await p.keyboard.press(FORWARD)
    ok(!!(await at(p, 'Settings › General')), `${FORWARD}: Settings opens again, at General`, await here(p))
    await p.keyboard.press(FORWARD)
    ok(!!(await at(p, 'Settings › Appearance')), `${FORWARD} again: at Appearance`, await here(p))
    // Voice & Meetings' tabs: a place each, too.
    await p.locator('.st-nav-item', { hasText: 'Voice & Meetings' }).click()
    await at(p, 'Settings › Voice & Meetings › Meetings'); await settle()
    await p.locator('.st-tabs [role="tab"]', { hasText: 'Dictation' }).click()
    await at(p, 'Settings › Voice & Meetings › Dictation'); await settle()
    await p.keyboard.press(BACK)
    ok(!!(await at(p, 'Settings › Voice & Meetings › Meetings')), `${BACK} from Voice & Meetings' Dictation tab: its Meetings tab`, await here(p))
    await p.keyboard.press(FORWARD)
    ok(!!(await at(p, 'Settings › Voice & Meetings › Dictation')), `${FORWARD}: Dictation again`, await here(p))
    await p.keyboard.press(BACK)
    await at(p, 'Settings › Voice & Meetings › Meetings')
    await p.keyboard.press(BACK)
    await at(p, 'Settings › Appearance')
    await p.keyboard.press(BACK)
    await at(p, 'Settings › General')
    await p.keyboard.press(BACK)
    await at(p, LAST)
    // Not while typing: ⌘K's box.
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').fill('agent')
    await p.locator('.palette input').press(BACK)
    await sleep(500)
    ok((await here(p)) === LAST && (await p.locator('.palette').count()) === 1, `${BACK} while typing in a box does nothing but what it does there`, await here(p))
    await p.keyboard.press('Escape')
    await sleep(200)

    // The mouse's back and forward buttons (3 and 4), which the browser isn't left to.
    const mouse = (button) => p.evaluate((button) => {
      const opts = { button, buttons: 0, bubbles: true, cancelable: true, view: window }
      document.body.dispatchEvent(new MouseEvent('mousedown', opts))
      const up = new MouseEvent('mouseup', opts)
      document.body.dispatchEvent(up)
      return up.defaultPrevented
    }, button)
    ok(await mouse(3) && !!(await at(p, 'Files › Projects')), 'the mouse\'s back button: back to Files › Projects (and the browser\'s own isn\'t used)', await here(p))
    ok(await mouse(3) && !!(await at(p, 'Files › Home')), 'again: Files › Home', await here(p))
    ok(await mouse(4) && !!(await at(p, 'Files › Projects')), 'its forward button: Files › Projects', await here(p))

    // The browser's own Back and Forward (popstate): the same steps.
    await p.goBack()
    ok(!!(await at(p, 'Files › Home')), 'the browser\'s Back: Files › Home', await here(p))
    await p.goBack()
    ok(!!(await at(p, 'the meeting Quarterly plan')), 'and again: the meeting', await here(p))
    await p.goForward()
    ok(!!(await at(p, 'Files › Home')), 'the browser\'s Forward: Files › Home', await here(p))
    ok(p.url() === `${kit.url}/`, 'the address stays the app\'s own', p.url())

    // The desktop app: its mouse buttons on Windows and a swipe on a Mac come as bridge-nav.
    await send(p, 'bridge-nav', 'back')
    ok(!!(await at(p, 'the meeting Quarterly plan')), 'the desktop app\'s back (a mouse button on Windows, a swipe on a Mac): the meeting', await here(p))
    await send(p, 'bridge-nav', 'forward')
    ok(!!(await at(p, 'Files › Home')), 'and its forward: Files › Home', await here(p))
    ok(errors.length === 0, 'keys, mouse, browser: no page errors', errors)
    await ctx.close()
  })

  // ---------- a long folder, at its scroll ----------
  await part('scroll', async () => {
    const { ctx, p, errors } = await open()
    await send(p, 'bridge-open-agent', { paneId: 'view:files' })
    await p.locator('.fx-row[data-name="Big"]').dblclick({ timeout: 10000 })
    await p.locator('.fx-row[data-name="file-150.txt"]').waitFor({ timeout: 10000 })
    await settle()
    await p.locator('.fx-body').evaluate((el) => { el.scrollTop = 900 })
    await sleep(300)
    await send(p, 'bridge-open-agent', { paneId: 'view:meetings' })
    await at(p, 'Meetings › Meetings'); await settle()
    await btn(p, 'back').click()
    await at(p, 'Files › Big')
    const top = await until(async () => { const v = await p.locator('.fx-body').evaluate((el) => el.scrollTop); return v > 850 ? v : null }, 4000, 100)
    ok(!!top && top < 950, '‹ back to a long folder: at its scroll, as it was', top || await p.locator('.fx-body').evaluate((el) => el.scrollTop))
    ok(errors.length === 0, 'scroll: no page errors', errors)
    await ctx.close()
  })

  // ---------- a tab closed ----------
  await part('a closed tab', async () => {
    const { ctx, p, errors } = await open({ tabs: [SITE, DOCS] })
    const start = await here(p)
    await p.locator(`.ws-tab[data-pane="${DOCS}"]`).click()
    await until(async () => /^Docs › /.test(await here(p)), 6000, 100); await settle()
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').fill('Meetings')
    await p.locator('.palette input').press('Enter')
    await at(p, 'Meetings › Meetings'); await settle()
    await p.locator(`.ws-tab[data-pane="${SITE}"]`).click()
    await at(p, start); await settle()
    await p.locator(`.ws-tab[data-pane="${DOCS}"]`).hover()
    await p.locator(`.ws-tab[data-pane="${DOCS}"] .ws-tab-x`).click()
    await until(async () => !(await tabs(p)).includes(DOCS), 6000, 100)
    await btn(p, 'back').click({ button: 'right' })
    const listed = await p.locator('.nav-menu [role="menuitem"]').allInnerTexts()
    ok(listed.length === 2 && /Meetings/.test(listed[0]) && /Site/.test(listed[1]) && !listed.some((x) => /Docs/.test(x)), 'Docs\' tab closed: ‹\'s list leaves it out', listed)
    await p.keyboard.press('Escape')
    await btn(p, 'back').click()
    ok(!!(await at(p, 'Meetings › Meetings')), '‹: Meetings', await here(p))
    await btn(p, 'back').click()
    ok(!!(await at(p, start)) && !(await tabs(p)).includes(DOCS), '‹ again passes over Docs, closed, to Site, and doesn\'t open it again', { at: await here(p), tabs: await tabs(p) })
    ok(await greyed(p, 'back'), 'and ‹ is greyed: nothing before that is left')
    await btn(p, 'forward').click()
    await at(p, 'Meetings › Meetings')
    await p.goBack()
    ok(!!(await at(p, start)), 'the browser\'s own Back passes over it too', await here(p))
    ok(errors.length === 0, 'a closed tab: no page errors', errors)
    await ctx.close()
  })

  // ---------- the top bar, as it looks ----------
  await part('the top bar', async () => {
    for (const [look, width] of [[{ mode: 'light', theme: 'sky' }, 1440], [{ mode: 'dark', theme: 'midnight' }, 1440], [{ mode: 'light', theme: 'sky' }, 1024]]) {
      const name = `${look.mode} at ${width}`
      const { ctx, p, errors } = await open({ ...look, width, tabs: [SITE, 'view:meetings'] })
      await p.locator('.ws-tab[data-pane="view:meetings"]').click()
      await at(p, 'Meetings › Meetings'); await settle()
      await p.locator(`.ws-tab[data-pane="${SITE}"]`).click()
      await settle()
      await btn(p, 'back').click()
      await at(p, 'Meetings › Meetings')
      const g = await p.evaluate(() => {
        const r = (s) => document.querySelector(s)?.getBoundingClientRect()
        const bar = document.querySelector('.topbar')
        return { rail: r('.top-left .rail-btn'), back: r('.nav-btn[data-dir="back"]'), fwd: r('.nav-btn[data-dir="forward"]'), search: r('.search-btn'), over: bar.scrollWidth - bar.clientWidth }
      })
      ok(g.back && g.fwd && g.back.left >= g.rail.right && g.fwd.left >= g.back.right && g.fwd.right < g.search.left && g.over <= 0,
        `${name}: ‹ and › after the sidebar's button, before search, nothing in the bar cut off`, g)
      ok(!(await greyed(p, 'back')) && !(await greyed(p, 'forward')), `${name}: both ready in the middle of the way`)
      await p.mouse.move(width / 2, 500)
      await sleep(200)
      await shot(p, `${tag}back-forward-topbar-${look.mode}-${width}`, { clip: { x: 0, y: 0, width, height: 64 } })
      ok(errors.length === 0, `${name}: no page errors`, errors)
      await ctx.close()
    }
  })

  // ---------- a phone: nothing added ----------
  await part('phone', async () => {
    const { ctx, p, errors } = await open({ phone: true })
    await p.locator('.tabbar').waitFor({ timeout: 20000 })
    const was = await p.evaluate(() => history.length)
    await p.locator('.tabbar button', { hasText: 'Agents' }).click()
    await p.locator('.board, .m-body').first().waitFor()
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    await sleep(600)
    await p.locator('.tabbar button', { hasText: 'Chief' }).click()
    await sleep(600)
    ok((await p.locator('.nav-btn').count()) === 0, 'a phone: no ‹ and › in its top bar (its tabs are its way around)')
    ok((await p.evaluate(() => history.length)) === was, 'and nothing added to the browser\'s history, so the system\'s Back in the phone apps does what it did', { was, now: await p.evaluate(() => history.length) })
    ok(errors.length === 0, 'phone: no page errors', errors)
    await ctx.close()
  })

  // ---------- turned off: nothing changes ----------
  await part('off', async () => {
    await kit.api('/settings', { trials: { 'back-forward': false } }, 'PATCH')
    const { ctx, p, errors } = await open()
    const was = await p.evaluate(() => history.length)
    await p.locator('.console .seg [role="tab"]', { hasText: 'Terminal' }).click()
    await at(p, 'Site › Terminal'); await settle()
    await send(p, 'bridge-open-agent', { paneId: 'view:meetings' })
    await at(p, 'Meetings › Meetings'); await settle()
    ok((await p.locator('.nav-btn').count()) === 0, 'turned off: no ‹ and › in the top bar')
    await p.keyboard.press(BACK)
    await p.evaluate(() => { const o = { button: 3, bubbles: true, cancelable: true }; document.body.dispatchEvent(new MouseEvent('mousedown', o)); document.body.dispatchEvent(new MouseEvent('mouseup', o)) })
    await send(p, 'bridge-nav', 'back')
    await sleep(600)
    ok((await here(p)) === 'Meetings › Meetings' && (await p.evaluate(() => history.length)) === was, 'and nothing changes: the keys, the mouse\'s button and the desktop app\'s back go nowhere, and nothing is added to the browser\'s history', { at: await here(p), was, now: await p.evaluate(() => history.length) })
    await p.keyboard.press('ControlOrMeta+Comma')
    await p.locator('.st-nav-item', { hasText: 'About & Updates' }).click()
    const box = p.locator('[data-setting="beta"] label', { hasText: 'Back and Forward' }).locator('input')
    await box.scrollIntoViewIfNeeded()
    ok(!(await box.isChecked()), 'Settings › About & Updates › Beta Features: Back and Forward, off')
    await box.check()
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => (await p.locator('.topbar .nav-btn').count()) === 2, 8000)), 'turned on there: ‹ and › in the top bar at once')
    ok(errors.length === 0, 'off: no page errors', errors)
    await ctx.close()
    ok((await kit.api('/config')).trials['back-forward'] === true, 'and kept on')
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
