// What a Claude Code agent runs in the background, in Chat's tray, with a stand-in Claude Code
// (stand-ins/claude.cjs) that writes its session log the way Claude Code does: a subagent, shells
// it and its subagent left running (and their output), a monitor and its news, padded so the log
// is read in several pieces; a notice quoted in tool output, which isn't one; the terminal's
// footer settling which shells are still running; and, when the log has none, the subagents the
// footer shows. An image pasted far into the log is served back. Then the tray itself, in the
// browser named by BRIDGE_TEST_BROWSER, in a light and a dark theme; and on a phone, the tray's
// head (its summary cut short, not drawn under what's beside it) and a reply's wide table (words
// kept whole, scrolling sideways, not one letter a line).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, solid, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('chat-background')
const kit = await startKit('chat-background')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  await kit.api('/setup', { name: 'Tester' })
  // Look for agents again, as the app does after an install: the server looked before the stand-in was there.
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  const work = path.join(kit.home, 'billing')
  fs.mkdirSync(work, { recursive: true })
  const one = await kit.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Billing check', newSpace: 'Billing' })
  ok(!!one.paneId, 'a Claude Code agent starts (the stand-in)', one)
  const bg = (pane) => kit.api(`/agents/${encodeURIComponent(pane)}/subagents`)
  // Its terminal can take a while to start (PowerShell on Windows), and the stand-in writes its log
  // over a moment, as Claude Code does: until its last notice (the monitor's news) is in.
  const r = await until(async () => { const x = await bg(one.paneId); return x.items?.length && x.tasks?.some((t) => t.event) && x }, 60000, 1000)
  ok(!!r, 'its subagent, shells and monitor are listed', r || (await bg(one.paneId).catch((e) => e.message)))
  if (r) {
    const sub = r.items.find((i) => i.id === 'agent-a1')
    ok(sub?.status === 'running' && sub.type === 'Explore' && sub.description === 'Look for rounding' && sub.tools === 3, 'the subagent: running, its type, what it was asked, its steps', sub)
    const task = (id) => r.tasks.find((t) => t.id === id) || {}
    const s1 = task('bsh1')
    ok(s1.kind === 'shell' && s1.status === 'running' && s1.description === 'Run the tests' && s1.command === 'npm test', 'a shell still running, with its command', s1)
    ok(s1.output?.at(-1) === 'Progress 100%' && s1.output.includes('11 passed') && !s1.output.join('\n').includes('\x1b'), 'and its output as a terminal shows it (colours off, a progress line rewritten)', s1.output)
    ok(s1.status !== 'failed', "a notice quoted in a tool's output isn't taken for one", s1.status)
    const s3 = task('bsh3')
    ok(s3.status === 'running' && s3.by === 'Look for rounding' && s3.output?.at(-1) === 'collected 40 items', 'a shell its subagent started: running, and which subagent', s3)
    ok(!s1.by, "the session's own shells say no subagent started them", s1.by)
    const s2 = task('bsh2')
    ok(s2.status === 'done' && /exit code 0/.test(s2.summary || ''), 'a shell that finished: done, with its exit code', s2)
    ok(task('bsh0').status === 'ended', 'a shell nothing was heard from, beyond the footer\'s count, has ended', task('bsh0'))
    const m = task('bmon1')
    ok(m.kind === 'monitor' && m.status === 'running' && /deploy 2 of 3 healthy$/.test(m.event || ''), 'a monitor: running, with its latest news', m)
    ok(r.running === 4, "running: the subagent, two shells (the footer's count) and the monitor", r.running)
  }

  // An image you pasted, read back out of the log (Chat shows it in your message).
  const img = await fetch(`${kit.url}/api/agents/${encodeURIComponent(one.paneId)}/image?uuid=img-0001-abcd&i=1`)
  const bytes = Buffer.from(await img.arrayBuffer())
  ok(img.status === 200 && img.headers.get('content-type') === 'image/png' && bytes.equals(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')), 'an image pasted far into the log is served', img.status)

  // Subagents its logs don't have, as the terminal's footer shows them.
  const two = await kit.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Footer only', newSpace: 'Billing', prompt: 'screen only' })
  const f = await until(async () => { const x = await bg(two.paneId); return x.items?.some((i) => i.fromScreen) && x }, 60000, 1000)
  const row = f?.items.find((i) => i.fromScreen)
  ok(row?.type === 'Explore' && row.description === 'Look for rounding in billing' && row.elapsed === '11m 2s' && row.status === 'running', 'with no subagent in its logs, the footer\'s rows are shown', f || (await bg(two.paneId).catch((e) => e.message)))

  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.theme
    const { ctx, p, errors } = await page(b, kit.url, look)
    await p.locator('.tab-main', { hasText: 'Billing check' }).first().click({ timeout: 20000 })
    const tray = p.locator('.sa-tray').first()
    await tray.waitFor({ timeout: 20000 }).catch(() => {})
    const head = await tray.locator('.sa-head').innerText().catch(() => '')
    ok(/In the background/.test(head) && /1 subagent, 2 shells and 1 monitor running/.test(head), `${t}: Chat's tray says what's running in the background`, head)
    ok(await solid(p, '.sa-tray'), `${t}: the tray is solid`)
    const names = await tray.locator('.sa-name').allInnerTexts()
    ok(['Look for rounding', 'Run the tests', 'Run the billing tests', 'Watch the deploy', 'Build the app'].every((n) => names.some((x) => x.includes(n))), `${t}: a row each, finished ones included`, names)
    const shell = tray.locator('.sa-item.k-shell', { hasText: 'Run the tests' })
    ok(/Progress 100%/.test(await shell.locator('.sa-now').innerText()), `${t}: a shell's row shows its latest line`)
    await shell.locator('.sa-row').click()
    const out = shell.locator('.sa-out').first()
    await out.waitFor({ timeout: 5000 }).catch(() => {})
    ok(/11 passed[\s\S]*Progress 100%/.test(await out.innerText().catch(() => '')), `${t}: opened, its output`)
    ok(await out.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 8).catch(() => false), `${t}: scrolled to its newest line`)
    const mon = tray.locator('.sa-item.k-monitor')
    ok(/deploy 2 of 3 healthy/.test(await mon.locator('.sa-now').innerText().catch(() => '')), `${t}: a monitor's row shows its latest news`)
    ok(/Build the app/.test(await tray.innerText()) && /exit code 0/.test(await tray.locator('.sa-item.k-shell', { hasText: 'Build the app' }).innerText()), `${t}: a finished shell says how it ended`)
    const theirs = tray.locator('.sa-item.k-shell', { hasText: 'Run the billing tests' })
    await theirs.locator('.sa-row').click()
    ok(/Started by its subagent .Look for rounding./.test(await theirs.innerText()), `${t}: a subagent's shell says which subagent started it`, await theirs.innerText())
    await shot(p, `${tag}background-${t}`)
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- On a phone ----------
  const three = await kit.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Ticket table', newSpace: 'Billing', prompt: 'table' })
  await until(async () => (await bg(three.paneId)).items?.length > 0, 60000, 1000)
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = `phone ${look.theme}`
    const { ctx, p, errors } = await page(b, kit.url, { ...look, phone: true })
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), three.paneId)
    const table = p.locator('.md-table').first()
    ok(!!(await until(() => table.isVisible(), 20000)), `${t}: the reply's table is there`)
    const cols = await table.evaluate((x) => [...x.rows[1].cells].map((c) => Math.round(c.getBoundingClientRect().width)))
    ok(cols.every((w) => w >= 50), `${t}: no column squeezed to a letter a line`, cols)
    const wrap = await p.locator('.md-table-wrap').first().evaluate((w) => ({ scroll: w.scrollWidth, client: w.clientWidth, x: getComputedStyle(w).overflowX }))
    ok(wrap.x === 'auto', `${t}: and when it's too wide for the phone, it scrolls sideways`, wrap)
    ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${t}: the page itself doesn't`)
    const tray = p.locator('.sa-tray').first()
    await tray.waitFor({ timeout: 20000 }).catch(() => {})
    const head = await tray.evaluate((x) => {
      const r = (s) => x.querySelector(s)?.getBoundingClientRect()
      const main = r('.sa-head-main'), sub = r('.sa-sub'), title = r('.sa-title')
      return { title: title && Math.round(title.height), subEnd: sub && Math.round(sub.right), mainEnd: main && Math.round(main.right) }
    })
    ok(head.title <= 20 && head.subEnd <= head.mainEnd + 1, `${t}: the tray's head on one line, its summary cut short within it`, head)
    const share = await tray.evaluate((x) => Math.round((x.getBoundingClientRect().height / window.innerHeight) * 100))
    ok(share <= 40, `${t}: open, the tray leaves most of the screen to the conversation`, `${share}% of the screen`)
    await shot(p, `${tag}background-${look.theme}-phone`)
    ok(errors.length === 0, `${t}: no page errors`, errors)
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
