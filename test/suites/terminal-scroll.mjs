// How far back an agent's Terminal tab scrolls, in the browser named by BRIDGE_TEST_BROWSER, with
// stand-in agents (stand-ins/long-output.cjs) that printed 8,000 numbered lines: one that then
// waits, one that keeps printing a line every 300 ms, and one that keeps them in a full-screen view
// of its own that takes the mouse, as Claude Code's fullscreen renderer does.
// The runtime keeps all 8,000. The Terminal tab opens on the latest; scrolling up with the keys, the
// rest is read in before the view reaches the top of the first lines it read, and the scroll goes
// on through without stopping: in every frame shown, the view is never further up than the keys
// pressed so far take it, never goes back down, and never shows the terminal empty. So too on a
// slow computer (the page slowed: Chromium's CPU six times, WebKit's every frame by 25 ms); the wheel
// scrolls too; the scroll bar's thumb taken to the top shows line 1, and only then is it said
// that's as far back as the terminal keeps; back at the bottom it's the latest again. With the
// agent printing meanwhile, the lines you're reading stay put when the rest comes in, and what's
// new waits below (New output · jump to latest). The full-screen agent's own history scrolls with
// the wheel, which goes to it as mouse reports (SGR), up and back down. On a phone, a swipe scrolls
// the terminal (xterm.js 6 has no touch scrolling of its own), a flick glides on, and a swipe on
// the full-screen agent scrolls its history; a New terminal scrolls by a swipe too.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, withoutCutOff, TEST, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('terminal-scroll')
const kit = await startKit('terminal-scroll')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'long-output.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const enc = encodeURIComponent
const INPUT = path.join(kit.home, 'agent-input.log')
// What the stand-in agents were sent, as they got it.
const sentTo = () => (fs.existsSync(INPUT) ? fs.readFileSync(INPUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).join('') : '')
const plainText = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

// The line number at the top of the terminal on screen, as drawn now (null: none there).
const TERM = '.term-wrap:not([hidden])'
const top = (p) => p.evaluate((sel) => {
  const row = [...document.querySelectorAll(`${sel} .xterm-rows`)].find((e) => e.offsetParent && e.getBoundingClientRect().height > 0)?.firstElementChild
  const m = /line (\d+) of/.exec(row?.textContent || '')
  return m ? Number(m[1]) : null
}, TERM)
const hint = (p) => p.locator(`${TERM} .term-hint`).filter({ visible: true }).first().innerText().catch(() => '')
// The top line in every frame drawn, and when each Page Up was pressed, from now until stopped.
// Read as each frame is about to be shown (a ResizeObserver's turn comes after every
// requestAnimationFrame callback, xterm's drawing among them, and before the frame is shown), so
// it's what's on screen, not a moment between.
const watch = (p) => p.evaluate((sel) => {
  window.__frames = []
  window.__keys = []
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-20px;top:0;width:1px;height:1px'
  document.body.append(probe)
  const ro = new ResizeObserver(() => {
    const row = [...document.querySelectorAll(`${sel} .xterm-rows`)].find((e) => e.offsetParent && e.getBoundingClientRect().height > 0)?.firstElementChild
    const m = /line (\d+) of/.exec(row?.textContent || '')
    window.__frames.push([performance.now(), m ? Number(m[1]) : null])
  })
  ro.observe(probe)
  const key = (e) => { if (e.key === 'PageUp') window.__keys.push(performance.now()) }
  document.addEventListener('keydown', key, true)
  const each = () => {
    if (!window.__watching) { ro.disconnect(); probe.remove(); document.removeEventListener('keydown', key, true); return }
    probe.style.width = probe.style.width === '1px' ? '2px' : '1px'
    requestAnimationFrame(each)
  }
  window.__watching = true
  requestAnimationFrame(each)
}, TERM)
const watched = (p) => p.evaluate(() => { window.__watching = false; return { frames: window.__frames, keys: window.__keys } })
// Frames that showed no line, went down, or had the view further up than the Page Ups pressed so
// far take it (a page is the terminal's rows less one). A slow computer draws fewer frames, so
// several keys can fall between two, and a key's page can show a frame late; the view still never
// gets ahead of the keys, and never goes back down.
const jumps = ({ frames, keys }, page) => {
  const out = []
  const start = frames[0]?.[1]
  for (let i = 1; i < frames.length; i++) {
    const [ta, a] = frames[i - 1]
    const [tb, t] = frames[i]
    const pressed = keys.filter((k) => k <= tb).length
    if (a == null || t == null || t > a || start - t > page * pressed) out.push({ from: a, to: t, ms: Math.round(tb - ta), pressed, moved: start - t })
  }
  return out
}
// The page slowed as a slower computer is: Chromium's CPU six times slower, WebKit (which can't be
// slowed that way) busy for 25 ms of every frame. Gives back a function that ends it.
const slow = async (p, which) => {
  if (which === 'chromium') {
    const cdp = await p.context().newCDPSession(p)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    return () => cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  }
  await p.evaluate(() => {
    window.__slow = true
    const busy = () => { if (!window.__slow) return; const t = performance.now(); while (performance.now() - t < 25) { /* a slow frame */ } requestAnimationFrame(busy) }
    requestAnimationFrame(busy)
  })
  return () => p.evaluate(() => { window.__slow = false })
}
// Up with the keys, a page at a time, as fast as a hand scrolls, until the top line is above `to`.
// Gives back the top line when the long read was asked for (null: it wasn't).
const pageUp = async (p, to, asked) => {
  let at = null
  for (let i = 0; i < 300; i++) {
    await p.keyboard.press('Shift+PageUp')
    await p.waitForTimeout(40)
    const tp = await top(p)
    if (at == null && asked()) at = tp
    if (tp != null && tp < to) break
  }
  return at
}
const thumb = (p) => p.locator(`${TERM} .xterm-scrollable-element > .scrollbar.vertical > .slider`).filter({ visible: true }).first()
// The scroll bar's thumb dragged to the top (or the bottom) of its track, as a hand would.
const dragThumb = async (p, to) => {
  const host = await p.locator(`${TERM} .terminal-host`).filter({ visible: true }).first().boundingBox()
  await p.mouse.move(host.x + host.width / 2, host.y + host.height / 2)
  const s = await thumb(p).boundingBox()
  const track = await thumb(p).evaluate((e) => { const r = e.parentElement.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
  await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await p.mouse.down()
  await p.mouse.move(s.x + s.width / 2, to === 'top' ? track.top + 1 : track.bottom - 1, { steps: 12 })
  await p.mouse.up()
}
const openTerminal = async (p, label) => {
  await p.locator('.tab-main', { hasText: label }).first().click({ timeout: 20000 })
  await p.locator('.console [role="tab"]', { hasText: 'Terminal' }).first().click()
}
const rowsPerPage = (p) => p.evaluate((sel) => [...document.querySelectorAll(`${sel} .xterm-rows`)].find((e) => e.offsetParent)?.children.length || 30, TERM)

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const dir = path.join(kit.home, 'code', 'app')
  fs.mkdirSync(dir, { recursive: true })
  const plain = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Long run', newSpace: 'Work', prompt: 'plain 8000' })
  const workspaceId = plain.paneId.split(':')[0]
  const slowOne = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Slow computer', workspaceId, prompt: 'plain 8000' })
  await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Busy run', workspaceId, prompt: 'busy 8000' })
  const full = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Full view', workspaceId, prompt: 'fullscreen 8000' })
  const kept = await until(async () => { const s = await kit.api(`/agents/${enc(plain.paneId)}/screen?lines=20000`); return /line 8000 of/.test(s.ansi) && s }, 30000, 500)
  const lines = plainText(kept?.ansi || '').split('\n')
  ok(/^line 1 of/.test(lines[0] || '') && lines.filter((l) => /^line \d+ of/.test(l)).length === 8000, 'the runtime keeps all 8,000 lines an agent printed', lines.slice(0, 2))
  ok(kept?.alt === false && kept?.mouse === false, 'its screen says it shows no full-screen view', kept && { alt: kept.alt, mouse: kept.mouse })
  const fullScreen = await until(async () => { const s = await kit.api(`/agents/${enc(full.paneId)}/screen?lines=60`); return /line 8000 of/.test(s.ansi) && s }, 30000, 500)
  ok(fullScreen?.alt === true && fullScreen?.mouse === true, 'a full-screen agent that takes the mouse: its screen says so', fullScreen && { alt: fullScreen.alt, mouse: fullScreen.mouse })

  // ---------- An agent that printed 8,000 lines ----------
  const { ctx, p, errors } = await page(b, kit.url, { height: 900 })
  const reads = []
  p.on('request', (r) => { const m = /\/agents\/([^/]+)\/screen\?lines=(\d+)/.exec(r.url()); if (m) reads.push({ pane: decodeURIComponent(m[1]), lines: Number(m[2]), at: Date.now() }) })
  const longRead = (pane) => () => reads.some((r) => r.pane === pane && r.lines === 20000)
  await openTerminal(p, 'Long run')
  ok(!!(await until(async () => /line 8000 of/.test(await p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 20000)), 'its Terminal tab opens on the latest line')
  const mine = reads.filter((r) => r.pane === plain.paneId)
  ok(mine.length > 0 && mine.every((r) => r.lines === 1500), 'while you watch, it reads the last 1,500 lines', mine.map((r) => r.lines))
  const page1 = (await rowsPerPage(p)) - 1

  // Up with the keys, a page at a time, as fast as a hand scrolls: the rest is read in on the way.
  await p.locator(`${TERM} .terminal-host`).filter({ visible: true }).first().click()
  await watch(p)
  const readAt = await pageUp(p, 6000, longRead(plain.paneId))
  const seen = await watched(p)
  ok(readAt != null && readAt > 6501, 'scrolling up, the rest is read in before the view reaches the top of the first 1,500 lines', { readAt })
  ok((await top(p)) < 6501, 'and the scroll goes on past them without stopping', { top: await top(p) })
  const bad = jumps(seen, page1)
  ok(seen.frames.length > 10 && bad.length === 0, 'in every frame on the way, the view moved up only as far as the keys took it, never down, and never showed the terminal empty', { frames: seen.frames.length, bad: bad.slice(0, 5) })

  // The wheel scrolls it too.
  const host = await p.locator(`${TERM} .terminal-host`).filter({ visible: true }).first().boundingBox()
  await p.mouse.move(host.x + host.width / 2, host.y + host.height / 2)
  const beforeWheel = await top(p)
  for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, -400); await p.waitForTimeout(30) }
  await p.waitForTimeout(200)
  ok((await top(p)) < beforeWheel, 'the wheel scrolls it up', { before: beforeWheel, after: await top(p) })
  ok(!/as far back/.test(await hint(p)), 'short of the top, nothing says it\'s as far back as it goes', await hint(p))

  // The scroll bar's thumb to the top: line 1.
  await dragThumb(p, 'top')
  ok(!!(await until(async () => (await top(p)) === 1, 5000)), 'the scroll bar\'s thumb taken to the top shows line 1', { top: await top(p) })
  ok(!!(await until(async () => /That's as far back as this terminal keeps/.test(await hint(p)), 3000)), 'and there it says that\'s as far back as the terminal keeps', await hint(p))
  await shot(p, `${tag}terminal-scroll-top`)

  // Back down: the latest again.
  await dragThumb(p, 'bottom')
  ok(!!(await until(async () => /line 8000 of/.test(await p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 5000)), 'taken back to the bottom, it shows the latest line again')
  ok(!!(await until(async () => !/as far back/.test(await hint(p)), 3000)), 'and no longer says it\'s as far back as it goes', await hint(p))

  // ---------- An agent still printing ----------
  await openTerminal(p, 'Busy run')
  ok(!!(await until(async () => /line 80\d\d of/.test(await p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 20000)), 'an agent still printing: its Terminal tab shows its latest lines')
  await p.locator(`${TERM} .terminal-host`).filter({ visible: true }).first().click()
  await p.keyboard.press('Shift+PageUp')
  await p.waitForTimeout(100)
  await watch(p)
  await pageUp(p, 6200, () => false)
  const busySeen = await watched(p)
  const busyBad = jumps(busySeen, page1)
  ok(busyBad.length === 0, 'with new lines coming in while the rest is read in, the lines you\'re reading stay put: no frame jumps', { frames: busySeen.frames.length, bad: busyBad.slice(0, 5) })
  // Where the keys took it, once it's drawn: a busy computer can draw the last Page Up's page a frame
  // after the loop above has looked (in CI, the view then went up one more page "by itself").
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  // (Should it move, what else changed says why: the rows shown and their size, and the line under it.)
  const shape = () => p.evaluate((sel) => { const r = [...document.querySelectorAll(`${sel} .xterm-rows`)].find((e) => e.offsetParent); return r ? `${r.children.length} rows at ${getComputedStyle(r).fontSize}` : null }, TERM)
  const still = await top(p)
  const shapeWas = await shape()
  await p.waitForTimeout(2500)
  ok((await top(p)) === still, 'reading back, the view holds still while the agent prints', { before: still, after: await top(p), shape: [shapeWas, await shape()], hint: await hint(p) })
  ok(await p.locator(`${TERM} .term-jump`).first().isVisible(), 'and offers New output · jump to latest')
  await p.locator(`${TERM} .term-jump`).first().click()
  ok(!!(await until(async () => !(await p.locator(`${TERM} .term-jump`).first().isVisible()) && /line 8\d\d\d of/.test(await p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 5000)), 'which shows the latest lines')

  // ---------- On a slow computer ----------
  await openTerminal(p, 'Slow computer')
  ok(!!(await until(async () => /line 8000 of/.test(await p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 20000)), 'slow computer: the Terminal tab opens on the latest line')
  await p.locator(`${TERM} .terminal-host`).filter({ visible: true }).first().click()
  const fast = await slow(p, which)
  await watch(p)
  const slowAt = await pageUp(p, 6000, longRead(slowOne.paneId))
  const slowSeen = await watched(p)
  await fast()
  ok(slowAt != null && slowAt > 6501 && (await top(p)) < 6501, 'slow computer: the rest is read in on the way up, and the scroll goes on past the first lines without stopping', { readAt: slowAt, top: await top(p) })
  const slowBad = jumps(slowSeen, page1)
  ok(slowSeen.frames.length > 10 && slowBad.length === 0, 'slow computer: in every frame, the view moved up only as far as the keys took it, never down, and never showed the terminal empty', { frames: slowSeen.frames.length, bad: slowBad.slice(0, 5) })

  // ---------- A full-screen agent that keeps its own history ----------
  await openTerminal(p, 'Full view')
  ok(!!(await until(async () => /line 8000 of/.test(await p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 20000)), 'a full-screen agent: its Terminal tab shows its view')
  fs.rmSync(INPUT, { force: true })
  const fh = await p.locator(`${TERM} .terminal-host`).filter({ visible: true }).first().boundingBox()
  await p.mouse.move(fh.x + fh.width / 2, fh.y + fh.height / 3)
  const fullBefore = await top(p)
  for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(40) }
  const sent = await until(() => sentTo(), 5000)
  ok(!!sent && /\x1b\[<64;60;20M/.test(sent) && !/\x1b\[<65;/.test(sent), 'the wheel goes to it as mouse reports (SGR, wheel up, over the middle of its screen)', JSON.stringify(sent || '').slice(0, 200))
  ok(!!(await until(async () => (await top(p) ?? 1e9) < fullBefore - 20, 5000)), 'and its own history scrolls back in the Terminal tab', { before: fullBefore, after: await top(p) })
  ok(!/nothing to scroll|as far back/.test(await hint(p)), 'nothing says there\'s nothing to scroll', await hint(p))
  const upTo = await top(p)
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 300); await p.waitForTimeout(40) }
  ok(!!(await until(async () => (await top(p) ?? 0) > upTo, 5000)), 'the wheel down scrolls it back toward the latest', { from: upTo, now: await top(p) })
  await shot(p, `${tag}terminal-scroll-fullscreen`)

  // ---------- A New terminal, on a touch screen ----------
  const sh = await kit.api('/agents/launch', { kind: 'shell', cwd: kit.home, label: 'Terminal', newSpace: 'Terminals' })
  await until(async () => /[$>]\s*$/.test(plainText((await kit.api(`/agents/${enc(sh.paneId)}/screen?lines=20`)).ansi).trimEnd()), 20000)
  // 3,000 numbered lines, as the shell there writes them (PowerShell on Windows).
  const count = IS_WIN ? '1..3000 | % { "line $_ of the agent\'s output" }' : 'i=1; while [ $i -le 3000 ]; do echo "line $i of the agent\'s output"; i=$((i+1)); done'
  await kit.api(`/panes/${enc(sh.paneId)}/input`, { steps: [{ text: count }, { keys: ['enter'] }] })
  await until(async () => /line 3000 of/.test(plainText((await kit.api(`/agents/${enc(sh.paneId)}/screen?lines=20`)).ansi)), 30000)
  const shTab = (await kit.api('/fleet')).tabs.find((x) => x.panes.some((q) => q.paneId === sh.paneId))
  await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), `tab:${shTab.tabId}`)
  ok(!!(await until(async () => /line 3000 of/.test(await p.locator('.live-shell .xterm-rows').first().innerText().catch(() => '')), 20000)), 'a New terminal shows what it printed', plainText((await kit.api(`/agents/${enc(sh.paneId)}/screen?lines=20`)).ansi).slice(-300))
  const shTop = () => p.evaluate(() => { const m = /line (\d+) of/.exec(document.querySelector('.live-shell .xterm-rows')?.firstElementChild?.textContent || ''); return m ? Number(m[1]) : null })
  const was = await shTop()
  const swiped = await p.evaluate(async () => {
    try { new Touch({ identifier: 0, target: document.body, clientX: 0, clientY: 0 }) } catch { return false } // no Touch events in this browser
    const el = document.querySelector('.live-shell .terminal-host')
    const r = el.getBoundingClientRect()
    const at = (y) => [new Touch({ identifier: 1, target: el, clientX: r.left + 100, clientY: y })]
    const fire = (type, touches) => el.dispatchEvent(new TouchEvent(type, { touches, changedTouches: touches.length ? touches : at(r.bottom - 60), bubbles: true, cancelable: true }))
    fire('touchstart', at(r.top + 60))
    for (let i = 1; i <= 24; i++) { fire('touchmove', at(r.top + 60 + (r.height - 120) * i / 24)); await new Promise((x) => requestAnimationFrame(x)) }
    for (let i = 0; i < 6; i++) { fire('touchmove', at(r.bottom - 60)); await new Promise((x) => requestAnimationFrame(x)) }
    fire('touchend', [])
    return true
  })
  if (!swiped) skip('a swipe scrolls a New terminal on a touch screen', `${which} has no Touch events here`)
  else {
    await p.waitForTimeout(300)
    const now = await shTop()
    ok(was != null && now != null && now < was - 10, 'on a touch screen, a swipe scrolls a New terminal\'s history', { before: was, after: now })
  }
  ok(withoutCutOff(errors).length === 0, 'no page errors', errors)
  await ctx.close()

  // ---------- Dark ----------
  const dk = await page(b, kit.url, { height: 900, mode: 'dark', theme: 'midnight' })
  await openTerminal(dk.p, 'Long run')
  await until(async () => /line 8000 of/.test(await dk.p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 20000)
  await dragThumb(dk.p, 'top')
  await until(async () => !/Loading/.test(await hint(dk.p)), 5000)
  await dragThumb(dk.p, 'top')
  ok(!!(await until(async () => (await top(dk.p)) === 1, 6000)), 'dark: the thumb to the top, then again, shows line 1', { top: await top(dk.p) })
  await shot(dk.p, `${tag}terminal-scroll-top-dark`)
  await dk.ctx.close()

  // ---------- On a phone: a finger scrolls it ----------
  const ph = await page(b, kit.url, { phone: true })
  await ph.p.waitForSelector('.tabbar button', { timeout: 15000 })
  // A swipe from y0 to y1 at x, as a finger moves, then lifted (still, or at speed: a flick).
  const swipe = (x, y0, y1, { flick = false } = {}) => ph.p.evaluate(async ({ sel, x, y0, y1, flick }) => {
    const el = [...document.querySelectorAll(`${sel} .terminal-host`)].find((e) => e.offsetParent && e.getBoundingClientRect().height > 0)
    try { new Touch({ identifier: 0, target: document.body, clientX: 0, clientY: 0 }) } catch { return false } // no Touch events in this browser
    const at = (y) => [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })]
    const fire = (type, touches) => el.dispatchEvent(new TouchEvent(type, { touches, changedTouches: touches.length ? touches : at(y1), bubbles: true, cancelable: true }))
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    fire('touchstart', at(y0))
    const n = flick ? 6 : 24
    for (let i = 1; i <= n; i++) { fire('touchmove', at(y0 + (y1 - y0) * i / n)); await frame() }
    if (!flick) for (let i = 0; i < 6; i++) { fire('touchmove', at(y1)); await frame() }
    fire('touchend', [])
    return true
  }, { sel: TERM, x, y0, y1, flick })
  await ph.p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), plain.paneId)
  await ph.p.locator('.console [role="tab"]').nth(1).click({ timeout: 20000 })
  ok(!!(await until(async () => /line 8000 of/.test(await ph.p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 20000)), 'phone: the Terminal tab opens on the latest line')
  const pb = await ph.p.locator(`${TERM} .terminal-host`).filter({ visible: true }).first().boundingBox()
  const px = pb.x + 120
  const phoneTop = await top(ph.p)
  if (!(await swipe(px, pb.y + 60, pb.y + pb.height - 60))) skip('phone: a swipe scrolls the terminal', `${which} has no Touch events here`)
  else {
    await ph.p.waitForTimeout(200)
    const after = await top(ph.p)
    ok(after != null && after < phoneTop - 10, 'phone: a swipe down scrolls back through what the agent printed', { before: phoneTop, after })
    await ph.p.waitForTimeout(300)
    const settled = await top(ph.p)
    await swipe(px, pb.y + 60, pb.y + pb.height - 60, { flick: true })
    await ph.p.waitForTimeout(1200)
    const flung = await top(ph.p)
    ok(flung != null && settled - flung > (pb.height - 120) / 14, 'phone: a flick glides on further than the finger moved', { before: settled, after: flung })
    ok(await ph.p.evaluate(() => document.scrollingElement.scrollTop === 0 && window.scrollY === 0), 'phone: the page itself didn\'t move')
    // The full-screen agent: a swipe scrolls its own history.
    fs.rmSync(INPUT, { force: true })
    await ph.p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), full.paneId)
    await ph.p.locator('.console [role="tab"]').nth(1).click({ timeout: 20000 })
    await until(async () => /line 8000 of/.test(await ph.p.locator(`${TERM} .xterm-rows`).filter({ visible: true }).first().innerText().catch(() => '')), 20000)
    const fb = await ph.p.locator(`${TERM} .terminal-host`).filter({ visible: true }).first().boundingBox()
    await swipe(fb.x + 120, fb.y + 60, fb.y + fb.height - 60)
    const swiped = await until(() => /\x1b\[<64;/.test(sentTo()), 5000)
    const back = swiped && await until(async () => (await top(ph.p) ?? 1e9) < 7900, 5000)
    ok(!!back, 'phone: a swipe on the full-screen agent scrolls its own history, as the wheel does', { sent: JSON.stringify(sentTo()).slice(0, 120), top: await top(ph.p) })
    await shot(ph.p, `${tag}terminal-scroll-phone`)
  }
  ok(withoutCutOff(ph.errors).length === 0, 'phone: no page errors', ph.errors)
  await ph.ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
