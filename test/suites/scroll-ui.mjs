// Scroll bars, in the browser named by BRIDGE_TEST_BROWSER, with every Beta Feature on and a lot in
// the app (60 meetings with their notes, 20 dictations, 30 whiteboards, a folder of 100 documents,
// six agents). Every scroll area has one look, as macOS draws its overlay scroll bars: thin, no
// track, and the thumb clear until the pointer is over that area or it's scrolled from the keys (a
// moment after, clear again), in the light look and the dark; a strip that hides its bar keeps it
// hidden; a terminal keeps its own; and the sheet editor's own reset, loaded when a sheet opens,
// doesn't undo it for the rest of the app. Then each main view scrolls in one place, at 1440x900 and
// at 1024x700 with the Agents panel under it: Home, Meetings, a meeting (its summary and transcript
// flowing down the page when its panel is that short), Studio's home and a document, a sheet and a
// page in it, Files in a folder of 100, Whiteboards, Agent Map, Dictations, Usage and Settings.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, withoutCutOff, TEST, ROOT } from '../lib/harness.mjs'

const { ok, skip, done } = checks('scroll-ui')
const trials = Object.fromEntries([...fs.readFileSync(path.join(ROOT, 'src', 'trials.js'), 'utf8').matchAll(/\{ id: '([a-z-]+)'/g)].map((m) => [m[1], true]))
const kit = await startKit('scroll-ui', { config: { trials } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const CLEAR = /^rgba\(0, 0, 0, 0\) rgba\(0, 0, 0, 0\)$|^transparent transparent$/
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  // ---------- A lot in every view ----------
  for (const [space, label] of [['Shop', 'Cart'], ['Shop', 'Checkout'], ['Docs', 'Guides'], ['Api', 'Billing'], ['Api', 'Auth'], ['Site', 'Landing']]) {
    const dir = path.join(kit.home, 'code', space.toLowerCase())
    fs.mkdirSync(dir, { recursive: true })
    await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: space, prompt: 'idle' })
  }
  const titles = ['Weekly payments sync', '1:1 with Dana', 'Checkout launch review', 'Interview - Theo Park', 'Design crit', 'Standup', 'Vendor call', 'Planning']
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
  for (let i = 0; i < 60; i++) {
    const at = new Date(midnight); at.setDate(at.getDate() - 1 - Math.floor(i * 1.3)); at.setHours(9 + (i % 5))
    const id = `${at.toISOString().slice(0, 10)}-t${String(i).padStart(5, '0')}`
    const dir = path.join(kit.data, 'meetings', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'meeting.json'), JSON.stringify({ id, title: `${titles[i % titles.length]} ${i}`, startedAt: at.toISOString(), endedAt: new Date(+at + 1800e3).toISOString(), status: 'done', seconds: 1800, kind: 'general', call: 'off' }))
    fs.writeFileSync(path.join(dir, 'summary.md'), `## ${titles[i % titles.length]}\n\n${Array.from({ length: 30 }, (_, k) => `- Point ${k}: the launch, the numbers and who does what next.`).join('\n')}\n`)
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'), Array.from({ length: 80 }, (_, k) => JSON.stringify({ src: k % 2 ? 'them' : 'you', t0: k * 20, t1: k * 20 + 15, text: `Line ${k} of what was said about the launch and the numbers for this quarter.`, engine: 'test' })).join('\n') + '\n')
  }
  for (let i = 0; i < 20; i++) await kit.api('/dictations', { text: `Remind me about the launch, part ${i}`, ms: 1500 })
  for (let i = 0; i < 30; i++) await kit.api('/boards', { title: `Board ${i}` })
  const docs = path.join(kit.home, 'Work')
  fs.mkdirSync(docs, { recursive: true })
  for (let i = 0; i < 70; i++) fs.writeFileSync(path.join(docs, `notes-${i}.md`), `# Notes ${i}\n\n${Array.from({ length: 80 }, (_, k) => `Paragraph ${k}: the plan for the quarter and what comes next.`).join('\n\n')}\n`)
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(docs, `data-${i}.csv`), `a,b,c\n${Array.from({ length: 200 }, (_, k) => `${k},${k * 2},${k * 3}`).join('\n')}\n`)
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(docs, `page-${i}.html`), `<!doctype html><title>Page ${i}</title><h1>Page ${i}</h1>`)
  const place = (await kit.api('/places', { path: docs })).place
  await until(async () => (await kit.api('/fleet')).agents.length >= 6, 30000)
  const store = { 'cc-rail-meetings': true, 'cc-rail-dictations': true }
  const open = (p, paneId) => p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), paneId)
  const colorOf = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).scrollbarColor : null }, sel)
  const widthOf = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).scrollbarWidth : null }, sel)
  // A thumb's color as [r, g, b, alpha], and the track's.
  const parts = (c) => { const n = String(c || '').match(/-?[\d.]+/g)?.map(Number) || []; return /color\(srgb/.test(c) ? [[n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1], n.slice(4)] : [n.slice(0, 4), n.slice(4)] }

  // ---------- One look, in the dark and the light ----------
  for (const mode of ['dark', 'light']) {
    const { ctx, p, errors } = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', store })
    await p.waitForSelector('.rail .tab-row', { timeout: 20000 }).catch(() => {})
    await open(p, 'view:meetings')
    await p.locator('.mt-home .mt-row').first().waitFor({ timeout: 15000 }).catch(() => {})
    await p.mouse.move(700, 20) // over the top bar: no scroll area
    await p.waitForTimeout(200)
    // A browser without scroll bar colours (WebKit before Safari 26, as CI's macOS 15 has): the
    // fallback is what draws them (thin, no track, a faint thumb always there); the rest is for one with.
    const modern = await p.evaluate(() => CSS.supports('scrollbar-color', 'auto'))
    if (!modern) {
      const fallback = await p.evaluate(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules] } catch { return [] } }).some((r) => r instanceof CSSSupportsRule && /not\s*\(scrollbar-color/.test(r.conditionText) && CSS.supports(r.conditionText) && /::-webkit-scrollbar-thumb[^}]*border-radius/.test(r.cssText) && /::-webkit-scrollbar\s*\{[^}]*width: 10px/.test(r.cssText)))
      ok(fallback && await widthOf(p, '.ws-tabs-scroll') === 'none', `${mode}: no scroll bar colours in this browser: its scroll bars are drawn thin with no track and a faint thumb, and the tab strip still hides its bar`, { fallback })
      skip(`${mode}: the thumb only over an area or while it scrolls`, 'this browser has no scroll bar colours to show it with')
      await shot(p, `${tag}scroll-rest-${mode}`)
      ok(withoutCutOff(errors).length === 0, `${mode}: no page errors`, errors)
      await ctx.close()
      continue
    }
    const rest = { rail: await colorOf(p, '.rail-scroll'), meetings: await colorOf(p, '.mt-home'), width: [await widthOf(p, '.rail-scroll'), await widthOf(p, '.mt-home')] }
    ok(CLEAR.test(rest.rail) && CLEAR.test(rest.meetings) && rest.width.every((w) => w === 'thin'), `${mode}: at rest, the sidebar's and Meetings' scroll bars are thin and clear, with no track`, rest)
    await shot(p, `${tag}scroll-rest-${mode}`)
    // The pointer over Meetings: its thumb, not the sidebar's.
    const box = await p.locator('.mt-home').boundingBox()
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await p.waitForTimeout(200)
    const over = { meetings: await colorOf(p, '.mt-home'), rail: await colorOf(p, '.rail-scroll') }
    const [thumb, track] = parts(over.meetings)
    ok(thumb[3] > 0.2 && thumb[3] < 0.6 && (track[3] ?? 0) === 0 && CLEAR.test(over.rail), `${mode}: the pointer over Meetings shows its thumb (no track), and not the sidebar's`, over)
    ok(mode === 'dark' ? thumb[0] > 150 : thumb[0] < 100, `${mode}: a ${mode === 'dark' ? 'light' : 'dark'} thumb, as on a ${mode} page`, thumb)
    await shot(p, `${tag}scroll-over-${mode}`)
    // Scrolled from the keys with the pointer elsewhere: the thumb while it scrolls, clear again after.
    await p.mouse.move(700, 20)
    await p.locator('.mt-home').evaluate((e) => { e.tabIndex = -1; e.focus() })
    await p.keyboard.press('PageDown')
    const keyed = await until(async () => !CLEAR.test(await colorOf(p, '.mt-home')) && await colorOf(p, '.mt-home'), 2000, 50)
    ok(!!keyed && CLEAR.test(await colorOf(p, '.rail-scroll')), `${mode}: scrolled from the keys, Meetings shows its thumb while it scrolls`, keyed)
    ok(!!(await until(async () => CLEAR.test(await colorOf(p, '.mt-home')), 3000, 100)), `${mode}: and a moment after, it's clear again`, await colorOf(p, '.mt-home'))
    // The app scrolling by itself (not you): no thumb.
    await p.waitForTimeout(800)
    await p.locator('.mt-home').evaluate((e) => { e.scrollTop += 200 })
    await p.waitForTimeout(100)
    ok(CLEAR.test(await colorOf(p, '.mt-home')), `${mode}: the app scrolling it by itself shows no thumb`, await colorOf(p, '.mt-home'))
    // A strip that hides its bar keeps it hidden.
    ok(await widthOf(p, '.ws-tabs-scroll') === 'none', `${mode}: the tab strip still hides its bar`, await widthOf(p, '.ws-tabs-scroll'))
    if (mode === 'dark') {
      // A terminal keeps its own colors.
      await p.locator('.rail-tool[aria-label="New terminal"]').click()
      const term = await until(async () => (await p.locator('.live-term .xterm-viewport').count()) > 0 && await colorOf(p, '.live-term .xterm-viewport'), 15000)
      ok(!!term && !CLEAR.test(term) && term !== over.meetings, 'a terminal keeps its own scroll bar, in its own colors', term)
      // A sheet opened in Studio brings the sheet editor's reset for every element; the rest of the app keeps its look.
      await p.evaluate((d) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: d })), { root: `place:${place.id}`, path: 'data-1.csv' })
      await p.locator('.sd-univer canvas').first().waitFor({ timeout: 30000 }).catch(() => {})
      await p.mouse.move(700, 20)
      await p.waitForTimeout(500)
      const after = { rail: await colorOf(p, '.rail-scroll'), width: await widthOf(p, '.rail-scroll'), sheet: await p.locator('.sd-univer').count() }
      ok(after.sheet === 1 && CLEAR.test(after.rail) && after.width === 'thin', 'with a sheet open (its editor\'s own styles loaded), the sidebar\'s bar is still thin and clear', after)
    }
    ok(withoutCutOff(errors).length === 0, `${mode}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- Each view scrolls in one place ----------
  // Every scroll area on the page, and the one it's in that scrolls too, if any: what shows two bars.
  const nested = (p) => p.evaluate(() => {
    const over = (v) => /(auto|scroll)/.test(v)
    const scrolls = (e) => {
      if (!e.clientWidth || !e.clientHeight) return false
      const s = getComputedStyle(e)
      return (over(s.overflowY) && e.scrollHeight > e.clientHeight + 1) || (over(s.overflowX) && s.scrollbarWidth !== 'none' && e.scrollWidth > e.clientWidth + 1)
    }
    const name = (e) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`
    const out = []
    for (const e of document.querySelectorAll('*')) {
      if (!e.getClientRects().length || !scrolls(e)) continue
      for (let up = e.parentElement; up; up = up.parentElement) if (scrolls(up)) { out.push(`${name(e)} in ${name(up)}`); break }
    }
    return out
  })
  const mid = (await kit.api('/meetings')).meetings[0].id
  const studio = (f) => (p) => p.evaluate((d) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: d })), { root: `place:${place.id}`, path: f })
  const VIEWS = [
    ['Home', (p) => open(p, 'view:home'), '.hm'],
    ['Meetings', (p) => open(p, 'view:meetings'), '.mt-home .mt-row'],
    ['a meeting', (p) => p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id } })), mid), '.mt-page .mt-line'],
    ['Studio\'s home', (p) => open(p, 'view:studio'), '.sd-home .sd-file-name'],
    ['a document in Studio', studio('notes-1.md'), '.sd-desk'],
    ['a sheet in Studio', studio('data-1.csv'), '.sd-univer canvas'],
    ['a page in Studio', studio('page-1.html'), '.sd-page-ed'],
    ['Files, in a folder of 100', async (p) => { await open(p, 'view:files'); await p.locator('.fx-side-row', { hasText: 'Work' }).first().click({ timeout: 15000 }) }, '.fx-body :text("notes-2.md")'],
    ['Whiteboards', (p) => open(p, 'view:whiteboards'), '.wb-home'],
    ['Agent Map', (p) => open(p, 'view:map'), '.am-row'],
    ['Dictations', (p) => open(p, 'view:dictations'), '.dc-home'],
    ['Usage', async (p) => {
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-card', { detail: { id: 'gauge' } })))
      await p.locator('.usage-card button', { hasText: 'Stats, patterns and history' }).first().click({ timeout: 15000 })
    }, '.ustats'],
    ...['General', 'Model Providers', 'Meetings', 'Devices', 'About & Updates'].map((s) => [`Settings › ${s}`, async (p) => {
      if (!(await p.locator('.modal.settings').count())) await p.locator('button[aria-label="Settings"]').first().click()
      await p.locator('.st-nav-item', { hasText: s }).first().click({ timeout: 8000 })
    }, '.modal.settings .st-scroll']),
  ]
  for (const [width, height] of [[1440, 900], [1024, 700]]) {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', width, height, store })
    await p.waitForSelector('.rail .tab-row', { timeout: 20000 }).catch(() => {})
    const twice = []
    for (const [name, go, ready] of VIEWS) {
      // The usage card is a desktop popover that needs room for the Today panel beside it.
      if (name === 'Usage' && width < 1440) continue
      try {
        await go(p)
        await p.locator(ready).first().waitFor({ timeout: 20000 })
        await p.waitForTimeout(600)
        const found = await nested(p)
        if (found.length) twice.push({ name, found })
        if (name === 'a meeting') await shot(p, `${tag}scroll-meeting-${width}`)
      } catch (e) { twice.push({ name, failed: e.message.split('\n')[0] }) }
    }
    ok(!twice.length, `${width}x${height}: Home, Meetings, a meeting, Studio's home and a document, sheet and page in it, Files, Whiteboards, Agent Map, Dictations, Usage and Settings each scroll in one place, none with a scroll area inside another`, twice)
    ok(withoutCutOff(errors).filter((e) => !/sandboxed and lacks the 'allow-same-origin'/.test(e)).length === 0, `${width}x${height}: no page errors`, errors)
    await ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
