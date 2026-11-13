// The tabs above the agents, as Chrome's are, in the browser named by BRIDGE_TEST_BROWSER, in a
// light and a dark look. With 20 open on a 1440 window every tab is on screen, all as wide as each
// other, the one on screen with its name and ×; with 30 on a 1024 window the others are their icons
// (an agent's still saying it needs you), and the ones still out of sight are counted on Search
// tabs, whose list (every open tab, found by typing) opens one, which comes into view. A moment's
// hover shows a card with the tab's whole name and its space (no browser tooltip), the next tab's at
// once, gone when the pointer leaves. A tab closed with the pointer leaves the others as wide as they
// were until the pointer leaves the strip, so the next tab's × is under it; closing the tab on screen
// shows the one after it; Ctrl+Shift+→ and dragging move a tab; side by side, both tabs on screen
// keep their names and ×.
// A right-click on a tab opens its menu, as wide as what it says: a new agent in its space, open it
// beside, its colors (No color and Chrome's nine, each in the look's own), Close, Close other tabs
// and Close tabs to the right. Red puts a red line under the tab, still there after a reload. From
// the keyboard: Shift+F10 or the menu key opens it, ↓ and → move through it, Esc closes it with the
// focus back on the tab; near the window's right and bottom edges it opens to the pointer's left and
// above it. Close tabs to the right and Close other tabs close those, the agents still in the sidebar.
// With Tab Groups on (a beta feature): each space's chip in its own color, before its tabs, a line in
// that color under them; a click folds the group to its chip (how many, the most urgent dot), another
// unfolds it; its right-click menu, as wide as what it says (not stretched to the window's edge),
// folds it, starts an agent in that space, has Chrome's nine colors and closes its tabs; a color
// picked there, or in one of its tabs' menus, colors its chip and its line, still after a reload;
// another computer's group is grey, at the end.
// Your own groups, as Chrome's: Add tab to new group puts a chip before the tab, in a color, and opens
// the group's editor under it (a dialog: its name focused, the chip showing it as it's typed, then a
// menu of the nine colors and New agent in group, Ungroup, Close group); ↓ → ↑ get round it, Enter or
// a click elsewhere closes it. Add tab to group › opens its own menu (New group and the groups there
// are), beside the menu or on its left by the window's edge, from the pointer or →, ← and Esc back.
// Remove from group, dropping a tab between two of a group's tabs (in) or dragging it out (out),
// Ctrl+Shift+←/→ at a group's edge (out, then back in), a click on the chip (folds it), a reload (all
// kept), Ungroup, a group with no name, Close group, and the group gone with its last tab. With Tab
// Groups on, a group of yours holds tabs of two spaces, the others still by space, and a space's chip
// keeps its own menu. Pin tab: to the start, its icon and dot alone, no ×; Close other tabs and Close
// tabs to the right leave pinned tabs; a reload keeps them. Rename…: in the tab, Enter keeps it (the
// sidebar has it too), Esc puts it back, one that doesn't take says why; a view has no Rename. Every
// menu and editor is as wide as what it says (320px at most), inside the window.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, withoutCutOff, noServiceWorker, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('tab-strip')
const kit = await startKit('tab-strip')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
// Each part on its own: one that breaks is a failure, and the next part still runs.
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
try {
  await kit.api('/setup', { name: 'Tester' })
  // Look for agents again: the server looked before the stand-in Claude Code was there.
  await kit.api('/agents/catalog')
  // Three spaces: shop (one agent asking), Reporting and billing-api.
  const launch = async (project, prompt, label, workspaceId) => {
    const dir = path.join(kit.home, 'code', project)
    fs.mkdirSync(dir, { recursive: true })
    return (await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label, ...(workspaceId ? { workspaceId } : { newSpace: project }), ...(prompt ? { prompt } : {}) })).paneId
  }
  const spaceOf = (id) => until(async () => (await kit.api('/fleet')).agents.find((a) => a.paneId === id)?.workspaceId, 15000)
  const A = {}
  A.checkout = await launch('shop', 'idle', 'Checkout copy')
  const shop = await spaceOf(A.checkout)
  A.deploy = await launch('shop', 'ask npm run deploy', 'Deploy', shop)
  A.weekly = await launch('Reporting', 'idle', 'Weekly numbers')
  const reporting = await spaceOf(A.weekly)
  A.board = await launch('Reporting', 'idle', 'Board deck', reporting)
  A.rounding = await launch('billing-api', 'idle', 'Fix rounding')
  const billing = await spaceOf(A.rounding)
  A.invoices = await launch('billing-api', 'idle', 'Invoices', billing)
  ok(!!(await until(async () => (await kit.api('/fleet')).agents.filter((a) => Object.values(A).includes(a.paneId)).length === 6, 30000)), 'six agents in three spaces')
  const studio = (name) => `view:studio:${encodeURIComponent('place:docs')}:${encodeURIComponent(`/docs/${name}`)}`
  const VIEWS = ['view:meetings', 'view:dictations', 'view:map', 'view:whiteboards', studio('PE_Q4_2026_Priorities_v6a.docx'), studio('Budget 2027.xlsx'), studio('Launch plan.pptx'), studio('Notes.md'), studio('Pricing.docx'),
    studio('Contract.pdf'), studio('Roadmap.md'), studio('Org chart.md'), studio('Hiring plan.docx'), studio('Offsite.pptx'), studio('Q3 numbers.xlsx'), studio('Press kit.md'), studio('Brand.pdf'), studio('Minutes.docx'), studio('Retro.md'), studio('Vendors.xlsx'), studio('Board memo.docx'), studio('Pitch.pptx'), studio('Wiki.md'), studio('Terms.pdf')]
  const ws = (tabs, active, more = {}) => ({ 'cc-ws': { tabs, active, side: null, split: false, group: 'main', ...more } })
  const trial = (on) => kit.api('/settings', { trials: { 'tab-groups': on, studio: true } }, 'PATCH')
  // The strip as it is: each tab's edges, how wide it and its name are, whether its × shows; the
  // strip's own edges, how far it scrolls, and what Search tabs says.
  const geo = (p) => p.evaluate(() => {
    const s = document.querySelector('.ws-tabs-scroll')
    const r = s.getBoundingClientRect()
    const shows = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'
    const tabs = [...s.querySelectorAll(':scope > .ws-tab')].map((x) => {
      const bx = x.getBoundingClientRect()
      const n = x.querySelector('.ws-tab-name')
      return { id: x.dataset.pane, main: x.classList.contains('main'), left: Math.round(bx.left), right: Math.round(bx.right), w: Math.round(bx.width), name: shows(n) ? Math.round(n.getBoundingClientRect().width) : 0, text: n?.textContent || '', x: shows(x.querySelector('.ws-tab-x')), title: x.getAttribute('title') }
    })
    return { left: Math.round(r.left), right: Math.round(r.right), over: s.scrollWidth - s.clientWidth, tabs, search: document.querySelector('.tab-search-btn')?.getAttribute('aria-label') || '' }
  })
  const open = async (look, store, width = 1440) => {
    const pg = await page(b, kit.url, { ...look, width, height: 900, store })
    await pg.p.waitForSelector('.ws-tab', { timeout: 20000 }).catch(() => {})
    await until(async () => (await pg.p.locator('.ws-tab').count()) === store['cc-ws'].tabs.length, 15000)
    await pg.p.waitForTimeout(400)
    return pg
  }
  const strip = (p, name) => p.locator('.ws-tabs').boundingBox().then((bx) => shot(p, name, { clip: { x: 0, y: 0, width: p.viewportSize().width, height: Math.round((bx?.y || 60) + (bx?.height || 40) + 12) } }))
  // A page whose tabs are put in once, before it first opens, so a reload shows what it saved itself
  // (open's store is put back on every load).
  const seeded = async (look, w, more = {}) => {
    const pg = await page(b, kit.url, { ...look, width: 1440, height: 900, store: more, before: (ctx) => ctx.addInitScript((x) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('cc-ws', JSON.stringify(x)) } } catch { /* no storage */ } }, w['cc-ws']) })
    await pg.p.waitForSelector('.ws-tab', { timeout: 20000 }).catch(() => {})
    await until(async () => (await pg.p.locator('.ws-tab').count()) === w['cc-ws'].tabs.length, 15000)
    await pg.p.waitForTimeout(400)
    return pg
  }
  const clear = (c) => !!c && !/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/.test(c)
  // A menu's edges, and how wide what it says is (each item's, the colors' row's).
  const menuBox = (m) => m.evaluate((e) => {
    const r = e.getBoundingClientRect()
    const most = Math.max(...[...e.querySelectorAll('.menu-item, .tab-menu-colors')].map((x) => { const g = document.createRange(); g.selectNodeContents(x); return g.getBoundingClientRect().width }))
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), most: Math.round(most), width: innerWidth, height: innerHeight }
  })
  // As wide as what it says (and never wider than a menu needs: the menu's own right edge in
  // styles.css once stretched it to the window's), inside the window.
  const compact = (m) => !!m && m.w <= m.most + 40 && m.w <= 320 && m.left >= 0 && m.top >= 0 && m.right <= m.width && m.bottom <= m.height
  const focused = (p) => p.evaluate(() => { const e = document.activeElement; return e?.closest('.tab-menu') ? (e.getAttribute('aria-label') || e.textContent.trim()) : e?.dataset?.pane || (e?.classList.contains('ws-group') ? `chip:${e.innerText.trim()}` : e?.tagName) })
  // Chrome's colors in each look (tabstrip.css), as the browser gives them.
  const RED = { light: 'rgb(217, 48, 37)', dark: 'rgb(242, 139, 130)' }
  const L = { mode: 'light', theme: 'sky' }
  // The strip from left to right, each tab by a short name: a group's chip as [its name, and how
  // many when folded], a tab in a group with a chip *, a pinned one ^.
  const NICK = { ...Object.fromEntries(Object.entries(A).map(([k, v]) => [v, k])), 'view:meetings': 'meetings', 'view:map': 'map' }
  const lay = (p) => p.locator('.ws-tabs-scroll').evaluate((s, nick) => [...s.children].map((x) => (x.classList.contains('ws-group')
    ? `[${x.querySelector('.ws-group-name')?.textContent || ''}${x.querySelector('.ws-group-n') ? ` ${x.querySelector('.ws-group-n').textContent}` : ''}]`
    : `${nick[x.dataset.pane] || x.dataset.pane}${x.classList.contains('grouped') ? '*' : ''}${x.classList.contains('pinned') ? '^' : ''}`)).join(' '), NICK).catch((e) => e.message)
  const untilLay = async (p, want, ms = 3000) => !!(await until(async () => (await lay(p)) === want, ms, 100))
  // A tab's menu; an item in it, by its words exactly; a group of yours from Add tab to group ›.
  const exact = (w) => new RegExp(`^\\s*${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
  const menuOf = async (p, id) => {
    await p.locator(`.ws-tab[data-pane="${id}"]`).click({ button: 'right' })
    const m = p.locator('.tab-menu')
    await m.waitFor({ timeout: 3000 }).catch(() => {})
    return m
  }
  const pick = async (p, id, label) => (await menuOf(p, id)).locator('.menu-item', { hasText: exact(label) }).first().click({ timeout: 3000 })
  const addTo = async (p, id, group) => {
    await (await menuOf(p, id)).locator('[aria-haspopup="menu"]').hover({ timeout: 3000 })
    await p.locator('.tab-submenu .menu-item', { hasText: exact(group) }).click({ timeout: 3000 })
  }
  const itemsOf = async (m) => (await m.locator('.menu-item').allInnerTexts().catch(() => [])).map((x) => x.trim())
  // Dragged onto the right (or left) half of another tab, as a person drags it, the pointer settling
  // there a moment (WebKit drops only after a move over where it's marked).
  const dragOnto = async (p, from, onto, after) => {
    const fb = await p.locator(`.ws-tab[data-pane="${from}"]`).boundingBox(), ob = await p.locator(`.ws-tab[data-pane="${onto}"]`).boundingBox()
    const x = after ? ob.x + ob.width - 12 : ob.x + 12
    await p.mouse.move(fb.x + 20, fb.y + 14)
    await p.mouse.down()
    await p.mouse.move(fb.x + 40, fb.y + 14, { steps: 4 })
    await p.mouse.move(x, ob.y + 14, { steps: 8 })
    await p.mouse.move(x + (after ? -2 : 2), ob.y + 14, { steps: 2 })
    await p.mouse.up()
  }
  // Somewhere to click that does nothing itself (no button, link, field or tab under it).
  const quiet = (p) => p.evaluate(() => [[700, 860], [1000, 860], [700, 560], [300, 860], [1100, 500]].find(([x, y]) => { const e = document.elementFromPoint(x, y); return e && !e.closest('button, a, input, textarea, select, [role="button"], [role="tab"], [tabindex], [contenteditable], .xterm, .tab-menu') }) || [5, 895])

  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.mode
    await trial(false)
    // ---------- 20 tabs on a 1440 window: every one on screen ----------
    await part(`${t}: 20 tabs`, async () => {
      const tabs = [...VIEWS.slice(0, 14), ...Object.values(A)]
      const { ctx, p, errors } = await open(look, ws(tabs, A.weekly))
      const g = await geo(p)
      const outside = g.tabs.filter((x) => x.left < g.left - 1 || x.right > g.right + 1).map((x) => x.id)
      ok(g.tabs.length === 20 && !outside.length && g.over <= 1, `${t}: with 20 tabs open at 1440, every tab is inside the strip, none past its edge`, { outside, over: g.over, strip: [g.left, g.right], n: g.tabs.length })
      const main = g.tabs.find((x) => x.main)
      ok(main?.text === 'Weekly numbers' && main.name >= 50 && main.x, `${t}: the tab on screen keeps its name, readable, and its ×`, main)
      const others = g.tabs.filter((x) => !x.main).map((x) => x.w)
      ok(Math.max(...others) - Math.min(...others) <= 1, `${t}: the others all as wide as each other`, others)
      ok(g.search === 'Search tabs' && g.tabs.every((x) => !x.title), `${t}: none out of sight (Search tabs counts none), and no browser tooltip on a tab`, { search: g.search, titles: g.tabs.filter((x) => x.title).map((x) => x.title) })
      await strip(p, `${tag}tab-strip-20-${t}`)
      ok(errors.length === 0, `${t}: 20 tabs: no page errors`, errors)
      await ctx.close()
    })

    // ---------- A moment's hover: the tab's card ----------
    await part(`${t}: hover card`, async () => {
      const { ctx, p, errors } = await open(look, ws(['view:meetings', A.checkout, A.deploy, A.weekly, A.board], 'view:meetings'))
      const weekly = p.locator(`.ws-tab[data-pane="${A.weekly}"]`)
      ok(!(await weekly.getAttribute('title')), `${t}: a tab has no browser tooltip`)
      await weekly.hover()
      const card = p.locator('.tab-card')
      ok(!!(await until(() => card.isVisible(), 3000)) && /Weekly numbers/.test(await card.innerText()) && /Reporting/.test(await card.innerText()), `${t}: hovering a tab for a moment shows its card: its name and its space`, await card.innerText().catch(() => 'no card'))
      ok((await weekly.getAttribute('aria-describedby')) === 'ws-tab-card', `${t}: the card describes the tab to a screen reader too`)
      await shot(p, `${tag}tab-strip-card-${t}`, { clip: { x: 0, y: 0, width: 1440, height: 260 } })
      await p.locator(`.ws-tab[data-pane="${A.board}"]`).hover()
      ok(!!(await until(async () => /Board deck/.test(await card.innerText().catch(() => '')), 400, 50)), `${t}: moving to the next tab shows its card at once`, await card.innerText().catch(() => 'no card'))
      await p.mouse.move(700, 600)
      ok(!!(await until(async () => !(await card.count()), 2000)), `${t}: and leaving the strip hides it`)
      ok(errors.length === 0, `${t}: hover card: no page errors`, errors)
      await ctx.close()
    })

    // ---------- A right-click on a tab: its menu, and its color ----------
    await part(`${t}: tab menu`, async () => {
      const { ctx, p, errors } = await seeded(look, ws(['view:meetings', A.checkout, A.weekly, A.board, 'view:map'], 'view:meetings'))
      const weekly = p.locator(`.ws-tab[data-pane="${A.weekly}"]`)
      const menu = p.locator('.tab-menu')
      await weekly.click({ button: 'right' })
      await menu.waitFor({ timeout: 5000 }).catch(() => {})
      const items = (await menu.locator('.menu-item').allInnerTexts().catch(() => [])).map((x) => x.trim())
      ok(items.join('|') === 'New agent in Reporting|Open beside the current tab|Add tab to new group|Rename…|Pin tab|Close|Close other tabs|Close tabs to the right', `${t}: a right-click on a tab opens its menu: a new agent in its space, open it beside, a new group, rename, pin, close it, the others, those to its right`, items)
      const mb = await menuBox(menu)
      ok(compact(mb), `${t}: the menu is as wide as what it says, inside the window`, mb)
      const swatches = await menu.locator('.tab-menu-color').evaluateAll((es) => es.map((e) => ({ name: e.getAttribute('aria-label'), color: e.dataset.color || null, bg: getComputedStyle(e).backgroundColor, on: e.getAttribute('aria-checked') })))
      const filled = swatches.filter((x) => x.color)
      ok(swatches.length === 10 && swatches[0].name === 'No color' && swatches[0].on === 'true' && filled.length === 9 && new Set(filled.map((x) => x.bg)).size === 9 && filled.every((x) => clear(x.bg)) && filled.find((x) => x.color === 'red')?.bg === RED[t], `${t}: its colors: No color (ticked), then Chrome's nine, each in this look's own`, swatches)
      await shot(p, `${tag}tab-strip-tab-menu-${t}`, { clip: { x: 0, y: 0, width: 1440, height: 420 } })
      // The line under it, if there is one (asked of the tab, so none doesn't wait for one to come).
      const line = () => weekly.evaluate((e) => { const l = e.querySelector('.ws-tab-line'); return l ? getComputedStyle(l).backgroundColor : null }).catch(() => null)
      ok(!(await line()), `${t}: no line under it before a color is picked`)
      await menu.locator('[data-color="red"]').click()
      ok(!!(await until(async () => (await line()) === RED[t], 3000)) && (await menu.locator('[data-color="red"]').getAttribute('aria-checked')) === 'true', `${t}: Red puts a red line under the tab, the menu still open with Red ticked`, await line())
      ok((await p.locator('.ws-tab .ws-tab-line').count()) === 1, `${t}: the other tabs have no line`)
      await p.keyboard.press('Escape')
      ok(!!(await until(async () => !(await menu.count()), 2000)), `${t}: Esc closes the menu`)
      // Kept with the window's tabs: after a reload, still red.
      await until(async () => /"red"/.test(await p.evaluate(() => localStorage.getItem('cc-ws'))), 3000)
      await p.reload()
      await p.waitForSelector(`.ws-tab[data-pane="${A.weekly}"]`, { timeout: 20000 }).catch(() => {})
      ok(!!(await until(async () => (await line()) === RED[t], 8000)), `${t}: after a reload the tab's line is still red`, await line())
      // No color takes it off.
      await weekly.click({ button: 'right' })
      await menu.locator('.tab-menu-none').click()
      ok(!!(await until(async () => !(await line()), 3000)), `${t}: No color takes the line off`, await line())
      await p.keyboard.press('Escape')
      ok(withoutCutOff(errors).length === 0, `${t}: tab menu: no page errors`, errors)
      await ctx.close()
    })

    // ---------- 30 tabs on a 1024 window: the rest out of sight, and Search tabs ----------
    await part(`${t}: 30 tabs`, async () => {
      const tabs = [...VIEWS, ...Object.values(A)]
      const { ctx, p, errors } = await open(look, ws(tabs, A.checkout), 1024)
      const g = await geo(p)
      const main = g.tabs.find((x) => x.main)
      const iconsOnly = g.tabs.filter((x) => !x.main).every((x) => x.name === 0 && !x.x)
      const hidden = g.tabs.filter((x) => (x.left + x.right) / 2 < g.left || (x.left + x.right) / 2 > g.right).length
      ok(iconsOnly && main?.text === 'Checkout copy' && main.name >= 50 && main.x, `${t}: with 30 tabs at 1024 the others are their icons alone; the tab on screen keeps its name and ×`, { main, others: g.tabs.filter((x) => !x.main).slice(0, 3) })
      ok(hidden > 0 && g.search === `Search tabs: ${hidden} out of sight`, `${t}: those still out of sight are counted on Search tabs (${hidden})`, g.search)
      const asks = await until(async () => (await kit.api('/fleet')).agents.find((a) => a.paneId === A.deploy)?.status === 'blocked', 20000)
      ok(!!asks && !!(await until(() => p.locator(`.ws-tab[data-pane="${A.deploy}"] .sdot-blocked`).evaluate((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0), 8000)), `${t}: an agent's tab that is its icon alone still has the dot that says it needs you`)
      await strip(p, `${tag}tab-strip-30-${t}`)
      await p.locator('.tab-search-btn').click()
      const list = p.locator('.tab-search')
      await list.waitFor({ timeout: 5000 }).catch(() => {})
      ok((await list.locator('.tab-search-row').count()) === 30 && /Open tabs\s*30/i.test(await list.locator('.tab-search-head').innerText().catch(() => '')), `${t}: Search tabs lists every open tab`, await list.locator('.tab-search-head').innerText().catch(() => ''))
      ok(await p.evaluate(() => document.activeElement?.closest('.tab-search') && document.activeElement.tagName === 'INPUT'), `${t}: ready to type`)
      await p.keyboard.type('invoic')
      const rows = await list.locator('.tab-search-row').allInnerTexts()
      ok(rows.length === 1 && /Invoices/.test(rows[0]) && /billing-api/.test(rows[0]), `${t}: typing finds a tab by its name, with its space`, rows)
      await shot(p, `${tag}tab-strip-search-${t}`, { clip: { x: 0, y: 0, width: 1024, height: 420 } })
      await p.keyboard.press('Enter')
      const shown = await until(async () => { const x = await geo(p); const m = x.tabs.find((y) => y.main); return m?.id === A.invoices && m.left >= x.left - 1 && m.right <= x.right + 1 && x }, 5000)
      ok(!!shown && !(await list.count()), `${t}: Enter opens it, in view in the strip, and the list closes`, (await geo(p)).tabs.find((y) => y.main))
      await p.locator('.tab-search-btn').click()
      await list.waitFor({ timeout: 5000 }).catch(() => {})
      await p.keyboard.press('Escape')
      ok(!!(await until(async () => !(await list.count()), 3000)), `${t}: Esc closes it`)
      ok(errors.length === 0, `${t}: 30 tabs: no page errors`, errors)
      await ctx.close()
    })
  }

  // ---------- Closing with the pointer ----------
  await part('closing', async () => {
    const tabs = [...VIEWS.slice(0, 6), A.checkout, A.weekly]
    const { ctx, p, errors } = await open({ mode: 'light', theme: 'sky' }, ws(tabs, 'view:meetings'))
    // The pointer on the third tab until its × shows, as it does under the pointer; the strip as it
    // is then. One that never shows says what the pointer is over.
    const id3 = (await geo(p)).tabs[2].id
    const tab3 = p.locator(`.ws-tab[data-pane="${id3}"]`)
    const x = tab3.locator('.ws-tab-x')
    const bx = await until(async () => { await tab3.hover(); return x.boundingBox() }, 5000, 200)
    if (!bx) {
      throw new Error(`the third tab's × doesn't show under the pointer: ${JSON.stringify(await tab3.evaluate((e) => {
        const r = e.getBoundingClientRect()
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return { tab: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], strip: document.querySelector('.ws-tabs-scroll')?.className, over: [at, at?.parentElement, at?.parentElement?.parentElement].map((n) => n && `${n.tagName}.${String(n.className).slice(0, 40)}`), hovered: [...document.querySelectorAll(':hover')].slice(-2).map((n) => `${n.tagName}.${String(n.className).slice(0, 40)}`) }
      }))}`)
    }
    const before = await geo(p)
    const third = before.tabs.find((y) => y.id === id3), fourth = before.tabs[before.tabs.indexOf(third) + 1]
    ok(third.w < 220, 'eight tabs share the strip, each narrower than its widest', third.w)
    await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2)
    await until(async () => !(await p.locator(`.ws-tab[data-pane="${third.id}"]`).count()), 3000)
    await p.waitForTimeout(150)
    const under = await p.evaluate(([cx, cy]) => { const e = document.elementFromPoint(cx, cy); return { x: !!e?.closest('.ws-tab-x'), tab: e?.closest('.ws-tab')?.dataset.pane } }, [bx.x + bx.width / 2, bx.y + bx.height / 2])
    const kept = await geo(p)
    ok(under.x && under.tab === fourth.id, 'closed with the pointer, the next tab\'s × is under it', { under, next: fourth.id })
    ok(kept.tabs.every((y) => Math.abs(y.w - before.tabs.find((z) => z.id === y.id).w) <= 1), 'and every tab is as wide as it was', kept.tabs.map((y) => y.w))
    await p.mouse.move(700, 600)
    const wider = await until(async () => { const y = await geo(p); return y.tabs[0].w > before.tabs[0].w + 4 && y }, 3000)
    ok(!!wider, 'once the pointer leaves the strip, they share its width again', (await geo(p)).tabs.map((y) => y.w))
    // The tab on screen closed: the one after it shows.
    const order = (await geo(p)).tabs.map((y) => y.id)
    await p.locator(`.ws-tab[data-pane="${order[1]}"]`).click()
    await p.locator(`.ws-tab[data-pane="${order[1]}"] .ws-tab-x`).click()
    ok(!!(await until(async () => (await geo(p)).tabs.find((y) => y.main)?.id === order[2], 3000)), 'closing the tab on screen shows the one after it', (await geo(p)).tabs.find((y) => y.main)?.id)
    // Ctrl+Shift+→ moves the focused tab one place on.
    const now = (await geo(p)).tabs.map((y) => y.id)
    await p.locator(`.ws-tab[data-pane="${now[0]}"]`).focus()
    await p.keyboard.press('Control+Shift+ArrowRight')
    ok(!!(await until(async () => (await geo(p)).tabs.map((y) => y.id).indexOf(now[0]) === 1, 3000)), 'Ctrl+Shift+→ moves a tab one place on', (await geo(p)).tabs.map((y) => y.id))
    // Dragged onto the right half of another tab: a mark where it would go, and it goes there.
    const was = (await geo(p)).tabs.map((y) => y.id)
    const from = p.locator(`.ws-tab[data-pane="${was[0]}"]`), onto = p.locator(`.ws-tab[data-pane="${was[2]}"]`)
    const fb = await from.boundingBox(), ob = await onto.boundingBox()
    await p.mouse.move(fb.x + 20, fb.y + 14)
    await p.mouse.down()
    await p.mouse.move(fb.x + 40, fb.y + 14, { steps: 4 })
    await p.mouse.move(ob.x + ob.width - 12, ob.y + 14, { steps: 8 })
    const mark = await until(() => p.locator('.ws-tab.drop-after').evaluate((e) => { const m = getComputedStyle(e, '::after'); return m.display !== 'none' && m.width === '2px' && e.dataset.pane }), 3000)
    await p.mouse.up()
    const moved = await until(async () => { const o = (await geo(p)).tabs.map((y) => y.id); return o.indexOf(was[0]) === o.indexOf(was[2]) + 1 && o }, 3000)
    ok(mark === was[2] && !!moved, 'dragging a tab marks where it would go, and drops it there', { mark, order: moved || (await geo(p)).tabs.map((y) => y.id) })
    // Side by side: both tabs on screen keep their names and their ×.
    await p.locator('.ws-tab-tools button[aria-label="Split"]').click()
    const two = await until(async () => (await p.locator('.ws-tab.side').count()) === 1, 3000)
    const pair = two && await p.evaluate(() => [...document.querySelectorAll('.ws-tab.main, .ws-tab.side')].map((e) => ({ name: e.querySelector('.ws-tab-name').getBoundingClientRect().width, x: getComputedStyle(e.querySelector('.ws-tab-x')).display !== 'none' })))
    ok(pair?.length === 2 && pair.every((z) => z.name >= 50 && z.x), 'side by side, both tabs on screen keep their names and their ×', pair)
    ok(errors.length === 0, 'closing: no page errors', errors)
    await ctx.close()
  })

  // ---------- The tab menu from the keyboard, near the window's edge, and closing from it ----------
  await part('tab menu: keys and closing', async () => {
    const { ctx, p, errors } = await open({ mode: 'light', theme: 'sky' }, ws(['view:meetings', A.checkout, A.deploy, A.weekly, A.board, 'view:map'], 'view:meetings'))
    const menu = p.locator('.tab-menu')
    const deploy = p.locator(`.ws-tab[data-pane="${A.deploy}"]`)
    const ids = async () => (await geo(p)).tabs.map((y) => y.id)
    // Shift+F10 on the focused tab: its menu, the focus on its first item; ↓ the next, ↓ again its
    // colors (at the one it has, No color), → along them; Esc closes it, the focus back on the tab.
    await deploy.focus()
    await p.keyboard.press('Shift+F10')
    await menu.waitFor({ timeout: 3000 }).catch(() => {})
    const walk = [await focused(p)]
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) { await p.keyboard.press(k); walk.push(await focused(p)) }
    ok(walk.join('|') === 'New agent in shop|Open beside the current tab|Add tab to new group|Rename…|Pin tab|No color|Grey|Blue', 'Shift+F10 on a tab opens its menu at its first item; ↓ moves down it, to its colors, → along them', walk)
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => !(await menu.count()), 2000)) && (await focused(p)) === A.deploy, 'Esc closes it, the focus back on the tab', await focused(p))
    await p.keyboard.press('ContextMenu')
    ok(!!(await until(() => menu.isVisible(), 2000)) && (await focused(p)) === 'New agent in shop', 'the menu key opens it too', await focused(p))
    await p.keyboard.press('Escape')
    // Near the window's right and bottom edges: to the pointer's left and above it, inside the window.
    const at = await deploy.evaluate((e) => { const x = innerWidth - 12, y = innerHeight - 12; e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); return { x, y } })
    await menu.waitFor({ timeout: 3000 }).catch(() => {})
    const mb = await menuBox(menu)
    ok(mb.right <= at.x + 1 && mb.bottom <= at.y + 1 && mb.left >= 0 && mb.top >= 0 && compact(mb), 'near the window\'s right and bottom edges it opens to the pointer\'s left and above it', { mb, at })
    await p.keyboard.press('Escape')
    // A view on screen: no new agent, and nothing to open beside it.
    await p.locator('.ws-tab[data-pane="view:meetings"]').click({ button: 'right' })
    const view = (await menu.locator('.menu-item').allInnerTexts().catch(() => [])).map((x) => x.trim())
    ok(view.join('|') === 'Add tab to new group|Pin tab|Close|Close other tabs|Close tabs to the right', 'the tab on screen, a view: no new agent, nothing to open beside it, no Rename', view)
    await p.keyboard.press('Escape')
    // Close tabs to the right, then Close other tabs.
    await deploy.click({ button: 'right' })
    await menu.locator('.menu-item', { hasText: 'Close tabs to the right' }).click()
    ok(!!(await until(async () => (await ids()).join() === ['view:meetings', A.checkout, A.deploy].join(), 3000)), 'Close tabs to the right closes those after it', await ids())
    await p.locator(`.ws-tab[data-pane="${A.checkout}"]`).click({ button: 'right' })
    await menu.locator('.menu-item', { hasText: 'Close other tabs' }).click()
    const alone = await until(async () => { const g = await geo(p); return g.tabs.length === 1 && g.tabs[0].id === A.checkout && g.tabs[0].main && g }, 3000)
    ok(!!alone, 'Close other tabs leaves it alone, on screen', (await geo(p)).tabs)
    ok(/Weekly numbers/.test(await p.locator('.rail').innerText()), 'the agents whose tabs closed are still in the sidebar')
    await p.locator(`.ws-tab[data-pane="${A.checkout}"]`).click({ button: 'right' })
    const lone = (await menu.locator('.menu-item').allInnerTexts().catch(() => [])).map((x) => x.trim())
    ok(lone.join('|') === 'New agent in shop|Add tab to new group|Rename…|Pin tab|Close', 'a tab alone has nothing else to close', lone)
    await p.keyboard.press('Escape')
    ok(errors.length === 0, 'tab menu: no page errors', errors)
    await ctx.close()
  })

  // ---------- Your own groups, as Chrome's (Tab Groups off) ----------
  await part('your own groups', async () => {
    const { ctx, p, errors } = await seeded(L, ws(['view:meetings', A.checkout, A.deploy, A.weekly, A.board, 'view:map'], 'view:meetings'))
    const s = p.locator('.ws-tabs-scroll')
    const chip = s.locator('.ws-group').first()
    const editor = p.locator('.tab-group-editor')
    const lineOf = (id) => s.locator(`.ws-tab[data-pane="${id}"]`).evaluate((e) => { const l = e.querySelector('.ws-tab-line'); return l ? getComputedStyle(l).backgroundColor : null }).catch(() => null)
    const chipBg = () => chip.evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => null)
    const gone = (x) => until(async () => !(await x.count()), 2000, 100)
    // Add tab to new group: a chip before the tab, in a color, a line in it under the tab, and the
    // group's editor by the chip with its name ready to type.
    await pick(p, A.weekly, 'Add tab to new group')
    await editor.waitFor({ timeout: 3000 }).catch(() => {})
    ok(await untilLay(p, 'meetings checkout deploy [] weekly* board map'), 'Add tab to new group puts the tab in a group of its own, its chip before it', await lay(p))
    const at = await p.evaluate(() => { const c = document.querySelector('.ws-group')?.getBoundingClientRect(), e = document.querySelector('.tab-group-editor')?.getBoundingClientRect(); return c && e && { chip: [Math.round(c.left), Math.round(c.bottom)], editor: [Math.round(e.left), Math.round(e.top)], field: !!document.activeElement?.matches('.tab-group-name') } })
    ok(!!at?.field && Math.abs(at.editor[0] - at.chip[0]) <= 2 && at.editor[1] >= at.chip[1] && at.editor[1] - at.chip[1] <= 12, 'its editor opens under the chip, its name field focused', at)
    const eb = await menuBox(editor)
    ok(compact(eb), 'the editor is as wide as what it says, inside the window', eb)
    const roles = await editor.evaluate((e) => ({ role: e.getAttribute('role'), menu: !!e.querySelector('[role="menu"]'), radios: e.querySelectorAll('[role="menu"] [role="menuitemradio"]').length, items: [...e.querySelectorAll('[role="menu"] [role="menuitem"]')].map((x) => x.textContent.trim()), field: e.querySelector('input')?.getAttribute('aria-label') })).catch((e) => e.message)
    ok(roles?.role === 'dialog' && roles.menu && roles.radios === 9 && roles.items?.join('|') === 'New agent in group|Ungroup|Close group' && roles.field === 'Group name', 'the editor: its name, then a menu of the nine colors (menuitemradio) and New agent in group, Ungroup and Close group (menuitem)', roles)
    ok(clear(await chipBg()) && (await lineOf(A.weekly)) === (await chipBg()), 'the chip has a color, and a line in it runs under the tab', { chip: await chipBg(), line: await lineOf(A.weekly) })
    await shot(p, `${tag}tab-strip-group-editor`, { clip: { x: 0, y: 0, width: 1440, height: 320 } })
    await p.keyboard.type('Numbers')
    ok(!!(await until(async () => (await lay(p)) === 'meetings checkout deploy [Numbers] weekly* board map', 2000, 100)), 'the chip shows the name as it is typed', await lay(p))
    // ↓ to its colors, at its own; → along them; ↑ back to the name; Enter closes it, the focus on the chip.
    const own = await editor.locator('[aria-checked="true"]').getAttribute('aria-label').catch(() => null)
    const keys = []
    for (const k of ['ArrowDown', 'ArrowRight', 'ArrowUp']) { await p.keyboard.press(k); keys.push(await p.evaluate(() => (document.activeElement?.matches('.tab-group-name') ? 'name' : document.activeElement?.getAttribute('aria-label')))) }
    ok(!!own && keys[0] === own && keys[1] && keys[1] !== own && keys[2] === 'name', '↓ goes to its colors at its own, → along them, ↑ back to its name', { own, keys })
    await p.keyboard.press('Enter')
    ok(!!(await gone(editor)) && (await focused(p)) === 'chip:Numbers', 'Enter closes it, the focus on the chip', await focused(p))
    // A right-click on the chip: the same editor. Green colors the chip and the line; a click elsewhere closes it.
    await chip.click({ button: 'right' })
    await editor.waitFor({ timeout: 3000 }).catch(() => {})
    ok((await editor.locator('input').inputValue().catch(() => '')) === 'Numbers', 'a right-click on the chip opens its editor, with its name', await editor.locator('input').inputValue().catch((e) => e.message))
    const green = await editor.locator('[data-color="green"]').evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => null)
    await editor.locator('[data-color="green"]').click({ timeout: 3000 })
    ok(clear(green) && !!(await until(async () => (await chipBg()) === green && (await lineOf(A.weekly)) === green, 2000, 100)) && (await editor.count()) === 1, 'Green colors the chip and the line under its tab, the editor still open', { green, chip: await chipBg() })
    const [qx, qy] = await quiet(p)
    await p.mouse.click(qx, qy)
    ok(!!(await gone(editor)), 'a click elsewhere closes it', [qx, qy])
    // Add tab to group ›: its own menu, under the pointer, with New group and the groups there are.
    const m = await menuOf(p, A.board)
    const more = m.locator('[aria-haspopup="menu"]')
    ok((await more.innerText().catch(() => '')).trim() === 'Add tab to group', 'with a group there, a tab\'s menu has Add tab to group, with its own menu', await itemsOf(m))
    await more.hover({ timeout: 3000 }).catch(() => {})
    const sub = p.locator('.tab-submenu')
    await sub.waitFor({ timeout: 3000 }).catch(() => {})
    const sb = await menuBox(sub), pb = await menuBox(m)
    ok((await itemsOf(sub)).join('|') === 'New group|Numbers' && (await more.getAttribute('aria-expanded')) === 'true' && compact(sb) && (sb.left >= pb.right - 6 || sb.right <= pb.left + 6), 'under the pointer it opens its own menu beside it: New group, and Numbers', { items: await itemsOf(sub), sb, pb })
    await shot(p, `${tag}tab-strip-add-to-group`, { clip: { x: 0, y: 0, width: 1440, height: 420 } })
    await sub.locator('.menu-item', { hasText: 'Numbers' }).click({ timeout: 3000 })
    ok(await untilLay(p, 'meetings checkout deploy [Numbers] weekly* board* map'), 'picked, the tab joins that group', await lay(p))
    // From the keyboard: → opens it at its first item, ↓ the next, ← back to the item; Esc closes it
    // and then the menu, the focus back on the tab.
    await p.locator(`.ws-tab[data-pane="${A.checkout}"]`).focus()
    await p.keyboard.press('Shift+F10')
    await p.locator('.tab-menu').waitFor({ timeout: 3000 }).catch(() => {})
    const walk = []
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape']) { await p.keyboard.press(k); walk.push(await focused(p)) }
    ok(walk.join('|') === 'Open beside the current tab|Add tab to group|New group|Numbers|Add tab to group|New group|Add tab to group' && (await p.locator('.tab-menu').count()) === 1, '→ opens Add tab to group\'s menu at its first item, ↓ moves in it, ← or Esc goes back to the item', walk)
    await p.keyboard.press('Escape')
    ok(!!(await gone(p.locator('.tab-menu'))) && (await focused(p)) === A.checkout, 'Esc again closes the menu, the focus back on the tab', await focused(p))
    // Remove from group: out of it, where it is.
    await pick(p, A.board, 'Remove from group')
    ok(await untilLay(p, 'meetings checkout deploy [Numbers] weekly* board map'), 'Remove from group takes the tab out of the group, where it was', await lay(p))
    await addTo(p, A.checkout, 'Numbers')
    ok(await untilLay(p, 'meetings deploy [Numbers] weekly* checkout* board map'), 'Add tab to group › Numbers puts the tab at the group\'s end', await lay(p))
    // Dragged between two of its tabs, a tab joins the group; dragged out, it leaves it.
    await dragOnto(p, A.deploy, A.weekly, true)
    ok(await untilLay(p, 'meetings [Numbers] weekly* deploy* checkout* board map'), 'a tab dropped between two of a group\'s tabs joins the group', await lay(p))
    await dragOnto(p, A.deploy, 'view:map', true)
    ok(await untilLay(p, 'meetings [Numbers] weekly* checkout* board map deploy'), 'dragged out of the group, it leaves it', await lay(p))
    await dragOnto(p, A.deploy, A.weekly, false)
    ok(await untilLay(p, 'meetings [Numbers] deploy* weekly* checkout* board map'), 'dropped just after the chip (before the group\'s first tab), a tab joins the group', await lay(p))
    // (Back out to the end, for what follows: a drop WebKit misses on a slow computer is tried again.)
    await dragOnto(p, A.deploy, 'view:map', true)
    for (let i = 0; i < 3 && !(await untilLay(p, 'meetings [Numbers] weekly* checkout* board map deploy', 2000)); i++) await dragOnto(p, A.deploy, 'view:map', true)
    // Ctrl+Shift+→ at the group's edge: out of it first, where it is; Ctrl+Shift+← beside it: back in.
    await p.locator(`.ws-tab[data-pane="${A.checkout}"]`).focus()
    await p.keyboard.press('Control+Shift+ArrowRight')
    ok(await untilLay(p, 'meetings [Numbers] weekly* checkout board map deploy') && (await focused(p)) === A.checkout, 'Ctrl+Shift+→ at the group\'s edge takes the tab out of it first, the focus still on it', { lay: await lay(p), focus: await focused(p) })
    await p.keyboard.press('Control+Shift+ArrowLeft')
    ok(await untilLay(p, 'meetings [Numbers] weekly* checkout* board map deploy') && (await focused(p)) === A.checkout, 'Ctrl+Shift+← beside the group puts it back in', { lay: await lay(p), focus: await focused(p) })
    // A click on the chip folds the group, another unfolds it.
    await chip.click()
    ok(await untilLay(p, 'meetings [Numbers 2] board map deploy'), 'a click on the chip folds the group to it, with how many', await lay(p))
    await chip.click()
    ok(await untilLay(p, 'meetings [Numbers] weekly* checkout* board map deploy'), 'another unfolds it', await lay(p))
    // Kept with the window's tabs: after a reload, the same, still green.
    await until(async () => /"Numbers"/.test(await p.evaluate(() => localStorage.getItem('cc-ws'))), 3000, 100)
    await p.reload()
    await p.waitForSelector('.ws-group', { timeout: 20000 }).catch(() => {})
    ok(await untilLay(p, 'meetings [Numbers] weekly* checkout* board map deploy', 8000) && (await chipBg()) === green, 'after a reload the group is there, named, green, with its tabs', { lay: await lay(p), chip: await chipBg() })
    // Ungroup: the chip goes, the tabs stay where they are.
    await chip.click({ button: 'right' })
    await editor.locator('.menu-item', { hasText: 'Ungroup' }).click({ timeout: 3000 })
    ok(await untilLay(p, 'meetings weekly checkout board map deploy'), 'Ungroup: the chip goes, its tabs stay where they are', await lay(p))
    // A group with no name: its chip its color alone, "Unnamed group" to a screen reader and in the
    // menus. Close group closes its tabs, and the chip goes; the agents are still in the sidebar.
    await pick(p, A.weekly, 'Add tab to new group')
    await editor.waitFor({ timeout: 3000 }).catch(() => {})
    await p.keyboard.press('Escape')
    ok(!!(await gone(editor)) && (await focused(p)) === 'chip:', 'Esc closes the editor, the focus on the chip', await focused(p))
    await addTo(p, A.checkout, 'Unnamed group')
    const cw = await chip.evaluate((e) => Math.round(e.getBoundingClientRect().width)).catch(() => 0)
    ok(await untilLay(p, 'meetings [] weekly* checkout* board map deploy') && (await chip.getAttribute('aria-label')) === 'Unnamed group' && cw > 0 && cw <= 16, 'a group with no name: its chip its color alone, Unnamed group to a screen reader and in the menus', { lay: await lay(p), cw })
    await chip.click({ button: 'right' })
    await editor.locator('.menu-item', { hasText: 'Close group' }).click({ timeout: 3000 })
    ok(await untilLay(p, 'meetings board map deploy'), 'Close group closes its tabs, and its chip goes', await lay(p))
    ok(/Weekly numbers/.test(await p.locator('.rail').innerText()), 'its agents are still in the sidebar')
    // The last tab of a group closed: the group goes, its color too.
    await pick(p, A.board, 'Add tab to new group')
    await editor.waitFor({ timeout: 3000 }).catch(() => {})
    await p.keyboard.type('Solo')
    await p.keyboard.press('Enter')
    ok(await untilLay(p, 'meetings [Solo] board* map deploy'), 'a group of one', await lay(p))
    const board = p.locator(`.ws-tab[data-pane="${A.board}"]`)
    await board.hover()
    await board.locator('.ws-tab-x').click({ timeout: 3000 })
    const kept = await until(async () => { const w = JSON.parse(await p.evaluate(() => localStorage.getItem('cc-ws'))); return !Object.keys(w.tabGroups || {}).length && !Object.keys(w.colors || {}).some((k) => k.startsWith('g:')) && w }, 3000, 100)
    ok(await untilLay(p, 'meetings map deploy') && !!kept, 'its last tab closed, the group goes, its color too', { lay: await lay(p), saved: await p.evaluate(() => localStorage.getItem('cc-ws')) })
    // New agent in group: New agent, in the group's space; the agent it starts opens in the group.
    await pick(p, A.deploy, 'Add tab to new group')
    await editor.waitFor({ timeout: 3000 }).catch(() => {})
    await editor.locator('.menu-item', { hasText: 'New agent in group' }).click({ timeout: 3000 })
    const dialog = p.locator('.modal').first()
    await dialog.waitFor({ timeout: 5000 }).catch(() => {})
    ok(/In shop/.test(await dialog.innerText().catch(() => '')), 'New agent in group opens New agent, in the group\'s space', await dialog.innerText().catch(() => 'no dialog'))
    // (Its folder as the test's server has it: the dialog shows it from ~, which here is the test's own home.)
    await dialog.locator('input.mono').fill(path.join(kit.home, 'code', 'shop')).catch(() => {})
    const start = dialog.locator('button[type="submit"]')
    await until(() => start.isEnabled(), 5000, 100)
    await start.click({ timeout: 3000 }).catch(() => {})
    const joined = await until(async () => { const x = await lay(p); return /^meetings map \[\] deploy\* \S+\*$/.test(x) && x }, 20000, 200)
    ok(!!joined, 'the agent it starts opens in the group', await lay(p))
    ok(withoutCutOff(errors).length === 0, 'your own groups: no page errors', errors)
    await ctx.close()
  })

  // ---------- Near the window's right edge: a group's editor, and Add tab to group's own menu ----------
  await part('group menus near the right edge', async () => {
    const tabs = [...VIEWS.slice(4, 18), A.weekly, A.board]
    const { ctx, p, errors } = await open(L, ws(tabs, VIEWS[4], { tabGroups: { 'g:edge': { name: 'Quarterly review', tabs: [A.weekly, A.board] }, 'g:two': { name: 'Two', tabs: [VIEWS[5]] } }, colors: { 'g:edge': 'blue', 'g:two': 'red' } }), 900)
    const chip = p.locator('.ws-group[data-group="g:edge"]')
    await chip.click({ button: 'right' })
    const editor = p.locator('.tab-group-editor')
    await editor.waitFor({ timeout: 3000 }).catch(() => {})
    const eb = await menuBox(editor)
    const cb = await chip.boundingBox()
    ok(compact(eb) && eb.right <= eb.width - 7 && (Math.abs(eb.left - cb.x) <= 2 || eb.right >= eb.width - 9), 'near the right edge a group\'s editor stays inside the window, under its chip or moved left as far as it must be', { eb, chip: cb })
    await p.keyboard.press('Escape')
    await p.locator(`.ws-tab[data-pane="${A.board}"]`).evaluate((e) => e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 12, clientY: e.getBoundingClientRect().bottom - 6, button: 2 })))
    const menu = p.locator('.tab-menu')
    await menu.waitFor({ timeout: 3000 }).catch(() => {})
    await menu.locator('[aria-haspopup="menu"]').hover({ timeout: 3000 }).catch(() => {})
    const sub = p.locator('.tab-submenu')
    await sub.waitFor({ timeout: 3000 }).catch(() => {})
    const mb = await menuBox(menu), sb = await menuBox(sub)
    ok(compact(mb) && compact(sb) && sb.right <= mb.left + 6, 'by the right edge a tab\'s menu and Add tab to group\'s own menu stay inside the window, that one on its left', { mb, sb })
    await shot(p, `${tag}tab-strip-menus-edge`, { clip: { x: 0, y: 0, width: 900, height: 460 } })
    await p.keyboard.press('Escape')
    ok(withoutCutOff(errors).length === 0, 'menus near the edge: no page errors', errors)
    await ctx.close()
  })

  // ---------- Pinned tabs ----------
  await part('pinned tabs', async () => {
    const { ctx, p, errors } = await seeded(L, ws(['view:meetings', A.checkout, A.deploy, A.weekly, A.board], 'view:meetings'))
    const tab = (id) => p.locator(`.ws-tab[data-pane="${id}"]`)
    await pick(p, A.weekly, 'Pin tab')
    ok(await untilLay(p, 'weekly^ meetings checkout deploy board'), 'Pin tab takes the tab to the start', await lay(p))
    const look = await tab(A.weekly).evaluate((e) => ({ w: Math.round(e.getBoundingClientRect().width), name: Math.round(e.querySelector('.ws-tab-name')?.getBoundingClientRect().width || 0), x: !!e.querySelector('.ws-tab-x'), dot: !!e.querySelector('.sdot'), text: e.textContent, says: e.getAttribute('aria-description') })).catch((e) => e.message)
    ok(look.w <= 48 && look.name <= 1 && !look.x && look.dot && /Weekly numbers/.test(look.text) && /Pinned tab/.test(look.says), 'a pinned tab is its icon and dot alone, with no ×; its name still there for a screen reader', look)
    await tab(A.weekly).hover()
    ok(!!(await until(async () => /Weekly numbers/.test(await p.locator('.tab-card').innerText().catch(() => '')), 3000, 100)), 'its card has its name')
    await p.mouse.move(700, 600)
    const pm = await menuOf(p, A.weekly)
    ok((await itemsOf(pm)).includes('Unpin tab') && !(await itemsOf(pm)).includes('Pin tab'), 'its menu has Unpin tab', await itemsOf(pm))
    await p.keyboard.press('Escape')
    await pick(p, A.board, 'Pin tab')
    ok(await untilLay(p, 'weekly^ board^ meetings checkout deploy'), 'another pinned goes after it', await lay(p))
    await strip(p, `${tag}tab-strip-pinned`)
    await pick(p, A.checkout, 'Close other tabs')
    ok(await untilLay(p, 'weekly^ board^ checkout'), 'Close other tabs leaves the pinned tabs', await lay(p))
    await until(async () => /"pinned":\[[^\]]+\]/.test(await p.evaluate(() => localStorage.getItem('cc-ws'))), 3000, 100)
    await p.reload()
    await p.waitForSelector('.ws-tab', { timeout: 20000 }).catch(() => {})
    ok(await untilLay(p, 'weekly^ board^ checkout', 8000), 'after a reload they are still pinned', await lay(p))
    await pick(p, A.weekly, 'Close tabs to the right')
    ok(await untilLay(p, 'weekly^ board^'), 'Close tabs to the right leaves the pinned tabs too', await lay(p))
    await pick(p, A.board, 'Unpin tab')
    ok(await untilLay(p, 'weekly^ board') && (await tab(A.board).locator('.ws-tab-x').count()) === 1, 'Unpin tab: a tab again, after the pinned ones, with its ×', await lay(p))
    ok(withoutCutOff(errors).length === 0, 'pinned tabs: no page errors', errors)
    await ctx.close()
  })

  // ---------- Rename… ----------
  await part('rename', async () => {
    // A rename that doesn't take (herdr down, say), when the test says so: its route is there before
    // the page opens, and no service worker answers in its place, as WebKit needs.
    let refuse = false
    const store = ws([A.checkout, A.deploy, 'view:map'], A.checkout)
    const { ctx, p, errors } = await page(b, kit.url, { ...L, width: 1440, height: 900, store, before: async (c) => { await noServiceWorker(c); await c.route(/\/api\/tabs\/[^/]+\/rename$/, (r) => (refuse ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'herdr is not running' }) }) : r.continue())) } })
    await until(async () => (await p.locator('.ws-tab').count()) === store['cc-ws'].tabs.length, 20000)
    const tab = p.locator(`.ws-tab[data-pane="${A.deploy}"]`)
    const field = tab.locator('input.ws-tab-rename')
    const nameOf = () => tab.locator('.ws-tab-name').innerText().then((x) => x.trim()).catch(() => '')
    const rail = () => p.locator('.rail').innerText().catch(() => '')
    await pick(p, A.deploy, 'Rename…')
    await field.waitFor({ timeout: 3000 }).catch(() => {})
    ok((await field.inputValue().catch(() => '')) === 'Deploy' && !!(await field.evaluate((e) => e === document.activeElement).catch(() => false)), 'Rename… edits the name in the tab itself, focused', await field.inputValue().catch((e) => e.message))
    await shot(p, `${tag}tab-strip-rename`, { clip: { x: 0, y: 0, width: 1440, height: 160 } })
    await p.keyboard.type('Ship it')
    await p.keyboard.press('Enter')
    ok(!!(await until(async () => !(await field.count()) && (await nameOf()) === 'Ship it', 3000, 100)) && (await focused(p)) === A.deploy, 'Enter keeps the new name, the focus back on the tab', { name: await nameOf(), focus: await focused(p) })
    ok(!!(await until(async () => /Ship it/.test(await rail()), 5000, 100)), 'the sidebar has the new name too (renamed as its ⋯ menu renames)')
    // From the keyboard: its menu, down to Rename…, Enter; Esc puts the name back.
    await tab.focus()
    await p.keyboard.press('Shift+F10')
    await p.locator('.tab-menu').waitFor({ timeout: 3000 }).catch(() => {})
    for (let i = 0; i < 6 && (await focused(p)) !== 'Rename…'; i++) await p.keyboard.press('ArrowDown')
    await p.keyboard.press('Enter')
    await field.waitFor({ timeout: 3000 }).catch(() => {})
    await p.keyboard.type('Nope')
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => !(await field.count()), 2000, 100)) && (await nameOf()) === 'Ship it' && (await focused(p)) === A.deploy, 'Esc puts the name back, the focus on the tab', { name: await nameOf(), focus: await focused(p) })
    await p.waitForTimeout(300)
    ok(!/Nope/.test(await rail()), 'and nothing is renamed')
    // One that doesn't take: the old name back, and why, under the tab.
    refuse = true
    await pick(p, A.deploy, 'Rename…')
    await field.waitFor({ timeout: 3000 }).catch(() => {})
    await p.keyboard.type('Lost')
    await p.keyboard.press('Enter')
    const note = p.locator('.tab-note[role="alert"]')
    ok(!!(await until(async () => /Couldn't rename it: herdr is not running/.test(await note.innerText().catch(() => '')) && (await nameOf()) === 'Ship it', 3000, 100)), 'a rename that doesn\'t take says why, under the tab, the old name back', { note: await note.innerText().catch(() => 'no note'), name: await nameOf() })
    refuse = false
    // A view isn't renamed here (the sidebar has no Rename for it either).
    const mv = await menuOf(p, 'view:map')
    ok(!(await itemsOf(mv)).includes('Rename…'), 'a view\'s menu has no Rename…', await itemsOf(mv))
    await p.keyboard.press('Escape')
    await pick(p, A.deploy, 'Rename…')
    await field.waitFor({ timeout: 3000 }).catch(() => {})
    await p.keyboard.type('Deploy')
    await p.keyboard.press('Enter')
    ok(!!(await until(async () => (await nameOf()) === 'Deploy' && /Deploy/.test(await rail()), 5000, 100)), 'renamed back', await nameOf())
    ok(withoutCutOff(errors).length === 0, 'rename: no page errors', errors)
    await ctx.close()
  })

  // ---------- Tab Groups ----------
  await trial(true)
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.mode
    await part(`${t}: Tab Groups`, async () => {
      const remote = 'remote:desk1:p9'
      const tabs = ['view:meetings', 'view:map', A.checkout, A.deploy, A.weekly, A.board, A.rounding, remote]
      const { ctx, p, errors } = await seeded(look, ws(tabs, 'view:meetings'), { 'cc-remote-tabs': { [remote]: { title: 'Nightly export', device: 'Desk' } } })
      const s = p.locator('.ws-tabs-scroll')
      await until(async () => (await s.locator('.ws-group').count()) >= 4, 10000)
      const items = await s.evaluate((e) => [...e.children].map((x) => {
        const cs = getComputedStyle(x)
        const line = x.querySelector('.ws-tab-line')
        const r = x.getBoundingClientRect()
        return { chip: x.classList.contains('ws-group'), text: x.innerText.trim(), id: x.dataset.pane, bg: cs.backgroundColor, ink: cs.color, line: line ? getComputedStyle(line).backgroundColor : null, lineBottom: line ? Math.round(line.getBoundingClientRect().bottom) : null, bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }
      }))
      const chip = (name) => items.findIndex((x) => x.chip && x.text === name)
      const rep = chip('Reporting'), sh = chip('shop'), desk = chip('Desk')
      ok(rep >= 0 && items[rep + 1]?.id === A.weekly && items[rep + 2]?.id === A.board && items[rep].right <= items[rep + 1].left, `${t}: Reporting's chip is before its tabs`, items.map((x) => (x.chip ? `[${x.text}]` : x.id)))
      ok(clear(items[rep].bg) && items[rep + 1].line === items[rep].bg && items[rep + 2].line === items[rep].bg && items[rep + 1].lineBottom === items[rep + 1].bottom, `${t}: the chip is filled in its color, and a line in that color runs under its tabs`, items.slice(rep, rep + 3))
      ok(sh >= 0 && clear(items[sh].bg) && items[sh].bg !== items[rep].bg, `${t}: each space has its own color`, [items[sh]?.bg, items[rep].bg])
      ok(desk === items.length - 2 && items.at(-1).id === remote && /^rgb\((9[0-9]|1[0-9]{2}|[5-9][0-9]), /.test(items[desk].bg), `${t}: another computer's group at the end, grey`, items[desk])
      // Each chip's words readable on its color (4.5:1).
      const lum = (c) => { const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl }
      const ratio = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
      const low = items.filter((x) => x.chip && ratio(x.bg, x.ink) < 4.5).map((x) => `${x.text} ${ratio(x.bg, x.ink).toFixed(2)}`)
      ok(!low.length, `${t}: each chip's name reads on its color (4.5:1)`, low)
      await strip(p, `${tag}tab-strip-groups-${t}`)
      // A click folds the group to its chip; another unfolds it.
      await s.locator('.ws-group', { hasText: 'Reporting' }).click()
      const folded = await until(async () => !(await s.locator(`.ws-tab[data-pane="${A.weekly}"]`).count()) && (await s.locator('.ws-group.folded').innerText().catch(() => '')), 3000)
      ok(/^Reporting\s*2$/.test(folded || '') && (await s.locator('.ws-group.folded .sdot').count()) === 1 && (await s.locator('.ws-group.folded').getAttribute('aria-expanded')) === 'false', `${t}: a click folds the group to its chip, with how many and the most urgent dot`, folded)
      await s.locator('.ws-group', { hasText: 'Reporting' }).click()
      ok(!!(await until(async () => (await s.locator(`.ws-tab[data-pane="${A.weekly}"]`).count()) === 1 && (await s.locator(`.ws-tab[data-pane="${A.board}"]`).count()) === 1, 3000)), `${t}: another unfolds it`)
      // Right-click: fold, a new agent in that space, close its tabs.
      await s.locator('.ws-group', { hasText: 'Reporting' }).click({ button: 'right' })
      const menu = p.locator('.tab-group-menu')
      const said = (await menu.innerText().catch(() => '')).replace(/\s+/g, ' ')
      ok(/Fold its tabs away/.test(said) && /New agent in Reporting/.test(said) && /Close its 2 tabs/.test(said), `${t}: its right-click menu folds it, starts an agent in its space and closes its tabs`, said)
      // As wide as what it says: the menu's own right edge (styles.css) once stretched it to the window's.
      const gm = await menuBox(menu)
      ok(compact(gm) && gm.right < gm.width - 40, `${t}: the group's menu is as wide as what it says, not stretched to the window's edge`, gm)
      const own = await menu.locator('.tab-menu-color').evaluateAll((es) => es.map((e) => ({ color: e.dataset.color || null, bg: getComputedStyle(e).backgroundColor, on: e.getAttribute('aria-checked') })))
      ok(own.length === 9 && own.every((x) => x.color) && own.filter((x) => x.on === 'true').length === 1 && own.find((x) => x.on === 'true').bg === items[rep].bg, `${t}: and Chrome's nine colors, the group's own ticked`, own)
      await shot(p, `${tag}tab-strip-group-menu-${t}`, { clip: { x: 0, y: 0, width: 1440, height: 320 } })
      if (t === 'light') {
        await menu.locator('.menu-item', { hasText: 'New agent in Reporting' }).click()
        ok(!!(await until(() => p.locator('.modal').first().isVisible(), 5000)), `${t}: New agent in Reporting opens New agent`)
        await p.keyboard.press('Escape')
        await p.waitForTimeout(300)
      } else {
        await menu.locator('.menu-item', { hasText: 'Close its 2 tabs' }).click()
        ok(!!(await until(async () => !(await s.locator(`.ws-tab[data-pane="${A.weekly}"], .ws-tab[data-pane="${A.board}"]`).count()) && !(await s.locator('.ws-group', { hasText: 'Reporting' }).count()), 3000)), `${t}: Close its 2 tabs closes them, and its chip goes`)
        ok(/Weekly numbers/.test(await p.locator('.rail').innerText()), `${t}: its agents are still in the sidebar`)
      }
      // A color for shop's group from its chip's menu: its chip, and the line under each of its tabs.
      const shopIs = () => s.evaluate((e, ids) => {
        const chip = [...e.querySelectorAll('.ws-group')].find((x) => x.innerText.trim() === 'shop')
        return { chip: chip && getComputedStyle(chip).backgroundColor, lines: ids.map((id) => { const l = e.querySelector(`.ws-tab[data-pane="${id}"] .ws-tab-line`); return l && getComputedStyle(l).backgroundColor }) }
      }, [A.checkout, A.deploy])
      const paints = (x, c) => x.chip === c && x.lines.every((l) => l === c)
      const tm = p.locator('.tab-menu')
      await s.locator('.ws-group', { hasText: 'shop' }).click({ button: 'right' })
      const purple = await tm.locator('[data-color="purple"]').evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => null)
      await tm.locator('[data-color="purple"]').click()
      ok(clear(purple) && !!(await until(async () => paints(await shopIs(), purple), 3000)), `${t}: Purple in the chip's menu colors its chip and the line under its tabs`, { purple, now: await shopIs() })
      await p.keyboard.press('Escape')
      // A tab in it: its menu has the group's color ticked (and no No color), and colors the group.
      await s.locator(`.ws-tab[data-pane="${A.deploy}"]`).click({ button: 'right' })
      const ticked = await tm.locator('.tab-menu-color[aria-checked="true"]').getAttribute('data-color').catch(() => null)
      const cyan = await tm.locator('[data-color="cyan"]').evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => null)
      ok(ticked === 'purple' && !(await tm.locator('.tab-menu-none').count()), `${t}: a grouped tab's menu has its group's color ticked`, ticked)
      await tm.locator('[data-color="cyan"]').click()
      ok(clear(cyan) && !!(await until(async () => paints(await shopIs(), cyan), 3000)), `${t}: Cyan in one of its tabs' menus colors the whole group`, { cyan, now: await shopIs() })
      await p.keyboard.press('Escape')
      // Kept with the window's tabs.
      await until(async () => /"cyan"/.test(await p.evaluate(() => localStorage.getItem('cc-ws'))), 3000)
      await p.reload()
      ok(!!(await until(async () => paints(await shopIs().catch(() => ({ lines: [] })), cyan), 15000)), `${t}: after a reload the group is still cyan`, await shopIs().catch((e) => e.message))
      ok(withoutCutOff(errors).length === 0, `${t}: groups: no page errors`, errors)
      await ctx.close()
    })
  }
  // ---------- Your own groups with Tab Groups on ----------
  await part('your own groups with Tab Groups on', async () => {
    const { ctx, p, errors } = await seeded(L, ws(['view:meetings', A.checkout, A.deploy, A.weekly, A.board, A.rounding], 'view:meetings'))
    const editor = p.locator('.tab-group-editor')
    await until(async () => (await p.locator('.ws-group').count()) >= 3, 10000)
    ok(await untilLay(p, 'meetings [shop] checkout* deploy* [Reporting] weekly* board* [billing-api] rounding*'), 'with Tab Groups on, the tabs by space', await lay(p))
    await pick(p, A.deploy, 'Add tab to new group')
    await editor.waitFor({ timeout: 3000 }).catch(() => {})
    const eb = await menuBox(editor)
    await p.keyboard.type('Ship')
    await p.keyboard.press('Enter')
    await addTo(p, A.weekly, 'Ship')
    ok(await untilLay(p, 'meetings [shop] checkout* [Ship] deploy* weekly* [Reporting] board* [billing-api] rounding*'), 'a group of yours holds tabs of two spaces, after the space of its first; the other tabs still by space', await lay(p))
    const bgs = await p.locator('.ws-group').evaluateAll((es) => es.map((e) => getComputedStyle(e).backgroundColor))
    ok(new Set(bgs).size === bgs.length, 'a new group takes a color no other chip has', bgs)
    ok(compact(eb), 'its editor is as wide as what it says, inside the window', eb)
    const tm = await menuOf(p, A.rounding)
    const tb = await menuBox(tm)
    ok(compact(tb) && (await itemsOf(tm)).includes('Add tab to group'), 'a tab\'s menu, Tab Groups on: as wide as what it says, with Add tab to group', { tb, items: await itemsOf(tm) })
    await p.keyboard.press('Escape')
    await p.locator('.ws-group', { hasText: 'shop' }).click({ button: 'right' })
    const sm = p.locator('.tab-group-menu')
    await sm.waitFor({ timeout: 3000 }).catch(() => {})
    const smb = await menuBox(sm)
    ok(compact(smb) && !(await sm.locator('input').count()) && /Fold its tabs away/.test(await sm.innerText().catch(() => '')), 'a space\'s chip keeps its own menu, as wide as what it says', smb)
    await p.keyboard.press('Escape')
    await until(async () => /"Ship"/.test(await p.evaluate(() => localStorage.getItem('cc-ws'))), 3000, 100)
    await p.reload()
    await p.waitForSelector('.ws-group', { timeout: 20000 }).catch(() => {})
    ok(await untilLay(p, 'meetings [shop] checkout* [Ship] deploy* weekly* [Reporting] board* [billing-api] rounding*', 8000), 'after a reload, the same', await lay(p))
    await pick(p, A.weekly, 'Remove from group')
    ok(await untilLay(p, 'meetings [shop] checkout* [Ship] deploy* [Reporting] weekly* board* [billing-api] rounding*'), 'Remove from group: back in its space\'s group', await lay(p))
    ok(withoutCutOff(errors).length === 0, 'your own groups, Tab Groups on: no page errors', errors)
    await ctx.close()
  })
  await trial(false)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
