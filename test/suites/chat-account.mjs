// Accounts, with two Claude Code accounts and a stand-in Claude Code (stand-ins/claude.cjs), in the
// browser named by BRIDGE_TEST_BROWSER, in a light and a dark theme: the message box's chip says
// which account a conversation is on and its menu continues it on the other (it starts again there,
// same conversation), not while it's working; the agent's header has no second switcher; the top
// bar's menu says it's the account new agents start on. And a usage limit: Chat says when it resets
// and whether it carries on by itself, and Continue now moves it to the other account and tells it
// to carry on.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, solid, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('chat-account')
const kit = await startKit('chat-account')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  await kit.api('/setup', { name: 'Tester' })
  // Look for agents again, as the app does after an install: the server looked before the stand-in was there.
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  const work = await kit.api('/accounts', { kind: 'claude', label: 'Work' })
  ok(/^claude-/.test(work.id), 'a second Claude Code account, Work', work)
  const dir = path.join(kit.home, 'billing')
  fs.mkdirSync(dir, { recursive: true })
  const agentOf = async (pred) => ((await kit.api('/fleet')).agents || []).find(pred)

  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.theme
    const label = `Billing ${t}`
    const one = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: label, prompt: 'idle' })
    const first = await until(() => agentOf((a) => a.paneId === one.paneId && a.sessionId && a.status !== 'working' && a.status !== 'unknown'), 60000, 1000)
    ok(!!first, `${t}: a Claude Code agent with a conversation, done working`, await agentOf((a) => a.paneId === one.paneId))
    const { ctx, p, errors } = await page(b, kit.url, look)
    p.on('dialog', (d) => d.accept())
    await p.locator('.tab-main', { hasText: label }).first().click({ timeout: 20000 })
    const chip = p.locator('.model-chip').first()
    ok(!!(await until(async () => (await chip.locator('.mc-acct').innerText().catch(() => '')).trim() === 'Your usual login', 15000)), `${t}: the message box's chip says the account it's on (your usual login, not "Default")`, await chip.innerText().catch(() => ''))
    ok((await p.locator('.pane-head .acct-tag, .pane-head .acct-chip, .pane-sub .acct-chip').count()) === 0, `${t}: the agent's header has no switcher of its own`)
    await chip.click()
    const menu = p.locator('.model-pop')
    await menu.waitFor({ timeout: 5000 }).catch(() => {})
    ok(await solid(p, '.model-pop'), `${t}: its menu is solid`)
    const rows = menu.locator('.acct-item', { has: p.locator('.acct-left') })
    // Each name without its plan tag (the stand-in Claude Code says it's on Max once it's asked).
    const names = (await rows.locator('.acct-name').allInnerTexts()).map((x) => x.split('\n')[0].trim())
    ok(/Claude Code account/i.test(await menu.innerText()) && names.join('|') === 'Your usual login|Work', `${t}: the menu lists its accounts under its models`, names)
    ok(await rows.nth(0).getAttribute('aria-checked') === 'true' && await rows.nth(0).isDisabled() && !(await rows.nth(1).isDisabled()), `${t}: the one it's on is ticked, the other can be picked`)
    await shot(p, `${tag}account-menu-${t}`)
    await rows.nth(1).click()
    // It starts again on Work, the same conversation, and the app opens it.
    const moved = await until(() => agentOf((a) => a.sessionId === first.sessionId && a.paneId !== first.paneId && a.accountId === work.id), 30000, 500)
    ok(!!moved, `${t}: the conversation continues on Work`, ((await kit.api('/fleet')).agents || []).map((a) => ({ pane: a.paneId, session: a.sessionId, account: a.accountId })))
    ok(!!(await until(async () => (await p.locator('.model-chip .mc-acct').first().innerText().catch(() => '')).trim() === 'Work', 20000)), `${t}: and its chip says Work`, await p.locator('.model-chip').first().innerText().catch(() => ''))
    // Not while it's working.
    const busy = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: `${label} busy`, newSpace: label })
    await until(() => agentOf((a) => a.paneId === busy.paneId && a.sessionId && a.status === 'working'), 60000, 1000)
    await p.locator('.tab-main', { hasText: `${label} busy` }).first().click({ timeout: 20000 })
    await until(async () => (await p.locator('.model-chip .mc-acct').count()) > 0 && (await p.locator('.state-tag.st-working').count()) > 0, 15000)
    await p.locator('.model-chip').first().click()
    const m2 = p.locator('.model-pop')
    await m2.waitFor({ timeout: 5000 }).catch(() => {})
    ok(/It's working\. Another account can pick it up once it's done/.test(await m2.innerText().catch(() => '')) && await m2.locator('.acct-item', { hasText: 'Work' }).isDisabled(), `${t}: while it's working the other account waits, and says why`)
    await p.keyboard.press('Escape')
    // The top bar's menu is for new agents.
    await p.locator('.usage-chip').first().click()
    const top = await p.locator('.acct-pop.top').innerText().catch(() => '')
    ok(/New Claude agents start on/i.test(top), `${t}: the top bar's account menu says it's for new agents`, top)
    await p.keyboard.press('Escape')
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // A usage limit. The 5-hour one: Claude Code carries on by itself at the reset, and Chat says so.
  const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
  p.on('dialog', (d) => d.accept())
  const openIdle = async (label, prompt) => {
    const l = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: label, prompt })
    const a = await until(() => agentOf((x) => x.paneId === l.paneId && x.sessionId && x.status !== 'working' && x.status !== 'unknown'), 60000, 1000)
    await p.locator('.tab-main', { hasText: label }).first().click({ timeout: 20000 })
    return a
  }
  await openIdle('Billing limit', 'limit')
  const card = p.locator('.chat-limit')
  ok(!!(await until(() => card.isVisible(), 15000)), 'at a usage limit, Chat says so')
  const five = await card.innerText()
  ok(/Claude Code hit its session limit/.test(five) && /Resets 3:10am/.test(five) && /It carries on by itself at 3:10am/.test(five), 'the 5-hour one: when it resets, and that it carries on by itself then', five)
  ok(/Continue now on Work/.test(five), 'with the other account to carry on with now', five)
  await shot(p, `${tag}usage-limit-sky`)
  // The weekly one doesn't carry on by itself: Continue now on Work.
  const weekly = await openIdle('Billing weekly', 'weekly limit')
  ok(!!(await until(async () => /weekly limit/.test(await card.innerText().catch(() => '')), 15000)), 'the weekly one too')
  const wk = await card.innerText()
  ok(/Resets Oct 29 at 5am/.test(wk) && /It won't carry on by itself/.test(wk), "the weekly one: it won't carry on by itself", wk)
  await card.locator('button', { hasText: 'Continue now on Work' }).click()
  const onWork = await until(() => agentOf((a) => a.sessionId === weekly.sessionId && a.paneId !== weekly.paneId && a.accountId === work.id), 30000, 500)
  ok(!!onWork, 'Continue now: the conversation goes on on Work', ((await kit.api('/fleet')).agents || []).map((a) => ({ pane: a.paneId, session: a.sessionId, account: a.accountId })))
  const typed = () => { try { return fs.readFileSync(path.join(kit.home, 'claude-typed.log'), 'utf8') } catch { return '' } }
  const told = onWork && await until(() => /Continue from where you stopped\./.test(typed()), 30000, 1000)
  ok(!!told, 'and it is told to carry on from where it stopped', onWork && { typed: typed(), queued: ((await kit.api('/fleet')).queue || {})[onWork.paneId], status: (await agentOf((a) => a.paneId === onWork.paneId))?.status })
  ok(errors.length === 0, 'usage limit: no page errors', errors)
  await ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
