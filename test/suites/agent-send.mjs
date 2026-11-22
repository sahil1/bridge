// A message to an agent goes in and is sent the way that agent takes one, and one it didn't take
// says so (server/promptsafe.js, agents.js submit), with a stand-in Codex (stand-ins/codex.cjs) that
// reads keys as Codex does: an Enter among a paste's keys is a newline. To Codex, each goes in whole
// and is sent once: one line, several lines, one over 1,000 characters (its box shows "[Pasted
// Content N chars]"), and one while Codex reads late (busy) with bracketed paste not yet turned on
// in the terminal (the text and Enter were read together, and it stayed in the box). One Codex keeps
// in its box (each Enter a newline): Enter goes once more, then the send says so and the message is
// still there; sent again, that's cleared first and it goes once. One held while Codex worked and
// not taken when it went: held saying why, not typed in again, until Send again sends it. In the
// browser named by BRIDGE_TEST_BROWSER: a message from the message box that Codex didn't take says
// so under the box, and what you wrote is back in it; and the held one says why, with Send again.
// And Enter in the message box (src/enter.js): Smart sends from the end, makes a new line with the
// caret back in the words (the hint saying ⌘⏎ sends, which it does) or words selected, takes spaces
// after the caret as the end, and leaves an input method's Enter alone; ⌘Enter Sends and Always
// Sends, set elsewhere, taken by the open window at once; a message brought back with ↑ goes again
// with Enter, though ↑ leaves the caret at its start; the hint light and dark.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, browser, page, shot, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('agent-send')
const kit = await startKit('agent-send')
kit.program('codex', fs.readFileSync(path.join(TEST, 'stand-ins', 'codex.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const enc = encodeURIComponent
const flag = (n, on) => (on ? fs.writeFileSync(path.join(kit.home, n), '') : fs.rmSync(path.join(kit.home, n), { force: true }))
// What the stand-ins took as sent, oldest first, for a session.
const got = (session) => { try { return fs.readFileSync(path.join(kit.home, 'codex-got.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.session === session).map((x) => x.text) } catch { return [] } }
const agentOf = async (paneId) => ((await kit.api('/fleet')).agents || []).find((a) => a.paneId === paneId)
const queueOf = async (paneId) => ((await kit.api('/fleet')).queue || {})[paneId] || []
const screen = async (paneId) => ((await kit.api(`/agents/${enc(paneId)}/screen?lines=40`)).ansi || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
// Free for the next message: done working (a second and a half after a message), its box empty, and
// past the 3 s after a message went in, when the server holds the next (server/index.js holdFor).
const idle = async (paneId) => {
  const free = await until(async () => ['idle', 'done'].includes((await agentOf(paneId))?.status) && /Ask Codex to do anything/.test(await screen(paneId)), 30000, 200)
  await sleep(2000)
  return free
}
// A send's answer, or what refused it.
const send = (paneId, text) => kit.api(`/agents/${enc(paneId)}/prompt`, { text }).catch((e) => ({ error: e.message }))
fs.mkdirSync(path.join(kit.home, '.codex'), { recursive: true })
fs.writeFileSync(path.join(kit.home, '.codex', 'auth.json'), JSON.stringify({ tokens: { id_token: 'stand-in' } }))
// Each in a folder of its own, so each finds its own conversation.
const launch = async (label) => {
  const dir = path.join(kit.home, label.toLowerCase())
  fs.mkdirSync(dir, { recursive: true })
  const a = await kit.api('/agents/launch', { kind: 'codex', cwd: dir, label, newSpace: label })
  const x = await until(async () => { const y = await agentOf(a.paneId); return y?.sessionId && y }, 40000, 300)
  await idle(a.paneId)
  return { ...a, sessionId: x?.sessionId }
}

try {
  await kit.api('/setup', { name: 'Tester' })
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'codex' && a.installed), 'the stand-in Codex is found')

  // ---------- Each goes in whole and is sent, once ----------
  const cx = await launch('March')
  ok(!!cx.sessionId, 'a Codex agent at its prompt', await agentOf(cx.paneId))
  const one = 'Check the March invoices'
  const r1 = await send(cx.paneId, one)
  ok(r1.ok && r1.taken === true, 'one line: sent, and seen leaving its box', r1)
  ok(JSON.stringify(got(cx.sessionId)) === JSON.stringify([one]), 'Codex has it, once, as written', got(cx.sessionId))
  await idle(cx.paneId)
  const lines = 'Then the credits:\n  both currencies\n\nand say what changed'
  const r2 = await send(cx.paneId, lines)
  ok(r2.ok && r2.taken === true && got(cx.sessionId).at(-1) === lines && got(cx.sessionId).length === 2, 'several lines: one message, every line of it (none sent it early)', { r2, got: got(cx.sessionId) })
  await idle(cx.paneId)
  const long = `Here is the ledger to check:\n${Array.from({ length: 40 }, (_, i) => `row ${i + 1}: ${'4.20 '.repeat(6).trim()}`).join('\n')}`
  const r3 = await send(cx.paneId, long)
  ok(r3.ok && r3.taken === true && got(cx.sessionId).at(-1) === long, 'over 1,000 characters (shown as a placeholder in its box): all of it, sent', { r3, last: got(cx.sessionId).at(-1)?.slice(0, 80) })
  await idle(cx.paneId)

  // ---------- Busy, reading late, bracketed paste not yet on ----------
  flag('codex-no-bracketed', true)
  flag('codex-slow', true)
  const late = await launch('April')
  flag('codex-no-bracketed', false)
  const r4 = await send(late.paneId, 'Start on the April ledger')
  ok(r4.ok && r4.taken === true && JSON.stringify(got(late.sessionId)) === JSON.stringify(['Start on the April ledger']), 'Codex reading late, its paste mode unseen: still sent, once', { r4, got: got(late.sessionId), typed: fs.readFileSync(path.join(kit.home, 'codex-typed.log'), 'utf8').slice(-300) })
  flag('codex-slow', false)
  await idle(late.paneId)

  // ---------- Kept in its box ----------
  flag('codex-enter-newline', true)
  const kept = 'Close the March ledger'
  const r5 = await send(cx.paneId, kept)
  ok(/^Codex didn't take the message\. It's still in its box: press Enter in the Terminal tab, or Send again\.$/.test(r5.error || ''), 'Codex keeps it in its box: the send says so (not that it went)', r5)
  ok(!got(cx.sessionId).includes(kept) && (await screen(cx.paneId)).includes(kept), 'Codex didn\'t get it, and it\'s in its box', { got: got(cx.sessionId), screen: (await screen(cx.paneId)).slice(-400) })
  const typed = fs.readFileSync(path.join(kit.home, 'codex-typed.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const at = typed.findLastIndex((c) => c.includes(kept))
  ok(at >= 0 && typed.slice(at + 1).filter((c) => c === '\r').length === 2, 'Enter went twice, no more', typed.slice(at))
  flag('codex-enter-newline', false)
  const r6 = await send(cx.paneId, kept)
  ok(r6.ok && r6.taken === true && r6.cleared === kept, 'sent again: what was left in its box is cleared first', r6)
  ok(got(cx.sessionId).filter((x) => x.includes(kept)).length === 1 && got(cx.sessionId).at(-1) === kept, 'and it goes, once, as written', got(cx.sessionId))
  await idle(cx.paneId)

  // ---------- In the browser ----------
  const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', width: 1440, height: 900 })
  await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), cx.paneId)
  const boxEl = p.locator(`textarea[data-composer="${cx.paneId}"]`)
  await boxEl.waitFor({ timeout: 20000 })
  flag('codex-enter-newline', true)
  const fromBox = 'Then the April invoices'
  await boxEl.fill(fromBox)
  await boxEl.press('Enter')
  const note = await until(async () => { const x = await p.locator('.comp-note').innerText().catch(() => ''); return /Codex didn't take the message/.test(x) && x }, 20000, 200)
  ok(!!note && /still in its box: press Enter in the Terminal tab, or Send again/.test(note), 'from the message box: it says Codex didn\'t take it, and what to do', note || await p.locator('.comp-note').innerText().catch(() => ''))
  ok((await boxEl.inputValue()) === fromBox, 'and what you wrote is back in the message box', await boxEl.inputValue())
  await shot(p, `${tag}agent-send-not-taken-light-1440`)
  flag('codex-enter-newline', false)
  await boxEl.press('Enter')
  ok(!!(await until(() => got(cx.sessionId).at(-1) === fromBox, 15000, 200)), 'Send again: it goes', got(cx.sessionId))
  await idle(cx.paneId)

  // Held while it works, then not taken when it went: held saying why, until Send again.
  const may = await send(cx.paneId, 'Start the May ledger')
  ok(may.taken === true, 'one more goes in, and it works on it', may)
  flag('codex-enter-newline', true)
  const held = 'Then the June ledger'
  const r7 = await send(cx.paneId, held)
  ok(r7.queued === true, 'one sent while it works is held for it', r7)
  const failed = await until(async () => (await queueOf(cx.paneId)).find((x) => x.text === held && x.failed), 40000, 300)
  ok(!!failed && /Codex didn't take the message/.test(failed.failed), 'when it went, Codex kept it in its box: still held, saying why', await queueOf(cx.paneId))
  const typedOnce = (fs.readFileSync(path.join(kit.home, 'codex-typed.log'), 'utf8').match(/Then the June ledger/g) || []).length
  await sleep(5000)
  ok((fs.readFileSync(path.join(kit.home, 'codex-typed.log'), 'utf8').match(/Then the June ledger/g) || []).length === typedOnce && typedOnce === 1, 'and it isn\'t typed in again and again', typedOnce)
  const bubble = p.locator('.msg.queued', { hasText: held })
  ok(!!(await until(async () => /Codex didn't take the message/.test(await bubble.locator('.queued-failed').innerText().catch(() => '')), 10000, 200)), 'the chat shows why it\'s still held', await bubble.innerText().catch(() => ''))
  await shot(p, `${tag}agent-send-held-not-taken-light-1440`)
  flag('codex-enter-newline', false)
  await bubble.locator('button', { hasText: 'Send again' }).click()
  ok(!!(await until(() => got(cx.sessionId).at(-1) === held, 30000, 300)), 'Send again: it goes, once', got(cx.sessionId))
  ok(!!(await until(async () => !(await queueOf(cx.paneId)).length, 10000, 200)) && got(cx.sessionId).filter((x) => x === held).length === 1, 'nothing left held', { got: got(cx.sessionId).slice(-3), queue: await queueOf(cx.paneId) })

  // ---------- Enter in the message box (src/enter.js) ----------
  // Smart, the default: the caret at the end sends; back in the words, Enter is a new line there, the
  // hint says ⌘⏎ sends, and it does; spaces after the caret don't count; words selected: a new line in
  // their place; an input method's Enter does nothing. Then ⌘Enter Sends and Always Sends, set
  // elsewhere (Settings, another device) and taken at once by the open window.
  await idle(cx.paneId)
  const hint = () => p.locator('.composer-stack .comp-hint').innerText().catch(() => '')
  const last = () => got(cx.sessionId).at(-1)
  const left = async (n) => { for (let i = 0; i < n; i++) await boxEl.press('ArrowLeft') }
  const nothingSent = async (was) => { await sleep(1200); return last() === was }
  await boxEl.fill('Check the March totals')
  ok(/⏎ send · ⇧⏎ new line/.test(await hint()), 'Smart, the caret at the end: the hint says ⏎ sends, ⇧⏎ is a new line', await hint())
  await left(13)
  await boxEl.press('Enter')
  ok((await boxEl.inputValue()) === 'Check the\n March totals' && await nothingSent(held), 'Smart, the caret back in the words: Enter is a new line there, and nothing is sent', { box: await boxEl.inputValue(), last: last() })
  ok(!!(await until(async () => /^(⌘|Ctrl)⏎ to send$/.test((await hint()).trim()), 4000, 100)), 'and the hint says ⌘⏎ sends, nothing else', await hint())
  await shot(p, `${tag}smart-enter-composer-light`, { clip: await p.locator('.composer-stack').boundingBox().then((r) => ({ x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 })) })
  await boxEl.press('ControlOrMeta+Enter')
  ok(!!(await until(() => last() === 'Check the\n March totals', 15000, 200)), '⌘Enter sends it there, new line and all', got(cx.sessionId).slice(-2))
  ok(!!(await until(async () => (await boxEl.inputValue()) === '' && /⏎ send · ⇧⏎ new line/.test(await hint()), 4000, 100)), 'the box empty again, and its hint as it was', await hint())
  await idle(cx.paneId)
  await boxEl.fill('Check the April totals   ')
  await left(2)
  await boxEl.press('Enter')
  ok(!!(await until(() => last() === 'Check the April totals', 15000, 200)), 'Smart: the caret before nothing but spaces is the end, so Enter sends', got(cx.sessionId).slice(-2))
  await idle(cx.paneId)
  await boxEl.fill('Check the May totals')
  await boxEl.evaluate((el) => el.setSelectionRange(10, 13))
  await boxEl.press('Enter')
  ok((await boxEl.inputValue()) === 'Check the \n totals' && await nothingSent('Check the April totals'), 'Smart, words selected: Enter is a new line in their place, nothing sent', await boxEl.inputValue())
  // An input method putting a word together: its Enter (isComposing, or Safari's keyCode 229) is its own.
  await boxEl.fill('合計を確認')
  await boxEl.evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(e, 'keyCode', { get: () => 229 })
    el.dispatchEvent(e)
  })
  ok((await boxEl.inputValue()) === '合計を確認' && await nothingSent('Check the April totals'), 'an input method\'s Enter, the caret at the end: nothing is sent', { box: await boxEl.inputValue(), last: last() })
  // ⌘Enter Sends, set from elsewhere: the open window takes it at once (the live feed's config).
  await kit.api('/settings', { enterKey: 'mod' }, 'PATCH')
  await boxEl.fill('Check the June totals')
  ok(!!(await until(async () => /^(⌘|Ctrl)⏎ send · ⏎ new line$/.test((await hint()).trim()), 8000, 100)), '⌘Enter Sends, set elsewhere: the open window says so at once', await hint())
  await boxEl.press('Enter')
  ok((await boxEl.inputValue()) === 'Check the June totals\n' && await nothingSent('Check the April totals'), '⌘Enter Sends: Enter at the end is a new line', await boxEl.inputValue())
  await boxEl.press('ControlOrMeta+Enter')
  ok(!!(await until(() => last() === 'Check the June totals', 15000, 200)), 'and ⌘Enter sends', got(cx.sessionId).slice(-2))
  await idle(cx.paneId)
  await kit.api('/settings', { enterKey: 'always' }, 'PATCH')
  await boxEl.fill('Check the July totals')
  await left(7)
  ok(!!(await until(async () => /^⏎ send · ⇧⏎ new line$/.test((await hint()).trim()), 8000, 100)), 'Always Sends: the hint says ⏎ sends, the caret back in the words too', await hint())
  await boxEl.press('Enter')
  ok(!!(await until(() => last() === 'Check the July totals', 15000, 200)), 'and Enter sends from there', got(cx.sessionId).slice(-2))
  await kit.api('/settings', { enterKey: null }, 'PATCH')
  await idle(cx.paneId)
  // Smart again (taken out of the settings): ↑ in the empty box brings back a message, the caret at
  // its start; unchanged, Enter sends it again from there, as before.
  await boxEl.fill('Check the totals')
  await left(3)
  ok(!!(await until(async () => /^(⌘|Ctrl)⏎ to send$/.test((await hint()).trim()), 8000, 100)), 'Smart again, as soon as it\'s set', await hint())
  await boxEl.fill('')
  await boxEl.press('ArrowUp')
  const back = await until(async () => { const v = await boxEl.inputValue(); return v && v }, 4000, 100)
  // At its start, where ↑ puts it (once the box has the message: WebKit can draw it after the frame
  // ↑ moved the caret in, which leaves it at the end).
  await sleep(300)
  await boxEl.evaluate((el) => el.setSelectionRange(0, 0))
  ok(!!back && /⏎ send · ⇧⏎ new line/.test(await hint()), '↑ brings back a message, and with the caret at its start the hint says Enter sends it', { back, hint: await hint() })
  const sentSoFar = got(cx.sessionId).length
  await boxEl.press('Enter')
  ok(!!(await until(() => got(cx.sessionId).length === sentSoFar + 1 && last() === back.trim(), 15000, 200)), 'and Enter sends it again', { back, last: got(cx.sessionId).slice(-2) })
  await idle(cx.paneId)
  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()

  // The hint in the dark.
  {
    const dk = await page(b, kit.url, { mode: 'dark', theme: 'midnight', width: 1440, height: 900 })
    await dk.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await dk.p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), cx.paneId)
    const box = dk.p.locator(`textarea[data-composer="${cx.paneId}"]`)
    await box.waitFor({ timeout: 20000 })
    await box.fill('Check the March totals')
    for (let i = 0; i < 13; i++) await box.press('ArrowLeft')
    await box.press('Enter')
    const said = await until(async () => { const x = (await dk.p.locator('.composer-stack .comp-hint').innerText().catch(() => '')).trim(); return /^(⌘|Ctrl)⏎ to send$/.test(x) && x }, 8000, 100)
    ok(!!said, 'dark: the caret back in the words, the hint says ⌘⏎ sends', await dk.p.locator('.composer-stack .comp-hint').innerText().catch(() => ''))
    await shot(dk.p, `${tag}smart-enter-composer-dark`, { clip: await dk.p.locator('.composer-stack').boundingBox().then((r) => ({ x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 })) })
    await box.fill('')
    ok(dk.errors.length === 0, 'dark: no page errors', dk.errors)
    await dk.ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
