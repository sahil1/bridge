// The sidebar as it fills up, in the browser named by BRIDGE_TEST_BROWSER. The chief of staff in one
// place: its row at the top starts it (no second button in the tabs or at the foot of the sidebar),
// says what it does until it's been opened from there, and once it runs, with a second thread, its
// own space isn't listed again: the thread is under its row, the sidebar folded down has one way to
// it, ⌘K has one entry for it, and the tour points at the row. Then a few hundred meetings over a
// year: the last week by day, two days open, older ones under Earlier by week and month, all
// folding; the one recording and the one open stay in sight when their group is folded; what's
// folded is kept after a reload; and the list stays short and quick however many there are.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('rail-ui')
const kit = await startKit('rail-ui')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const DAY = 864e5
try {
  await kit.api('/setup', { name: 'Tester' })
  // Look for agents again: the server looked before the stand-in Claude Code was there.
  await kit.api('/agents/catalog')

  // ---------- The chief of staff: one place ----------
  // (Each part on its own: one that breaks is a failure, and the next part still runs.)
  const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
  await part('the chief of staff, not running', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    const row = p.locator('.rail-nav-btn.rail-chief')
    await row.waitFor({ timeout: 15000 }).catch(() => {})
    await p.waitForTimeout(1500)
    ok(await row.count() === 1 && /Hands work to the right agent/.test(await row.innerText()) && /sends the work to the right agent/i.test(await row.getAttribute('title') || ''), 'not running yet: its row at the top of the sidebar says what it does, under its name and in its tooltip', await row.innerText().catch(() => ''))
    const others = await p.locator('button').filter({ hasText: /^\s*Chief of Staff\s*$/ }).count()
    ok(others === 0 && await p.locator('.rail-foot, .ws-tab-tools .ghost-btn').count() === 0, 'and no second button to start it: not in the tabs, not at the foot of the sidebar', others)
    await shot(p, `${tag}rail-chief-none`)
    await row.click({ timeout: 5000 })
    const chief = await until(async () => (await kit.api('/fleet')).agents.find((a) => a.chief), 30000)
    ok(!!chief, 'the row starts it')
    ok(!!(await until(async () => /Chief of Staff/.test(await p.locator('.ws-tab.main').innerText().catch(() => '')), 15000)), 'and opens it', await p.locator('.ws-tabs').innerText().catch(() => ''))
    ok(!!(await until(async () => !/Hands work/.test(await row.innerText()), 5000)) && /right agent/.test(await row.getAttribute('title') || ''), 'opened from there once, the row is just its name (the tooltip still says what it does)', await row.innerText())
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  if (!(await kit.api('/fleet')).agents.some((a) => a.chief)) await kit.api('/chief/launch', {})
  const thread = await kit.api('/chief/threads', { name: 'Pricing page' })
  await until(async () => (await kit.api('/fleet')).agents.filter((a) => a.chief).length === 2, 20000)
  await part('the chief of staff, running', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight' })
    await p.waitForSelector('.rail-threads .rm-row', { timeout: 15000 }).catch(() => {})
    const navs = await p.locator('.rail-nav-btn').allInnerTexts()
    ok(navs.filter((x) => /Chief of Staff/.test(x)).length === 1, 'running, with a second thread: one Chief of Staff row in the sidebar', navs)
    ok((await p.locator('.rail-threads .rm-row').allInnerTexts()).map((x) => x.trim()).join('|') === 'Pricing page', 'its other thread is under it', await p.locator('.rail-threads').innerText().catch(() => ''))
    const spaces = await p.locator('.rail .ws-label').allInnerTexts()
    ok(!spaces.some((x) => /Chief of Staff/.test(x)) && await p.locator('.rail .tab-row', { hasText: 'Chief of Staff' }).count() === 0, 'and its space isn\'t listed again with the others', spaces)
    await p.locator('.rail-threads .rm-row', { hasText: 'Pricing page' }).click({ timeout: 5000 })
    ok(!!(await until(async () => (await p.locator('.ws-tab.main').innerText().catch(() => '')).includes('Pricing page'), 8000)) && await p.locator('.rail-threads .rm-row.on').count() === 1, 'a thread opens from there')
    // The chief's ⋯: what its row in its space had.
    await p.locator('.rail-chief-row').hover()
    await p.locator('.rail-chief-row .rail-nav-fold').click({ timeout: 5000 })
    const items = (await p.locator('.rail-chief-row .menu-item').allInnerTexts()).map((x) => x.trim())
    ok(['Browse folder', 'Mute notifications', 'Close tab…'].every((x) => items.includes(x)), 'its ⋯ menu has what its row in its space had', items)
    await p.keyboard.press('Escape')
    await shot(p, `${tag}rail-chief-running`)
    // ⌘K: one entry, which opens it.
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.pal-input input').fill('chief')
    await p.waitForTimeout(300)
    const found = (await p.locator('.pal-item .pal-text b').allInnerTexts()).map((x) => x.trim())
    ok(found.filter((x) => x === 'Chief of Staff').length === 1 && found.includes('Chief of Staff · Pricing page'), '⌘K: one Chief of Staff, and its other thread', found)
    await p.keyboard.press('Enter')
    ok(!!(await until(async () => (await p.locator('.ws-tab.main').innerText().catch(() => '')).trim().startsWith('Chief of Staff'), 8000)), 'which opens its Main thread', await p.locator('.ws-tab.main').innerText().catch(() => ''))
    // The tour points at the row.
    await p.evaluate(() => window.dispatchEvent(new Event('bridge-tour')))
    await p.locator('.tour-card').waitFor({ timeout: 5000 }).catch(() => {})
    for (let i = 0; i < 4 && !/Chief of Staff/.test(await p.locator('.tour-card h3').innerText().catch(() => '')); i++) { await p.locator('.tour-card .btn.primary').click(); await p.waitForTimeout(400) }
    // (The lit area glides from the step before, so it's looked at until it's there.)
    const lit = await until(() => p.evaluate(() => { const h = document.querySelector('.tour-hole')?.getBoundingClientRect(); const r = document.querySelector('.rail-chief')?.getBoundingClientRect(); return !!h && !!r && h.left <= r.left && h.right >= r.right && h.top <= r.top && h.bottom >= r.bottom && h.height < 120 }), 3000, 100)
    await shot(p, `${tag}rail-tour`)
    ok(/Your Chief of Staff/.test(await p.locator('.tour-card h3').innerText().catch(() => '')) && lit, 'the tour points at the row', await p.locator('.tour-card').innerText().catch(() => ''))
    await p.keyboard.press('Escape')
    // Folded down: one way to it, and no space of its own.
    await p.locator('.rail-btn').click()
    await p.waitForSelector('.rail.collapsed', { timeout: 5000 }).catch(() => {})
    ok(await p.locator('.rail.collapsed .mini-nav[aria-label="Chief of Staff"]').count() === 1 && await p.locator('.rail.collapsed .mini-ws').count() === 0, 'the sidebar folded down: one Chief of Staff, no space of its own', await p.locator('.rail.collapsed').innerHTML().then((h) => h.length))
    await p.locator('.rail-btn').click()
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  await kit.api(`/tabs/${encodeURIComponent((await kit.api('/fleet')).agents.find((a) => a.paneId === thread.paneId)?.tabId || '')}/close`, {}).catch(() => {})

  // ---------- A few hundred meetings ----------
  // 300 over the last year, from yesterday back (between 9 and 1), written as the server keeps
  // them; and one recording now.
  const titles = ['Weekly payments sync', '1:1 with Dana', 'Checkout launch review', 'Interview - Theo Park', 'Design crit', 'Standup', 'Vendor call', 'Planning']
  const now = Date.now()
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0)
  const made = []
  for (let i = 0; i < 300; i++) {
    const at = new Date(midnight); at.setDate(at.getDate() - 1 - Math.floor(i * 1.2)); at.setHours(9 + (i % 5))
    const id = `${at.toISOString().slice(0, 10)}-t${String(i).padStart(5, '0')}`
    const dir = path.join(kit.data, 'meetings', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'meeting.json'), JSON.stringify({ id, title: `${titles[i % titles.length]} ${i}`, startedAt: at.toISOString(), endedAt: new Date(+at + 1800e3).toISOString(), status: 'done', seconds: 1800, kind: 'general', call: 'off' }))
    made.push({ id, at })
  }
  const live = await kit.api('/meetings', { title: 'Pricing call now', call: false })
  const t0 = Date.now()
  const listed = (await kit.api('/meetings')).meetings
  const took = Date.now() - t0
  ok(listed.length === 301 && took < 3000, 'the server lists 301 meetings in well under a few seconds', { n: listed.length, ms: took })
  const older = listed.filter((m) => new Date(m.startedAt) < new Date(+midnight - 6 * DAY)).length
  const old = made[150] // about six months ago
  const oldTitle = listed.find((m) => m.id === old.id).title

  const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', store: { 'cc-rail-meetings': true } })
  const list = p.locator('.rail-meetings')
  await p.waitForSelector('.rail-meetings .rm-fold', { timeout: 20000 }).catch(() => {})
  const heads = async () => (await p.locator('.rail-meetings .rm-day-head').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
  const h = await heads()
  ok(/^TODAY \d+$/i.test(h[0] || '') && /^YESTERDAY \d+$/i.test(h[1] || '') && new RegExp(`^EARLIER ${older}$`, 'i').test(h.at(-1) || ''), 'the last week by day, then Earlier with how many are in it', h)
  ok(h.length <= 8, 'at most seven days and Earlier', h.length)
  const opened = await p.locator('.rail-meetings .rm-day-head[aria-expanded="true"]').count()
  ok(opened === 2, 'the two most recent days open, the rest folded', opened)
  const rows = await list.locator('.rm-row').count()
  ok(rows > 0 && rows <= 12, 'so a short list, not all 301', rows)
  ok(await list.locator('.rm-row', { hasText: 'Pricing call now' }).locator('.rec-dot').count() === 1, 'the one recording, with its dot')
  await shot(p, `${tag}rail-meetings`)
  // Folding Today keeps the one recording in sight.
  await list.locator('.rm-day-head').first().click()
  ok(await list.locator('.rm-day-head').first().getAttribute('aria-expanded') === 'false' && await list.locator('.rm-day').first().locator('.rm-row').count() === 1 && await list.locator('.rm-row', { hasText: 'Pricing call now' }).count() === 1, 'Today folded: only the one recording is left under it')
  // An old meeting opened: in sight under Earlier, folded as it is.
  await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id } })), old.id)
  const early = list.locator('.rm-earlier')
  ok(!!(await until(async () => (await early.locator('.rm-row.on', { hasText: oldTitle }).count()) === 1, 10000)) && await early.locator('.rm-row').count() === 1, 'the meeting open, from months ago, shows under Earlier while it\'s folded', await early.innerText().catch(() => ''))
  // Earlier, open: weeks, then months, each folded with its count.
  const t1 = await p.evaluate(async () => { const el = [...document.querySelectorAll('.rail-meetings .rm-day-head')].pop(); const s = performance.now(); el.click(); await new Promise((r) => requestAnimationFrame(() => r())); return performance.now() - s })
  const spans = (await early.locator('.rm-span-head').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
  ok(spans.length >= 8 && /^Week of \w+ \d+ \d+$/.test(spans[0]) && spans.some((x) => /^[A-Z][a-z]+( \d{4})? \d+$/.test(x)), 'Earlier opens on weeks, then months, each with how many', spans)
  ok(spans.reduce((n, x) => n + Number(x.split(' ').pop()), 0) === older, 'which add up to Earlier\'s', spans)
  ok(await early.locator('.rm-span-head[aria-expanded="true"]').count() === 0, 'all folded to start with')
  ok(t1 < 400, 'opening it takes a moment, not a wait', Math.round(t1))
  const month = early.locator('.rm-span', { has: p.locator('.rm-row.on') })
  await month.locator('.rm-span-head').click()
  const inMonth = await month.locator('.rm-row').count()
  ok(inMonth > 1 && /^[A-Z][a-z]{2} \d+$/.test((await month.locator('.rm-row .rm-time').first().innerText()).trim()), 'a month opens on its meetings, each with its date', { n: inMonth, d: await month.locator('.rm-row .rm-time').first().innerText().catch(() => '') })
  const nodes = await list.evaluate((el) => el.querySelectorAll('*').length)
  ok(nodes < 600, 'still a short list for the page to draw', nodes)
  await shot(p, `${tag}rail-meetings-earlier`)
  // Kept after a reload: Today folded, Earlier and that month open.
  await p.reload()
  await p.waitForSelector('.rail-meetings .rm-fold', { timeout: 20000 }).catch(() => {})
  await p.waitForTimeout(500)
  const again = await p.evaluate(() => [...document.querySelectorAll('.rail-meetings .rm-day-head, .rail-meetings .rm-span-head')].filter((e) => e.getAttribute('aria-expanded') === 'true').map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  ok(!again.some((x) => /^today/i.test(x)) && again.some((x) => /^yesterday/i.test(x)) && again.some((x) => /^earlier/i.test(x)) && again.length === 3, 'after a reload, what was open or folded stays so', again)
  // WebKit counts a request the reload cut off (the presence ping, the live feed) as a page error.
  ok(errors.filter((e) => !/\/api\/[\w/.-]+ due to access control checks/.test(e)).length === 0, 'no page errors', errors)
  await ctx.close()
  await kit.api(`/meetings/${live.id}/stop`, {}).catch(() => {})
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
