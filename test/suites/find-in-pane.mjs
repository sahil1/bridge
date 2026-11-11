// Find in this chat or terminal (⌘F on a Mac, Ctrl+F elsewhere), in the browser named by
// BRIDGE_TEST_BROWSER, with a stand-in Claude Code (stand-ins/claude.cjs "find") whose conversation
// has "ledger" five times, forty lines apart, and "zeppelin" once, before what Chat first shows.
// In its Chat: ⌘F opens the bar at the top of the pane, its field focused and nothing said until
// something's typed; it counts the matches ("3 of 5"), marks each and the current one more
// strongly; Enter, Shift+Enter, ⌘G and ⇧⌘G go round them, scrolling each into view; Match case
// changes the count; nothing found says No matches; ⌘F again selects what's typed; a new message
// with a match changes the count, not the match or the scroll; a word only in the earlier messages
// is found, read in and scrolled to; Esc closes it and gives focus back. Started with a word
// selected and the pointer over the chat, it starts with that word. In the agent's Terminal tab
// and a New terminal: it finds a line in the scrollback and marks it there, drawn by the GPU too;
// what's typed in the field never reaches the terminal; Esc gives the terminal the keyboard back.
// ⌘F with focus and pointer elsewhere (the sidebar, ⌘K's field) is left to the browser. On a
// phone, the ⋯ menu's Find opens the same bar, which fits: 40 px targets, a 16 px field.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, phoneFaults, TEST, IS_MAC, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('find-in-pane')
const kit = await startKit('find-in-pane')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const MOD = IS_MAC ? 'Meta' : 'Control'
const enc = encodeURIComponent
// The highlights' ranges as text, and the current one with where it is in its chat.
const marks = (p) => p.evaluate(() => {
  if (typeof CSS === 'undefined' || !CSS.highlights) return null
  const all = [...(CSS.highlights.get('bridge-find') || [])].map((r) => r.toString())
  const r = [...(CSS.highlights.get('bridge-find-now') || [])][0]
  const box = r?.getBoundingClientRect()
  const chat = r && r.startContainer.parentElement.closest('.chat')
  const c = chat?.getBoundingClientRect()
  const bar = chat?.querySelector('.find-bar')?.getBoundingClientRect()
  return { all, now: r ? r.toString() : null, shown: !!(box && c && box.top >= (bar ? bar.bottom : c.top) && box.bottom <= c.bottom), scroll: chat ? Math.round(chat.scrollTop) : null, at: box && [Math.round(box.top), Math.round(box.bottom)], chat: c && [Math.round(c.top), Math.round(c.bottom)], bar: bar && Math.round(bar.bottom) }
})
// The average colour of a part of the screen, as drawn: { r, g, b }.
const colour = async (p, clip) => {
  const png = await p.screenshot({ clip })
  return p.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let r = 0, g = 0, bl = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2] }
    const n = d.length / 4
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n) }
  }, png.toString('base64'))
}
// Where the current match is on the screen, once a frame has been drawn: WebKit works out where a
// highlight goes as it draws the next frame, so a screenshot before then shows the text unmarked.
const nowBox = (p) => p.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(r))
  window.__drawn = CSS.highlights?.get('bridge-find-now')
  const r = [...(window.__drawn || [])][0]?.getBoundingClientRect()
  return r && { x: r.x, y: r.y, width: r.width, height: r.height }
})
// The current match as drawn. Find marks the matches anew as the earlier messages are read in: if it
// did while the screen was read, it's read again.
const nowColour = async (p) => {
  let c = null
  for (let i = 0; i < 5; i++) {
    const nb = await nowBox(p)
    c = nb && await colour(p, nb)
    if (await p.evaluate(() => CSS.highlights.get('bridge-find-now') === window.__drawn)) break
  }
  return c
}
// Whether the next keydown of F reached the page unhandled: set by a listener after ours.
const watchF = (p) => p.evaluate(() => { window.__f = 'none'; if (!window.__fl) { window.__fl = true; window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'f') window.__f = e.defaultPrevented }) } })
try {
  await kit.api('/setup', { name: 'Tester' })
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  const work = path.join(kit.home, 'billing')
  fs.mkdirSync(work, { recursive: true })
  const one = await kit.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Ledger check', newSpace: 'Billing', prompt: 'find' })
  const tr = await until(async () => { const x = await kit.api(`/agents/${enc(one.paneId)}/transcript`); return x.messages?.some((m) => /LEDGER report/.test(m.text || '')) && x }, 60000, 1000)
  ok(!!tr?.more && !tr.messages.some((m) => /zeppelin/.test(m.text || '')), "its conversation is in, and goes back further than Chat first shows (where zeppelin is)", tr && { more: tr.more, n: tr.messages.length })

  // ---------- Chat ----------
  const { ctx, p, errors } = await page(b, kit.url, { height: 800 })
  await p.locator('.tab-main', { hasText: 'Ledger check' }).first().click({ timeout: 20000 })
  await p.locator('.chat .msg', { hasText: 'LEDGER report' }).waitFor({ timeout: 20000 })
  // Full size, and the tray of what runs in the background folded, so the chat has room to scroll.
  await p.locator('.console button[aria-label="Full size"]').first().click()
  await p.locator('.sa-tray .sa-head-main[aria-expanded="true"]').first().click({ timeout: 5000 }).catch(() => {})
  const chat = p.locator('.chat').first()
  const bar = p.locator('.chat .find-bar')
  const field = bar.locator('input')
  const count = () => bar.locator('.find-count').innerText().catch(() => '')
  await p.locator('.composer textarea').click()
  await p.keyboard.press(`${MOD}+f`)
  ok(!!(await until(() => bar.isVisible(), 4000)), '⌘F in a chat opens its find bar')
  ok(await p.evaluate(() => document.activeElement?.matches('.find-bar input')), 'its field has focus')
  const at = await bar.evaluate((x) => { const r = x.getBoundingClientRect(); const c = x.closest('.chat').getBoundingClientRect(); return { top: Math.round(r.top - c.top), right: Math.round(c.right - r.right) } })
  ok(at.top >= 0 && at.top <= 16 && at.right < 40, 'at the top of the pane', at)
  ok((await bar.locator('.find-count').count()) === 0, 'nothing typed: nothing said')
  const tips = await bar.locator('button').evaluateAll((x) => x.map((e) => e.title))
  const g = IS_MAC ? '⌘G' : 'Ctrl+G'
  const sg = IS_MAC ? '⇧⌘G' : 'Ctrl+Shift+G'
  ok(tips.some((x) => x.includes('Shift+Enter') && x.includes(sg)) && tips.some((x) => /\(Enter or /.test(x) && x.includes(g)) && tips.includes('Match case'), "the buttons' tooltips name their keys, as this computer writes them", tips)

  await field.fill('ledger')
  const first = await until(async () => { const c = await count(); return /^\d of 5$/.test(c) && c }, 8000)
  ok(!!first, 'it counts the matches ("n of 5")', await count())
  const m0 = await marks(p)
  if (!m0) skip('the matches are marked', 'this browser has no CSS Custom Highlight API')
  else {
    ok(m0.all.length === 5 && m0.all.every((x) => /^ledger$/i.test(x)) && /^ledger$/i.test(m0.now || '') && m0.shown, 'every match is marked, the current one more strongly, in view', m0)
    // As drawn: the current match orange, here a match in a reply beside a code block (which Safari
    // leaves unmarked in text straight in its box).
    const c = await nowColour(p)
    ok(!!c && c.r - c.b > 60, 'the current match is drawn in its colour', c)
  }
  const n0 = Number(first?.split(' ')[0] || 0)
  const nth = (k) => `${((n0 - 1 + k + 50) % 5) + 1} of 5`
  await p.keyboard.press('Enter')
  ok(!!(await until(async () => (await count()) === nth(1), 3000)), 'Enter goes to the next match', await count())
  await p.keyboard.press('Shift+Enter')
  ok(!!(await until(async () => (await count()) === nth(0), 3000)), 'Shift+Enter to the one before', await count())
  await p.keyboard.press(`${MOD}+g`)
  ok(!!(await until(async () => (await count()) === nth(1), 3000)), `${g} to the next`, await count())
  await p.keyboard.press(`${MOD}+Shift+g`)
  ok(!!(await until(async () => (await count()) === nth(0), 3000)), `${sg} to the one before`, await count())
  // Round to the first (the question, at the top) and back to the last (under forty lines).
  for (let i = 0; i < 6 && (await count()) !== '1 of 5'; i++) await p.keyboard.press('Enter')
  const top = await marks(p)
  ok((await count()) === '1 of 5' && (!top || (top.now === 'Ledger' && top.shown)), 'round to the first match, scrolled into view', { count: await count(), top })
  await p.keyboard.press('Shift+Enter')
  const last = await marks(p)
  ok((await count()) === '5 of 5' && (!last || (last.now === 'LEDGER' && last.shown && last.scroll > top.scroll + 200)), 'and back past it to the last, scrolled down to', { count: await count(), last, top })
  await shot(p, `${tag}find-chat`)
  // The chat made shorter under the current match (what the agent runs opening under it, a phone's
  // keyboard): the match is brought back into view.
  if (last) {
    await p.evaluate(() => { const r = [...CSS.highlights.get('bridge-find-now')][0]; const chat = r.startContainer.parentElement.closest('.chat'); chat.scrollTop += r.getBoundingClientRect().bottom - (chat.getBoundingClientRect().bottom - 30) })
    const low = await marks(p)
    await p.setViewportSize({ width: 1440, height: 550 })
    const kept = await until(async () => { const m = await marks(p); return m.chat[1] < low.at[0] && m.shown && m }, 3000, 100)
    ok(low.shown && !!kept && kept.now === 'LEDGER', 'the chat made shorter under the current match: it\'s brought back into view', { low, kept: kept || await marks(p) })
    await p.setViewportSize({ width: 1440, height: 800 })
  }

  await bar.locator('button[aria-label="Match case"]').click()
  ok(!!(await until(async () => /of 3$/.test(await count()), 3000)) && (await bar.locator('button[aria-label="Match case"]').getAttribute('aria-pressed')) === 'true', 'Match case: only "ledger" as typed (3)', await count())
  await bar.locator('button[aria-label="Match case"]').click()
  ok(!!(await until(async () => /of 5$/.test(await count()), 3000)), 'and off again, all five', await count())

  // A new message with a match: counted, and the match and the view stay where they were.
  const log = (() => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.jsonl') && fs.readFileSync(f, 'utf8').includes('LEDGER report')) out.push(f) } }; walk(path.join(kit.home, '.claude', 'projects')); return out[0] })()
  await field.click()
  for (let i = 0; i < 6 && (await count()) !== '1 of 5'; i++) await p.keyboard.press('Enter')
  const still = await marks(p)
  fs.appendFileSync(log, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'One more thing: the ledger export is checked too.' }] } }) + '\n')
  const grew = await until(async () => /of 6$/.test(await count()), 20000)
  const after = await marks(p)
  ok(!!grew && (await count()) === '1 of 6' && (!still || (after.now === still.now && Math.abs(after.scroll - still.scroll) <= 2)), "a new message's match is counted; the current match and the view stay put", { count: await count(), still, after })

  await p.keyboard.press(`${MOD}+f`)
  ok(await field.evaluate((e) => e === document.activeElement && e.selectionStart === 0 && e.selectionEnd === e.value.length), '⌘F again selects what\'s typed')
  await p.keyboard.type('qqzzv')
  ok(!!(await until(async () => (await count()) === 'No matches', 3000)), 'nothing found: "No matches"', await count())
  await field.fill('')
  ok(!!(await until(async () => (await bar.locator('.find-count').count()) === 0, 3000)), 'emptied: nothing said again')

  // Only in the earlier messages: read in, found, scrolled to.
  await field.fill('zeppelin')
  const old = await until(async () => (await count()) === '1 of 1', 30000)
  const z = await marks(p)
  ok(!!old && (!z || (z.now === 'zeppelin' && z.shown)), 'a word only in the earlier messages: they\'re read in, and it\'s found and shown', { count: await count(), z })

  await p.keyboard.press('Escape')
  ok(!!(await until(async () => !(await bar.isVisible()), 3000)), 'Esc closes it')
  ok(await p.evaluate(() => document.activeElement?.matches('.composer textarea')), 'and gives focus back where it was')
  const gone = await marks(p)
  ok(!gone || gone.all.length === 0, 'its marks go too', gone)

  // Nothing with focus, a word selected, the pointer over the chat: it starts with that word.
  await p.evaluate(() => {
    document.activeElement?.blur()
    const msg = [...document.querySelectorAll('.chat .msg')].find((m) => m.innerText.includes('Why does the Ledger'))
    const w = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.data.indexOf('drift')
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 5); getSelection().removeAllRanges(); getSelection().addRange(r); break }
    }
  })
  const box = await chat.boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await p.keyboard.press(`${MOD}+f`)
  ok(!!(await until(() => bar.isVisible(), 3000)) && (await field.inputValue()) === 'drift' && /of 1$/.test(await until(count, 3000) || ''), 'nothing focused, the pointer over the chat: ⌘F there, starting with the word selected', { value: await field.inputValue(), count: await count() })
  await p.keyboard.press('Escape')

  // ⌘F elsewhere is the browser's: the sidebar, with the pointer on it, and ⌘K's field.
  await p.locator('.rail-nav-btn').first().focus()
  const rail = await p.locator('.rail-nav-btn').first().boundingBox()
  await p.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2)
  await watchF(p)
  await p.keyboard.press(`${MOD}+f`)
  ok((await p.evaluate(() => window.__f)) === false && !(await bar.isVisible()), "⌘F with focus and the pointer outside a pane is left to the browser", await p.evaluate(() => window.__f))
  await p.keyboard.press(`${MOD}+k`)
  await p.locator('[role="dialog"] input').first().waitFor({ timeout: 4000 }).catch(() => {})
  await watchF(p)
  await p.keyboard.press(`${MOD}+f`)
  ok((await p.evaluate(() => window.__f)) === false && !(await bar.isVisible()), "and in ⌘K's field", await p.evaluate(() => window.__f))
  await p.keyboard.press('Escape')

  // ---------- The agent's Terminal tab ----------
  await p.locator('.console [role="tab"]', { hasText: 'Terminal' }).first().click()
  const tbar = p.locator('.term-wrap:not([hidden]) .find-bar')
  await p.locator('.term-wrap:not([hidden]) .xterm-rows').waitFor({ timeout: 10000 })
  await until(async () => /auto mode on/.test(await p.locator('.term-wrap:not([hidden]) .xterm-rows').innerText()), 10000)
  await p.locator('.term-wrap:not([hidden]) .terminal-host').click()
  await p.keyboard.press(`${MOD}+f`)
  ok(!!(await until(() => tbar.isVisible(), 3000)) && !(await bar.isVisible()), "in the agent's Terminal tab, ⌘F opens the terminal's bar, not the chat's")
  await p.keyboard.type('auto mode')
  ok(!!(await until(async () => (await tbar.locator('.find-count').innerText().catch(() => '')) === '1 of 1', 5000)), 'and finds in its screen', await tbar.locator('.find-count').innerText().catch(() => ''))
  await p.keyboard.press('Escape')
  ok(await p.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), 'Esc gives the terminal the keyboard back')

  // ---------- A New terminal: more than a screen of output ----------
  await p.locator('.rail-tool[aria-label="New terminal"]').click()
  const shell = p.locator('.live-shell').first()
  const rows = () => shell.locator('.xterm-rows').innerText().catch(() => '')
  await until(async () => /[$#%>]$/.test((await rows()).trimEnd().split('\n').pop() || ''), 30000)
  let printed = false
  for (let i = 0; i < 3 && !printed; i++) {
    await shell.locator('.xterm').click()
    await p.keyboard.type(IS_WIN ? '"needle-" + 3*7; 1..120 | % { "row $_" }' : 'echo needle-$((3*7)); seq 1 120 | sed "s/^/row /"')
    await p.keyboard.press('Enter')
    printed = !!(await until(async () => /row 120/.test(await rows()), 10000))
  }
  ok(printed && !/needle-21/.test(await rows()), 'a New terminal printed a known line, then more than a screen', (await rows()).slice(-200))
  const sbar = shell.locator('.find-bar')
  await shell.locator('.xterm').click()
  await p.keyboard.press(`${MOD}+f`)
  ok(!!(await until(() => sbar.isVisible(), 3000)) && await p.evaluate(() => document.activeElement?.matches('.live-shell .find-bar input')), "⌘F in it opens the terminal's bar, its field focused")
  await p.keyboard.type('needle-21')
  const scount = () => sbar.locator('.find-count').innerText().catch(() => '')
  ok(!!(await until(async () => (await scount()) === '1 of 1', 5000)), 'it finds the line in the scrollback', await scount())
  const lit = await until(() => shell.evaluate((s) => {
    const d = [...s.querySelectorAll('.find-now')].find((e) => e.style.display !== 'none')
    if (!d) return null
    const r = d.getBoundingClientRect()
    const row = [...s.querySelectorAll('.xterm-rows > div')].find((x) => { const q = x.getBoundingClientRect(); return q.top <= r.top + r.height / 2 && q.bottom >= r.top + r.height / 2 })
    return { row: row?.textContent || '', w: Math.round(r.width) }
  }), 4000)
  ok(!!lit && /needle-21/.test(lit.row) && lit.w > 20, 'scrolled to it, and marked there', lit)
  await shot(p, `${tag}find-terminal`)
  await p.keyboard.type('zzq')
  ok(!!(await until(async () => (await scount()) === 'No matches', 3000)), 'typing on: "No matches"', await scount())
  await p.keyboard.press('Escape')
  ok(await p.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), 'Esc gives the terminal the keyboard back')
  const tbox = await shell.locator('.xterm').boundingBox()
  await p.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2)
  await p.mouse.wheel(0, 6000)
  await p.waitForTimeout(600)
  const sh = (await kit.api('/fleet')).tabs?.flatMap((x) => x.panes).find((x) => !x.agent)
  const screen = sh ? (await kit.api(`/agents/${enc(sh.paneId)}/screen?lines=300`).catch((e) => ({ ansi: e.message }))).ansi || '' : 'no shell in the fleet'
  ok(/needle-21/.test(screen) && !/zzq/.test(screen), 'what was typed in the field never reached the terminal', screen.slice(-300))
  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()

  // ---------- Drawn by the GPU ----------
  if (which !== 'chromium') skip('marks drawn by the GPU', 'checked in Chromium')
  else {
    const gp = await page(b, kit.url, { height: 760, store: { 'cc-term-dom': false } })
    await gp.p.locator('.tab-main', { hasText: 'Terminal' }).first().click({ timeout: 20000 })
    const gs = gp.p.locator('.live-shell').first()
    await gs.locator('.xterm').waitFor({ timeout: 15000 })
    await gp.p.waitForTimeout(800)
    const gl = await gs.evaluate((s) => !!s.querySelector('.xterm-screen canvas'))
    if (!gl) skip('marks drawn by the GPU', 'this browser has no WebGL')
    else {
      await gs.locator('.xterm').click()
      await gp.p.keyboard.press(`${MOD}+f`)
      await gp.p.keyboard.type('needle')
      const gc = await until(async () => { const c = await gs.locator('.find-count').innerText().catch(() => ''); return /^\d of 2$/.test(c) && c }, 5000)
      ok(!!gc, 'with the GPU drawing the terminal: both matches found (the command and its output)', { count: await gs.locator('.find-count').innerText().catch(() => ''), bars: await gs.locator('.find-bar').count(), focus: await gp.p.evaluate(() => document.activeElement?.className) })
      // The other match's cells, as drawn: tinted by its mark, not the terminal's own dark grey.
      const other = await until(() => gs.evaluate((s) => {
        const now = s.querySelector('.find-now')?.getBoundingClientRect()
        const d = [...s.querySelectorAll('.xterm-find-result-decoration')].find((e) => { if (e.style.display === 'none') return false; const q = e.getBoundingClientRect(); return !now || q.bottom <= now.top || q.top >= now.bottom })
        if (!d) return null
        const r = d.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }), 4000)
      if (!other) ok(false, 'the other match is on screen, marked')
      else {
        const avg = await colour(gp.p, other)
        ok(avg.r - avg.b > 20, "and the other match's cells are painted in its colour by the GPU", avg)
      }
      await shot(gp.p, `${tag}find-terminal-gpu`)
    }
    ok(gp.errors.length === 0, 'GPU: no page errors', gp.errors)
    await gp.ctx.close()
  }

  // ---------- On a phone ----------
  const ph = await page(b, kit.url, { phone: true })
  await ph.p.waitForSelector('.tabbar button', { timeout: 15000 })
  await ph.p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), one.paneId)
  await ph.p.locator('.chat .msg', { hasText: 'LEDGER report' }).waitFor({ timeout: 20000 })
  await ph.p.locator('button[aria-label="More actions"]').first().click()
  await ph.p.locator('.menu .menu-item', { hasText: 'Find in this chat' }).click()
  const pbar = ph.p.locator('.chat .find-bar')
  ok(!!(await until(() => pbar.isVisible(), 3000)) && await ph.p.evaluate(() => document.activeElement?.matches('.find-bar input')), 'phone: the ⋯ menu\'s Find in this chat opens the bar, its field focused')
  await ph.p.keyboard.type('ledger')
  ok(!!(await until(async () => /of [56]$/.test(await pbar.locator('.find-count').innerText().catch(() => '')), 5000)), 'phone: and finds', await pbar.locator('.find-count').innerText().catch(() => ''))
  // (Shown once the chat is laid out: what opens under it as the agent's page fills in makes it
  // shorter, and the match is brought back into view as it's drawn.)
  const pm = await until(async () => { const m = await marks(ph.p); return !m ? 'unmarked' : m.now && m.shown && m }, 3000, 100)
  ok(!!pm, 'phone: the current match is shown, clear of the bar', pm || await marks(ph.p))
  let f = await phoneFaults(ph.p, '.find-bar')
  ok(!Object.keys(f).length, 'phone: the bar fits (each target 40 px and uncovered, the field 16 px, nothing past the edge)', f)
  await shot(ph.p, `${tag}find-phone-chat`)
  await pbar.locator('button[aria-label="Close find"]').click()
  await ph.p.locator('.console [role="tab"]').nth(1).click()
  await ph.p.locator('button[aria-label="More actions"]').first().click()
  await ph.p.locator('.menu .menu-item', { hasText: 'Find in this terminal' }).click()
  const ptbar = ph.p.locator('.term-wrap:not([hidden]) .find-bar')
  ok(!!(await until(() => ptbar.isVisible(), 3000)), "phone: in the Terminal tab, the ⋯ menu's Find in this terminal opens the terminal's bar")
  await ph.p.waitForTimeout(300)
  f = await phoneFaults(ph.p, '.term-wrap:not([hidden]) .find-bar')
  ok(!Object.keys(f).length, 'phone: and it fits', f)
  await shot(ph.p, `${tag}find-phone-terminal`)
  ok(ph.errors.length === 0, 'phone: no page errors', ph.errors)
  await ph.ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
