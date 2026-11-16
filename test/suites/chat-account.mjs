// Accounts, with two Claude Code accounts and a stand-in Claude Code (stand-ins/claude.cjs), in the
// browser named by BRIDGE_TEST_BROWSER, in a light and a dark theme: the message box's chip says
// which account a conversation is on and its menu continues it on the other (it starts again there,
// same conversation), not while it's working; the agent's header has no second switcher; the top
// bar's menu says it's the account new agents start on. And a usage limit: Chat says when it resets
// and whether it carries on by itself, and Continue now moves it to the other account and tells it
// to carry on. What's in the message box goes with the conversation to the pane that takes its
// place, and the window doesn't load again: on another account, restarted on another model (Codex,
// stand-ins/codex.cjs, restarts to switch), handed to another agent.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, solid, noServiceWorker, TEST } from '../lib/harness.mjs'

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
  // A draft typed in an agent's message box, with a mark on the window that a reload would take away.
  const typeDraft = async (p, pane, text) => {
    await p.locator(`textarea[data-composer="${pane}"]`).fill(text)
    await p.evaluate(() => { window.__stayed = true })
  }
  // That draft in the message box of the pane that took over, none left for the old one, and the mark still there.
  const carried = async (p, from, to, text) => {
    const box = p.locator(`textarea[data-composer="${to}"]`)
    const got = !!to && !!(await until(async () => (await box.inputValue().catch(() => null)) === text, 15000))
    const was = await p.evaluate((k) => ({ stayed: window.__stayed === true, left: localStorage.getItem(k) }), `cc-draft-${from}`)
    return { ok: got && was.stayed && !was.left, box: await box.inputValue().catch(() => null), ...was }
  }

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
    const draft = `Then the ${t} invoices`
    await typeDraft(p, one.paneId, draft)
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
    const went = await carried(p, first.paneId, moved?.paneId, draft)
    ok(went.ok, `${t}: what was in its message box is in the new one's, and the window didn't load again`, went)
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
    // The top bar's menu is for new agents (from usage, in its Status menu).
    await p.locator('.topbar .status-btn').click()
    await p.locator('.status-pop .usage-chip').click()
    const top = await until(() => p.locator('.acct-pop.top').innerText().catch(() => ''), 5000) || ''
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
    // And its whole log written, the limit last: the stand-in draws its screen first, so it looked
    // done while what it has running wasn't in its log yet, and the tray under the chat, read then,
    // only looked again 15 seconds later (Claude Code writes its log as it works).
    await until(async () => !!(await kit.api(`/agents/${encodeURIComponent(l.paneId)}/transcript`).catch(() => null))?.limit, 30000, 500)
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
  // What it has running opens under the chat, which keeps its end in view: the card and its
  // buttons, rather than out of sight until the chat jumps to them.
  const atEnd = () => p.evaluate(() => { const c = document.querySelector('.chat-limit')?.closest('.chat'); return !!c && c.scrollHeight - c.scrollTop - c.clientHeight < 2 })
  // (As it's drawn: the chat is put back at its end when it's laid out, the frame after the tray.)
  const trayUp = await p.locator('.sa-tray').first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  const ended = trayUp && await until(atEnd, 3000)
  // (If not: whether the tray came, and where the chat was.)
  const scroll = () => p.evaluate(() => { const c = document.querySelector('.chat-limit')?.closest('.chat'); return c && { scrollHeight: c.scrollHeight, scrollTop: c.scrollTop, clientHeight: c.clientHeight } })
  ok(trayUp && !!ended, 'what it has running opens under the chat, and the chat keeps its end in view, the card with its buttons', ended ? undefined : { trayUp, chat: await scroll() })
  await card.locator('button', { hasText: 'Continue now on Work' }).click()
  const onWork = await until(() => agentOf((a) => a.sessionId === weekly.sessionId && a.paneId !== weekly.paneId && a.accountId === work.id), 30000, 500)
  ok(!!onWork, 'Continue now: the conversation goes on on Work', ((await kit.api('/fleet')).agents || []).map((a) => ({ pane: a.paneId, session: a.sessionId, account: a.accountId })))
  const typed = () => { try { return fs.readFileSync(path.join(kit.home, 'claude-typed.log'), 'utf8') } catch { return '' } }
  const told = onWork && await until(() => /Continue from where you stopped\./.test(typed()), 30000, 1000)
  ok(!!told, 'and it is told to carry on from where it stopped', onWork && { typed: typed(), queued: ((await kit.api('/fleet')).queue || {})[onWork.paneId], status: (await agentOf((a) => a.paneId === onWork.paneId))?.status })
  // Stopped at its weekly limit with its working line still on screen (Claude Code can leave it up):
  // it isn't working, so Chat says it hit its limit, and the account menu moves it to Work.
  {
    const s = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Billing stuck', newSpace: 'Billing stuck', prompt: 'stuck weekly limit' })
    const stuck = await until(() => agentOf((a) => a.paneId === s.paneId && a.sessionId && a.status === 'working'), 60000, 1000)
    ok(!!stuck, 'an agent at its weekly limit, its screen still showing it working', await agentOf((a) => a.paneId === s.paneId))
    await p.locator('.tab-main', { hasText: 'Billing stuck' }).first().click({ timeout: 20000 })
    ok(!!(await until(async () => /weekly limit/.test(await card.innerText().catch(() => '')), 15000)) && (await p.locator('.chat-live, .live-activity').count()) === 0, 'Chat says it hit its weekly limit, not that it is working', await p.locator('.console-body').innerText().catch(() => ''))
    await p.locator('.model-chip').first().click()
    const m = p.locator('.model-pop')
    await m.waitFor({ timeout: 5000 }).catch(() => {})
    const said = await m.innerText().catch(() => '')
    const toWork = m.locator('.acct-item', { hasText: 'Work' })
    ok(/stopped at its usage limit/.test(said) && !/It's working/.test(said) && !(await toWork.isDisabled()), 'the account menu: another account can pick it up now', said)
    await toWork.click()
    const moved = await until(() => agentOf((a) => a.sessionId === stuck.sessionId && a.paneId !== stuck.paneId && a.accountId === work.id), 30000, 500)
    ok(!!moved, 'and it goes on on Work', ((await kit.api('/fleet')).agents || []).map((a) => ({ pane: a.paneId, session: a.sessionId, account: a.accountId })))
  }
  ok(errors.length === 0, 'usage limit: no page errors', errors)
  await ctx.close()

  // Your usual login taken off the list while an agent is still on it: the agent goes by the
  // account it's signed in as when that's one you listed (Work here), else by its email, never
  // "Your usual login". The quota feed's answer is laid over, as plan usage reads real accounts
  // (with no service worker: in WebKit what a page asks for once one has it skips the test's route).
  {
    const usualOn = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Usual', newSpace: 'Usual', prompt: 'idle', account: 'claude-default' })
    await until(() => agentOf((a) => a.paneId === usualOn.paneId && a.sessionId && a.status !== 'working' && a.status !== 'unknown'), 60000, 1000)
    const chipFor = async (same) => {
      const { ctx: c2, p: p2 } = await page(b, kit.url, { before: async (c) => {
        await noServiceWorker(c)
        await c.route(/\/api\/quota(\?|$)/, async (route) => {
          const r = await route.fetch()
          const j = await r.json()
          const g = (j.accounts || []).find((x) => x.kind === 'claude')
          if (g) { g.usualHidden = true; g.accounts = g.accounts.filter((a) => a.id !== 'claude-default'); g.usual = { id: 'claude-default', label: 'Your usual login', isDefault: true, named: false, usable: false, status: 'pending', windows: [], signedIn: true, account: { email: 'pat.lee@example.com', organization: null }, sameAs: same } }
          await route.fulfill({ response: r, json: j })
        })
      } })
      await p2.locator('.tab-main', { hasText: 'Usual' }).first().click({ timeout: 20000 })
      const acct = () => p2.locator('.model-chip .mc-acct').first().innerText().then((x) => x.trim(), () => '')
      const want = same ? (x) => x === 'Work' : (x) => /^pa•••@example\.com$/.test(x)
      await until(async () => want(await acct()), 15000)
      const got = await acct()
      await c2.close()
      return got
    }
    const asWork = await chipFor(work.id)
    ok(asWork === 'Work', "your usual login off the list, signed in as Work: the agent's chip says Work", asWork)
    const asNone = await chipFor(null)
    ok(/^pa•••@example\.com$/.test(asNone), 'signed in as none you listed: who it is, its email mostly hidden', asNone)
  }

  // Restarted on another model (Codex restarts to switch), then handed to another agent: what was in
  // the message box goes too, and the window doesn't load again.
  {
    kit.program('codex', fs.readFileSync(path.join(TEST, 'stand-ins', 'codex.cjs'), 'utf8'))
    fs.mkdirSync(path.join(kit.home, '.codex'), { recursive: true })
    fs.writeFileSync(path.join(kit.home, '.codex', 'auth.json'), JSON.stringify({ tokens: { id_token: 'stand-in' } }))
    ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'codex' && a.installed), 'the stand-in Codex is found')
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight' })
    p.on('dialog', (d) => d.accept())
    const l = await kit.api('/agents/launch', { kind: 'codex', cwd: dir, label: 'Ledger', newSpace: 'Ledger' })
    const cx = await until(() => agentOf((a) => a.paneId === l.paneId && a.sessionId && a.status !== 'working' && a.status !== 'unknown'), 60000, 1000)
    ok(!!cx, 'a Codex agent with a conversation', await agentOf((a) => a.paneId === l.paneId))
    await p.locator('.tab-main', { hasText: 'Ledger' }).first().click({ timeout: 20000 })
    await typeDraft(p, l.paneId, 'Then the March ledger')
    await p.locator('.model-chip').first().click()
    await p.locator('.model-pop button', { hasText: 'Other…' }).click()
    await p.locator('.model-other input').fill('gpt-5-codex')
    await p.locator('.model-other button', { hasText: 'Restart' }).click()
    const back = await until(() => agentOf((a) => a.sessionId === cx?.sessionId && a.paneId !== l.paneId), 30000, 500)
    const started = () => { try { return fs.readFileSync(path.join(kit.home, 'codex-started.log'), 'utf8').trim().split('\n').map((x) => JSON.parse(x)) } catch { return [] } }
    ok(!!back && started().some((x) => x.join(' ') === `--model gpt-5-codex resume ${cx?.sessionId}`), 'Codex restarts on gpt-5-codex, with the same conversation', { back, started: started() })
    const restarted = await carried(p, l.paneId, back?.paneId, 'Then the March ledger')
    ok(restarted.ok, "restarted: what was in its message box is in the new one's, and the window didn't load again", restarted)

    const h = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Handover', newSpace: 'Handover', prompt: 'idle' })
    const cl = await until(() => agentOf((a) => a.paneId === h.paneId && a.sessionId && a.status !== 'working' && a.status !== 'unknown'), 60000, 1000)
    ok(!!cl, 'a Claude Code agent to hand off, done working', await agentOf((a) => a.paneId === h.paneId))
    await p.locator('.tab-main', { hasText: 'Handover' }).first().click({ timeout: 20000 })
    await typeDraft(p, h.paneId, 'Then the April ledger')
    const before = new Set(((await kit.api('/fleet')).agents || []).map((a) => a.paneId))
    await p.locator('.model-chip').first().click()
    await p.locator('.model-pop .ho-item', { hasText: 'Codex' }).click()
    await p.locator('.ho-pop button[type="submit"]').click()
    const to = await until(() => agentOf((a) => a.kind === 'codex' && !before.has(a.paneId)), 30000, 500)
    ok(!!to && !(await agentOf((a) => a.paneId === h.paneId)), 'handed to Codex, in a new pane, the old one closed', ((await kit.api('/fleet')).agents || []).map((a) => ({ pane: a.paneId, kind: a.kind, tab: a.tab })))
    const handed = await carried(p, h.paneId, to?.paneId, 'Then the April ledger')
    ok(handed.ok, "handed off: what was in its message box is in the new agent's, and the window didn't load again", handed)
    ok(errors.length === 0, 'restart and hand-off: no page errors', errors)
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
