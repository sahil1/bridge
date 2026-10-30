// The app as a whole, on any platform and in the browser named by BRIDGE_TEST_BROWSER (Chromium,
// or WebKit, the engine of Safari and the iPhone app): it loads in a light colour theme, a dark one
// and at phone width without page errors or sideways scrolling; the sidebar, ⌘K and Settings
// open; and a New terminal runs a command typed into it. And when the whole window breaks (a crash
// made on cue): a brief one just after it opened gone by itself; one that stays, tried again twice,
// then the way back in the middle of the window with a newer version offered straight away, Copy
// details, the crash written down on the computer, Reset this window's layout first when it happens
// again after a reload, and the app back after it, on a desktop and a phone.
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
