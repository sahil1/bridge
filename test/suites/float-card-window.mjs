// The floating card in a real window of the desktop app's (Electron, made and fitted as
// desktop/main.js does it: test/stand-ins/float-window.cjs), zoomed as ⌘+ and ⌘− in the main window
// zoom it. At each zoom from 83% to 207%, each kind of card (a meeting recording, slim and open with
// AI Assist's suggestion; one whose call ended with no sound from it; a call that started; a meeting
// about to start, with its prep; what needs you) is whole in its window, with room for its shadow and
// no more, and nothing in it runs past its edge or is cut off. The same in each of the app's
// languages. And on a short screen, opened, it's no taller than the screen, zoomed or not.
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
const env = { ...process.env, KIT_URL: kit.url, ...(screenOk.DISPLAY ? { DISPLAY: screenOk.DISPLAY } : {}) }
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
    assistItems: [{ id: 'a1', t: 300, kind: 'question', text: 'Ask who signs off on the pilot budget, and by when they need the numbers from finance.', why: 'Just said', state: 'new' }],
    transcript: [
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
    for (const e of c.querySelectorAll('*')) {
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
