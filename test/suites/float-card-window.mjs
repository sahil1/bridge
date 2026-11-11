// The floating card in a real window of the desktop app's (Electron, made and fitted as
// desktop/main.js does it: test/stand-ins/float-window.cjs), zoomed as ⌘+ and ⌘− in the main window
// zoom it. At each zoom from 83% to 207%, each kind of card (a meeting recording, slim and open with
// AI Assist's suggestion; one whose call ended with no sound from it; a call that started; a meeting
// about to start, with its prep; what needs you) is whole in its window, with room for its shadow and
// no more, and nothing in it runs past its edge or is cut off. The same in each of the app's
// languages. And on a short screen, opened, it's no taller than the screen, zoomed or not. Resized
// by its edges and corners as any window (a stand-in pointer, so the real one stays put): the edge
// follows the pointer and the other stays, the card fills its window, taller shows more of what's
// been said, the size is kept, and a double-click puts it back. While the screen is shared (a
// stand-in for native/callwatch): a meeting about to start and what needs you aren't shown, and
// come back by themselves once it stops; the meeting being recorded's card goes to the menu bar and
// comes back as it was, where it was (not for Bridge AI's own look at the screen). A reminder's menu by its
// ×, whole in the window: Remind me 1 min before (put off, and the app told to look again now), Hide
// until the next meeting, and Turn off meeting reminders, asked first, saying where they come back.
// 3.13.2's card at 110% (⌘+ once): its window stayed the card's size at 100%, which cut it off on
// the right and at the bottom.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { checks, startKit, electronBin, until, TEST, OUT } from '../lib/harness.mjs'

const { ok, skip, done } = checks('float-card-window')
const electron = electronBin()

// Linux with no screen (CI): one of its own, if the computer has Xvfb.
async function display() {
  if (process.platform !== 'linux' || process.env.DISPLAY) return {}
  const n = 90 + Math.floor(Math.random() * 400)
  const x = spawn('Xvfb', [`:${n}`, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: 'ignore' })
  const failed = await new Promise((r) => { x.once('error', () => r(true)); setTimeout(() => r(false), 1000) })
  return failed ? null : { DISPLAY: `:${n}`, xvfb: x }
}
const screenOk = electron ? await display() : null
if (!electron || !screenOk) {
  skip('the floating card in a real window', !electron ? "Electron isn't installed (npm install in desktop/, or set BRIDGE_TEST_ELECTRON)" : 'no screen, and no Xvfb to make one')
  process.exit(done().fail ? 1 : 0)
}

const kit = await startKit('float-card-window')
const { _electron } = await import('playwright-core')
// Whether the screen is shared: a stand-in for native/callwatch sharing, saying what bin/sharing.json
// says, a line each time it changes, as the helper does (not on Windows, which can't tell).
const shareBin = process.platform === 'win32' ? null : path.join(kit.bin, 'callwatch')
if (shareBin) {
  fs.writeFileSync(`${shareBin}.cjs`, `const fs = require('node:fs'), path = require('node:path'), parent = process.ppid
let last = ''
const look = () => { let v = false; try { v = JSON.parse(fs.readFileSync(path.join(__dirname, 'sharing.json'), 'utf8')).sharing } catch {} const line = JSON.stringify({ sharing: v }); if (line !== last) { last = line; process.stdout.write(line + '\\n') } }
look(); setInterval(look, 100)
setInterval(() => { try { process.kill(parent, 0) } catch { process.exit(0) } }, 500)`)
  fs.writeFileSync(shareBin, `#!/bin/sh\nexec "${process.execPath}" "${shareBin}.cjs" "$@"\n`, { mode: 0o755 })
}
const sharing = (v) => fs.writeFileSync(path.join(kit.bin, 'sharing.json'), JSON.stringify({ sharing: v }))
const env = { ...process.env, KIT_URL: kit.url, ...(shareBin ? { BRIDGE_CALLWATCH: shareBin } : {}), ...(screenOk.DISPLAY ? { DISPLAY: screenOk.DISPLAY } : {}) }
delete env.ELECTRON_RUN_AS_NODE
let el = null
try {
  el = await _electron.launch({ executablePath: electron, args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), path.join(TEST, 'stand-ins', 'float-window.cjs')], env, timeout: 60000 })
  const ctx = el.context()
  const now = Date.now()
  const ID = 'm-fit'
  const TITLE = 'Quarterly plan with the platform and design teams'
  const rec = (o = {}) => ({ id: ID, title: TITLE, status: 'recording', startedAt: new Date(now - 754000).toISOString(), seconds: 754, callApps: ['Zoom'], callEnded: null, callEndedApp: null, stopsAt: null, callQuiet: false, ...o })
  const base = { watching: true, calls: [], detect: true, float: 'meetings', floatHover: true, prompt: null, recording: null, soon: null }
  const soon = { id: 'ev-fit', title: 'Design review: onboarding for teams and their admins', start: new Date(now + 8 * 60000).toISOString(), end: new Date(now + 53 * 60000).toISOString(), join: 'https://meet.example.com/abc-defg-hij', attendees: ['priya@example.com', 'alex@example.com', 'sam@example.com'] }
  // Each kind of card: what /api/calls says, and what shows once the card is it.
  const KINDS = [
    { name: 'recording, slim', calls: { ...base, recording: rec() }, ready: '.float-card.slim .fc-time' },
    { name: 'recording, open', calls: { ...base, recording: rec() }, open: true, ready: '.float-card .fc-more .fc-stop' },
    { name: 'the call ended, with no sound from it', calls: { ...base, recording: rec({ callEnded: 'ended', callEndedApp: 'Zoom', stopsAt: new Date(now + 90000).toISOString(), callQuiet: true }) }, ready: '.float-card .fc-banner.fc-quiet' },
    { name: 'a call started', calls: { ...base, prompt: { app: 'Microsoft Teams', at: now, browser: false } }, ready: '.float-card .fc-ask .fc-badge' },
    { name: 'a meeting about to start', calls: { ...base, soon }, ready: '.float-card .prep-glance .pg-item' },
    { name: 'what needs you', calls: { ...base, float: 'always' }, ready: '.float-card .fc-mark' },
  ]
  let calls = KINDS[0].calls
  await ctx.route(/\/api\/calls(\?|$)/, (r) => r.fulfill({ json: calls }))
  // The meeting as it records: lines said, AI Assist's suggestion, the call's sound, a section.
  await ctx.route(new RegExp(`/api/meetings/${ID}(\\?|$)`), (r) => r.fulfill({ json: {
    id: ID, title: TITLE, status: 'recording', call: 'on', me: 'Sam', assist: true, levels: { you: 0.4, them: 0.6 },
    // An Idea, as the owner saw: it took the Ideas list's .idea, laid out with its words 18 pixels wide.
    assistItems: [{ id: 'a1', t: 300, kind: 'idea', text: 'Ask each integration lead to name the one dependency that would slip their date, and who owns unblocking it.', why: 'Just said', state: 'new' }],
    transcript: [
      ...Array.from({ length: 9 }, (_, i) => ({ src: i % 2 ? 'them' : 'you', t0: 600 + i * 10, t1: 606 + i * 10, text: `Earlier line ${i + 1}: where the pilot stands, and who's waiting on what.` })),
      { src: 'you', t0: 700, t1: 706, text: "Let's go through the rollout plan for the second quarter first." },
      { src: 'them', t0: 707, t1: 715, name: 'Priya Raman', text: 'Sure. The platform team needs two more weeks for the migration.' },
      { src: 'you', t0: 716, t1: 720, text: 'Okay, what does that do to the launch date?' },
    ],
    sections: [{ title: 'Intro' }, { title: 'Rollout plan and dates' }],
    event: { end: new Date(now + 20 * 60000).toISOString(), attendees: ['a', 'b', 'c', 'd', 'e', 'f'] },
  } }))
  await ctx.route(/\/api\/prep(\?|$)/, (r) => r.fulfill({ json: {
    writer: true,
    suggest: { label: 'Claude Sonnet 5.5', at: new Date(now - 60000).toISOString(), items: [
      { kind: 'goal', text: 'Agree on who owns the admin invite flow' },
      { kind: 'question', text: 'Does the new onboarding still work for teams on single sign-on?' },
      { kind: 'question', text: 'What did support hear most last month?' },
    ] },
    people: { known: [{ name: 'Priya Raman' }], new: ['alex@example.com'], more: 1, insights: true },
    last: { title: soon.title, startedAt: new Date(now - 7 * 86400000).toISOString(), yours: [1, 2], theirs: [1] },
  } }))
  await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-float-pin', '0') } catch { /* no storage */ } })
  const main = await el.firstWindow()
  await main.waitForLoadState('domcontentloaded')
  // The main window recording this meeting, with a screen to watch (the card's Watch screen).
  const live = () => main.evaluate((id) => {
    clearInterval(window.__live)
    const ch = new BroadcastChannel('bridge-meetings')
    const say = () => ch.postMessage({ type: 'state', rec: { id, title: 'x', paused: false, section: null }, elapsed: 754, you: 0.4, screen: null, canWatch: true })
    say()
    window.__live = setInterval(say, 250)
  }, ID)
  await live()
  await el.evaluate(() => globalThis.openFloat())
  const card = await until(() => el.windows().find((w) => w.url().includes('float=1')), 15000, 100)
  ok(!!card, 'the card opens in a window of its own')
  if (!card) throw new Error('no card')
  await card.waitForSelector('.float-card', { timeout: 15000 })

  // A picture of the window as it is on the screen (Playwright's own is of the page at 100%).
  const capture = async (name) => {
    const png = await el.evaluate(async () => (await globalThis.floatWin.webContents.capturePage()).toPNG().toString('base64')).catch(() => null)
    if (!png) return
    fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })
    fs.writeFileSync(path.join(OUT, 'shots', `${name}.png`), Buffer.from(png, 'base64'))
  }
  const zoomTo = (level) => el.evaluate((_e, l) => globalThis.mainWin.webContents.setZoomLevel(l), level)
  const zoomOf = () => el.evaluate(() => globalThis.floatWin.webContents.getZoomFactor())
  const sizeOf = () => el.evaluate(() => globalThis.floatWin.getContentSize())
  // Where the card is in its window, in the page's pixels, and what in it runs past its edge or is
  // cut off sideways (rather than wrapping or ending in …).
  const look = () => card.evaluate(() => {
    const c = document.querySelector('.float-card')
    if (!c) return null
    const r = c.getBoundingClientRect()
    const past = []
    const cut = []
    // (The bands to resize it by go a little past its edge on purpose.)
    for (const e of c.querySelectorAll(':scope *:not(.fc-grip)')) {
      const b = e.getBoundingClientRect()
      if (!b.width || !b.height) continue
      const what = `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).trim().replace(/\s+/g, '.')}`
      if (b.right > r.right + 0.5 || b.left < r.left - 0.5) past.push(`${what} ${Math.round(b.left - r.left)}…${Math.round(b.right - r.left)} of ${Math.round(r.width)}`)
      const s = getComputedStyle(e)
      if (e.scrollWidth > e.clientWidth + 1 && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis' && !e.matches('.fc-more, input')) cut.push(`${what}: ${e.scrollWidth} in ${e.clientWidth}`)
    }
    return { left: r.left, top: r.top, right: innerWidth - r.right, bottom: innerHeight - r.bottom, w: Math.round(r.width), h: Math.round(r.height), past: past.slice(0, 6), cut: cut.slice(0, 6) }
  })
  // Whole, with room for its shadow (12 of the page's pixels around it) and no more, once it's fitted.
  const whole = (l, snug = true) => !!l && l.left >= 6 && l.top >= 6 && l.right >= 6 && l.bottom >= 6 && (!snug || (l.right <= 14 && l.bottom <= 14))
  const show = async (k) => {
    calls = k.calls
    await card.mouse.move(1, 1)
    await until(() => card.$(k.ready), 8000, 100)
    if (k.open) {
      await card.hover('.float-card .fc-head').catch(() => {})
      await until(() => card.$(k.ready), 5000, 100)
    }
    return !!(await card.$(k.ready))
  }

  // ---------- Each kind of card, at each zoom ----------
  // The zoom levels ⌘+ and ⌘− step through (Electron's: 1.2 to the power of each), 83% to 207%.
  const LEVELS = [-1, 0, 0.5, 1, 1.5, 2, 3, 4]
  for (const k of KINDS) {
    ok(await show(k), `${k.name}: the card shows it`, k.ready)
    const bad = []
    for (const level of LEVELS) {
      await zoomTo(level)
      const z = await zoomOf()
      const l = await until(async () => { const x = await look(); return whole(x) && Math.abs(x.w * z + 24 * z - (await sizeOf())[0]) <= 2 ? x : null }, 4000, 100) || await look()
      if (!whole(l) || l.past.length || l.cut.length) bad.push({ zoom: `${Math.round(z * 100)}%`, window: await sizeOf(), ...l })
      if (level === 0 || level === 0.5) await capture(`float-${k.name.replace(/\W+/g, '-')}-${Math.round(z * 100)}`)
    }
    ok(!bad.length, `${k.name}: whole in its window at every zoom from 83% to 207%, nothing in it past its edge or cut off`, bad.slice(0, 3))
  }
  await zoomTo(0)

  // ---------- Resized by its edges and corners ----------
  {
    const bounds = () => el.evaluate(() => globalThis.floatWin.getBounds())
    const point = (x, y) => el.evaluate((_e, q) => { globalThis.cursor = q }, { x, y })
    // Takes the grip, moves the stand-in pointer by (dx, dy) on the screen, and lets go.
    const resize = async (g, dx, dy) => {
      const box = await card.locator(`.fc-grip.${g}`).boundingBox()
      if (!box) return null
      await point(1000, 500)
      await card.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await card.mouse.down()
      await point(1000 + dx, 500 + dy)
      await until(async () => { const b = await bounds(); return b.width !== before.width || b.height !== before.height }, 3000, 50)
      await until(async () => whole(await look()), 3000, 50)
      await card.mouse.up()
      await point(null)
      return bounds()
    }
    let before
    const k = KINDS.find((x) => x.name.startsWith('the call ended')) // open while recording, as tall as it gets
    await show(k)
    await until(async () => whole(await look()), 4000, 100)
    const grips = await card.$$eval('.fc-grip', (g) => g.map((x) => x.className.replace('fc-grip ', '')).sort().join(' '))
    ok(grips === 'e n ne nw s se sw w', 'open while recording: it resizes by each edge and corner', grips)
    before = await bounds()
    const wider = await resize('w', -120, 0)
    const l1 = await look()
    ok(wider && wider.width === before.width + 120 && wider.x + wider.width === before.x + before.width && whole(l1) && l1.w === before.width + 120 - 24, 'its left edge dragged 120 points left: the window 120 wider, its right edge where it was, the card filling it', { before, wider, card: l1 })
    before = await bounds()
    const lines0 = await card.$$eval('.fc-said-line', (x) => x.length)
    // As far as the screen lets it (CI's screens are short): no taller than it less 8 points each
    // side, nor past its bottom but for the 12 around the card.
    const wa = await el.evaluate(({ screen }) => screen.getDisplayMatching(globalThis.floatWin.getBounds()).workArea)
    const want = Math.min(before.height + 160, wa.height - 16, wa.y + wa.height + 12 - before.y)
    const taller = await resize('se', 0, 160)
    const l2 = await look()
    const said = await card.evaluate(() => { const b = document.querySelector('.fc-said'); const last = [...b.querySelectorAll('.fc-said-line')].pop(); const r = b.getBoundingClientRect(), q = last?.getBoundingClientRect(); return { lines: b.querySelectorAll('.fc-said-line').length, lastShown: !!q && q.bottom <= r.bottom + 1 && q.top >= r.top - 1 } })
    ok(taller && Math.abs(taller.height - want) <= 1 && taller.height > before.height && taller.y === before.y && whole(l2) && said.lines > lines0 && said.lastShown, 'its bottom right corner dragged 160 down: that much taller (as far as the screen lets it), its top where it was, and more of what\'s been said shows, the newest line in view', { before, taller, want, wa, card: l2, said, lines0 })
    await capture('float-resized')
    const kept = await card.evaluate(() => JSON.parse(localStorage.getItem('cc-float-size') || 'null'))
    ok(kept?.w === l1.w && kept?.h === l2.h, 'the size is kept on this computer', kept)
    await card.reload()
    await card.waitForSelector(k.ready, { timeout: 15000 }).catch(() => {})
    const again = await until(async () => { const b = await bounds(); return Math.abs(b.width - taller.width) <= 1 && Math.abs(b.height - taller.height) <= 1 ? b : null }, 5000, 100)
    ok(!!again, 'opened again, it\'s the size it was given', { again: await bounds(), taller })
    // Slim, only sideways (its height is its bar's), at the width it was given.
    calls = KINDS[0].calls
    await card.mouse.move(1, 1)
    await until(() => card.$(KINDS[0].ready), 8000, 100)
    const slim = await card.$$eval('.fc-grip', (g) => g.map((x) => x.className.replace('fc-grip ', '')).sort().join(' '))
    const ls = await until(async () => { const x = await look(); return whole(x) ? x : null }, 4000, 100)
    ok(slim === 'e w' && ls?.w === l1.w, 'slim, it resizes only sideways, at the width it was given', { slim, card: ls })
    // Zoomed, the edge still follows the pointer and the card still fits (open first: the pointer
    // on its edge opens it).
    await zoomTo(2)
    await card.hover('.float-card .fc-head').catch(() => {})
    await until(() => card.$(KINDS[1].ready), 5000, 100)
    await until(async () => whole(await look()), 4000, 100)
    before = await bounds()
    const zoomed = await resize('w', -90, 0)
    const lz = await look()
    // (Let go, the window fits the card again, to the point above at this zoom.)
    ok(zoomed && Math.abs(zoomed.width - (before.width + 90)) <= 1 && zoomed.x + zoomed.width === before.x + before.width && whole(lz), 'zoomed to 144%, its left edge follows the pointer and the card fills the window', { before, zoomed, card: lz })
    await zoomTo(0)
    await card.locator('.fc-grip.e').dblclick()
    const usual = await until(async () => { const x = await look(); return whole(x) && x.w === 300 ? x : null }, 4000, 100)
    ok(!!usual && !(await card.evaluate(() => localStorage.getItem('cc-float-size'))), 'a double-click on an edge: its usual size again', await look())
  }

  // ---------- In each language ----------
  // The card's words at 100% (a word takes the same room in the page's pixels at any zoom).
  for (const lang of ['de', 'es', 'fr', 'hi', 'ja', 'pt-BR', 'zh-CN']) {
    // (The main window reloads in the new language too, so it's told it records again.)
    const again = main.waitForEvent('load', { timeout: 10000 }).catch(() => null)
    await card.evaluate((v) => localStorage.setItem('cc-lang', JSON.stringify(v)), lang)
    await again
    await live()
    calls = KINDS[0].calls
    await card.reload()
    await card.waitForSelector('.float-card', { timeout: 15000 })
    const bad = []
    for (const k of KINDS.slice(1)) {
      if (!(await show(k))) { bad.push({ kind: k.name, shown: false }); continue }
      if (k.open && !(await until(() => card.$('.fc-modes .fc-chip:not(.fc-ai)'), 3000, 100))) bad.push({ kind: k.name, watch: 'no Watch screen' })
      const l = await until(async () => { const x = await look(); return whole(x) ? x : null }, 4000, 100) || await look()
      if (!whole(l) || l.past.length || l.cut.length) bad.push({ kind: k.name, ...l })
      if (k.open) await capture(`float-${lang}-open`)
    }
    ok(!bad.length, `${lang}: every kind of card whole, nothing past its edge or cut off`, bad.slice(0, 3))
  }
  await card.evaluate(() => localStorage.setItem('cc-lang', JSON.stringify('en')))

  // ---------- While the screen is shared ----------
  // Placed as desktop/main.js places it (floatshare.js), with the stand-in saying when the screen is
  // shared: a meeting about to start, or what needs you, isn't shown while it is, and comes back by
  // itself once it stops; the meeting being recorded's goes to the menu bar and comes back after.
  if (shareBin) {
    const visible = () => el.evaluate(() => globalThis.floatWin.isVisible())
    const placed = (c) => el.evaluate((_e, c) => globalThis.placeCard(c), c)
    const soonK = KINDS.find((x) => x.name === 'a meeting about to start')
    sharing(false)
    await show(soonK)
    const p0 = await until(async () => { const p = await placed(soonK.calls); return p.show && await visible() && p }, 5000, 100)
    ok(!!p0, 'nothing shared: the reminder shows', p0)
    sharing(true)
    ok(!!(await until(async () => !(await visible()), 5000, 100)), 'a call starts sharing the screen: the reminder goes, by itself', await placed(soonK.calls))
    const held = await placed(soonK.calls)
    ok(held.held && !held.show && !(await visible()), 'and stays gone while it shares (looked at again)', held)
    const needs = KINDS.find((x) => x.name === 'what needs you')
    const pn = await placed(needs.calls)
    ok(pn.held && !(await visible()), 'what needs you waits too', pn)
    await show(soonK)
    await placed(soonK.calls)
    sharing(false)
    ok(!!(await until(() => visible(), 5000, 100)), 'the share ends: the reminder comes back by itself, still wanted')
    await capture('float-reminder-after-sharing')

    // The meeting being recorded: to the menu bar while the screen is shared, and back after as it
    // was (slim, or pinned open) and where it was. Bridge AI's own looks at the screen (stood in for)
    // aren't a share: watching a screen keeps the card; a look at the call's window doesn't move it.
    const own = (o) => el.evaluate((_e, o) => { globalThis.own = o }, { watching: false, capturing: false, ...o })
    const bounds = () => el.evaluate(() => globalThis.floatWin.getBounds())
    const opened = () => card.evaluate(() => !document.querySelector('.float-card')?.classList.contains('slim'))
    for (const pin of [false, true]) {
      const recK = KINDS[0]
      calls = recK.calls
      await card.reload()
      await card.waitForSelector('.float-card .fc-time', { timeout: 15000 })
      await until(async () => (await placed(recK.calls)).show && await visible(), 5000, 100)
      if (pin) {
        await card.hover('.float-card .fc-head')
        await card.click('.float-card .fc-links button[aria-label="Pin it open"]')
      }
      await card.mouse.move(1, 1)
      const was = await until(async () => ((await opened()) === pin ? 'yes' : null), 5000, 100)
      ok(!!was, pin ? 'the meeting\'s card pinned open' : 'the meeting\'s card slim', await opened())
      const at0 = await bounds()
      sharing(true)
      ok(!!(await until(async () => !(await visible()), 5000, 100)), `${pin ? 'pinned open' : 'slim'}: a call starts sharing the screen, and the meeting's card goes, by itself`)
      const pr = await placed(recK.calls)
      ok(pr.bar && pr.moved && !pr.show, 'to the menu bar (its time, Pause, Stop and the rest in its menu)', pr)
      if (!pin) {
        await own({ watching: true })
        const pw = await placed(recK.calls)
        ok(pw.show && !pw.bar && !!(await until(() => visible(), 3000, 100)), "the meeting watches a screen: a share can't be told from that, so the card stays, with Capture on it", pw)
        await own({})
        const pg = await placed(recK.calls)
        ok(!pg.show && pg.moved && !!(await until(async () => !(await visible()), 3000, 100)), 'it stops watching, the screen still shared: the card goes again', pg)
        await own({ capturing: true })
        const pc = await placed(recK.calls)
        ok(!pc.show && !(await visible()), "a look at the call's window during the share doesn't bring it back", pc)
        await own({})
      }
      sharing(false)
      ok(!!(await until(async () => await visible() && (await opened()) === pin, 5000, 100)) && JSON.stringify(await bounds()) === JSON.stringify(at0), `sharing stops: it comes back by itself, ${pin ? 'pinned open' : 'slim'} as it was, where it was`, { at0, now: await bounds(), open: await opened() })
      if (pin) await capture('float-recording-after-sharing')
    }
    await card.evaluate(() => localStorage.setItem('cc-float-pin', '0'))
    // A look at the call's window for its names alone, nothing shared: macOS counts it as recording
    // the screen, and the card stays.
    await own({ capturing: true })
    sharing(true)
    await new Promise((r) => setTimeout(r, 600))
    const pl = await placed(KINDS[0].calls)
    ok(pl.show && await visible(), "a look at the call's window, nothing shared: the card stays", pl)
    await own({})
    sharing(false)
    await until(async () => (await placed(KINDS[0].calls)).show, 3000, 100)
  }

  // ---------- The reminder's menu ----------
  // By its ×: Remind me 1 min before (put off on the server, and the app told to look again now),
  // Hide until the next meeting, and Turn off meeting reminders, which asks first and says where
  // they're turned back on. The menu fits in the window, however short the card.
  {
    const soonK = KINDS.find((x) => x.name === 'a meeting about to start')
    const sent = []
    await ctx.route(/\/api\/calls\/snooze(\?|$)/, (r) => { sent.push(['snooze', r.request().postDataJSON()]); return r.fulfill({ json: { until: new Date(Date.parse(soonK.calls.soon.start) - 60e3).toISOString() } }) })
    await ctx.route(/\/api\/settings(\?|$)/, (r) => { if (r.request().method() !== 'PATCH') return r.continue(); sent.push(['settings', r.request().postDataJSON()]); return r.fulfill({ json: { ok: true } }) })
    const asked = () => el.evaluate(() => ({ ...globalThis.asked }))
    await card.reload()
    await card.waitForSelector('.float-card', { timeout: 15000 })
    await show(soonK)
    await card.click('.float-card .fc-opts')
    const menu = card.locator('.float-card .fc-menu')
    await menu.waitFor({ timeout: 5000 }).catch(() => {})
    const items = (await menu.locator('.menu-item').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
    const at = new Date(Date.parse(soonK.calls.soon.start) - 60e3).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ')
    ok(items.length === 3 && items[0] === `Remind me 1 min before ${at}` && items[1] === 'Hide until the next meeting' && items[2] === 'Turn off meeting reminders…', 'the menu by its ×: Remind me 1 min before (at what time), Hide until the next meeting, Turn off meeting reminders…', items)
    const fits = await until(async () => { const b = await card.evaluate(() => { const m = document.querySelector('.fc-menu').getBoundingClientRect(); return { bottom: m.bottom, right: m.right, left: m.left, w: innerWidth, h: innerHeight } }); return b.bottom <= b.h && b.right <= b.w && b.left >= 0 ? b : null }, 4000, 100)
    ok(!!fits, 'and it fits in the window', fits)
    await capture('float-reminder-menu')
    const was = await asked()
    await menu.locator('.fc-later').click()
    ok(!!(await until(async () => sent.some(([k, b]) => k === 'snooze' && b.id === soonK.calls.soon.id) && (await asked()).look > was.look, 4000, 100)) && !(await card.$('.fc-menu')), 'Remind me 1 min before: put off on the server for this meeting, the app told to look again at once, the menu closed', { sent, asked: await asked() })
    // Turn off: asked first, saying where they come back; Cancel leaves them on.
    await card.click('.float-card .fc-opts')
    await card.locator('.fc-menu .fc-off').click()
    const confirm = card.locator('.float-card .fc-confirm')
    const said = await until(async () => { const x = await confirm.innerText().catch(() => ''); return /Turn off meeting reminders\?/.test(x) && x }, 4000, 100)
    ok(!!said && /Settings › Meetings › Remind me before meetings/.test(said), 'Turn off meeting reminders… asks first, saying where to turn them back on', said)
    const l = await until(async () => { const x = await look(); return whole(x) && !x.past.length && !x.cut.length ? x : null }, 4000, 100)
    ok(!!l, 'whole in its window, nothing past its edge or cut off', await look())
    await capture('float-reminder-turn-off')
    await confirm.locator('button', { hasText: 'Cancel' }).click()
    ok(!(await confirm.count()) && !sent.some(([k]) => k === 'settings'), 'Cancel: still on, nothing changed')
    await card.click('.float-card .fc-opts')
    await card.locator('.fc-menu .fc-off').click()
    const before = await asked()
    await confirm.locator('button', { hasText: 'Turn off' }).click()
    ok(!!(await until(async () => sent.some(([k, b]) => k === 'settings' && b?.meetings?.remind === false) && (await asked()).look > before.look, 4000, 100)), 'Turn off: Remind me before meetings off, and the app told to look again at once', sent)
    await card.click('.float-card .fc-opts')
    await card.locator('.fc-menu .fc-hide').click()
    ok(!!(await until(async () => (await asked()).hide === before.hide + 1, 4000, 100)), 'Hide until the next meeting: hidden as its × does')
    await ctx.unroute(/\/api\/calls\/snooze(\?|$)/)
    await ctx.unroute(/\/api\/settings(\?|$)/)
  }

  // ---------- A short screen ----------
  // Opened, as tall as it gets (the call ended with no sound, AI Assist's suggestion), and a meeting
  // about to start with its prep, on a screen 520 points tall: what's under the bar scrolls, and the
  // window is no taller than the screen, from 100% to 207%. (A Mac on CI, at 207%: the prep was cut
  // off at the bottom.)
  await ctx.addInitScript(() => { Object.defineProperty(screen, 'availHeight', { get: () => 520 }) })
  for (const k of [KINDS[2], KINDS[4]]) {
    calls = k.calls
    await card.reload()
    await card.waitForSelector(k.ready, { timeout: 15000 }).catch(() => {})
    const bad = []
    for (const level of [0, 2, 4]) {
      await zoomTo(level)
      const z = await zoomOf()
      const l = await until(async () => { const x = await look(); return whole(x) && (await sizeOf())[1] <= 520 - 16 ? x : null }, 4000, 100) || await look()
      const tall = (await sizeOf())[1]
      if (!whole(l) || tall > 504 || l.past.length) bad.push({ zoom: `${Math.round(z * 100)}%`, tall, ...l })
    }
    ok(!bad.length, `${k.name}, on a screen 520 points tall from 100% to 207%: it fits on it, whole`, bad)
  }
  await zoomTo(0)
} catch (x) {
  ok(false, `crashed: ${x.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await el?.close().catch(() => {})
  kit.stop()
  screenOk?.xvfb?.kill()
}
process.exit(done().fail ? 1 : 0)
