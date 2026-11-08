// The app as a whole, on any platform and in the browser named by BRIDGE_TEST_BROWSER (Chromium,
// or WebKit, the engine of Safari and the iPhone app): it loads in a light colour theme, a dark one
// and at phone width without page errors or sideways scrolling; in every theme it ships, light and
// dark, its text is 4.5:1 or more against what's behind it and a filled control 3:1 (WCAG AA); the sidebar, ⌘K and Settings
// open (its section names in Title Case); and a New terminal runs a command typed into it. Its
// views fetched ahead while the computer can't be reached: once it's back, Settings opens with its
// look, and a view opened meanwhile says it hit an error, then opens with Try again. And
// when the whole window breaks (a crash made on cue): a brief one just after it opened gone by
// itself; one that stays, tried again twice, then the way back in the middle of the window with a
// newer version offered straight away, Copy details, the crash written down on the computer, Reset
// this window's layout first when it happens again after a reload, and the app back after it, on a
// desktop and a phone. And the phone's top bar with everything at once (an update, setup going, a
// restart to apply, a meeting soon, the weather, usage, another device, an agent that needs you, a
// recording in Chromium), at 320, 375 and 430 wide: only what needs you now in it, each a 40px
// target that's all there and on top, nothing wider than the phone; the rest a line under it; and
// the update a tap away (the line, or a dot on Settings that opens About & Updates). The desktop's
// bar with all of them at each width from 1600 to 900: nothing past its edge, squeezed, cut off or on
// two lines, the news that had no room counted on Status and in its menu with usage, sounds, the
// weather and the time; a font that grows the words gives way again. What's pinned to it: by default
// the weather, the clock, usage and the news, not sounds; each says what it is on hover; as the
// window narrows the pinned chips go down to their icons before any leaves the bar; a pin in Status
// puts one in the bar or takes it out (an unpinned one isn't counted), kept for the next window;
// Settings › Appearance › In the Top Bar has the same switches; and the weather with none to show
// (no city picked, or not fetched) says why, at every width, and opens the city picker. Usage
// pinned is kept small: the provider's mark, the account new agents start on and the one figure
// that matters, colored and readable as it runs low, a model's own limit only once it's the one
// running out; all of it on hover, to a screen reader and in its menu, opened from the keyboard.
// Inside a computer on the phone app (stood in for: its page around Bridge
// AI, the computers it's paired with), the devices menu switches computer (online or not, straight
// to one paired on the phone) and opens the app's Cloud Agents and start screen; in a browser it's
// your devices alone.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, solid, noServiceWorker, changeAnswer, IS_WIN, ROOT } from '../lib/harness.mjs'

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
    // README.md's table of Settings has a row for each of them (Mail's row says it's a Mac's), and
    // none for a section that isn't there (Account, until Bold Bridge accounts are switched on).
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    const table = readme.slice(readme.indexOf('| Section | What\'s there |'))
    const rows = [...table.slice(0, table.search(/\n\n/)).matchAll(/^\| ([^|]+?) \|/gm)].map((m) => m[1]).filter((x) => !/^(Section|-+)$/.test(x))
    ok(navs.every((x) => rows.includes(x)) && rows.every((x) => navs.includes(x) || x === 'Mail'), `${t}: README.md's Settings table has a row for each section, and only those`, { rows, navs })
    await p.locator('.st-nav-item', { hasText: 'Devices' }).click()
    const heads = await until(async () => { const h = (await p.locator('.st-body h4').allInnerTexts()).map((x) => x.trim()); return h.includes('Your Devices') && h }, 6000)
    const at = (re) => (heads || []).findIndex((h) => re.test(h))
    ok(heads && at(/relay|Tailscale/i) >= 0 && at(/relay|Tailscale/i) < at(/^Your Devices$/) && at(/^Your Devices$/) < at(/^Notifications on this device$/), `${t}: connect first, then your devices, then notifications`, heads)
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

  // ---------- Contrast, in every theme it ships, light and dark (WCAG AA) ----------
  // Text 4.5:1 or more against what's behind it, and a filled control 3:1 against the pane it's on:
  // quiet (muted) text on each pane, a link on each and on its own soft fill (a picked tab), a primary
  // button, a badge, the need-you chip in the top bar, your message, error text, the status chips and
  // tags, and the sidebar's quiet text on the theme's frame. Each is the app's own styles, put on the
  // page as it draws them.
  {
    const themes = [...fs.readFileSync(path.join(ROOT, 'src', 'appearance.js'), 'utf8').matchAll(/\{ id: '([a-z]+)', name: '[^']+', chrome:/g)].map((m) => m[1])
    const probes = [
      ...['--pane', '--pane-2', '--pane-3'].map((v) => [`quiet text on ${v.slice(2)}`, '.work', `<div style="background:var(${v})"><span class="muted">Nov 8</span></div>`, '.muted', 4.5]),
      ...['--pane', '--pane-2', '--pane-3'].map((v) => [`a link on ${v.slice(2)}`, '.work', `<div style="background:var(${v})"><span style="color:var(--accent)">Open</span></div>`, 'span', 4.5]),
      ['a picked tab (a link on its soft fill)', '.work', '<div style="background:var(--pane-2)"><div class="st-nav-item on">General</div></div>', '.st-nav-item', 4.5],
      ['a primary button', '.work', '<div style="background:var(--pane)"><button class="btn primary">Save</button></div>', 'button', 4.5, 3],
      ['a badge', '.work', '<div style="background:var(--pane)"><span class="mc-needs">4</span></div>', 'span', 4.5, 3],
      ['the need-you chip', '.top-right', '<button class="needs-chip">4 need you</button>', 'button', 4.5],
      ['your message', '.work', '<div style="background:var(--pane)"><div class="msg user"><div class="msg-text">Ship it</div></div></div>', '.msg-text', 4.5],
      ['error text', '.work', '<div style="background:var(--pane-2)"><p class="error-text">It failed</p></div>', 'p', 4.5],
      ['a good chip', '.work', '<div style="background:var(--pane)"><span class="st-chip good">Up to date</span></div>', 'span', 4.5],
      ['a warning chip', '.work', '<div style="background:var(--pane)"><span class="st-chip warn">Off</span></div>', 'span', 4.5],
      ['a Done tag', '.work', '<div style="background:var(--pane)"><span class="state-tag st-done">Done</span></div>', 'span', 4.5],
      ['the sidebar\'s quiet text', '.rail', '<span class="rail-label">Spaces</span>', 'span', 4.5],
      ['the sidebar\'s rows', '.rail', '<button class="rail-nav-btn">Memory</button>', 'button', 4.5],
    ]
    const failed = []
    for (const theme of themes) {
      for (const mode of ['light', 'dark']) {
        const { ctx, p } = await page(b, kit.url, { mode, theme })
        await p.waitForSelector('.work', { timeout: 15000 }).catch(() => {})
        const got = await p.evaluate((probes) => {
          const parse = (c) => {
            const n = String(c).match(/-?[\d.]+(e-?\d+)?/g)?.map(Number) || []
            if (/^color\(/.test(c)) return [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1]
            return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]
          }
          const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1)
          const lum = (c) => { const [r, g, bl] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl }
          const ratio = (a, c) => { const x = lum(a), y = lum(c); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
          // What's behind an element: its own background and every one under it, see-through ones blended.
          const behind = (e, self = true) => {
            const layers = []
            for (let x = self ? e : e.parentElement; x; x = x.parentElement) { const c = parse(getComputedStyle(x).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break } }
            let col = [255, 255, 255, 1]
            for (const l of layers.reverse()) col = over(l, col)
            return col
          }
          return probes.map(([what, where, html, sel, need, ui]) => {
            const host = document.querySelector(where)
            if (!host) return { what, missing: where }
            const box = document.createElement('div')
            box.innerHTML = html
            host.append(box)
            const e = box.querySelector(sel)
            const bg = behind(e)
            const text = Math.round(ratio(over(parse(getComputedStyle(e).color), bg), bg) * 100) / 100
            const fill = ui ? Math.round(ratio(bg, behind(e, false)) * 100) / 100 : null
            box.remove()
            return { what, text, need, fill, ui }
          })
        }, probes)
        for (const x of got) if (x.missing || x.text < x.need || (x.ui && x.fill < x.ui)) failed.push(`${theme} ${mode}: ${x.what} ${x.missing ? `(no ${x.missing})` : `${x.text}:1${x.ui ? `, its fill ${x.fill}:1` : ''}`}`)
        await ctx.close()
      }
    }
    ok(themes.length >= 12 && !failed.length, `every theme (${themes.length}), light and dark: text 4.5:1 or more and filled controls 3:1 against what they're on`, failed)
  }

  // ---------- Out of reach as it fetches its views ahead ----------
  // (A phone opened as its link to the computer drops a moment, or the computer starting again.) The
  // views' files can't be had as the page fetches them ahead; back, Settings opens with its look
  // (WebKit kept a file that had failed as failed until a reload, and Settings' styles were never
  // asked for again). A view opened while they still can't be had says so, and Try again opens it
  // once they can.
  {
    const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8')
    const first = new Set([...html.matchAll(/assets\/([^"]+)"/g)].map((m) => m[1])) // what the page loads itself
    let cut = true
    // Meetings' own file stays out of reach until Try again: the page fetches the views ahead again
    // after a while (lazy.jsx preloadViews), and on a slow computer that could fall while Settings
    // was being opened, leaving Meetings nothing to fail on.
    let held = true
    const turned = []
    const { ctx, p } = await page(b, kit.url, {
      before: async (c) => {
        await noServiceWorker(c)
        await c.route(/\/assets\//, (r) => { const f = r.request().url().split('/').pop(); if (first.has(f) || (!cut && !(held && /^Meetings-/.test(f)))) return r.continue(); turned.push(f); return r.abort() })
      },
    })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    ok(!!(await until(() => turned.some((f) => /^Settings-/.test(f)), 10000, 100)), 'out of reach: the views it fetches ahead don\'t come', turned)
    cut = false
    await p.locator('button[aria-label="Settings"]').first().click()
    // (A stylesheet that failed has no rules to read: WebKit and Chromium refuse to, as from elsewhere.)
    const look = () => p.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"][href*="assets/"]')].map((l) => { try { return [l.href.split('/').pop(), l.sheet?.cssRules.length || 0] } catch { return [l.href.split('/').pop(), 0] } }))
    ok(!!(await until(async () => (await p.locator('.modal.settings').count()) > 0 && (await look()).every(([, n]) => n > 0), 8000, 200)), 'back: Settings opens, with its look (each of the app\'s stylesheets there)', { settings: await p.locator('.modal.settings').count(), look: await look() })
    await p.keyboard.press('Escape')
    cut = true
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
    ok(!!(await until(async () => /hit an error/.test(await p.locator('.crash').innerText().catch(() => '')), 8000, 200)), 'out of reach again: a view not fetched yet says it hit an error, with Try again', await p.locator('.crash').innerText().catch(() => ''))
    cut = false
    held = false
    await p.locator('.crash button', { hasText: 'Try again' }).click()
    ok(!!(await until(() => p.locator('.mt-view .pane-head').first().isVisible(), 8000, 200)), 'back: Try again opens it', await p.locator('.crash').innerText().catch(() => ''))
    await shot(p, `${tag}views-back`)
    await ctx.close()
  }

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
  const LONG_NAME = 'Design Team MacBook Pro 16-inch (2)'
  const busy = ({ setup = true, restart = true } = {}) => async (c) => {
    await noServiceWorker(c)
    await c.route(/\/api\/updates(\?|$)/, (r) => r.fulfill({ json: fakes.updates }))
    await c.route(/\/api\/setup\/plan(\?|$)/, (r) => r.fulfill({ json: setup ? fakes.plan : { running: false, needsYou: null, run: null, items: [] } }))
    await changeAnswer(c, /\/api\/fix(\?|$)/, (real) => ({ ...real, restart: restart ? [{ label: 'Full Disk Access' }] : [] }), { orElse: {} })
    await c.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: fakes.calendar }))
    await c.route(/\/api\/weather(\?|$)/, (r) => r.fulfill({ json: fakes.weather }))
    await c.route(/\/api\/quota(\?|$)/, (r) => r.fulfill({ json: fakes.quota }))
    // This computer has a long name (as a work computer often does), so every run sees the same bar.
    await changeAnswer(c, /\/api\/machines(\?|$)/, (real) => ({ ...real, here: { ...real.here, name: LONG_NAME }, machines: [...real.machines, fakes.device] }))
    await changeAnswer(c, /\/api\/fleet(\?|$)/, waiting)
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
    ok(!!(await until(async () => /About & Updates/.test(await p.locator('.st-bar h3').innerText().catch(() => '')) && /3\.7\.0/.test(await p.locator('.modal.settings .st-scroll').innerText().catch(() => '')), 6000)), `${t}: one tap opens About & Updates, with 3.7.0`)
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
  const withDevices = async (c) => { await noServiceWorker(c); await changeAnswer(c, /\/api\/machines(\?|$)/, (real) => ({ ...real, machines: linkedTo(real) })) }
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

  // ---------- The desktop's top bar, with everything going at once ----------
  // Its three places (which computer, search, what's happening now) and the Status menu, with an
  // agent waiting, a meeting on now and one next, setup going, a restart to apply, an update, usage
  // on an account, the weather, another device, the Bridge and Herdr tabs and the desktop app's room
  // for the Mac's window buttons. At each width from 1600 down to 900, as the window is made smaller
  // and as it opens at that size: nothing past the bar's edge, nothing narrower than what it says
  // (squeezed, cut off) or on two lines, and what left the bar is in the Status menu, one click away.
  const onNow = new Date(Date.now() - 10 * 6e4)
  const deskFakes = {
    calendar: { today: [{ id: 'e0', title: 'APM Platform weekly review with the whole team', canceled: false, calendar: 'Work', start: onNow.toISOString(), end: new Date(+onNow + 60 * 6e4).toISOString(), allDay: false, attendees: [], attendeeCount: 6 }, ...fakes.calendar.today], tomorrow: [], fetchedAt: new Date().toISOString() },
    quota: { ...fakes.quota, accounts: [{ kind: 'claude', accounts: [{ id: 'acct-w', label: 'Work Primary', active: true, isDefault: true, usable: true, status: 'ok', windows: fakes.quota.providers[0].windows }, { id: 'acct-p', label: 'Personal', usable: true, status: 'ok', windows: [] }] }] },
  }
  const deskBusy = async (c) => {
    await busy()(c)
    await c.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', 'platform-darwin')))
    await c.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: deskFakes.calendar }))
    await c.route(/\/api\/quota(\?|$)/, (r) => r.fulfill({ json: deskFakes.quota }))
    await changeAnswer(c, /\/api\/config(\?|$)/, (real) => ({ ...real, runtime: { ...real.runtime, liveView: true } }))
  }
  // What's wrong with the bar: past its edge, narrower than what it says, a line of words broken in
  // two; and what's in it, as each news chip and the meeting are there or not. And each pinned chip
  // (src/pins.js): in the bar or out of it for want of room, its words and long value showing or
  // not, and what it says on hover.
  const deskBar = (p) => p.evaluate(() => {
    const bar = document.querySelector('.topbar')
    const br = bar.getBoundingClientRect()
    // An icon (SVG) has no innerText, and its className isn't a string: its class attribute is.
    const name = (e) => `${(e.getAttribute('aria-label') || e.innerText || e.textContent || e.getAttribute('class') || '').trim().replace(/\s+/g, ' ').slice(0, 40)} <${e.tagName.toLowerCase()}.${(e.getAttribute('class') || '').split(' ')[0]}>`
    const inPop = (e) => e.closest('.status-pop, .acct-pop, .update-pop, .rec-menu, .menu')
    const out = { over: bar.scrollWidth - bar.clientWidth, past: [], squeezed: [], broken: [] }
    for (const e of bar.querySelectorAll('*')) {
      if (inPop(e) || !e.getClientRects().length) continue
      const r = e.getBoundingClientRect()
      if (r.width < 1) continue
      if (r.right > br.right + 0.5 || r.left < br.left - 0.5) out.past.push(name(e))
      // The computer's name is the one thing that may end in "…": its chip stops at 220px, and the
      // whole name is there on hover.
      if (e.matches('.mc-chip .mc-name') && e.title === e.textContent) continue
      if (e.clientWidth && e.scrollWidth > e.clientWidth + 1) out.squeezed.push(`${name(e)} ${e.scrollWidth}>${e.clientWidth}`)
    }
    const walk = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim() || inPop(n.parentElement) || !n.parentElement.getClientRects().length) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      const lines = new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)))
      if (lines.size > 1) out.broken.push(n.textContent.trim().slice(0, 40))
    }
    const shows = (s) => { const e = bar.querySelector(s); return !!e && e.getClientRects().length > 0 }
    out.has = { setup: shows('.x-setup .setup-chip'), restart: shows('.x-restart .update-chip'), update: shows('.x-update .update-chip'), meeting: shows('.meet-chip'), needs: shows('.needs-chip'), search: shows('.search-btn'), devices: shows('.mc-chip'), status: shows('.status-btn'), settings: shows('button[aria-label="Settings"]'),
      usage: shows('.x-usage .usage-chip'), weather: shows('.x-weather .wx-chip'), clock: shows('.x-clock .clock'), sounds: shows('.x-sounds .sound-btn') }
    const seen = (e) => e.getClientRects().length > 0
    out.pins = [...bar.querySelectorAll('.top-x')].map((x) => {
      const chip = x.querySelector('button, time')
      return chip && { id: [...x.classList].find((c) => c.startsWith('x-')).slice(2), in: seen(chip), words: [...x.querySelectorAll('.pin-word, .pin-long')].some(seen), hover: chip.getAttribute('title') || chip.getAttribute('aria-label') || '' }
    }).filter(Boolean)
    out.pinned = [...bar.querySelectorAll('.top-x')].map((x) => [...x.classList].find((c) => c.startsWith('x-')).slice(2))
    out.count = Number(bar.querySelector('.status-count')?.textContent || 0)
    out.name = bar.querySelector('.mc-chip .mc-name')?.title
    out.fit = [...bar.classList].filter((c) => c.startsWith('fit-')).length
    return out
  })
  // The bar once it's done giving way: it fits itself on the frame after anything in it changes size,
  // and the Status button's count is drawn after that (which can change what fits again), so it's
  // read when two looks, two frames apart, agree.
  const settledBar = async (p) => {
    let was = null
    for (let i = 0; i < 20; i++) {
      const x = await deskBar(p)
      if (was && JSON.stringify(x) === JSON.stringify(was)) return x
      was = x
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    }
    return was
  }
  const statusRows = async (p) => {
    const pop = p.locator('.status-pop')
    if (!(await pop.count())) await p.locator('.topbar .status-btn').click()
    await pop.waitFor({ timeout: 5000 }).catch(() => {})
    await until(async () => /Setting up/.test(await pop.innerText().catch(() => '')) && /Claude/.test(await pop.innerText().catch(() => '')), 5000)
    const text = (await pop.innerText().catch(() => '')).replace(/\s+/g, ' ')
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => !(await pop.count()), 3000)), 'Esc closes the Status menu')
    return text
  }
  const checkBar = async (p, t) => {
    const bar = await settledBar(p)
    ok(bar.over <= 0 && !bar.past.length, `${t}: nothing runs past the bar`, { over: bar.over, past: bar.past })
    ok(!bar.squeezed.length && !bar.broken.length, `${t}: nothing narrower than what it says, nothing on two lines`, { squeezed: bar.squeezed, broken: bar.broken })
    ok(bar.name === LONG_NAME, `${t}: a long computer name is whole on hover`, { name: bar.name })
    ok(bar.has.needs && bar.has.search && bar.has.devices && bar.has.status && bar.has.settings, `${t}: what needs you, search, the computer, Status and Settings are always there`, bar.has)
    const folded = ['setup', 'restart', 'update'].filter((k) => bar.pinned.includes(k) && !bar.has[k])
    ok(bar.count === folded.length, `${t}: the Status button counts the news that left the bar (${folded.join(', ') || 'none'})`, { count: bar.count, has: bar.has })
    // Icons first, then out: no pinned chip leaves the bar while another still shows its words.
    const gone = bar.pins.filter((x) => !x.in).map((x) => x.id)
    ok(!gone.length || !bar.pins.some((x) => x.in && x.words), `${t}: the pinned chips are down to their icons before any leaves the bar${gone.length ? ` (out: ${gone.join(', ')})` : ''}`, bar.pins)
    ok(bar.pins.every((x) => x.hover), `${t}: each pinned chip says what it is on hover`, bar.pins)
    const rows = await statusRows(p)
    const want = { setup: /Setting up · 1 of 3/, restart: /Restart Bridge AI to apply it/, update: /Bridge AI 3\.7\.0 is available/, meeting: /Now APM Platform/ }
    const missing = Object.entries(want).filter(([k, re]) => !bar.has[k] && !re.test(rows)).map(([k]) => k)
    ok(!missing.length && /Claude/.test(rows) && /new agents start on Work Primary/.test(rows) && /Notification sounds/.test(rows) && /Springfield/.test(rows) && /°F/.test(rows), `${t}: what isn't in the bar is in the Status menu, with usage, sounds, the weather and the time`, { missing, rows: rows.slice(0, 400) })
    return bar
  }
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', width: 1600, before: deskBusy })
    await until(async () => (await p.locator('.topbar .status-btn').count()) > 0 && (await p.locator('.topbar .meet-chip').count()) > 0 && (await p.locator('.topbar .x-update .update-chip').count()) > 0 && (await p.locator('.topbar .needs-chip').count()) > 0, 15000)
    const at = {}
    for (const w of [1600, 1440, 1280, 1100, 1000, 900]) {
      await p.setViewportSize({ width: w, height: 900 })
      at[w] = await checkBar(p, `desktop ${w}`)
      if ([1600, 1280, 900].includes(w)) await shot(p, `${tag}top-bar-${w}`, { clip: { x: 0, y: 0, width: w, height: 64 } })
    }
    ok(at[1600].has.update && at[1600].has.meeting && at[900].fit > at[1600].fit, 'with room the update and the meeting are in the bar; on a small window more of it gives way', { 1600: at[1600].has, fit: [at[1600].fit, at[900].fit] })
    // What's pinned to begin with (nothing chosen yet), and how it gives way: first each pinned chip
    // goes down to its icon and value, all of them still in the bar; then they leave it.
    ok(['weather', 'clock', 'usage', 'update', 'restart', 'setup'].every((k) => at[1600].pinned.includes(k)) && !at[1600].pinned.includes('sounds'), 'by default the weather, the clock, usage and the news are pinned to the bar, sounds not', at[1600].pinned)
    const compact = Object.keys(at).find((w) => at[w].pins.length && at[w].pins.every((x) => x.in && !x.words))
    ok(!!compact && at[900].pins.some((x) => !x.in), `as the window narrows the pinned chips go down to their icons, all still in the bar (${compact || 'at no width'}), then leave it`, Object.fromEntries(Object.entries(at).map(([w, x]) => [w, x.pins.map((c) => `${c.id}${c.in ? (c.words ? '+words' : '') : ':out'}`).join(' ')])))
    // A font picked in Appearance: the words grow, the bar doesn't change size, and it gives way again.
    await p.setViewportSize({ width: 1280, height: 900 })
    await p.waitForTimeout(500)
    await p.evaluate(() => document.documentElement.style.setProperty('--font', 'Verdana, "DejaVu Sans", Arial, sans-serif'))
    await checkBar(p, 'a wider font at 1280')
    await p.evaluate(() => document.documentElement.style.removeProperty('--font'))
    // The Status menu, open: its usage row opens the account menu; sounds go off and back on.
    await p.locator('.topbar .status-btn').click()
    await p.locator('.status-pop .usage-chip').click()
    ok(!!(await until(async () => /New Claude agents start on/i.test(await p.locator('.acct-pop.top').innerText().catch(() => '')), 5000)), 'Status › usage opens the account menu, for new agents')
    await p.keyboard.press('Escape')
    await p.locator('.topbar .status-btn').click()
    const speaker = p.locator('.status-pop .sound-btn')
    ok((await speaker.getAttribute('aria-checked')) === 'true' && (await kit.api('/config')).alertSounds === true, 'Status › Notification sounds: on to begin with')
    await speaker.click()
    ok(!!(await until(async () => (await kit.api('/config')).alertSounds === false && (await speaker.getAttribute('aria-checked')) === 'false', 5000)), 'a click mutes them, kept on the computer', await kit.api('/config').then((c) => c.alertSounds))
    ok(/still come, without a sound/.test(await speaker.getAttribute('title')), 'and it says they still come, without a sound', await speaker.getAttribute('title'))
    await speaker.click()
    ok(!!(await until(async () => (await kit.api('/config')).alertSounds === true && (await speaker.getAttribute('aria-checked')) === 'true', 5000)), 'and another turns sounds back on')
    // °F and °C: two plain buttons, the one picked pressed.
    await p.locator('.status-unit button', { hasText: '°C' }).click()
    ok(!!(await until(async () => (await p.locator('.status-unit button', { hasText: '°C' }).getAttribute('aria-pressed')) === 'true' && /\b18°/.test(await p.locator('.status-wx-open').innerText()), 3000)), 'the weather in °C at a click', await p.locator('.status-wx-open').innerText().catch(() => ''))
    await shot(p, `${tag}status-menu`, { clip: { x: 1280 - 420, y: 0, width: 420, height: 600 } })
    await p.keyboard.press('Escape')
    // Restart to apply, asked for in Settings while its chip had no room: the Status menu opens at it.
    await p.setViewportSize({ width: 1000, height: 900 })
    await p.waitForTimeout(600)
    if (!(await deskBar(p)).has.restart) {
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-restart')))
      ok(!!(await until(async () => /Bridge AI applies it when it restarts/.test(await p.locator('.status-pop').innerText().catch(() => '')), 4000)), 'Restart to apply, asked for with its chip out of the bar, opens in the Status menu')
      await p.keyboard.press('Escape')
    }
    // The Bridge and Herdr tabs still switch, at any width (their words go before they do).
    await p.locator('.view-tabs button[aria-label="Herdr"]').click()
    ok(!!(await until(async () => (await p.locator('.view-tabs button[aria-label="Herdr"]').getAttribute('aria-selected')) === 'true' && await p.locator('main.cmd').isHidden(), 4000)), 'Herdr switches to the Herdr view')
    await p.locator('.view-tabs button[aria-label="Bridge"]').click()
    ok(!!(await until(async () => (await p.locator('.view-tabs button[aria-label="Bridge"]').getAttribute('aria-selected')) === 'true' && await p.locator('main.cmd').isVisible(), 4000)), 'and Bridge back')
    ok(errors.filter((e) => !/herdr|WebSocket|socket/i.test(e)).length === 0, 'desktop top bar: no page errors', errors)
    await ctx.close()
  }
  for (const w of [1280, 900]) {
    const { ctx, p } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', width: w, before: deskBusy })
    await until(async () => (await p.locator('.topbar .status-btn').count()) > 0 && (await p.locator('.topbar .needs-chip').count()) > 0 && (await p.locator('.topbar .x-update .update-chip').count()) > 0, 15000)
    await p.waitForTimeout(800)
    await checkBar(p, `opened at ${w}`)
    await ctx.close()
  }

  // ---------- What's pinned to the desktop's top bar ----------
  // A quieter day (no setup, no restart, only the next meeting), so there's room: by default the
  // weather, the clock, usage and the update are in the bar with their words, sounds aren't; each
  // says what it is on hover and opens what its Status row opens. A pin in Status puts one in the bar
  // or takes it out (an unpinned update isn't counted on Status when there's no room), kept in this
  // browser for the next window; Settings › Appearance › In the Top Bar has the same switches.
  const deskCalm = async (c) => {
    await deskBusy(c)
    await c.route(/\/api\/setup\/plan(\?|$)/, (r) => r.fulfill({ json: { running: false, needsYou: null, run: null, items: [] } }))
    await changeAnswer(c, /\/api\/fix(\?|$)/, (real) => ({ ...real, restart: [] }), { orElse: {} })
    await c.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: fakes.calendar }))
  }
  // A wide window (2400): at 1920 this bar only just fits, by a few words' width that changes with
  // the time of day (the clock, the next meeting's time), so "with room" wouldn't always be so.
  const ROOM = 2400
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', width: ROOM, before: deskCalm })
    const chip = (id, pg = p) => pg.locator(`.topbar .x-${id}`).locator('button, time').first()
    await until(async () => (await chip('update').count()) > 0 && (await chip('usage').count()) > 0 && (await chip('weather').count()) > 0 && (await chip('clock').count()) > 0, 15000)
    await p.waitForTimeout(500)
    let bar = await deskBar(p)
    ok(bar.has.weather && bar.has.clock && bar.has.usage && bar.has.update && !bar.has.sounds && !(await p.evaluate(() => localStorage.getItem('cc-pins'))), 'pins, by default: the weather, the clock, usage and the update in the bar, sounds not', bar.has)
    const said = { usage: await chip('usage').innerText(), update: await chip('update').innerText(), weather: await chip('weather').innerText() }
    ok(bar.fit === 0 && said.usage.replace(/\s+/g, ' ').trim() === 'Work Primary 41% wk' && /Update/.test(said.update) && /64°/.test(said.weather), 'with room, each with its words: usage its account and the figure that matters (its week), the update its word, the weather its temperature', { fit: bar.fit, said })
    await shot(p, `${tag}top-bar-pins-${ROOM}`, { clip: { x: 0, y: 0, width: ROOM, height: 64 } })
    // What each says on hover: what its Status row says.
    const hover = { weather: await chip('weather').getAttribute('title'), usage: await chip('usage').getAttribute('title'), clock: await chip('clock').getAttribute('title'), update: await chip('update').getAttribute('title') }
    ok(hover.weather === 'Springfield: Partly cloudy, 64°F' && hover.usage === 'New Claude agents start on Work Primary\n41% of the week left\n62% of the 5-hour window left\nClick to switch account or see each limit'
      && /^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}$/.test(hover.clock || '') && /Bridge AI 3\.7\.0 is available \(you have 3\.6\.0\)/.test(hover.update || ''), 'a pinned chip says it all on hover: the place and sky, usage in full, the date, the version', hover)
    await chip('usage').click()
    ok(!!(await until(async () => /New Claude agents start on/i.test(await p.locator('.acct-pop.top').innerText().catch(() => '')), 5000)), 'usage in the bar opens its account menu, as its Status row does')
    await p.keyboard.press('Escape')
    // Pinned and unpinned from Status.
    const pin = (name) => p.locator(`.status-pop button[aria-label="Pin to the bar: ${name}"]:visible`).first()
    await p.locator('.topbar .status-btn').click()
    await pin('Notification sounds').waitFor({ timeout: 5000 }).catch(() => {})
    ok((await pin('Notification sounds').getAttribute('aria-pressed')) === 'false' && (await pin('Weather').getAttribute('aria-pressed')) === 'true' && (await pin('Clock').getAttribute('aria-pressed')) === 'true'
      && (await pin('Usage').getAttribute('aria-pressed')) === 'true' && (await pin('Updates').getAttribute('aria-pressed')) === 'true', 'Status: a pin on each item, pressed for what\'s in the bar')
    ok((await pin('Weather').getAttribute('title')) === 'Unpin from the bar' && (await pin('Notification sounds').getAttribute('title')) === 'Pin to the bar', 'each pin says what a click does')
    ok(/Pin any of these to see it in the top bar too\. Settings › Appearance/.test((await p.locator('.status-foot').innerText().catch(() => '')).replace(/\s+/g, ' ')), 'and the menu says how to put something in the bar')
    await pin('Notification sounds').click()
    await pin('Weather').click()
    await pin('Updates').click()
    bar = await until(async () => { const x = await deskBar(p); return x.has.sounds && !x.has.weather && !x.has.update && x }, 4000)
    ok(!!bar && (await pin('Notification sounds').getAttribute('aria-pressed')) === 'true' && (await pin('Weather').getAttribute('aria-pressed')) === 'false', 'pinned in Status, sounds come into the bar; unpinned, the weather and the update leave it', bar?.has)
    ok(/Click to silence them/.test(await chip('sounds').getAttribute('title')), 'the speaker in the bar says what a click does', await chip('sounds').getAttribute('title'))
    ok(/Bridge AI 3\.7\.0 is available/.test(await p.locator('.status-pop').innerText()) && /Springfield/.test(await p.locator('.status-pop').innerText()), 'and both are still in Status')
    await p.keyboard.press('Escape')
    ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('cc-pins')))) === JSON.stringify({ sounds: true, weather: false, update: false }), 'kept in this browser, only what was changed', await p.evaluate(() => localStorage.getItem('cc-pins')))
    // With no room, an unpinned update isn't counted on Status: it was taken out on purpose.
    await p.setViewportSize({ width: 900, height: 900 })
    await p.waitForTimeout(600)
    bar = await deskBar(p)
    ok(bar.count === 0 && !bar.pinned.includes('update'), 'at 900, the unpinned update isn\'t counted on Status', { count: bar.count, pinned: bar.pinned })
    // The next window opens with the same pins.
    const p2 = await ctx.newPage()
    await p2.goto(kit.url)
    const next = await until(async () => { const x = await deskBar(p2).catch(() => null); return x?.has.usage && x.has.sounds && x }, 15000)
    ok(!!next && !next.has.weather && !next.has.update && next.has.clock, 'the next window has the same pins', next?.has)
    await p2.close()
    // Settings › Appearance › In the Top Bar, from the foot of the Status menu: the same pins as switches.
    await p.setViewportSize({ width: ROOM, height: 900 })
    await p.locator('.topbar .status-btn').click()
    await p.locator('.status-foot .link-btn').click()
    const sec = p.locator('#st-topbar')
    ok(!!(await until(() => sec.isVisible(), 5000)) && /Appearance/.test(await p.locator('.st-nav-item.on').innerText()) && (await sec.locator('h4').innerText()) === 'In the Top Bar', 'Settings › Appearance opens at In the Top Bar')
    const sw = (name) => sec.locator('label', { hasText: name }).locator('input')
    ok(!(await sw('Weather').isChecked()) && (await sw('Notification sounds').isChecked()) && !(await sw('Updates').isChecked()) && (await sw('Clock').isChecked()) && (await sw('Usage').isChecked()) && (await sw('Setup').isChecked()) && (await sw('Restart to apply').isChecked()), 'its switches are the pins as they are')
    await p.waitForTimeout(300)
    await shot(p, `${tag}settings-top-bar`)
    await sw('Updates').click()
    await sw('Clock').click()
    await p.locator('.modal.settings button[aria-label="Close settings"]').click()
    bar = await until(async () => { const x = await deskBar(p); return x.has.update && !x.has.clock && x }, 4000)
    ok(!!bar, 'switched there: the update back in the bar, the clock out of it', bar?.has)
    // Pinned again, an update with no room is counted on Status.
    await p.setViewportSize({ width: 900, height: 900 })
    bar = await settledBar(p)
    ok(bar.pinned.includes('update') && !bar.has.update && bar.count === 1, 'at 900, the pinned update with no room is counted on Status', { count: bar.count, has: bar.has })
    ok(errors.filter((e) => !/herdr|WebSocket|socket/i.test(e)).length === 0, 'pins: no page errors', errors)
    await ctx.close()
  }
  // With no weather to show, the pinned weather says why rather than nothing: no city picked yet (a
  // click opens the Weather card, with its city picker), or it couldn't be fetched (the reason on
  // hover). That word stays while the chip is in the bar, however little room there is (as the bar
  // gives way the other chips' words go, never this one), and Status says it too, with the pin.
  const noWeather = [
    { what: 'no city picked yet', answer: (r) => r.fulfill({ status: 400, json: { error: 'Pick your city to see the weather.', code: 'noLocation' } }), word: 'Pick your city', why: /^No city picked yet: click to pick one for the weather$/, status: /Pick your city/ },
    { what: 'the weather not fetched', answer: (r) => r.abort(), word: '—', why: /^The weather couldn't be fetched: \S/, status: /The weather couldn't be fetched/ },
  ]
  for (const x of noWeather) {
    const { ctx, p } = await page(b, kit.url, { width: 2400, before: async (c) => { await deskCalm(c); await c.route(/\/api\/weather(\?|$)/, x.answer) } })
    const wx = p.locator('.topbar .x-weather .wx-chip')
    const said = async () => ({ text: (await wx.innerText({ timeout: 1000 }).catch(() => '')).trim(), title: await wx.getAttribute('title', { timeout: 1000 }).catch(() => null) })
    const first = await until(async () => { const s = await said(); return s.text === x.word && s }, 15000)
    ok(!!first && x.why.test(first.title || ''), `${x.what}: the pinned weather says so in the bar ("${x.word}"), and why on hover`, first || await said())
    const bare = []
    for (const w of [1600, 1280, 1100, 1000, 900]) {
      await p.setViewportSize({ width: w, height: 900 })
      await p.waitForTimeout(400)
      const now = await p.evaluate(() => { const e = document.querySelector('.topbar .x-weather .wx-chip'); return e && e.getClientRects().length ? e.innerText.trim() : null })
      if (now !== null && now !== x.word) bare.push(`${w}: "${now}"`)
    }
    ok(!bare.length, `${x.what}: with less room it keeps its word while it's in the bar, never an icon alone`, bare)
    await p.setViewportSize({ width: 2400, height: 900 })
    await p.locator('.topbar .status-btn').click()
    const pop = p.locator('.status-pop')
    ok(!!(await until(async () => x.status.test(await pop.locator('.status-now').innerText().catch(() => '')), 5000)) && await pop.locator('button[aria-label="Pin to the bar: Weather"]').isVisible(), `${x.what}: Status says so too, with the weather's pin`, await pop.locator('.status-now').innerText().catch(() => ''))
    await p.keyboard.press('Escape')
    if (x.word === 'Pick your city') {
      await wx.click()
      ok(!!(await until(() => p.getByText('Pick your city to see the weather.').first().isVisible(), 5000)), 'and a click opens the Weather card, where the city is picked')
    }
    await ctx.close()
  }

  // ---------- Usage pinned to the bar, kept small ----------
  // As one owner's bar had it: a plan with no 5-hour window, its week 29% left and a model's own
  // weekly limit (Fable) untouched, on Personal, where new agents start, with Work the other
  // account. The chip is the provider's mark, the account and the one figure that matters, colored
  // as it runs low and easy to read; no model's limit, no "Claude", no "New:"; all of it in words on
  // hover and to a screen reader (each limit and when it resets). A model's limit about to run out
  // takes the figure's place, and the menu has every model's limit; Auto, a sign-in that ran out and
  // plan usage off each say so; one account is the mark and the figure. With the busy day's bar, at
  // 1440 (a 13-inch laptop) down to 900, light and dark: nothing past its edge, squeezed or on two
  // lines, and the figure there whenever the chip is. Opened from the keyboard, closed with Escape.
  {
    const at = (h) => new Date(Date.now() + h * 3600e3).toISOString()
    const five = (pct) => ({ id: 'five_hour', kind: 'session', label: 'session', percentRemaining: pct, resetsAt: at(2) })
    const week = (pct) => ({ id: 'seven_day', kind: 'weekly', label: 'week', percentRemaining: pct, resetsAt: at(50) })
    const fable = (pct) => ({ id: 'model:fable', kind: 'model', label: 'Fable week', percentRemaining: pct, resetsAt: at(50) })
    const OWNER = [week(29), fable(100)]
    const usage = ({ windows = OWNER, setting = 'acct-p', personal = {}, off = false, one = false } = {}) => ({
      generatedAt: new Date().toISOString(), bestNow: 'claude', ...(off ? { off: true } : {}),
      providers: off ? [] : [{ provider: 'claude', usable: true, status: 'fresh', plan: 'max', percentRemaining: 29, windows }],
      accounts: [{ kind: 'claude', setting, pick: 'acct-p', accounts: one ? [{ id: 'claude-default', label: 'Your usual login', isDefault: true, named: false, active: true, usable: true, status: 'fresh', windows }] : [
        { id: 'acct-w', label: 'Work', isDefault: true, named: true, active: false, usable: true, status: 'fresh', color: 1, percentRemaining: 70, windows: [five(80), week(70)] },
        { id: 'acct-p', label: 'Personal', named: true, active: true, usable: true, status: 'fresh', color: 2, percentRemaining: 29, windows, ...personal },
      ] }],
    })
    const withUsage = (answer, day = deskCalm) => async (c) => { await day(c); await c.route(/\/api\/quota(\?|$)/, (r) => r.fulfill({ json: answer })) }
    // The chip as it is: what it says, on hover and to a screen reader, its size, and its figure's
    // level and contrast with what's behind it: each see-through background (the figure's own, the
    // chip's, the theme's frame) laid over the one under it, as the screen shows them.
    const pill = (p) => p.evaluate(() => {
      const e = document.querySelector('.topbar .x-usage .usage-chip')
      if (!e || !e.getClientRects().length) return null
      const seen = (x) => !!x && x.getClientRects().length > 0
      const fig = e.querySelector('.u-pct')
      const rgba = (c) => {
        const n = (c.match(/[\d.]+/g) || []).map(Number)
        if (/^color\(srgb/.test(c)) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1]
        return [n[0], n[1], n[2], n[3] ?? 1]
      }
      const behind = (el) => {
        const layers = []
        for (let x = el; x; x = x.parentElement) { const c = rgba(getComputedStyle(x).backgroundColor); if (c[3] > 0) layers.unshift(c); if (c[3] >= 1) break }
        return layers.reduce((u, [r, g, b, al]) => [r * al + u[0] * (1 - al), g * al + u[1] * (1 - al), b * al + u[2] * (1 - al)], [255, 255, 255])
      }
      const lum = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
      const ink = fig && rgba(getComputedStyle(fig).color), under = fig && behind(fig)
      const a = fig && lum(ink.slice(0, 3).map((v, i) => v * ink[3] + under[i] * (1 - ink[3]))), b = fig && lum(under)
      const r = e.getBoundingClientRect()
      return { text: e.innerText.replace(/\s+/g, ' ').trim(), title: e.getAttribute('title') || '', aria: e.getAttribute('aria-label') || '', width: Math.round(r.width), height: Math.round(r.height),
        mark: seen(e.querySelector('.pv-tile')), dot: seen(e.querySelector('.acct-dot')), fig: seen(fig) ? fig.textContent : null, level: fig ? ([...fig.classList].find((c) => c.startsWith('t-')) || 'plain') : null,
        contrast: fig ? Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10 : null }
    })
    const open = async (answer, o = {}) => {
      const x = await page(b, kit.url, { width: ROOM, ...o, before: withUsage(answer, o.day) })
      const got = await until(() => pill(x.p).then((c) => c?.fig || /sign in|usage off/.test(c?.text || '') ? c : null), 15000)
      return { ...x, chip: got }
    }
    const statusRow = async (p) => {
      await p.locator('.topbar .status-btn').click()
      const row = p.locator('.status-pop .usage-chip')
      await row.waitFor({ timeout: 5000 }).catch(() => {})
      const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ')
      await p.keyboard.press('Escape')
      return text
    }

    // The owner's: Personal and its week, nothing about Fable, in the warning's color, readable.
    for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
      const t = `usage chip ${look.theme}`
      const { ctx, p, chip } = await open(usage(), look)
      const lines = chip?.title.split('\n') || []
      ok(chip?.text === 'Personal 29% wk' && chip.mark && chip.dot, `${t}: the provider's mark, Personal's color and name, and its week's 29% (no "Claude", "New:" or Fable)`, chip)
      ok(chip?.width <= 200 && chip.height <= 34, `${t}: one line, at most 200 px wide (it was 371)`, chip)
      ok(chip?.level === 't-warning' && chip.contrast >= 4.5, `${t}: the figure in the warning's color (under 30% left), 4.5:1 or more against the chip`, chip)
      ok(lines[0] === 'New Claude agents start on Personal' && /^29% of the week left, Week resets /.test(lines[1] || '') && /^Fable week: 100% left, Resets /.test(lines[2] || '') && lines.at(-1) === 'Click to switch account or see each limit',
        `${t}: on hover, where new agents start, the week's limit and when it resets, the Fable week's, and what a click does`, lines)
      ok(chip?.aria === lines.slice(0, -1).join('. '), `${t}: and the same to a screen reader`, chip?.aria)
      await shot(p, `${tag}usage-chip-${look.theme}`, { clip: { x: ROOM - 760, y: 0, width: 760, height: 56 } })
      if (look.mode === 'light') {
        const row = await statusRow(p)
        ok(/^Claude new agents start on Personal 29% wk$/.test(row), 'Status › usage says which account new agents start on, in words, and its figure', row)
        await p.locator('.topbar .x-usage .usage-chip').click()
        const menu = p.locator('.acct-pop.top')
        ok(!!(await until(async () => /Fable week: 100% left/.test(await menu.innerText().catch(() => '')), 5000)), 'its menu has the Fable week\'s limit, under Personal', await menu.innerText().catch(() => ''))
        await p.keyboard.press('Escape')
      }
      await ctx.close()
    }

    // A model's limit about to run out: it's the figure, in the critical color; the Status row has
    // it beside the plan's; the menu says it under the account. And the keyboard: Enter opens the
    // menu with the focus in it, Escape closes it and puts the focus back on the chip.
    {
      const { ctx, p, chip } = await open(usage({ windows: [five(62), week(41), fable(7)] }))
      ok(chip?.text === 'Personal 7% Fable' && chip.level === 't-critical' && chip.contrast >= 4.5, 'Fable 7% left: the chip says so, in the critical color, readable', chip)
      ok(/^Fable week: 7% left, Resets /.test(chip?.title.split('\n')[1] || ''), 'and it\'s first on hover', chip?.title)
      ok(/62% 5h 41% wk 7% Fable/.test(await statusRow(p)), 'Status › usage: the 5-hour window, the week, and Fable now it\'s running out')
      await shot(p, `${tag}usage-chip-model-low`, { clip: { x: ROOM - 760, y: 0, width: 760, height: 56 } })
      const btn = p.locator('.topbar .x-usage .usage-chip')
      await btn.focus()
      await p.keyboard.press('Enter')
      const menu = p.locator('.acct-pop.top')
      ok(!!(await until(async () => (await menu.isVisible()) && await p.evaluate(() => !!document.activeElement?.closest('.acct-pop')), 4000)), 'Enter on the chip opens its menu, the focus in it')
      ok(/Fable week: 7% left/.test(await menu.innerText()) && await menu.locator('.acct-models .t-critical').count() === 1, 'the menu says Fable is at 7%, in the critical color', await menu.innerText())
      await p.waitForTimeout(300) // its fade in
      await shot(p, `${tag}usage-chip-menu`, { clip: { x: ROOM - 760, y: 0, width: 760, height: 420 } })
      await p.keyboard.press('Escape')
      ok(!!(await until(async () => !(await menu.count()) && await p.evaluate(() => !!document.activeElement?.matches('.x-usage .usage-chip')), 3000)), 'Escape closes it, the focus back on the chip')
      await ctx.close()
    }

    // Auto, a sign-in that ran out, plan usage off and one account: each says what it is.
    {
      const { ctx, p, chip } = await open(usage({ setting: 'auto' }))
      ok(chip?.title.split('\n')[0] === 'Auto: new Claude agents start on the account with the most left, now Personal', 'Auto: the chip says on hover that new agents start on the one with the most left, now Personal', chip?.title)
      ok(/new agents start on Personal auto 29% wk/.test(await statusRow(p)), 'and Status says Auto picked it, as the menu does')
      await ctx.close()
    }
    {
      const { ctx, chip } = await open(usage({ personal: { usable: false, status: 'error', error: 'Claude access token expired', percentRemaining: null, windows: [] } }))
      ok(chip?.text === 'Personal sign in' && chip.title.split('\n')[1] === 'Usage: sign-in expired (Claude access token expired)', 'a sign-in that ran out: the chip says sign in, and why on hover', chip)
      await ctx.close()
    }
    {
      const { ctx, chip } = await open(usage({ off: true }))
      ok(chip?.text === 'Personal usage off' && /Plan usage is off/.test(chip.title), 'plan usage off: the chip says so', chip)
      await ctx.close()
    }
    {
      const { ctx, chip } = await open(usage({ one: true }))
      ok(chip?.text === '29% wk' && chip.mark && !chip.dot && chip.title.split('\n')[0] === 'Claude usage', 'one account: the mark and the figure, Claude on hover', chip)
      await ctx.close()
    }

    // The busy day's bar with this usage, as the window narrows: nothing past its edge, squeezed or
    // on two lines; the chip gives way to its figure and stays one line while it's in the bar.
    for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
      const { ctx, p } = await open(usage(), { ...look, width: 1440, day: deskBusy })
      const said = {}
      for (const w of [1440, 1280, 1100, 1000, 900]) {
        await p.setViewportSize({ width: w, height: 900 })
        const bar = await settledBar(p)
        const c = await pill(p)
        said[w] = c ? c.text : 'out'
        ok(bar.over <= 0 && !bar.past.length && !bar.squeezed.length && !bar.broken.length, `usage chip ${look.theme} ${w}: nothing past the bar, squeezed or on two lines`, { past: bar.past, squeezed: bar.squeezed, broken: bar.broken })
        ok(!c || (c.fig === '29%' && c.height <= 34 && !/Fable|Claude|New:/.test(c.text)), `usage chip ${look.theme} ${w}: while it's in the bar, its figure is there on one line`, c)
        if ([1440, 1100, 900].includes(w)) await shot(p, `${tag}usage-bar-${look.theme}-${w}`, { clip: { x: 0, y: 0, width: w, height: 56 } })
      }
      ok(said[1440] !== 'out', `usage chip ${look.theme}: in the bar at 1440`, said)
      await ctx.close()
    }
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
    ok(errors.filter((e) => !/A crash made by a test|\/api\/\S+ due to access control checks/.test(e)).length === 0, `${t}: no other page errors`, errors)
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
