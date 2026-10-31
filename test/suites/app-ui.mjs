// The app as a whole, on any platform and in the browser named by BRIDGE_TEST_BROWSER (Chromium,
// or WebKit, the engine of Safari and the iPhone app): it loads in a light colour theme, a dark one
// and at phone width without page errors or sideways scrolling; the sidebar, ⌘K and Settings
// open (its section names in Title Case); and a New terminal runs a command typed into it. And
// when the whole window breaks (a crash made on cue): a brief one just after it opened gone by
// itself; one that stays, tried again twice, then the way back in the middle of the window with a
// newer version offered straight away, Copy details, the crash written down on the computer, Reset
// this window's layout first when it happens again after a reload, and the app back after it, on a
// desktop and a phone. And the phone's top bar with everything at once (an update, setup going, a
// restart to apply, a meeting soon, the weather, usage, another device, an agent that needs you, a
// recording in Chromium), at 320, 375 and 430 wide: only what needs you now in it, each a 40px
// target that's all there and on top, nothing wider than the phone; the rest a line under it; and
// the update a tap away (the line, or a dot on Settings that opens About & Updates). The desktop's
// bar keeps all of them. Inside a computer on the phone app (stood in for: its page around Bridge
// AI, the computers it's paired with), the devices menu switches computer (online or not, straight
// to one paired on the phone) and opens the app's Cloud Agents and start screen; in a browser it's
// your devices alone.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, solid, noServiceWorker, IS_WIN } from '../lib/harness.mjs'

const { ok, done } = checks('app-ui')
const kit = await startKit('app-ui')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  await kit.api('/setup', { name: 'Tester' })
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = `${look.theme}`
    const { ctx, p, errors } = await page(b, kit.url, look)
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 }).catch(() => {})
    const nav = await p.locator('.rail-nav-btn').allInnerTexts()
    ok(['New', 'Chief of Staff', 'Meetings'].every((x) => nav.some((n) => n.includes(x))), `${t}: the sidebar has New, Chief of Staff and Meetings`, nav)
    ok(await p.locator('.rail-nav-row .rail-rec').isVisible(), `${t}: and the record button`)
    await p.keyboard.press('ControlOrMeta+K')
    ok(!!(await until(async () => (await p.locator('[role="dialog"] input').count()) > 0, 4000)), `${t}: ⌘K opens the palette`)
    await p.keyboard.press('Escape')
    await p.locator('button[aria-label="Settings"]').first().click()
    await p.waitForSelector('.modal.settings', { timeout: 5000 }).catch(() => {})
    ok(await solid(p, '.modal.settings'), `${t}: Settings opens, solid`)
    await p.locator('.st-nav-item', { hasText: 'Meetings' }).click()
    ok(!!(await until(async () => /Name who spoke on the call/.test(await p.locator('.st-body').innerText()), 5000)), `${t}: Settings › Meetings`)
    await shot(p, `${tag}settings-${t}`)
    // Devices: one tab for the relay, the phone, your other devices and notifications.
    const navs = (await p.locator('.st-nav-item').allInnerTexts()).map((x) => x.trim())
    ok(navs.filter((x) => x === 'Devices').length === 1 && !navs.some((x) => /machines|Phone & notifications/i.test(x)), `${t}: Devices is one tab`, navs)
    // Names are in Title Case (Model Providers, About & Updates, Chief of Staff), short joining words aside.
    const titled = (x) => x.split(/\s+/).every((w, i) => (i > 0 && /^(a|an|and|as|at|by|for|in|of|on|or|the|to|&)$/.test(w)) || !/^\p{Ll}/u.test(w))
    ok(navs.length > 5 && navs.every(titled), `${t}: Settings' section names are in Title Case`, navs)
    await p.locator('.st-nav-item', { hasText: 'Devices' }).click()
    const heads = await until(async () => { const h = (await p.locator('.st-body h4').allInnerTexts()).map((x) => x.trim()); return h.includes('Your devices') && h }, 6000)
    const at = (re) => (heads || []).findIndex((h) => re.test(h))
    ok(heads && at(/relay|Tailscale/i) >= 0 && at(/relay|Tailscale/i) < at(/^Your devices$/) && at(/^Your devices$/) < at(/^Notifications on this device$/), `${t}: connect first, then your devices, then notifications`, heads)
    await p.keyboard.press('Escape')
    // The devices menu's way in (section "machines") opens it at your devices.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))
    ok(!!(await until(async () => /Devices/.test(await p.locator('.st-nav-item.on').innerText()) && await p.evaluate(() => { const e = document.getElementById('st-machines'); const b = document.querySelector('.st-scroll'); return !!e && !!b && Math.abs(e.getBoundingClientRect().top - b.getBoundingClientRect().top) < 40 }), 6000)), `${t}: Link a device… opens it at your devices`)
    await shot(p, `${tag}settings-machines-${t}`)
    await p.keyboard.press('Escape')
    if (look.mode === 'light') {
      // A New terminal: typed into like a terminal app. The answer only shows if the shell ran it.
      // PowerShell gets a bare expression, not echo (see server.mjs: no slow first command lookup).
      await p.locator('.rail-tool[aria-label="New terminal"]').click()
      const term = p.locator('.live-shell .xterm, .term-wrap:not([hidden]) .xterm').first()
      await term.waitFor({ timeout: 15000 }).catch(() => {})
      // As you would: once the shell shows its prompt (PowerShell can take a few seconds to start).
      const rows = () => p.locator('.live-shell .xterm-rows, .term-wrap:not([hidden]) .xterm-rows').first().innerText().catch(() => '')
      const prompt = await until(async () => /[$#%>]$/.test((await rows()).trimEnd().split('\n').pop() || ''), 30000)
      ok(!!prompt, 'New terminal shows its prompt', (await rows()).slice(-300))
      let seen = false
      for (let i = 0; i < 3 && !seen; i++) {
        await term.click()
        await p.keyboard.type(IS_WIN ? '"bridge-" + 6*7 + "-ok"' : 'echo bridge-$((6*7))-ok')
        await p.keyboard.press('Enter')
        seen = !!(await until(async () => /bridge-42-ok/.test(await rows()), 10000))
      }
      ok(seen, 'New terminal runs what you type', (await rows()).slice(-400))
      await shot(p, `${tag}terminal`)
    }
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }
  // Phone width.
  const ph = await page(b, kit.url, { width: 390, height: 844 })
  await ph.p.waitForTimeout(2500)
  const wide = await ph.p.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)
  ok(wide <= 1, 'at phone width nothing scrolls sideways', wide)
  await shot(ph.p, `${tag}phone`)
  ok(ph.errors.length === 0, 'phone: no page errors', ph.errors)
  await ph.ctx.close()

  // ---------- The phone's top bar, with everything in it at once ----------
  const soon = new Date(Date.now() + 20 * 6e4)
  const fakes = {
    updates: { current: '3.6.0', latest: '3.7.0', available: true, how: 'app', url: 'https://example.com/r', notes: '' },
    plan: { running: true, needsYou: null, run: { at: 1, ids: ['node', 'speech', 'devtools'] }, items: [{ id: 'node', state: 'done' }, { id: 'speech', state: 'running' }, { id: 'devtools', state: 'todo' }] },
    calendar: { today: [{ id: 'e1', title: 'Weekly payments sync', canceled: false, calendar: 'Work', start: soon.toISOString(), end: new Date(+soon + 30 * 6e4).toISOString(), allDay: false, attendees: [], attendeeCount: 4 }], tomorrow: [], fetchedAt: new Date().toISOString() },
    weather: { location: 'Springfield', fetchedAt: new Date().toISOString(), current: { temp: 64, feels: 62, humidity: 58, wind: 7, code: 2, summary: 'Partly cloudy' }, daily: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: new Date(Date.now() + i * 864e5).toISOString().slice(0, 10), hi: 70, lo: 52, code: 2, rain: 10 })) },
    quota: { generatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), bestNow: 'claude', stale: false, providers: [{ provider: 'claude', usable: true, status: 'ok', plan: 'max', percentRemaining: 62, windows: [{ kind: 'session', label: '5h', percentRemaining: 62 }, { kind: 'weekly', label: 'week', percentRemaining: 41 }] }] },
    device: { id: 'test-studio', name: 'Studio Mac', relay: 'https://relay.example.com', os: 'darwin', version: '3.6.0', state: 'linked', online: true, lastSeen: new Date().toISOString(), addedAt: new Date().toISOString(), code: null, error: null, counts: { blocked: 1 }, agents: [] },
  }
  // An agent waiting on you, in the fleet the page is given (the live feed is turned away, so it stays).
  const waiting = (f) => ({ ...f, workspaces: [...(f.workspaces || []), { id: 'w-wait', label: 'acme-shop' }], tabs: [...(f.tabs || []), { tabId: 't-wait', workspaceId: 'w-wait', label: 'checkout', panes: [{ paneId: 'p-wait', agent: true, cwd: kit.home }] }],
    agents: [...(f.agents || []), { paneId: 'p-wait', tabId: 't-wait', workspaceId: 'w-wait', workspace: 'acme-shop', tab: 'checkout', title: 'Fix login redirect', kind: 'claude', status: 'blocked', cwd: kit.home }] })
  const busy = ({ setup = true, restart = true } = {}) => async (c) => {
    await noServiceWorker(c)
    await c.route(/\/api\/updates(\?|$)/, (r) => r.fulfill({ json: fakes.updates }))
    await c.route(/\/api\/setup\/plan(\?|$)/, (r) => r.fulfill({ json: setup ? fakes.plan : { running: false, needsYou: null, run: null, items: [] } }))
    await c.route(/\/api\/fix(\?|$)/, async (r) => { const real = await (await r.fetch()).json().catch(() => ({})); await r.fulfill({ json: { ...real, restart: restart ? [{ label: 'Full Disk Access' }] : [] } }) })
    await c.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: fakes.calendar }))
    await c.route(/\/api\/weather(\?|$)/, (r) => r.fulfill({ json: fakes.weather }))
    await c.route(/\/api\/quota(\?|$)/, (r) => r.fulfill({ json: fakes.quota }))
    await c.route(/\/api\/machines(\?|$)/, async (r) => { const real = await (await r.fetch()).json(); await r.fulfill({ json: { ...real, machines: [...real.machines, fakes.device] } }) })
    await c.route(/\/api\/fleet(\?|$)/, async (r) => r.fulfill({ json: waiting(await (await r.fetch()).json()) }))
    await c.route(/\/api\/events(\?|$)/, (r) => r.abort())
  }
  // Every control in the bar: whole, on screen, on top where you'd tap it, and big enough to tap.
  const barCheck = (p) => p.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const out = []
    for (const el of document.querySelectorAll('.topbar button, .topbar a, .topbar [role="button"]')) {
      const r = el.getBoundingClientRect()
      if (!el.getClientRects().length || r.width === 0) continue
      const name = el.getAttribute('aria-label') || el.innerText.trim().replace(/\s+/g, ' ') || el.className
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      const top = x >= 0 && x < vw ? document.elementFromPoint(x, y) : null
      const bad = [r.left < 0 || r.right > vw + 0.5 ? 'off screen' : null, r.width < 40 || r.height < 40 ? `${Math.round(r.width)}x${Math.round(r.height)}` : null, !top || !(el === top || el.contains(top)) ? 'covered or clipped' : null].filter(Boolean)
      // Clipped by a box around it (a row that hides what spills out).
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a)
        if (cs.overflowX === 'visible' || cs.display === 'contents') continue
        const b = a.getBoundingClientRect()
        if (r.left < b.left - 0.5 || r.right > b.right + 0.5) { bad.push('clipped'); break }
      }
      out.push({ name, bad })
    }
    return { wide: document.scrollingElement.scrollWidth - window.innerWidth, items: out }
  })
  for (const [width, look, more] of [[320, { mode: 'dark', theme: 'midnight' }, {}], [375, { mode: 'light', theme: 'sky' }, {}], [430, { mode: 'light', theme: 'bridge' }, { setup: false, restart: false }]]) {
    const t = `phone ${width}`
    const { ctx, p, errors } = await page(b, kit.url, { ...look, phone: true, before: busy(more) })
    await p.setViewportSize({ width, height: 780 })
    await p.waitForSelector('.tabbar button', { timeout: 15000 }).catch(() => {})
    await until(async () => (await p.locator('.topbar .needs-chip').count()) > 0, 10000)
    let recording = false
    if (which === 'chromium' && width === 320) {
      // A recording too: from the Meetings tab, then back.
      await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
      const start = p.locator('.m-meetings button', { hasText: 'Start recording' })
      if (await until(() => start.isVisible(), 10000)) await start.click()
      recording = !!(await until(() => p.locator('.topbar .rec-pill').isVisible(), 15000))
      ok(recording, `${t}: a recording shows in the bar`)
      await p.locator('.tabbar button', { hasText: 'Chief' }).click()
    }
    await p.waitForTimeout(1500)
    const bar = await barCheck(p)
    ok(bar.wide <= 1, `${t}: nothing wider than the phone`, bar.wide)
    const names = bar.items.map((x) => x.name)
    ok(bar.items.every((x) => !x.bad.length), `${t}: every control in the top bar is whole, on top and at least 40px`, bar.items.filter((x) => x.bad.length))
    ok(['Search and commands', 'Settings', '1 needs you'].every((x) => names.includes(x)), `${t}: it has search, Settings and the agent that needs you`, names)
    ok(await p.locator('.topbar').locator('.usage-chip, .wx-chip, .meet-chip, .clock, .update-chip, .setup-chip').count() === 0, `${t}: usage, the weather, the next meeting, the clock, setup, a restart and the update aren't in it`, names)
    const note = (await p.locator('.top-notes').innerText().catch(() => '')).trim()
    ok(more.setup === false ? /Bridge AI 3\.7\.0 is available/.test(note) : /^Setting up · 1 of 3/.test(note), `${t}: one line under it, the most pressing: ${more.setup === false ? 'the update' : 'setup'}`, note)
    await shot(p, `${tag}phone-top-bar-${width}`)
    if (width === 375) {
      // What left the bar is in the Today tab: the next meeting, usage and the weather.
      await p.locator('.tabbar button', { hasText: 'Today' }).click()
      const today = await until(async () => { const x = await p.locator('.m-today').innerText().catch(() => ''); return /Weekly payments sync/.test(x) && /Springfield/.test(x) && /62%/.test(x) && x }, 8000)
      ok(!!today, `${t}: the next meeting, usage and the weather are in the Today tab`, (await p.locator('.m-today').innerText().catch(() => '')).slice(0, 400))
      await p.locator('.tabbar button', { hasText: 'Chief' }).click()
    }
    // The update, a tap away: its line, or the dot on Settings while a line before it shows.
    const line = p.locator('.top-notes .update-note')
    const dot = p.locator('.topbar .settings-btn .top-dot')
    const via = (await line.isVisible().catch(() => false)) ? line : p.locator('.topbar button[aria-label="Settings"]')
    ok(more.setup === false || await dot.isVisible().catch(() => false), `${t}: with the update's line behind setup's, Settings has a dot`)
    await via.tap({ timeout: 3000 }).catch(() => {})
    ok(!!(await until(async () => /About & Updates/.test(await p.locator('.st-nav-item.on').innerText().catch(() => '')) && /3\.7\.0/.test(await p.locator('.st-body').innerText().catch(() => '')), 6000)), `${t}: one tap opens About & Updates, with 3.7.0`)
    await p.locator('button[aria-label="Close settings"]').click().catch(() => {})
    ok(!!(await until(async () => !(await dot.count()) && !(await line.count()), 4000)), `${t}: seen, the dot and the line go`)
    if (recording) for (const m of (await kit.api('/meetings')).meetings.filter((x) => x.status === 'recording')) await kit.api(`/meetings/${m.id}/stop`, {}).catch(() => {})
    // A request the recording's stop cut off isn't the page's fault.
    ok(errors.filter((e) => !/due to access control checks/.test(e)).length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }
  // Put away instead: the line goes, the dot stays until About & Updates has been opened.
  {
    const { ctx, p } = await page(b, kit.url, { mode: 'light', theme: 'sky', phone: true, before: busy({ setup: false, restart: false }) })
    const x = p.locator('.top-notes .top-note-x')
    await x.waitFor({ timeout: 15000 }).catch(() => {})
    await x.tap().catch(() => {})
    ok(!!(await until(async () => !(await p.locator('.top-notes .update-note').count()) && await p.locator('.topbar .settings-btn .top-dot').isVisible(), 4000)), 'phone: Not now puts the line away, leaving a dot on Settings')
    await ctx.close()
  }
  // ---------- Inside a computer, on the phone: switch computer, and what's on the phone ----------
  const studio = 'https://studio-relay.example.com', linux = 'https://linux-relay.example.com'
  const linkedTo = (real) => [
    { id: 'test-studio', name: 'Studio Mac', relay: studio, os: 'mac', version: '3.6.0', state: 'linked', online: true, lastSeen: new Date().toISOString(), addedAt: new Date().toISOString(), code: null, error: null, counts: { blocked: 1 }, agents: [] },
    { id: 'test-win', name: 'Windows PC', relay: 'https://win-relay.example.com', os: 'windows', version: '3.6.0', state: 'linked', online: false, lastSeen: new Date(Date.now() - 3 * 36e5).toISOString(), addedAt: new Date().toISOString(), code: null, error: null, counts: null, agents: [] },
  ].concat(real.machines || [])
  const withDevices = async (c) => { await noServiceWorker(c); await c.route(/\/api\/machines(\?|$)/, async (r) => { const real = await (await r.fetch()).json(); await r.fulfill({ json: { ...real, machines: linkedTo(real) } }) }) }
  {
    // The phone app's page: Bridge AI inside it, the computers the phone is paired with, and the app
    // itself (what it's asked, as the relay page's own screens ask it).
    const ph = await page(b, `${kit.url}/api/config`, { phone: true, mode: 'light', theme: 'sky', before: withDevices })
    await ph.p.setViewportSize({ width: 375, height: 780 })
    await ph.p.evaluate(({ studio, linux }) => {
      window.opened = []; window.posted = []; window.started = 0
      window.bridgeNative = { platform: 'ios', bundled: ['demo', 'cloud'], post: (m) => window.posted.push(m) }
      window.bridgeRelay = {
        WebSocket: class extends WebSocket { constructor(u) { super(`ws://${location.host}${u}`) } },
        computers: { list: () => [{ relay: location.origin, name: 'Desk', current: true }, { relay: studio, name: 'Studio Mac', current: false }, { relay: linux, name: 'Linux box', current: false }], open: (r) => window.opened.push(r), add: () => { window.started++ }, forget: async () => {} },
      }
      document.open()
      document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe id="app" src="/"></iframe>')
      document.close()
    }, { studio, linux })
    const app = ph.p.frameLocator('#app')
    const chip = app.locator('.topbar .mc-chip')
    await chip.waitFor({ timeout: 20000 }).catch(() => {})
    const menu = app.locator('.mc-menu')
    const openMenu = async () => { if (!(await menu.count())) await chip.tap({ timeout: 5000 }) ; await menu.waitFor({ timeout: 5000 }) }
    await openMenu().catch(() => {})
    const rows = (await menu.locator('.mc-item').allInnerTexts().catch(() => [])).map((x) => x.replace(/\s+/g, ' ').trim())
    ok(rows.length === 4 && /this one/.test(rows[0]) && /^Studio Mac Mac · 1 needs you$/.test(rows[1]) && /^Windows PC Windows · Offline, seen/.test(rows[2]) && /^Linux box Paired on this phone$/.test(rows[3]), 'phone app: the devices menu lists this computer, the others with whether they\'re online, and one paired on the phone alone', rows)
    const items = (await menu.locator('.menu-item').allInnerTexts().catch(() => [])).map((x) => x.trim())
    ok(/On this phone/i.test(await menu.innerText().catch(() => '')) && ['Cloud Agents', 'Start screen'].every((x) => items.includes(x)), 'and On this phone: Cloud Agents and the start screen', items)
    const sizes = await menu.evaluate((m) => [...m.querySelectorAll('.mc-item, .menu-item')].map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), out: r.left < 0 || r.right > window.innerWidth } }))
    ok(sizes.length > 0 && sizes.every((x) => x.h >= 40 && !x.out), 'every row in it on screen and at least 40px tall', sizes)
    await shot(ph.p, `${tag}phone-app-devices`)
    await menu.locator('.mc-item', { hasText: 'Studio Mac' }).tap()
    ok((await ph.p.evaluate(() => window.opened)).join() === studio, 'one tap on a computer paired on the phone switches straight to it, through its own relay')
    await openMenu()
    await menu.locator('.mc-item', { hasText: 'Linux box' }).tap()
    ok((await ph.p.evaluate(() => window.opened)).at(-1) === linux, 'as does one only the phone knows')
    await openMenu()
    await menu.locator('.menu-item', { hasText: 'Cloud Agents' }).tap()
    ok((await ph.p.evaluate(() => window.posted)).some((m) => m.type === 'open' && m.name === 'cloud'), 'Cloud Agents asks the app for its Cloud Agents, as its start screen does', await ph.p.evaluate(() => window.posted))
    await openMenu()
    await menu.locator('.menu-item', { hasText: 'Start screen' }).tap()
    ok(await ph.p.evaluate(() => window.started) === 1, 'Start screen goes to the app\'s screen for pairing or opening a computer')
    await openMenu()
    await menu.locator('.mc-item', { hasText: 'Windows PC' }).tap()
    ok(!!(await until(() => ph.p.frames().some((f) => /\/m\/test-win\/$/.test(f.url())), 8000)), 'one linked to this computer only is shown through it', ph.p.frames().map((f) => f.url()))
    await ph.ctx.close()
  }
  {
    // A browser (Safari, say): no app around the page, so your devices alone.
    const { ctx, p } = await page(b, kit.url, { phone: true, mode: 'dark', theme: 'midnight', before: withDevices })
    const chip = p.locator('.topbar .mc-chip')
    await chip.waitFor({ timeout: 15000 }).catch(() => {})
    await chip.tap({ timeout: 5000 }).catch(() => {})
    const menu = p.locator('.mc-menu')
    await menu.waitFor({ timeout: 5000 }).catch(() => {})
    const text = await menu.innerText().catch(() => '')
    ok(/Studio Mac/.test(text) && /Windows PC/.test(text) && !/On this phone|Cloud Agents|Start screen|Linux box/i.test(text), 'phone browser: the devices menu has your devices, and nothing that needs the app', text)
    await ctx.close()
  }

  // The desktop's bar keeps every chip.
  {
    const { ctx, p } = await page(b, kit.url, { mode: 'light', theme: 'sky', width: 1600, before: busy() })
    await until(async () => (await p.locator('.topbar .usage-chip').count()) > 0, 10000)
    const got = await p.evaluate(() => ['.needs-chip', '.setup-chip', '.meet-chip', '.usage-chip', '.update-chip', '.wx-chip', '.clock', 'button[aria-label="Settings"]'].filter((s) => document.querySelector(`.topbar ${s}`)))
    ok(got.length === 8 && !(await p.locator('.top-notes').count()), 'desktop: the top bar still has needs you, setup, the next meeting, usage, the update, the weather, the clock and Settings', got)
    await ctx.close()
  }

  // ---------- The whole window broke ----------
  // A newer version out (made up: the tests never ask GitHub), so the update check finds one.
  const newer = { current: '3.0.11', latest: '3.0.12', available: true, how: 'app', url: 'https://example.com/r', notes: '' }
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight', phone: true }]) {
    const t = `crash ${look.phone ? 'phone ' : ''}${look.theme}`
    const { ctx, p, errors } = await page(b, kit.url, { ...look, before: async (c) => { await noServiceWorker(c); await c.route(/\/api\/updates(\?|$)/, (r) => r.fulfill({ json: newer })) } })
    // Set once (the helper's saved values come back on every load; this one mustn't).
    await p.waitForSelector('.rail-nav-btn, .tabbar button', { timeout: 15000 }).catch(() => {})
    // Brief, as while an update restarts the app: tried again by itself, and gone.
    await p.evaluate(() => localStorage.setItem('cc-test-crash', 'brief'))
    await p.reload()
    const card = p.locator('.crash-screen .crash-card')
    ok(!!(await until(async () => /Trying again/.test(await card.innerText().catch(() => '')), 8000)), `${t}: a crash just after the window opened: it tries again by itself`)
    ok(!!(await until(async () => (await p.locator('.rail-nav-btn, .tabbar button').count()) > 0 && !(await p.locator('.crash-screen').count()), 15000)), `${t}: and a brief one is gone, with nothing to click`)
    // One that stays.
    await p.evaluate(() => localStorage.setItem('cc-test-crash', '1'))
    await p.reload()
    ok(!!(await until(() => card.isVisible(), 15000)), `${t}: the window broke: it says so`)
    ok(!!(await until(async () => (await p.locator('.crash-card.retrying').count()) === 0, 12000)), `${t}: it tries twice by itself, then asks`)
    const box = await card.boundingBox()
    const vw = p.viewportSize()
    ok(box && Math.abs(box.x + box.width / 2 - vw.width / 2) < 4 && Math.abs(box.y + box.height / 2 - vw.height / 2) < 60, `${t}: in the middle of the window`, { box, vw })
    const text = await card.innerText()
    ok(/A crash made by a test/.test(text) && /nothing is lost/.test(text), `${t}: with the error, and that nothing is lost`, text.slice(0, 300))
    ok(['Try again', 'Reload', "Reset this window's layout", 'Copy details'].every((x) => text.includes(x)), `${t}: and the ways back`, text)
    ok(await card.locator('button', { hasText: 'Update to 3.0.12' }).isVisible(), `${t}: with a newer version offered straight away, no click needed`)
    ok(!/happened again/.test(text) && /Try again/.test(await card.locator('.btn.primary').first().innerText()), `${t}: the first time, Try again first`, text.slice(0, 300))
    const log = path.join(kit.data, 'logs', 'ui-errors.log')
    ok(!!(await until(() => fs.existsSync(log) && /\[Bridge AI\] A crash made by a test/.test(fs.readFileSync(log, 'utf8')), 5000)), `${t}: it's written down on the computer`)
    await shot(p, `${tag}crash-${look.phone ? 'phone-' : ''}${look.theme}`)
    // Again after a reload: Reset this window's layout first, and it says why.
    await p.reload()
    await card.waitFor({ timeout: 15000 })
    await until(async () => (await p.locator('.crash-card.retrying').count()) === 0, 12000)
    ok(/happened again after a reload/.test(await card.innerText()) && /Reset this window/.test(await card.locator('.btn.primary').first().innerText()), `${t}: again after a reload: Reset this window's layout first`, await card.innerText())
    await card.locator('button', { hasText: "Reset this window's layout" }).click()
    ok(!!(await until(async () => (await p.locator('.rail-nav-btn, .tabbar button').count()) > 0 && !(await p.locator('.crash-screen').count()), 15000)), `${t}: reset, the app is back`)
    ok(await p.evaluate(() => !!localStorage.getItem('cc-appearance')), `${t}: with its look kept`)
    // WebKit counts a request a reload cuts off (the presence ping, the live feed) as a page error.
    ok(errors.filter((e) => !/A crash made by a test|\/api\/[\w/.-]+ due to access control checks/.test(e)).length === 0, `${t}: no other page errors`, errors)
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
