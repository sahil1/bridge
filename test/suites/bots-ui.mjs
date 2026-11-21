// Bots, as the owner meets it: one Bots row in the sidebar opening three tabs, Connections, Bots and
// Sessions, against the server itself, with a stand-in Slack (one shared app reaching Front Desk, its
// Chief, and Hiring) and the stand-in Claude Code answering (stand-ins/helper-claude.cjs: each
// conversation a live session in a pane of its own). Only what's hard to bring about here is stood in
// for in the page (Playwright's routes), as the API contract has it: another copy of Bridge AI on the
// same app and Slack holding reads back (a connection's others and limited), a push waiting for you
// and a run at its time limit (two turns of a session's Thread), and a Bridge AI from before sessions
// (a second page without them, each saying so, never failing).
//   Connections: a card saying it's connected, Test this connection (each check as the server ran it:
//     what needs you first, the rest a click away; a check's fix), You here linked by a code sent to
//     the app in a direct message (the card ticks by itself), the Chief picked and the specialists it
//     reaches, Advanced folded with the app's tokens and A slash command for each bot (a switch on
//     its label's line), Try a message (a dry run), and nothing listed as coming. A bot given an app of
//     its own there (An App of Its Own) has a card of the same kind under Slack, after the shared one,
//     saying whose it is; set up, it offers to move the bot onto the shared one, which works: done,
//     its card goes and that's said.
//   Bots: the Chief first, then the specialists; New bot's three questions (what it's for, its
//     folder, where it answers) sent as one (/bots/quick), the bot as asked for: its page opens.
//   A bot's page: Overview, Settings, Memory, Activity; its Overview's sessions and Start a Test
//     Session; Settings with five fields (name, what it's for, its folder, who can ask, edits files)
//     and the rest under Advanced, commands among them (none in this version, saying why), and where
//     it answers in one line, with Open in Connections (its connection's card, scrolled to).
//   Sessions: every session (Hiring's in #launch with your change and Dana's question waiting, Front
//     Desk's with Sam in a direct message, one ended), waiting for you first, filtered by bot and by
//     how it stands; Start a test session, opening it. A session: its Thread (Dana's reply sent as
//     edited, your change undone, your step in's answer posted to the thread, a push approved and a
//     run at its time limit carried on) and Live (the agent's own Chat and Terminal of its pane, never
//     in the sidebar's Spaces; typing is Step in), Stop on a turn at work, End session, and Open it now
//     for one whose pane closed.
//   Old places (the overview, a connection's Routing, Connections) go to their tab; Settings › Bots is
//   the switch and Open Bots. Light and dark, a computer and a phone (More › Bots, each tab and a
//   session fitting the screen).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSlack, checks, until, sleep, browser, page, shot, phoneFaults, changeAnswer, noServiceWorker, TEST } from '../lib/harness.mjs'
import { openSettings, lookers, M } from '../lib/bots.mjs'

const { ok, done } = checks('bots-ui')
const slack = await startSlack('bots-ui')
const NOTES = 'Sam at 2, Lee at 4.\n'
const kit = await startKit('bots-ui', {
  config: { name: 'Tester', trials: { 'slack-bot': true } },
  env: ({ home }) => {
    for (const d of ['Hiring', 'Launch', 'Desk']) fs.mkdirSync(path.join(home, d), { recursive: true })
    fs.writeFileSync(path.join(home, 'Hiring', 'notes.md'), NOTES)
    return { BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_CARRY_MS: '0' }
  },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
const { posted } = lookers(kit, slack)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const shown = (p, sel, ms = 8000) => p.locator(sel).first().waitFor({ timeout: ms }).then(() => true, () => false)
const textOf = (p, sel) => p.locator(sel).first().innerText({ timeout: 3000 }).catch(() => '')
// What's wrong on a phone's screen (phoneFaults), but for what's only scrolled under the tab bar, as
// anything on a long page is at some point: the page scrolls it out from under, so it isn't a fault.
const fits = async (p, ...scopes) => {
  const f = await phoneFaults(p, ...scopes)
  if (f.covered) f.covered = f.covered.filter((x) => !/ under Sections <nav\.tabbar>$/.test(x))
  if (!f.covered?.length) delete f.covered
  return f
}
// The server's sessions, and one with its turns.
const sessions = async (q = '') => (await kit.api(`/bots/sessions${q}`)).sessions
const view = (sid) => kit.api(`/bots/sessions/${sid}`)
// The session a question (these words) is in.
const sessionWith = (words, ms = 40000) => until(async () => { for (const s of await sessions()) { const v = await view(s.id); if (v.turns.some((x) => String(x.text || '').includes(words))) return v.session } return null }, ms, 500)
const stateOf = async (sid) => (await sessions()).find((x) => x.id === sid) || null
const inThread = async (ts) => (await posted()).filter((x) => x.thread_ts === ts)
const conn = (id) => kit.api(`/connections/${id}`)
const SUM = { ok: /Every check passed/, warn: /Working, with \d+ warnings?/, fail: /\d+ checks? failed/ }

let C, FD, HI, LB
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  C = (await kit.api('/connections', { platform: 'slack', name: 'tester_bot' })).id
  await kit.api(`/connections/${C}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
  FD = (await kit.api('/bots', { name: 'Front Desk', description: 'Takes every question first', readsFrom: ['~/Desk'] })).id
  HI = (await kit.api('/bots', { name: 'Hiring', description: 'Answers hiring questions', readsFrom: ['~/Hiring'] })).id
  await kit.api(`/bots/${FD}/settings`, { askers: [{ id: 'U0SAM', name: 'Sam' }] })
  await kit.api(`/bots/${HI}/settings`, { askers: [{ id: 'U0DANA', name: 'Dana' }], changes: 'edit', writesTo: ['~/Hiring'], answerIn: 'thread' })
  ok(!!(await until(async () => (await conn(C)).state === 'connected', 20000)), 'the shared Slack connection is connected')
} catch (e) { ok(false, `the kit couldn't be set up: ${e.stack}`) }

// ---------- What the page is given in place of what's hard to bring about here ----------
// Another copy on the same app, Slack holding reads back (a connection's others and limited); in
// Hiring's session, a push waiting for you and a run at its time limit (each a turn of its Thread,
// answered here when pressed). Everything else is the server's own.
function standIns() {
  const st = { others: null, limited: null, calls: [], sid: null }
  const T = (min) => new Date(Date.now() - min * 60000).toISOString()
  const extra = [
    { q: 'qpush', at: T(2), from: { id: 'U0OWNER', name: 'Tester', owner: true }, text: 'Push the notes', state: 'sent', sent: 'Asked to push.', auto: true, push: { id: 'p4', state: 'waiting', title: 'Update the interview notes', summary: 'Adds Kim and tomorrow\'s times', branch: 'bot/hiring/notes', head: 'h4', code: 'h4', files: ['notes.md'], stat: '1 file changed', at: T(1) } },
    { q: 'qlimit', at: T(1), from: { id: 'U0DANA', name: 'Dana' }, text: 'Check every old thread too', state: 'answering', limit: { phase: 'asking', ran: 10, longest: 240, left: 230, choices: [], at: T(0), doing: 'reading old threads' } },
  ]
  const install = async (ctx) => {
    await noServiceWorker(ctx)
    await changeAnswer(ctx, /\/api\/connections$/, (j) => ({ ...j, connections: (j.connections || []).map((c) => (c.id === C && (st.others || st.limited) ? { ...c, ...(st.others ? { others: st.others, numConnections: 2 } : {}), ...(st.limited ? { limited: st.limited } : {}) } : c)) }))
    await changeAnswer(ctx, /\/api\/bots\/sessions\/s\d+$/, (j) => (st.sid && j?.session?.id === st.sid ? { ...j, turns: [...(j.turns || []), ...extra] } : j))
    await ctx.route(/\/api\/bots\/questions\/q(push|limit)\/(push|limit)$/, (r) => {
      const [q, act] = r.request().url().split('/').slice(-2)
      const body = r.request().postDataJSON()
      st.calls.push([act, q, body])
      const t = extra.find((x) => x.q === q)
      if (t && act === 'push') t.push = { ...t.push, state: body.act === 'approve' ? 'pushed' : 'denied' }
      if (t && act === 'limit') { delete t.limit; t.state = 'answering' }
      return r.fulfill({ json: { ok: true } })
    })
  }
  return { st, install }
}
const called = (st, kind, ms = 6000) => until(() => st.calls.find((c) => c[0] === kind) || null, ms, 100)

let sA = null // Hiring's, in #launch: your change, then Dana's question waiting for you
let sB = null // Front Desk's, Sam's direct message
let sC = null // Hiring's, in your direct messages, ended
let first = null // the question that started sA, in #launch
try {
  // ---------- A computer, light ----------
  const S = standIns()
  const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', before: S.install })
  await p.locator('.rail').waitFor({ timeout: 20000 })

  await part('the sidebar: one Bots row, three tabs', async () => {
    const row = p.locator('[data-setting="rail-bots"] .rail-nav-btn')
    ok(await shown(p, '[data-setting="rail-bots"] .rail-nav-btn', 15000) && (await row.innerText()).trim().startsWith('Bots'), 'the sidebar has one Bots row', await row.innerText().catch(() => ''))
    ok(!(await p.locator('.rail-bot-list, .rail-bots-head').count()), 'and no list of bots under a heading, as before')
    await row.click()
    ok(await shown(p, '.bh[data-setting="bots-home"]'), 'Bots opens in the main area')
    const tabs = await p.locator('.bh-tabs [role="tab"]').allInnerTexts()
    ok(tabs.map((x) => x.trim().split('\n')[0]).join('|') === 'Connections|Bots|Sessions', 'with three tabs: Connections, Bots, Sessions', tabs)
  })

  await part('connections', async () => {
    await p.locator('.bh-tabs [data-tab="connections"]').click()
    const card = p.locator(`.bh-card[data-connection="${C}"]`)
    ok(await shown(p, `.bh-card[data-connection="${C}"]`), 'Connections: a card for the shared Slack app')
    ok(/@tester_bot/.test(await card.locator('.cn-name').innerText()) && /Connected to/.test(await card.locator('.cn-state').innerText()), 'named @tester_bot, saying it\'s connected', await card.locator('.cn-state').innerText().catch(() => ''))
    // Its Chief: none yet, then Front Desk, picked here.
    ok((await card.locator('[data-setting="connection-chief"] select').inputValue()) === '', 'no Chief yet')
    await card.locator('[data-setting="connection-chief"] select').selectOption(HI)
    ok(!!(await until(async () => (await conn(C)).chief?.id === HI, 5000)) && !!(await until(async () => (await card.locator('[data-setting="connection-chief"] select').inputValue()) === HI, 8000)), 'a Chief picked is kept (PATCH chief) and shown')
    await card.locator('[data-setting="connection-chief"] select').selectOption(FD)
    ok(!!(await until(async () => (await conn(C)).chief?.id === FD, 5000)), 'Front Desk, its Chief')
    ok(!!(await until(async () => (await card.locator('[data-setting="connection-bots"] .cn-bots [data-bot]').evaluateAll((l) => l.map((e) => e.dataset.bot))).join() === HI, 8000)), 'its specialists: Hiring (the Chief isn\'t listed again)')
    // Test this connection, before you're linked there: each check as the server ran it.
    await card.locator('[data-setting="connection-test"] button', { hasText: 'Test this connection' }).click()
    const r1 = await until(async () => (await conn(C)).check, 40000, 500)
    ok(!!r1 && !!(await until(async () => SUM[r1.state].test(await textOf(p, `.bh-card[data-connection="${C}"] .bh-test-sum`)), 10000)), 'Test this connection: summed up as the server found it', { state: r1?.state, said: await textOf(p, `.bh-card[data-connection="${C}"] .bh-test-sum`) })
    const needs = (r1?.checks || []).filter((x) => x.state === 'warn' || x.state === 'fail')
    let states = await card.locator('.bh-check').evaluateAll((l) => l.map((e) => e.dataset.check))
    ok(needs.length > 0 && states.join() === needs.map((x) => x.id).join(), 'what needs you first: its warnings and failures (you aren\'t linked there yet)', { shown: states, needs: needs.map((x) => `${x.id}:${x.state}`) })
    const owner = needs.find((x) => x.id === 'owner')
    ok(!!owner?.fix && (await card.locator('.bh-check[data-check="owner"]').innerText()).includes(owner.fix), 'a check that needs you says what to do', owner)
    await card.locator('.bh-all-checks').click()
    states = await card.locator('.bh-check').evaluateAll((l) => l.map((e) => `${e.dataset.check}:${e.dataset.state}`))
    ok(states.join() === r1.checks.map((x) => `${x.id}:${x.state}`).join(), 'and every check a click away, as the server said', states)
    // What the server says of the app, stood in for: another copy on it, Slack holding reads back.
    S.st.others = { n: 1, since: new Date().toISOString() }
    S.st.limited = { method: 'conversations.replies', wait: 30, at: new Date().toISOString() }
    ok(!!(await until(async () => /Another copy of Bridge AI is connected to this app too \(2 in all\)/.test(await textOf(p, `.bh-card[data-connection="${C}"] [data-setting="connection-copies"]`)), 12000)), 'another copy of Bridge AI on the same app: said, with what to do')
    ok(!!(await until(async () => /Slack is making it wait before it reads more \(30 s\)/.test(await textOf(p, `.bh-card[data-connection="${C}"] [data-setting="connection-limited"]`)), 12000)), 'Slack holding its reads back: said')
    S.st.others = null
    S.st.limited = null
    // You here: a code, sent to the app in your direct messages.
    ok(/Not linked yet/.test(await card.locator('[data-setting="connection-you"]').innerText()), 'You Here: not linked yet')
    await card.locator('[data-setting="connection-you"] button', { hasText: 'Link me' }).click()
    ok(await shown(p, '[data-setting="connection-link-code"]'), 'Link me: a code')
    const code = await textOf(p, '[data-setting="connection-link-code"]')
    ok(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code) && !!(await conn(C)).linking?.expiresAt, 'the server\'s, waiting to be sent', code)
    ok(/Send this code to @tester_bot in a direct message/.test(await card.locator('.bh-code').innerText()), 'saying where to send it')
    await slack.ask({ user: 'U0OWNER', dm: true, text: `link ${code}` })
    ok(!!(await until(async () => /Tester/.test(await card.locator('.bh-you-name').innerText().catch(() => '')), 15000)) && (await conn(C)).owner?.id === 'U0OWNER', 'once the app has it, the card says it\'s you, by itself')
    // Tested again, linked: what needed you there is done.
    await card.locator('[data-setting="connection-test"] button', { hasText: 'Test this connection' }).click()
    const r2 = await until(async () => { const c = (await conn(C)).check; return c && c.at !== r1.at ? c : null }, 40000, 500)
    ok(!!r2 && r2.checks.find((x) => x.id === 'owner')?.state === 'ok' && !!(await until(async () => SUM[r2.state].test(await textOf(p, `.bh-card[data-connection="${C}"] .bh-test-sum`)), 10000)), 'tested again, linked: you there passes, summed up as the server found it', r2 && { state: r2.state, checks: r2.checks.map((x) => `${x.id}:${x.state}`) })
    // Advanced: folded, with the app's tokens and the rest.
    const adv = card.locator('[data-setting="connection-advanced"]')
    ok(!(await adv.evaluate((d) => d.open)) && !(await card.locator('[data-setting="slack-connect"]').isVisible().catch(() => false)), 'Advanced is folded: no tokens on the card itself')
    await adv.locator(':scope > summary').click()
    ok(await shown(p, `.bh-card[data-connection="${C}"] [data-setting="connection-advanced"] .cn-rename input`) && await shown(p, `.bh-card[data-connection="${C}"] [data-setting="connection-perbot"]`), 'opened: its name, a slash command for each bot, its tokens and manifest')
    // (A slash command for each bot: its switch on its label's line, before it, as the other switches.)
    const perBot = card.locator('[data-setting="connection-perbot"]')
    const box = await perBot.locator('input').boundingBox()
    const words = await perBot.locator('label b').boundingBox()
    ok(!!box && !!words && Math.abs((box.y + box.height / 2) - (words.y + words.height / 2)) < 8 && box.x + box.width <= words.x, 'A slash command for each bot: its switch on the same line as its label', { box, words })
    ok(!(await card.locator('[data-setting="slack-owner"]').count()), 'and no You in Slack picker: You Here is the one way')
    await adv.locator(':scope > summary').click()
    // Try a message: the server's own dry run.
    await card.locator('[data-setting="routing-try"] summary').click()
    await card.locator('.ro-try textarea').fill('Hiring: who is interviewing today?')
    await card.locator('.ro-try select').nth(0).selectOption('dm')
    await card.locator('.ro-try button[type="submit"]').click()
    ok(await shown(p, `.bh-card .ro-out[data-bot="${HI}"]`, 10000), 'Try a message: a direct message naming Hiring goes to Hiring', await textOf(p, '.ro-out'))
    ok(/nothing was sent, answered or kept/.test(await textOf(p, '.ro-out')), 'a dry run, said so')
    await card.locator('.ro-try textarea').fill('what does the team plan cost?')
    await card.locator('.ro-try button[type="submit"]').click()
    ok(!!(await until(async () => /the Chief, takes it/.test(await textOf(p, `.bh-card .ro-out[data-rule="chief"][data-bot="${FD}"]`)), 10000)), 'and one naming no bot goes to its Chief, Front Desk', await textOf(p, '.ro-out'))
    const all = await p.locator('.bh [data-setting="bots-connections"]').innerText()
    ok(!/coming|Telegram/i.test(all) && !(await p.locator('.bh [data-platform="telegram"]').count()), 'nothing listed as coming: no Telegram', all.slice(-300))
    ok((await p.locator('.bh .bh-plat').evaluateAll((l) => l.map((e) => e.dataset.platform))).join() === 'slack', 'its connections under their platform: Slack')
    await shot(p, `${tag}bots-ui-connections-light`)
  })

  // ---------- Conversations in Slack, each a session ----------
  await part('conversations in Slack', async () => {
    // You, in #launch: Hiring answers and makes your change at once.
    first = await slack.ask({ user: 'U0OWNER', text: `${M} Hiring: who is interviewing today? Add Kim at 10 to the notes. [edit Hiring/notes.md Sam at 2, Lee at 4, Kim at 10.] [answer Sam at 2 and Lee at 4; Kim's in the notes.]` })
    sA = await sessionWith('who is interviewing today')
    ok(!!(await until(async () => (await inThread(first.ts)).find((x) => /Kim's in the notes/.test(x.text || '')), 30000)) && /Kim at 10/.test(fs.readFileSync(path.join(kit.home, 'Hiring', 'notes.md'), 'utf8')), 'your question in #launch: answered and your change made at once')
    // Dana, in its thread: her answer waits for you.
    await slack.ask({ user: 'U0DANA', thread: first.ts, text: 'And tomorrow? [answer Tomorrow: Kim at 10.]' })
    ok(!!(await until(async () => { const s = await stateOf(sA?.id); return s?.state === 'waiting' && s.waiting?.kind === 'draft' ? s : null }, 40000, 500)), 'Dana\'s, in its thread: the same session, waiting for you')
    // Sam, in a direct message: no bot named, so Front Desk, its Chief; answered at once.
    await slack.ask({ user: 'U0SAM', dm: true, text: 'What does the team plan cost? [answer $12 a seat.]' })
    sB = await sessionWith('team plan cost')
    ok(sB?.bot?.id === FD && !!(await until(async () => (await stateOf(sB.id))?.state === 'idle', 30000, 500)), 'Sam\'s direct message: Front Desk\'s session, answered', sB && { bot: sB.bot, state: (await stateOf(sB.id))?.state })
    // You, in your direct messages: Hiring, then that session ended.
    await slack.ask({ user: 'U0OWNER', dm: true, text: 'Hiring: an old question about roles [answer Design and sales.]' })
    sC = await sessionWith('an old question about roles')
    await until(async () => (await stateOf(sC?.id))?.state === 'idle', 30000, 500)
    ok((await kit.api(`/bots/sessions/${sC?.id}/end`, {})).ended === true && (await stateOf(sC.id))?.state === 'closed', 'and one of yours, ended')
    S.st.sid = sA?.id || null
  })

  await part('bots, and a new one', async () => {
    await p.locator('.bh-tabs [data-tab="bots"]').click()
    ok(await shown(p, '.bh-bots .bh-group[data-group="chiefs"] .bo-card'), 'Bots: the Chief first')
    const order = await p.locator('.bh-bots .bo-card').evaluateAll((l) => l.map((e) => e.dataset.bot))
    ok(order.join() === [FD, HI].join(), 'Front Desk (the Chief) then Hiring (a specialist)', order)
    ok(/chief/i.test(await textOf(p, '.bh-group[data-group="chiefs"] .bh-group-head')) && /Chief of @tester_bot/.test(await textOf(p, `.bo-card[data-bot="${FD}"]`)), 'the Chief, under Chief, saying of which connection')
    // New bot: three questions, sent as one.
    await p.locator('[data-setting="bots-new"]').click()
    const q = p.locator('[data-setting="bots-quick"]')
    ok(await shown(p, '[data-setting="bots-quick"]'), 'New bot: three questions')
    ok(/It answers through @tester_bot on Slack/.test(await q.innerText()), 'with one connection, it says where it answers instead of asking')
    await q.locator('textarea').fill('Answers questions about the launch plan')
    ok(await q.locator('button[type="submit"]').isDisabled(), 'not made without its folder')
    await q.locator('input.mono').fill('~/Launch')
    await q.locator('button[type="submit"]').click()
    const made = await until(async () => (await kit.api('/bots')).bots.find((x) => x.name === 'Launch Bot'), 10000)
    LB = made?.id
    const full = made && await kit.api(`/bots/${made.id}`)
    const shownAs = (x) => String(x || '').replace(/\\/g, '/')
    ok(!!full && full.description === 'Answers questions about the launch plan' && shownAs(full.settings.readsFrom?.[0]) === '~/Launch' && shownAs(full.settings.writesTo?.[0]) === '~/Launch' && full.settings.changes === 'edit' && full.settings.answerIn === 'thread', 'made by /bots/quick as asked: what it\'s for, reading and editing its folder, answering in a thread', full && { d: full.description, r: full.settings.readsFrom, w: full.settings.writesTo, c: full.settings.changes, a: full.settings.answerIn })
    ok((await conn(C)).bots.some((x) => x.id === LB), 'reached through the shared connection')
    ok(!!(await until(async () => (await textOf(p, '.bp .bp-name')) === 'Launch Bot', 8000)), 'its page opens')
  })

  await part('a bot\'s own app, in Connections', async () => {
    await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click()
    await p.locator('.bh-tabs [data-tab="connections"]').click()
    const card = p.locator(`.bh-card[data-connection="${C}"]`)
    await card.locator('[data-setting="connection-advanced"] > summary').click()
    const own = card.locator('[data-setting="connection-own"]')
    await own.locator('select').selectOption(LB)
    await own.locator('button', { hasText: 'Give it its own app' }).click()
    const O = await until(async () => (await kit.api('/connections')).connections.find((x) => x.own?.id === LB)?.id, 8000)
    const oc = p.locator(`.bh-card[data-connection="${O}"]`)
    ok(!!O && await shown(p, `.bh-card[data-connection="${O}"] [data-setting="slack-guide"]`), 'An App of Its Own: Launch Bot\'s own app, a card with its steps', O)
    ok(/Launch Bot's own app/.test(await textOf(p, `.bh-card[data-connection="${O}"] [data-setting="connection-kind"]`)) && /Shared · 2 bots/.test(await textOf(p, `.bh-card[data-connection="${C}"] [data-setting="connection-kind"]`)), 'saying whose it is; the shared one, how many bots it carries')
    ok((await p.locator('.bh .bh-plat[data-platform="slack"] .cn-card').evaluateAll((l) => l.map((e) => e.dataset.kind))).join() === 'shared,own', 'under Slack, the shared one first, then the bot\'s own')
    await kit.api(`/connections/${O}/tokens`, { appToken: 'xapp-two', botToken: 'xoxb-two' })
    ok(!!(await until(async () => /Connected to/.test(await textOf(p, `.bh-card[data-connection="${O}"] .cn-state`)), 15000)), 'set up: connected, said on its card')
    const move = oc.locator('[data-setting="connection-share"][data-move="true"]')
    ok(!!(await until(async () => /Your shared Slack connection, @tester_bot, reaches your other bots/.test(await move.innerText().catch(() => '')), 8000)), 'the shared one works: it offers to move Launch Bot onto it', await move.innerText().catch(() => ''))
    await oc.locator('[data-setting="connection-advanced"] > summary').click()
    await sleep(300)
    await shot(p, `${tag}bots-ui-own-app-light`)
    await move.locator('button', { hasText: 'Move Launch Bot to @tester_bot' }).click()
    ok(/Its own app's tokens are deleted here/.test(await textOf(p, `.bh-card[data-connection="${O}"] .bh-share-sure`)), 'asking first, saying what happens')
    await move.locator('.bh-share-sure .btn.primary').click()
    ok(!!(await until(async () => !(await p.locator(`.bh-card[data-connection="${O}"]`).count()) && /Moved Launch Bot to @tester_bot/.test(await textOf(p, '[data-setting="connections-done"]')), 10000)), 'moved: its card goes, and that\'s said')
    ok((await conn(C)).bots.some((x) => x.id === LB), 'Launch Bot reached through tester_bot again')
    await p.locator('[data-setting="connections-done"] .icon-btn').click()
  })

  await part('a bot\'s page', async () => {
    await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click()
    await p.locator('.bh-tabs [data-tab="bots"]').click()
    await p.locator(`.bh .bo-card[data-bot="${HI}"]`).click()
    await p.locator('.bp .sb-tabs').first().waitFor({ timeout: 10000 })
    const tabs = await p.locator('.bp .sb-tabs [role="tab"]').evaluateAll((l) => l.map((e) => e.dataset.tab))
    ok(tabs.join() === 'overview,settings,memory,activity', 'its tabs: Overview, Settings, Memory, Activity', tabs)
    await p.locator('.bp .sb-tabs [data-tab="overview"]').click()
    ok(await shown(p, '.bp [data-setting="bot-overview"]'), 'Overview')
    const ov = await textOf(p, '.bp [data-setting="bot-overview"]')
    ok(/Answers hiring questions/.test(ov) && /~[\\/]Hiring/.test(ov) && /@tester_bot/.test(ov), 'what it\'s for, its folder, where it\'s reached', ov.slice(0, 300))
    const its = (await sessions(`?bot=${HI}`)).length
    ok(its === 2 && !!(await until(async () => (await p.locator('.bp [data-setting="bot-sessions"] [data-session]').count()) === its, 8000)), 'its sessions (its own only)', its)
    ok(await shown(p, '.bp [data-setting="bot-test"] [data-setting="test-session"] textarea'), 'and Start a Test Session')
    ok(await shown(p, '.bp [data-setting="bots-access-line"]'), 'what it may do in a line, on top')
    // Settings: five fields, then Advanced.
    await p.locator('.bp .sb-tabs [data-tab="settings"]').click()
    for (const [sel, name] of [['bot-name', 'its name'], ['bot-purpose', 'what it\'s for'], ['slack-folders', 'its folder'], ['slack-askers', 'who can ask'], ['bot-edits', 'edits files']]) ok(await shown(p, `.bp [data-setting="bot-settings"] [data-setting="${sel}"]`), `Settings: ${name}`)
    ok((await p.locator('.bp [data-setting="bot-name"] input').inputValue()) === 'Hiring' && (await p.locator('.bp [data-setting="bot-purpose"] input').inputValue()) === 'Answers hiring questions', 'its name and what it\'s for, filled in')
    const adv = p.locator('.bp [data-setting="bot-advanced"]')
    if (await adv.evaluate((d) => d.open)) await adv.locator(':scope > summary').click()
    ok(!(await p.locator('.bp [data-setting="slack-limits"]').count()) && !(await p.locator('.bp [data-setting="bots-mcp"]').count()), 'the rest folded under Advanced')
    await adv.locator(':scope > summary').click()
    for (const [sel, name] of [['bot-where', 'where it answers'], ['slack-changes', 'changes'], ['bots-bash', 'commands'], ['slack-limits', 'limits and Longest Run'], ['bots-access-memory', 'memory'], ['slack-replies', 'how answers go'], ['bots-answer-in', 'Answer In'], ['slack-channels', 'channels'], ['slack-identity', 'icon, export and delete']]) ok(await shown(p, `.bp [data-setting="bot-advanced"] [data-setting="${sel}"]`), `Advanced: ${name}`)
    ok(!(await p.locator('.bp [data-setting="bot-advanced"] [data-setting="slack-changes"] [data-mode="pr"]').count()) && /Proposes a PR \(waits for your OK\)/.test(await textOf(p, '.bp [data-setting="slack-changes"]')), 'one pull-request mode: Proposes a PR (waits for your OK)')
    ok(/Longest Run/.test(await textOf(p, '.bp [data-setting="slack-limits"]')) && /With no answer it carries on/.test(await textOf(p, '.bp [data-setting="slack-limits"]')), 'Longest Run, and silence carries on')
    ok((await kit.api(`/bots/${HI}`)).settings.limits.longest === 240, '(240 minutes, the server\'s)')
    // (No commands in this version: the reason, as the server gives it, and no switch.)
    const why = (await kit.api(`/bots/${HI}`)).commands?.why
    ok(!!why && !(await p.locator('.bp [data-setting="bots-bash"] [role="radio"]').count()) && (await textOf(p, '.bp [data-setting="bots-bash"]')).includes(why), 'Commands: none in this version, saying why, with no switch', { why, text: await textOf(p, '.bp [data-setting="bots-bash"]') })
    // Where it answers: a line, and Open in Connections, its connection's card scrolled to.
    const line = await textOf(p, '.bp [data-setting="bot-where"]')
    ok(/Reached through @tester_bot\s*·\s*connected/.test(line) && !(await p.locator('.bp [data-setting="slack-connect"], .bp [data-setting="slack-guide"], .bp [data-setting="slack-owner"]').count()), 'where it answers, in one line: no connection set up here', line)
    await p.locator('.bp [data-setting="bot-where"] button', { hasText: 'Open in Connections' }).click()
    ok(!!(await until(async () => (await p.locator(`.bh[data-tab="connections"] .bh-card[data-connection="${C}"].cn-focus`).count()) > 0, 8000)), 'Open in Connections: its connection\'s card, picked out')
    await p.locator('.bh-tabs [data-tab="bots"]').click()
    await p.locator(`.bh .bo-card[data-bot="${HI}"]`).click()
    await p.locator('.bp .sb-tabs [data-tab="settings"]').click({ timeout: 8000 })
    if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
    await adv.locator(':scope > summary').click()
    // Edits files, on and off.
    const before = (await kit.api(`/bots/${HI}`)).settings.changes
    const sw = p.locator('.bp [data-setting="bot-edits"] input[type="checkbox"]')
    if (await sw.isEnabled()) {
      await sw.click()
      ok(!!(await until(async () => (await kit.api(`/bots/${HI}`)).settings.changes !== before, 8000)), 'Edits Files: switched, saved', before)
      await sw.click()
      await until(async () => (await kit.api(`/bots/${HI}`)).settings.changes === before, 8000)
    } else ok(/Claude Code/.test(await textOf(p, '.bp [data-setting="bot-edits"]')), 'Edits Files: off, saying it needs Claude Code')
    // When You Ask: Full Access, on and off: on, what it means, and that anyone using your Slack
    // account can run anything here through it.
    const full = p.locator('.bp [data-setting="bot-full-access"] input[type="checkbox"]')
    const was = (await kit.api(`/bots/${HI}`)).settings.fullAccess
    await full.click()
    ok(!!(await until(async () => (await kit.api(`/bots/${HI}`)).settings.fullAccess === !was, 8000)), 'When You Ask: Full Access: switched, saved', was)
    const fullText = await textOf(p, '.bp [data-setting="bot-full-access"]')
    ok(!was ? /Like your own Claude Code/.test(fullText) && /Anyone using your Slack account can run anything on this computer through this bot/.test(fullText) : /Off: your asks are limited/.test(fullText), 'it says what it means, and warns while it\'s on', fullText)
    // (Its page says it plainly once, the first time it's on: Got it hides it for good.)
    const note = p.locator('.bp [data-setting="bot-full-note"]')
    if (!was) {
      ok(!!(await until(async () => (await note.count()) === 1, 8000)) && /has When You Ask: Full Access on/.test(await note.innerText()), 'the bot\'s page says once that Full Access is on, plainly')
      await note.locator('button', { hasText: 'Got it' }).click()
      ok(!!(await until(async () => (await note.count()) === 0, 5000)), 'Got it: the note goes')
    }
    await full.click()
    await until(async () => (await kit.api(`/bots/${HI}`)).settings.fullAccess === was, 8000)
    await shot(p, `${tag}bots-ui-bot-settings-light`)
  })

  await part('sessions', async () => {
    await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click()
    await p.locator('.bh-tabs [data-tab="sessions"]').click()
    ok(await shown(p, '[data-setting="bots-sessions"] [data-session]'), 'Sessions: every session')
    const ids = () => p.locator('[data-setting="bots-sessions"] [data-session]').evaluateAll((l) => l.map((e) => e.dataset.session))
    ok(!!(await until(async () => (await ids()).join() === [sA.id, sB.id, sC.id].join(), 8000)), 'what waits for you first, then idle, then ended', { shown: await ids(), sA: sA.id, sB: sB.id, sC: sC.id })
    const row = await textOf(p, `[data-session="${sA.id}"]`)
    ok(/who is interviewing today/.test(row) && /Hiring/.test(row) && /#launch/.test(row) && /Dana/.test(row) && /Waiting for you/.test(row) && /2 turns/.test(row), 'a row: its words, bot, where, who, how it stands, its turns', row)
    await p.locator('[data-setting="bots-sessions"] select').nth(0).selectOption(FD)
    ok(!!(await until(async () => (await ids()).join() === sB.id, 6000)), 'by bot: Front Desk\'s, as the server gives them')
    await p.locator('[data-setting="bots-sessions"] select').nth(0).selectOption('')
    await p.locator('[data-setting="bots-sessions"] select').nth(1).selectOption('closed')
    ok(!!(await until(async () => (await ids()).join() === sC.id, 6000)), 'by how it stands: ended')
    await p.locator('[data-setting="bots-sessions"] select').nth(1).selectOption('')
    // Start a test session.
    await p.locator('[data-setting="sessions-test"]').click()
    const f = p.locator('[data-setting="bots-sessions"] [data-setting="test-session"]')
    await f.locator('select').selectOption(HI)
    await f.locator('textarea').fill('Who is on the panel for Kim? [answer Lee and Sam.]')
    await f.locator('button[type="submit"]').click()
    const t = await sessionWith('Who is on the panel for Kim', 20000)
    ok(t?.bot?.id === HI && t.try === true && t.place.kind === 'try', 'Start a test session: a session of Hiring\'s, as you, posted nowhere', t)
    ok(await shown(p, `.bh-sv[data-session="${t?.id}"]`, 10000) && /Who is on the panel for Kim\?/.test(await textOf(p, '.bh-sv .bp-name')), 'and it opens, as any session')
    ok(/a test session/.test(await textOf(p, '.bh-sv-meta')), 'saying it\'s a test session')
    ok(!!(await until(async () => /Lee and Sam\./.test(await textOf(p, `.bh-sv[data-session="${t?.id}"] .bh-turns`)), 30000)), 'its answer, in its Thread')
    await shot(p, `${tag}bots-ui-sessions-light`)
  })

  await part('a session: its Thread', async () => {
    await p.evaluate((sid) => window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { session: sid } })), sA.id)
    ok(await shown(p, `.bh-sv[data-session="${sA.id}"] .bh-turns`), 'a session opens at its Thread')
    ok((await textOf(p, '.bh-sv-head .bh-chip')) === 'Waiting for you' && /Hiring\s*#launch · Tester, Dana · 2 turns/.test(await textOf(p, '.bh-sv-meta')), 'how it stands, a chip; bot, where, who and its turns in a line', await textOf(p, '.bh-sv-meta'))
    ok(!/of 240 min/.test(await textOf(p, '.bh-sv-head')), 'and no time limit over it')
    const v = await view(sA.id)
    const [mine, dana] = v.turns
    ok(v.turns.length === 2 && !!(await until(async () => (await p.locator('.bh-turn').count()) === 4, 8000)), 'its two turns, and the two stood in for (a push, a run at its time limit)', v.turns.map((x) => x.text))
    ok(mine?.from?.owner === true && dana?.from?.owner !== true, 'the server says which turn was yours (you there, linked)', v.turns.map((x) => x.from))
    const t1 = await textOf(p, `.bh-turn[data-turn="${mine.q}"]`)
    ok(/^You/.test(t1) && /Kim's in the notes/.test(t1) && /Sent without asking/.test(t1) && /Made/.test(t1) && /notes\.md/.test(t1), 'your turn: what you asked, its answer, how it went, and your change, made', t1)
    // Dana's reply to check: edited, then sent.
    const draft = p.locator(`.bh-turn[data-turn="${dana.q}"] textarea`)
    ok((await draft.inputValue()) === 'Tomorrow: Kim at 10.', 'Dana\'s reply waiting, to edit right there')
    await draft.fill('Tomorrow: Kim at 10, and Lee at 3.')
    await p.locator(`.bh-turn[data-turn="${dana.q}"] button`, { hasText: /^\s*Send\s*$/ }).click()
    ok(!!(await until(async () => (await inThread(first.ts)).find((x) => x.text === 'Tomorrow: Kim at 10, and Lee at 3.'), 15000)), 'Send: posted in its thread as you edited it')
    ok(!!(await until(async () => /Tomorrow: Kim at 10, and Lee at 3\./.test(await textOf(p, `.bh-turn[data-turn="${dana.q}"] .bh-reply`)), 10000)), 'and the turn shows it sent')
    // Your change, undone.
    await p.locator(`.bh-turn[data-turn="${mine.q}"] button`, { hasText: 'Undo' }).click()
    ok(!!(await until(() => fs.readFileSync(path.join(kit.home, 'Hiring', 'notes.md'), 'utf8') === NOTES, 10000)), 'Undo: the notes back as they were')
    ok(!!(await until(async () => (await view(sA.id)).turns[0]?.write?.state === 'undone', 8000)) && !!(await until(async () => /Undone/.test(await textOf(p, `.bh-turn[data-turn="${mine.q}"]`)), 8000)), 'its turn says so')
    // A push to approve, stood in for.
    ok(/Update the interview notes/.test(await textOf(p, '.bh-turn[data-turn="qpush"]')) && /bot\/hiring\/notes/.test(await textOf(p, '.bh-turn[data-turn="qpush"]')), 'a push waiting: what and which branch')
    await p.locator('.bh-turn[data-turn="qpush"] button', { hasText: 'Approve the push' }).click()
    const push = await called(S.st, 'push')
    ok(push?.[1] === 'qpush' && push?.[2]?.act === 'approve' && push?.[2]?.hash === 'h4', 'Approve the push: with its hash', push)
    // A run at its time limit, stood in for: silence carries on, and Carry on says so.
    ok(/With no answer from you it carries on, up to its Longest Run of 240 minutes\./.test(await textOf(p, '.bh-turn[data-turn="qlimit"]')), 'a run at its time limit: with no answer it carries on')
    await p.locator('.bh-turn[data-turn="qlimit"] button', { hasText: 'Carry on' }).click()
    ok((await called(S.st, 'limit'))?.[2]?.act === 'continue', 'Carry on')
    // Your step in, while it's idle: a turn of its own, its answer kept here until you post it.
    const r = await kit.api(`/bots/sessions/${sA.id}/steer`, { text: 'Use the March notes too [answer Done: the March notes are in.]' })
    ok(r.ok && r.into === 'new' && !!r.q, 'stepping in while it\'s idle: a turn of its own', r)
    ok(!!(await until(async () => /You stepped in/.test(await textOf(p, `.bh-turn[data-turn="${r.q}"]`)) && /Done: the March notes are in\./.test(await textOf(p, `.bh-turn[data-turn="${r.q}"]`)), 30000)), 'your step in, and its answer to you, kept here')
    const after = await until(async () => { const x = await stateOf(sA.id); return x?.state === 'idle' ? x : null }, 15000, 500)
    ok(!!after, '(nothing waits on you for it)', after || await stateOf(sA.id))
    await p.locator(`.bh-turn[data-turn="${r.q}"] [data-setting="session-post"]`).click()
    ok(!!(await until(async () => (await inThread(first.ts)).find((x) => x.text === 'Done: the March notes are in.'), 15000)), 'Post to thread: sent where the session is')
    await shot(p, `${tag}bots-ui-thread-light`)
  })

  await part('a session: Live', async () => {
    await p.locator('.bh-sv [data-view="live"]').click()
    ok(await shown(p, '.bh-live .console', 15000), 'Live: the session\'s pane, as an agent\'s console (the fleet\'s botSessions)')
    const f = await kit.api('/fleet')
    const pane = (await stateOf(sA.id))?.paneId
    ok(!!pane && f.botSessions?.some((a) => a.paneId === pane && a.helper?.session === sA.id) && !f.agents.some((a) => a.paneId === pane) && !f.workspaces.some((w) => w.label === 'Bot Runs'), 'the fleet gives its pane among botSessions, never among its agents or Spaces', { pane, botSessions: f.botSessions?.map((a) => [a.paneId, a.helper?.session]) })
    ok(!/Bot Runs|Hiring: session/.test(await p.locator('.rail').innerText()), 'and the sidebar\'s Spaces don\'t have it')
    const views = await p.locator('.bh-live .console .seg [role="tab"]').allInnerTexts()
    ok(views.map((x) => x.trim()).join('|') === 'Chat|Terminal', 'its Chat and Terminal only', views)
    const box = p.locator('.bh-live .composer-wrap textarea')
    ok((await box.getAttribute('placeholder')) === 'Step in: type to Hiring…', 'its message box is Step in')
    await box.fill('Anything else for Kim? [answer Nothing else.]')
    await box.press('Enter')
    const st = await until(async () => (await view(sA.id)).turns.find((x) => x.steer && /Anything else for Kim/.test(x.text || '')), 20000)
    ok(!!st, 'what you type goes to the session as Step in (the server\'s steer), not typed into its pane as it is', st && { text: st.text, steer: st.steer })
    await p.locator('.bh-live .console .seg [role="tab"]', { hasText: 'Terminal' }).click()
    ok(await shown(p, '.bh-live .term-wrap:not([hidden])'), 'its Terminal')
    ok(!(await p.locator('[data-setting="session-stop"]').count()), 'Live has its pane\'s own Stop, not a second one over it')
    await shot(p, `${tag}bots-ui-live-light`)
    await p.locator('.bh-sv [data-view="thread"]').click()
    // A turn at work: Stop, the session kept.
    await until(async () => (await stateOf(sA.id))?.state !== 'working', 30000, 500)
    await slack.ask({ user: 'U0OWNER', thread: first.ts, text: 'Read every old thread, take your time. [work 60] [answer Too slow.]' })
    ok(!!(await until(async () => (await stateOf(sA.id))?.state === 'working', 20000, 500)) && await shown(p, '[data-setting="session-stop"]', 10000), 'a turn at work: Stop')
    await p.locator('[data-setting="session-stop"]').click()
    ok(!!(await until(async () => (await view(sA.id)).turns.find((x) => /Read every old thread/.test(x.text || ''))?.state === 'stopped', 15000)) && (await stateOf(sA.id))?.state !== 'closed', 'Stop: the turn it\'s on stops, the session stays')
    p.once('dialog', (d) => d.accept())
    await p.locator('[data-setting="session-more"]').click()
    await p.getByRole('menuitem', { name: 'End session' }).click()
    ok(!!(await until(async () => (await stateOf(sA.id))?.state === 'closed', 10000)), 'End session, under ⋯, once you say so')
    // Front Desk's, whose pane closed: Open it now.
    const sp = (await kit.api('/fleet?all=1')).agents.find((a) => a.helper?.session === sB.id)
    if (sp?.tabId) await kit.api(`/tabs/${sp.tabId}/close`, {})
    ok(!!(await until(async () => !(await stateOf(sB.id))?.live, 15000, 500)), 'its pane closed (the session kept)')
    await p.evaluate((sid) => { localStorage.setItem(`cc-session-view-${sid}`, 'live'); window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { session: sid } })) }, sB.id)
    ok(await shown(p, `.bh-sv[data-session="${sB.id}"] [data-setting="session-open"]`), 'a session whose pane closed: Open it now')
    ok(/remembers everything so far/.test(await textOf(p, `.bh-sv[data-session="${sB.id}"] .bh-live-off`)), 'saying it remembers the thread')
    await p.locator(`.bh-sv[data-session="${sB.id}"] [data-setting="session-open"]`).click()
    ok(!!(await until(async () => (await stateOf(sB.id))?.live, 20000, 500)) && await shown(p, `.bh-sv[data-session="${sB.id}"] .bh-live .console`, 15000), 'Open it now: its pane again, going on from its conversation')
  })

  await part('old places, and Settings › Bots', async () => {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-bot', { detail: { id: 'connections' } })))
    ok(await shown(p, '.bh[data-tab="connections"]'), 'what still opens Connections as a bot page gets Bots at Connections')
    const x = await page(b, kit.url, { mode: 'light', before: noServiceWorker, store: { 'cc-ws': { tabs: ['view:bot:overview', `view:bot:routing:${C}`], active: `view:bot:routing:${C}`, side: null, split: false, group: 'main' } } })
    ok(await shown(x.p, '.bh[data-tab="connections"]', 15000), 'a connection\'s Routing kept in a tab opens as Bots at Connections')
    const kept = await x.p.evaluate(() => JSON.parse(localStorage.getItem('cc-ws')).tabs)
    ok(kept.join() === 'view:bots:bots,view:bots:connections', 'and the overview\'s tab is Bots at its Bots tab', kept)
    ok(x.errors.length === 0, 'no page errors there', x.errors)
    await x.ctx.close()
    await openSettings(p, 'slack-bot', '.modal.settings [data-setting="bots-beta"]')
    ok(await p.locator('.modal.settings [data-setting="bots-beta"] input[type="checkbox"]').isChecked(), 'Settings › Bots: the switch, on')
    ok(!(await p.locator('.modal.settings [data-setting="slack-askers"], .modal.settings .sb-bots').count()), 'and nothing else of the bots there')
    await p.locator('.modal.settings [data-setting="bots-open"]').click()
    ok(!!(await until(async () => !(await p.locator('.modal.settings').count()) && await p.locator('.bh[data-setting="bots-home"]').isVisible(), 8000)), 'Open Bots: Settings closes, Bots opens')
  })
  ok(errors.length === 0, 'light: no page errors', errors)
  await ctx.close()

  // ---------- Dark ----------
  await part('dark', async () => {
    const x = await page(b, kit.url, { mode: 'dark', theme: 'midnight', before: noServiceWorker })
    await x.p.locator('[data-setting="rail-bots"] .rail-nav-btn').click({ timeout: 20000 })
    for (const tb of ['connections', 'bots', 'sessions']) {
      await x.p.locator(`.bh-tabs [data-tab="${tb}"]`).click()
      ok(await shown(x.p, `.bh[data-tab="${tb}"] .bh-body > *`), `dark: ${tb}`)
      await x.p.waitForTimeout(300)
      await shot(x.p, `${tag}bots-ui-${tb}-dark`)
    }
    const bg = await x.p.evaluate(() => getComputedStyle(document.querySelector('.bh')).backgroundColor)
    ok(/rgb\((\d+), (\d+), (\d+)\)/.test(bg) && bg.match(/\d+/g).slice(0, 3).every((n) => +n < 90), 'dark: Bots is dark', bg)
    await x.p.evaluate((sid) => { localStorage.setItem(`cc-session-view-${sid}`, 'thread'); window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { session: sid } })) }, sA.id)
    ok(await shown(x.p, `.bh-sv[data-session="${sA.id}"] .bh-turns`), 'dark: a session\'s Thread')
    await shot(x.p, `${tag}bots-ui-thread-dark`)
    await x.p.evaluate((sid) => window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { session: sid } })), sB.id)
    await x.p.locator(`.bh-sv[data-session="${sB.id}"] [data-view="live"]`).click()
    ok(await shown(x.p, `.bh-sv[data-session="${sB.id}"] .bh-live .console`, 15000), 'dark: its Live')
    await shot(x.p, `${tag}bots-ui-live-dark`)
    ok(x.errors.length === 0, 'dark: no page errors', x.errors)
    await x.ctx.close()
  })

  // ---------- A phone ----------
  for (const mode of ['light', 'dark']) {
    await part(`a phone, ${mode}`, async () => {
      const x = await page(b, kit.url, { mode, phone: true, before: noServiceWorker, store: { [`cc-session-view-${sB.id}`]: 'thread' } })
      await x.p.locator('.tabbar button', { hasText: 'More' }).click({ timeout: 20000 })
      await x.p.locator('.m-more-row[data-id="bots"]').click()
      ok(await shown(x.p, '[data-setting="phone-bots"]'), `${mode}, a phone: More › Bots`)
      for (const tb of ['connections', 'bots', 'sessions']) {
        await x.p.locator(`[data-setting="phone-bots"] .bh-tabs [data-tab="${tb}"]`).click()
        ok(await shown(x.p, `[data-setting="phone-bots"][data-tab="${tb}"] .bh-body > *`), `${mode}, a phone: ${tb}`)
        await x.p.waitForTimeout(400)
        const faults = await fits(x.p, '[data-setting="phone-bots"]')
        ok(!Object.keys(faults).length, `${mode}, a phone: ${tb} fits, every control a whole target`, faults)
        await shot(x.p, `${tag}bots-ui-phone-${tb}-${mode}`)
      }
      await x.p.locator(`[data-setting="phone-bots"] [data-session="${sB.id}"]`).click()
      ok(await shown(x.p, `.bh-sv.phone[data-session="${sB.id}"] .bh-turns`), `${mode}, a phone: a session, at its Thread`)
      await x.p.waitForTimeout(300)
      let faults = await fits(x.p, '.bh-sv.phone')
      ok(!Object.keys(faults).length, `${mode}, a phone: its Thread fits`, faults)
      await shot(x.p, `${tag}bots-ui-phone-thread-${mode}`)
      await x.p.locator('.bh-sv.phone [data-view="live"]').click()
      ok(await shown(x.p, '.bh-sv.phone .bh-live .console.v-mobile', 15000), `${mode}, a phone: its Live, the phone's agent console`)
      await until(async () => (await stateOf(sB.id))?.state !== 'working', 30000, 500)
      await x.p.locator('.bh-sv.phone .bh-live .composer-wrap textarea').fill(`Phone step in, ${mode} [answer Noted, ${mode}.]`)
      await x.p.locator('.bh-sv.phone .bh-live .composer-wrap button.send:not(.rec-stop)').click()
      ok(!!(await until(async () => (await view(sB.id)).turns.find((t) => t.steer && String(t.text || '').includes(`Phone step in, ${mode}`)), 20000)), `${mode}, a phone: Step in`)
      await shot(x.p, `${tag}bots-ui-phone-live-${mode}`)
      await x.p.locator('.m-view-back', { hasText: 'Bots' }).click()
      ok(await shown(x.p, '[data-setting="phone-bots"][data-tab="sessions"]'), `${mode}, a phone: ‹ Bots, back to Sessions`)
      await x.p.locator('[data-setting="phone-bots"] .bh-tabs [data-tab="bots"]').click()
      await x.p.locator(`[data-setting="phone-bots"] .bo-card[data-bot="${HI}"]`).click()
      ok(await shown(x.p, '.bp.phone .sb-tabs [data-tab="settings"]'), `${mode}, a phone: a bot's page`)
      await x.p.locator('.bp.phone .sb-tabs [data-tab="settings"]').click()
      await x.p.waitForTimeout(300)
      faults = await fits(x.p, '.bp.phone')
      ok(!Object.keys(faults).length, `${mode}, a phone: its Settings fit`, faults)
      ok(x.errors.length === 0, `${mode}, a phone: no page errors`, x.errors)
      await x.ctx.close()
    })
  }

  // ---------- How each screen looks: a computer and a phone, light and dark ----------
  // Each of Bots' screens as a person meets it, for an eye to look over (test/.out/shots, named
  // bots-ui-look-<desktop|phone>-<mode>-<screen>): Connections with its last test, Bots, New bot's
  // three questions, Sessions, a session's Thread and Live, a bot's Overview and its Settings with
  // Advanced closed. And on each, nothing past the screen's edge on a phone.
  for (const [mode, phone] of [['light', false], ['dark', false], ['light', true], ['dark', true]]) {
    await part(`looks, ${mode}${phone ? ', a phone' : ''}`, async () => {
      const x = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', phone, before: noServiceWorker, store: { [`cc-session-view-${sB.id}`]: 'thread' } })
      const p = x.p
      const at = phone ? 'phone' : 'desktop'
      const look = async (screen, scope) => {
        await p.waitForTimeout(450)
        await shot(p, `${tag}bots-ui-look-${at}-${mode}-${screen}`)
        if (phone) {
          const f = await fits(p, scope)
          ok(!Object.keys(f).length, `${mode}, a phone: ${screen} fits`, f)
        }
      }
      const home = async (tb) => {
        if (phone) {
          await p.locator('.tabbar button', { hasText: 'More' }).click({ timeout: 20000 })
          await p.locator('.tabbar button', { hasText: 'More' }).click()
          await p.locator('.m-more-row[data-id="bots"]').click()
        } else await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click({ timeout: 20000 })
        await p.locator(`.bh-tabs [data-tab="${tb}"]`).click()
        await p.locator(`.bh[data-tab="${tb}"] .bh-body > *`).first().waitFor({ timeout: 10000 })
      }
      await home('connections')
      await p.locator(`.bh-card[data-connection="${C}"] .bh-test-sum`).waitFor({ timeout: 10000 })
      await look('connections', '.bh')
      await home('bots')
      await p.locator('.bh .bo-card').first().waitFor({ timeout: 10000 })
      await look('bots', '.bh')
      await p.locator('[data-setting="bots-new"]').click()
      await p.locator('[data-setting="bots-quick"] textarea').waitFor({ timeout: 8000 })
      await look('new-bot', '.bh')
      await home('sessions')
      await p.locator('[data-setting="bots-sessions"] [data-session]').first().waitFor({ timeout: 10000 })
      await look('sessions', '.bh')
      await p.locator(`[data-setting="bots-sessions"] [data-session="${sB.id}"]`).click()
      await p.locator(`.bh-sv[data-session="${sB.id}"] .bh-turns`).waitFor({ timeout: 10000 })
      await look('thread', '.bh-sv')
      await p.locator('.bh-sv [data-view="live"]').click()
      await p.locator('.bh-live .console').waitFor({ timeout: 15000 })
      await look('live', '.bh-sv-head')
      await p.locator('.bh-sv [data-view="thread"]').click()
      await home('bots')
      await p.locator(`.bh .bo-card[data-bot="${HI}"]`).click()
      await p.locator('.bp .sb-tabs [data-tab="overview"]').click({ timeout: 10000 })
      await p.locator('.bp [data-setting="bot-overview"]').waitFor({ timeout: 8000 })
      await p.locator('.bp [data-setting="bot-test"]').evaluate((e) => e.scrollIntoView({ block: 'center' }))
      await look('bot-overview', '.bp .bp-main')
      await p.locator('.bp .sb-tabs [data-tab="settings"]').click()
      await p.locator('.bp [data-setting="bot-settings"]').waitFor({ timeout: 8000 })
      ok(!(await p.locator('.bp [data-setting="bot-advanced"]').evaluate((d) => d.open)), `${mode}${phone ? ', a phone' : ''}: a bot's Settings open with Advanced closed`)
      await look('bot-settings', '.bp .bp-main')
      ok(x.errors.length === 0, `${mode}${phone ? ', a phone' : ''}: no page errors as it was looked at`, x.errors)
      await x.ctx.close()
    })
  }

  // ---------- A Bridge AI from before sessions, checks and the quick New bot ----------
  // (As a phone or another computer may still reach one: each says so, and New bot is made the long
  // way, with the same result.)
  await part('without them: each says so', async () => {
    const before = async (ctx) => {
      await noServiceWorker(ctx)
      await ctx.route(/\/api\/bots\/sessions(\/[^?]*)?(\?.*)?$/, (r) => r.fulfill({ status: 404, json: { error: 'Not found' } }))
      await ctx.route(/\/api\/connections\/[^/]+\/check$/, (r) => r.fulfill({ status: 404, json: { error: 'Not found' } }))
      await ctx.route(/\/api\/bots\/quick$/, (r) => r.fulfill({ status: 404, json: { error: 'Not found' } }))
      await changeAnswer(ctx, /\/api\/connections$/, (j) => ({ ...j, connections: (j.connections || []).map(({ chief, check, ...c }) => c) }))
    }
    const x = await page(b, kit.url, { mode: 'light', before })
    await x.p.locator('[data-setting="rail-bots"] .rail-nav-btn').click({ timeout: 20000 })
    await x.p.locator('.bh-tabs [data-tab="sessions"]').click()
    ok(!!(await until(async () => /doesn't keep sessions yet/.test(await textOf(x.p, '[data-setting="bots-sessions"]')), 8000)), 'Sessions: this Bridge AI doesn\'t keep sessions yet, said once')
    await x.p.locator('.bh-tabs [data-tab="connections"]').click()
    await x.p.locator(`.bh-card[data-connection="${C}"] [data-setting="connection-test"] button`, { hasText: 'Test this connection' }).click()
    ok(!!(await until(async () => /can't test a connection yet/.test(await textOf(x.p, `.bh-card[data-connection="${C}"] [data-setting="connection-test"]`)), 8000)), 'Test this connection: it can\'t yet, said')
    ok(!(await x.p.locator(`.bh-card[data-connection="${C}"] [data-setting="connection-chief"]`).count()), 'no Chief to pick where the server has none')
    await x.p.locator('.bh-tabs [data-tab="bots"]').click()
    await x.p.locator('[data-setting="bots-new"]').click()
    const q = x.p.locator('[data-setting="bots-quick"]')
    await q.locator('textarea').fill('Answers questions about the press kit')
    await q.locator('input.mono').fill('~/Launch')
    await q.locator('button[type="submit"]').click()
    ok(!!(await until(async () => (await textOf(x.p, '.bp .bp-name')) === 'Press Kit', 10000)), 'New bot, made the long way: Press Kit, its page open', await textOf(x.p, '.bp .bp-name'))
    const made = (await kit.api('/bots')).bots.find((y) => y.name === 'Press Kit')
    const full = made && await kit.api(`/bots/${made.id}`)
    ok(full?.description === 'Answers questions about the press kit' && String(full?.settings.readsFrom?.[0] || '').replace(/\\/g, '/') === '~/Launch' && full?.settings.answerIn === 'thread', 'as asked: what it\'s for, its folder, answering in a thread', full && { d: full.description, r: full.settings.readsFrom, a: full.settings.answerIn, c: full.settings.changes })
    await x.p.locator('.bp .sb-tabs [data-tab="overview"]').click()
    ok(!!(await until(async () => (await x.p.locator('.bp [data-setting="bot-conversations"]').evaluate((e) => e.open).catch(() => false)) && x.p.locator('.bp [data-setting="bots-conversations"]').isVisible(), 8000)) && !(await x.p.locator('.bp [data-setting="bot-sessions"]').count()), 'its Overview: its conversations open, as before sessions, and no Sessions')
    ok(x.errors.length === 0, 'without them: no page errors', x.errors)
    await x.ctx.close()
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  await kit.stop()
  slack.stop()
}
process.exit(done().fail ? 1 : 0)
