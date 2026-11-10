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
// With Tab Groups on (a beta feature): each space's chip in its own color, before its tabs, a line in
// that color under them; a click folds the group to its chip (how many, the most urgent dot), another
// unfolds it; its right-click menu folds it, starts an agent in that space and closes its tabs;
// another computer's group is grey, at the end.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, TEST } from '../lib/harness.mjs'

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
    const before = await geo(p)
    const third = before.tabs[2], fourth = before.tabs[3]
    ok(third.w < 220, 'eight tabs share the strip, each narrower than its widest', third.w)
    await p.locator(`.ws-tab[data-pane="${third.id}"]`).hover()
    const x = p.locator(`.ws-tab[data-pane="${third.id}"] .ws-tab-x`)
    const bx = await x.boundingBox()
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

  // ---------- Tab Groups ----------
  await trial(true)
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.mode
    await part(`${t}: Tab Groups`, async () => {
      const remote = 'remote:desk1:p9'
      const tabs = ['view:meetings', 'view:map', A.checkout, A.deploy, A.weekly, A.board, A.rounding, remote]
      const { ctx, p, errors } = await open(look, { ...ws(tabs, 'view:meetings'), 'cc-remote-tabs': { [remote]: { title: 'Nightly export', device: 'Desk' } } })
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
      const clear = (c) => !/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/.test(c)
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
      await shot(p, `${tag}tab-strip-group-menu-${t}`, { clip: { x: 0, y: 0, width: 1440, height: 260 } })
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
      ok(errors.length === 0, `${t}: groups: no page errors`, errors)
      await ctx.close()
    })
  }
  await trial(false)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
