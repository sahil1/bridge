// Bots, as the owner meets it: one Bots row in the sidebar opening three tabs, Connections, Bots and
// Sessions, with a stand-in Slack (one shared app reaching Front Desk, its Chief, and Hiring) and the
// stand-in Claude Code as a session's live pane. What the server doesn't have yet in this branch
// (sessions, Test this connection, You here's code, a connection's Chief, the quick New bot) is
// stood in for in the page, as the API contract has it (Playwright's routes); a second page without
// them shows each saying so, never failing.
//   Connections: a card saying it's connected, Test this connection with each check (passed, a
//     warning, failed with what to do), You here linked by a code sent to the app, the Chief picked
//     and the specialists it reaches, Advanced folded with the app's tokens, Try a message (a dry
//     run, the real server's) and Telegram, coming.
//   Bots: the Chief first, then the specialists; New bot's three questions (what it's for, its
//     folder, where it answers) sent as one, and without /bots/quick made the long way, the bot as
//     asked for: its page opens.
//   A bot's page: Overview, Settings, Memory, Activity; its Overview's sessions and Start a Test
//     Session; Settings with five fields (name, what it's for, its folder, who can ask, edits files)
//     and the rest under Advanced, commands in a sandbox among them.
//   Sessions: every session, waiting for you first, filtered by bot and by how it stands; Start a
//     test session, opening it. A session: its Thread (a reply sent as edited, a push approved, a
//     change undone, a run at its time limit carried on) and Live (the agent's own Chat and Terminal
//     of its pane; typing is Step in, Stop and End session), and Open it now for one whose pane closed.
//   Old places (the overview, a connection's Routing, Connections) go to their tab; Settings › Bots is
//   the switch and Open Bots. Light and dark, a computer and a phone (More › Bots, each tab and a
//   session fitting the screen).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSlack, checks, until, browser, page, shot, phoneFaults, changeAnswer, noServiceWorker, TEST } from '../lib/harness.mjs'
import { openSettings } from '../lib/bots.mjs'

const { ok, done } = checks('bots-ui')
const slack = await startSlack('bots-ui')
const kit = await startKit('bots-ui', {
  config: { name: 'Tester', trials: { 'slack-bot': true } },
  env: ({ home }) => {
    for (const d of ['Hiring', 'Launch', 'Desk']) fs.mkdirSync(path.join(home, d), { recursive: true })
    fs.writeFileSync(path.join(home, 'Hiring', 'notes.md'), '# Interviews\n\nSam at 2, Lee at 4.\n')
    return { BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000' }
  },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const shown = (p, sel, ms = 8000) => p.locator(sel).first().waitFor({ timeout: ms }).then(() => true, () => false)
const textOf = (p, sel) => p.locator(sel).first().innerText({ timeout: 3000 }).catch(() => '')
const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
// What's wrong on a phone's screen (phoneFaults), but for what's only scrolled under the tab bar, as
// anything on a long page is at some point: the page scrolls it out from under, so it isn't a fault.
const fits = async (p, ...scopes) => {
  const f = await phoneFaults(p, ...scopes)
  if (f.covered) f.covered = f.covered.filter((x) => !/ under Sections <nav\.tabbar>$/.test(x))
  if (!f.covered?.length) delete f.covered
  return f
}

let C, FD, HI, pane
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  C = (await kit.api('/connections', { platform: 'slack', name: 'tester_bot' })).id
  await kit.api(`/connections/${C}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
  FD = (await kit.api('/bots', { name: 'Front Desk', description: 'Takes every question first', readsFrom: ['~/Desk'] })).id
  HI = (await kit.api('/bots', { name: 'Hiring', description: 'Answers hiring questions', readsFrom: ['~/Hiring'] })).id
  await kit.api(`/bots/${HI}/settings`, { askers: [{ id: 'U0DANA', name: 'Dana' }] })
  ok(!!(await until(async () => (await kit.api(`/connections/${C}`)).state === 'connected', 20000)), 'the shared Slack connection is connected')
  // The session's pane: the stand-in Claude Code in ~/Hiring.
  pane = (await kit.api('/agents/launch', { kind: 'claude', cwd: path.join(kit.home, 'Hiring'), label: 'Hiring session', newSpace: 'Bot Runs' })).paneId
  await until(async () => (await kit.api('/fleet')).agents?.some((a) => a.paneId === pane), 15000)
} catch (e) { ok(false, `the kit couldn't be set up: ${e.stack}`) }

// ---------- What the page is given in place of the server's sessions and checks ----------
// The API contract (B1 sessions, B3 connections), answered here; each call the page makes, noted.
function standIns() {
  const st = { chief: FD, check: null, calls: [], quick: null, others: null, limited: null }
  const T = (min) => ago(min)
  const s1 = { id: 's1', bot: { id: HI, name: 'Hiring' }, connection: { id: C, name: 'tester_bot', platform: 'slack' }, place: { kind: 'channel', id: 'C0HIRE', name: 'hiring' }, thread: '1700000000.000100', people: [{ id: 'U0DANA', name: 'Dana' }, { id: 'U0OWNER', name: 'Tester' }], state: 'working', waiting: { kind: 'draft', q: 'q2' }, paneId: pane, live: true, agent: 'claude', startedAt: T(30), lastAt: T(1), turns: 4, title: 'Who is interviewing today?', ran: 3, longest: 240 }
  const s2 = { id: 's2', bot: { id: FD, name: 'Front Desk' }, connection: { id: C, name: 'tester_bot', platform: 'slack' }, place: { kind: 'dm', id: 'D0SAM' }, thread: null, people: [{ id: 'U0SAM', name: 'Sam' }], state: 'idle', waiting: null, paneId: null, live: false, agent: 'claude', startedAt: T(90), lastAt: T(20), turns: 2, title: 'What does the team plan cost?', ran: null, longest: 240 }
  const s3 = { id: 's3', bot: { id: HI, name: 'Hiring' }, connection: { id: C, name: 'tester_bot', platform: 'slack' }, place: { kind: 'channel', id: 'C0HIRE', name: 'hiring' }, thread: '1690000000.000100', people: [{ id: 'U0LEE', name: 'Lee' }], state: 'closed', waiting: null, paneId: null, live: false, agent: 'claude', startedAt: T(3000), lastAt: T(2900), turns: 1, title: 'An old question about roles', ran: null, longest: 240 }
  const sessions = [s3, s2, s1]
  const detail = {
    s1: {
      session: s1,
      turns: [
        { q: 'q1', at: T(30), from: { id: 'U0DANA', name: 'Dana' }, text: 'Who is interviewing today?', state: 'sent', draft: 'Sam at 2 and Lee at 4.', sent: true, auto: true },
        { q: 'q3', at: T(20), from: { id: 'U0OWNER', name: 'Tester', owner: true }, text: 'Add Kim to the notes', state: 'sent', draft: 'Added Kim to notes.md.', sent: true, auto: true, write: { id: 'w1', state: 'applied', files: [{ path: 'notes.md', op: 'change' }], applied: { direct: true }, by: { name: 'Tester' }, at: T(19) } },
        { q: 'q2', at: T(5), from: { id: 'U0DANA', name: 'Dana' }, text: 'And tomorrow?', state: 'draft', draft: 'Tomorrow: Kim at 10.' },
        { q: 'q4', at: T(2), from: { id: 'U0OWNER', name: 'Tester', owner: true }, text: 'Push the notes', state: 'sent', draft: 'Asked to push.', sent: true, auto: true, push: { id: 'p4', state: 'waiting', title: 'Update the interview notes', summary: 'Adds Kim and tomorrow\'s times', branch: 'bot/hiring/notes', head: 'h4', at: T(1) } },
        { q: 'q5', at: T(1), from: { id: 'U0DANA', name: 'Dana' }, text: 'Check every old thread too', state: 'answering', limit: { phase: 'asking', ran: 10, longest: 240, left: 230, choices: [], at: T(0), doing: 'reading old threads' } },
        { q: 'q8', at: T(0), from: { id: 'U0OWNER', name: 'Tester', owner: true }, text: 'Use the March notes too', steer: true, state: 'draft', draft: 'Done: the March notes are in.' },
      ],
      pane: { paneId: pane, live: true, status: 'working', asking: null, doing: 'Reading notes.md' },
    },
    s2: { session: s2, turns: [{ q: 'q6', at: T(90), from: { id: 'U0SAM', name: 'Sam' }, text: 'What does the team plan cost?', state: 'sent', draft: '$12 a seat.', sent: true, auto: true }], pane: { paneId: null, live: false, status: null } },
    s3: { session: s3, turns: [{ q: 'q7', at: T(3000), from: { id: 'U0LEE', name: 'Lee' }, text: 'An old question about roles', state: 'sent', draft: 'Design and sales.', sent: true, auto: true }], pane: null },
  }
  const install = async (ctx) => {
    await noServiceWorker(ctx)
    // The fleet as the page first asks for it, never pushed after: the session's pane among the
    // fleet's bot sessions (left out of agents and the sidebar).
    await ctx.route(/\/api\/events$/, (r) => r.abort())
    await changeAnswer(ctx, /\/api\/fleet$/, (j) => ({ ...j, agents: (j.agents || []).filter((a) => a.paneId !== pane), botSessions: (j.agents || []).filter((a) => a.paneId === pane) }))
    await changeAnswer(ctx, /\/api\/connections$/, (j) => ({ ...j, connections: (j.connections || []).map((c) => ({ ...c, chief: st.chief ? { id: st.chief, name: st.chief === FD ? 'Front Desk' : 'Hiring' } : null, check: st.check, numConnections: st.others ? 2 : 1, others: st.others, linking: null, limited: st.limited, catchingUp: null })), coming: [{ id: 'telegram', name: 'Telegram' }] }))
    await ctx.route(/\/api\/connections\/[^/?]+$/, (r) => {
      const body = r.request().method() === 'PATCH' ? r.request().postDataJSON() : null
      if (body && 'chief' in body) { st.chief = body.chief; st.calls.push(['chief', body.chief]); return r.fulfill({ json: { ok: true } }) }
      return r.fallback()
    })
    await ctx.route(/\/api\/connections\/[^/]+\/check$/, (r) => {
      const list = [
        { id: 'tokens', label: 'Tokens', state: 'ok', detail: 'Both tokens work.' },
        { id: 'socket', label: 'Socket Mode', state: 'ok', detail: 'Connected 3 s ago, one copy.' },
        { id: 'scopes', label: 'Scopes', state: 'warn', detail: 'chat:write.customize is missing.', fix: 'Update the app with its manifest.' },
        { id: 'events', label: 'Events arrive', state: 'fail', detail: 'A message posted didn\'t come back in 10 s.', fix: 'Turn on Event Subscriptions in the app.' },
        { id: 'files', label: 'Files', state: 'skip', detail: 'Skipped: no channel to try in.' },
      ]
      st.check = { at: new Date().toISOString(), took: 3200, state: 'fail', counts: { ok: 2, warn: 1, fail: 1, skip: 1 }, checks: list }
      st.calls.push(['check'])
      return r.fulfill({ json: st.check })
    })
    await ctx.route(/\/api\/connections\/[^/]+\/link$/, (r) => { st.calls.push(['link']); return r.fulfill({ json: { code: 'K7QX-M2PA', expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), send: 'Send K7QX-M2PA to @tester_bot in a direct message' } }) })
    await ctx.route(/\/api\/bots\/quick$/, (r) => { st.quick = r.request().postDataJSON(); return r.fulfill({ json: { id: HI } }) })
    await ctx.route(/\/api\/bots\/sessions(\?[^/]*)?$/, (r) => {
      const bot = new URL(r.request().url()).searchParams.get('bot')
      st.calls.push(['list', bot])
      return r.fulfill({ json: { sessions: sessions.filter((s) => !bot || s.bot.id === bot) } })
    })
    await ctx.route(/\/api\/bots\/sessions\/[^/]+$/, (r) => {
      const sid = decodeURIComponent(r.request().url().split('/').pop())
      return detail[sid] ? r.fulfill({ json: detail[sid] }) : r.fulfill({ status: 404, json: { error: 'Not found' } })
    })
    await ctx.route(/\/api\/bots\/sessions\/[^/]+\/(open|steer|stop|end)$/, (r) => {
      const [sid, act] = r.request().url().split('/').slice(-2)
      st.calls.push([act, sid, r.request().postDataJSON()])
      if (act === 'end' && detail[sid]) detail[sid].session.state = 'closed'
      return r.fulfill({ json: { ok: true } })
    })
    await ctx.route(/\/api\/bots\/[^/]+\/sessions$/, (r) => {
      const bot = decodeURIComponent(r.request().url().split('/').slice(-2)[0])
      const body = r.request().postDataJSON()
      st.calls.push(['test', bot, body])
      const s = { ...s2, id: 's9', bot: { id: bot, name: bot === HI ? 'Hiring' : 'Front Desk' }, place: { kind: 'try' }, try: true, people: [{ id: 'U0OWNER', name: 'Tester' }], state: 'working', paneId: null, live: false, title: body.text, turns: 1, startedAt: T(0), lastAt: T(0) }
      sessions.push(s)
      detail.s9 = { session: s, turns: [{ q: 'q9', at: T(0), from: { id: 'U0OWNER', name: 'Tester', owner: true }, text: body.text, state: 'answering' }], pane: { paneId: null, live: false, status: 'working' } }
      return r.fulfill({ json: { q: 'q9', conv: 'try-1', sid: 's9' } })
    })
    await ctx.route(/\/api\/bots\/questions\/[^/]+$/, (r) => {
      const q = r.request().url().split('/').pop()
      const body = r.request().postDataJSON()
      st.calls.push(['answer', q, body])
      const t = detail.s1.turns.find((x) => x.q === q)
      if (t) Object.assign(t, body.send ? { state: 'sent', sent: body.text, draft: body.text } : { state: 'discarded' })
      return r.fulfill({ json: { item: { id: q, state: body.send ? 'sent' : 'discarded' } } })
    })
    await ctx.route(/\/api\/bots\/questions\/[^/]+\/(push|limit)$/, (r) => {
      const [q, act] = r.request().url().split('/').slice(-2)
      const body = r.request().postDataJSON()
      st.calls.push([act, q, body])
      const t = detail.s1.turns.find((x) => x.q === q)
      if (t && act === 'push') t.push = { ...t.push, state: body.act === 'approve' ? 'pushed' : 'denied' }
      if (t && act === 'limit') t.limit = { carried: true }
      return r.fulfill({ json: { ok: true } })
    })
    await ctx.route(/\/api\/bots\/[^/]+\/writes\/[^/]+\/undo$/, (r) => {
      st.calls.push(['undo', r.request().url().split('/').slice(-2)[0]])
      detail.s1.turns[1].write = { ...detail.s1.turns[1].write, state: 'undone', undone: { by: 'Tester' } }
      return r.fulfill({ json: { ok: true } })
    })
    await ctx.route(/\/api\/bots\/[^/]+\/settings$/, (r) => {
      const body = r.request().postDataJSON()
      if (body && ('bash' in body || 'domains' in body)) st.calls.push(['bash', body])
      return r.fallback()
    })
  }
  return { st, install }
}
const called = (st, kind, ms = 6000) => until(() => st.calls.find((c) => c[0] === kind) || null, ms, 100)

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
    ok((await card.locator('[data-setting="connection-chief"] select').inputValue()) === FD, 'its Chief: Front Desk')
    ok((await card.locator('[data-setting="connection-bots"] .cn-bots [data-bot]').evaluateAll((l) => l.map((e) => e.dataset.bot))).join() === HI, 'its specialists: Hiring (the Chief isn\'t listed again)')
    await card.locator('[data-setting="connection-chief"] select').selectOption(HI)
    ok(!!(await until(() => S.st.chief === HI, 5000)) && !!(await until(async () => (await card.locator('[data-setting="connection-chief"] select').inputValue()) === HI, 8000)), 'a new Chief picked is sent (PATCH chief) and shown')
    await card.locator('[data-setting="connection-chief"] select').selectOption(FD)
    await until(() => S.st.chief === FD, 5000)
    // Test this connection.
    await card.locator('[data-setting="connection-test"] button', { hasText: 'Test this connection' }).click()
    ok(await shown(p, `.bh-card[data-connection="${C}"] .bh-checks`), 'Test this connection: each check, a line')
    let states = await card.locator('.bh-check').evaluateAll((l) => l.map((e) => e.dataset.state))
    ok(states.join() === 'warn,fail', 'what needs you first: the warning and the failure', states)
    ok(/3 more checks, passed or skipped/.test(await textOf(p, `.bh-card[data-connection="${C}"] .bh-all-checks`)), 'and the rest a click away')
    await card.locator('.bh-all-checks').click()
    states = await card.locator('.bh-check').evaluateAll((l) => l.map((e) => e.dataset.state))
    ok(states.join() === 'ok,ok,warn,fail,skip', 'every check: passed, a warning, failed and skipped, as the server said', states)
    ok(/1 check failed/.test(await card.locator('.bh-test-sum').innerText()), 'summed up: 1 check failed', await card.locator('.bh-test-sum').innerText().catch(() => ''))
    ok(/Turn on Event Subscriptions in the app\./.test(await card.locator('.bh-check.fail').innerText()) && !/Both tokens work\.\s*Update/.test(await card.innerText()), 'a failed check says what to do; a passed one doesn\'t')
    // What the server says of the app: another copy on it, Slack holding reads back.
    S.st.others = { n: 1, since: new Date().toISOString() }
    S.st.limited = { method: 'conversations.replies', wait: 30, at: new Date().toISOString() }
    ok(!!(await until(async () => /Another copy of Bridge AI is connected to this app too \(2 in all\)/.test(await textOf(p, `.bh-card[data-connection="${C}"] [data-setting="connection-copies"]`)), 10000)), 'another copy of Bridge AI on the same app: said, with what to do')
    ok(/Slack is making it wait before it reads more \(30 s\)/.test(await textOf(p, `.bh-card[data-connection="${C}"] [data-setting="connection-limited"]`)), 'Slack holding its reads back: said')
    S.st.others = null
    S.st.limited = null
    // You here: a code sent to the app.
    ok(/Not linked yet/.test(await card.locator('[data-setting="connection-you"]').innerText()), 'You Here: not linked yet')
    await card.locator('[data-setting="connection-you"] button', { hasText: 'Link me' }).click()
    ok(await shown(p, '[data-setting="connection-link-code"]') && (await textOf(p, '[data-setting="connection-link-code"]')) === 'K7QX-M2PA', 'Link me: the code to send @tester_bot in a direct message')
    ok(/Send this code to @tester_bot in a direct message/.test(await card.locator('.bh-code').innerText()), 'saying where to send it')
    await kit.api(`/connections/${C}`, { owner: { id: 'U0OWNER', name: 'Tester' } }, 'PATCH')
    ok(!!(await until(async () => /Tester/.test(await card.locator('.bh-you-name').innerText().catch(() => '')), 10000)), 'once the app has it, the card says it\'s you, by itself')
    // Advanced: folded, with the app's tokens and the rest.
    const adv = card.locator('[data-setting="connection-advanced"]')
    ok(!(await adv.evaluate((d) => d.open)) && !(await card.locator('[data-setting="slack-connect"]').isVisible().catch(() => false)), 'Advanced is folded: no tokens on the card itself')
    await adv.locator(':scope > summary').click()
    ok(await shown(p, `.bh-card[data-connection="${C}"] [data-setting="connection-advanced"] .cn-rename input`) && await shown(p, `.bh-card[data-connection="${C}"] [data-setting="connection-perbot"]`), 'opened: its name, a slash command for each bot, its tokens and manifest')
    await adv.locator(':scope > summary').click()
    // Try a message: the server's own dry run.
    await card.locator('[data-setting="routing-try"] summary').click()
    await card.locator('.ro-try textarea').fill('Hiring: who is interviewing today?')
    await card.locator('.ro-try select').nth(0).selectOption('dm')
    await card.locator('.ro-try button[type="submit"]').click()
    ok(await shown(p, `.bh-card .ro-out[data-bot="${HI}"]`, 10000), 'Try a message: a direct message naming Hiring goes to Hiring', await textOf(p, '.ro-out'))
    ok(/nothing was sent, answered or kept/.test(await textOf(p, '.ro-out')), 'a dry run, said so')
    ok(await shown(p, '[data-setting="connections-new"] [data-platform="telegram"]') && /Telegram: coming/.test(await textOf(p, '[data-setting="connections-new"]')), 'Telegram: coming')
    await shot(p, `${tag}bots-ui-connections-light`)
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
    await q.locator('input.mono').fill('~/Launch')
    await q.locator('button[type="submit"]').click()
    ok(!!(await until(() => S.st.quick, 6000)), 'sent as one: /bots/quick')
    ok(S.st.quick?.purpose === 'Answers questions about the launch plan' && S.st.quick?.folder === '~/Launch' && S.st.quick?.connection === C, 'with what it\'s for, its folder and its connection', S.st.quick)
    ok(!!(await until(async () => (await textOf(p, '.bp .bp-name')) === 'Hiring', 8000)), 'the bot it made opens (here the stand-in answered Hiring)')
  })

  await part('a bot\'s page', async () => {
    const tabs = await p.locator('.bp .sb-tabs [role="tab"]').evaluateAll((l) => l.map((e) => e.dataset.tab))
    ok(tabs.join() === 'overview,settings,memory,activity', 'its tabs: Overview, Settings, Memory, Activity', tabs)
    await p.locator('.bp .sb-tabs [data-tab="overview"]').click()
    ok(await shown(p, '.bp [data-setting="bot-overview"]'), 'Overview')
    const ov = await textOf(p, '.bp [data-setting="bot-overview"]')
    ok(/Answers hiring questions/.test(ov) && /~\/Hiring/.test(ov) && /@tester_bot/.test(ov), 'what it\'s for, its folder, where it\'s reached', ov.slice(0, 300))
    ok(!!(await until(async () => (await p.locator('.bp [data-setting="bot-sessions"] [data-session]').count()) === 2, 8000)), 'its sessions (its own only)')
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
    for (const [sel, name] of [['bots-where', 'where it answers'], ['slack-changes', 'changes'], ['bots-bash', 'commands'], ['slack-limits', 'limits and Longest Run'], ['bots-access-memory', 'memory'], ['slack-replies', 'how answers go'], ['bots-answer-in', 'Answer In'], ['slack-channels', 'channels'], ['slack-identity', 'icon, export and delete']]) ok(await shown(p, `.bp [data-setting="bot-advanced"] [data-setting="${sel}"]`), `Advanced: ${name}`)
    ok(!(await p.locator('.bp [data-setting="bot-advanced"] [data-setting="slack-changes"] [data-mode="pr"]').count()) && /Proposes a PR \(waits for your OK\)/.test(await textOf(p, '.bp [data-setting="slack-changes"]')), 'one pull-request mode: Proposes a PR (waits for your OK)')
    ok(/Longest Run/.test(await textOf(p, '.bp [data-setting="slack-limits"]')) && /With no answer it carries on/.test(await textOf(p, '.bp [data-setting="slack-limits"]')), 'Longest Run, and silence carries on')
    await p.locator('.bp [data-setting="bots-bash"] [role="radio"]', { hasText: 'In a Sandbox' }).click()
    const bash = await called(S.st, 'bash')
    ok(bash?.[1]?.bash === 'sandboxed', 'Commands: In a Sandbox sends bash: sandboxed', bash)
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
    await shot(p, `${tag}bots-ui-bot-settings-light`)
  })

  await part('sessions', async () => {
    await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click()
    await p.locator('.bh-tabs [data-tab="sessions"]').click()
    ok(await shown(p, '[data-setting="bots-sessions"] [data-session]'), 'Sessions: every session')
    const ids = () => p.locator('[data-setting="bots-sessions"] [data-session]').evaluateAll((l) => l.map((e) => e.dataset.session))
    ok((await ids()).join() === 's1,s2,s3', 'what waits for you first, then idle, then closed', await ids())
    const row = await textOf(p, '[data-session="s1"]')
    ok(/Who is interviewing today\?/.test(row) && /Hiring/.test(row) && /#hiring/.test(row) && /Dana/.test(row) && /Waiting for you: a reply to check/.test(row) && /4 turns/.test(row), 'a row: its words, bot, where, who, how it stands, its turns', row)
    await p.locator('[data-setting="bots-sessions"] select').nth(0).selectOption(FD)
    ok(!!(await until(async () => (await ids()).join() === 's2', 6000)) && S.st.calls.some((c) => c[0] === 'list' && c[1] === FD), 'by bot: asked of the server for Front Desk')
    await p.locator('[data-setting="bots-sessions"] select').nth(0).selectOption('')
    await p.locator('[data-setting="bots-sessions"] select').nth(1).selectOption('closed')
    ok(!!(await until(async () => (await ids()).join() === 's3', 6000)), 'by how it stands: closed')
    await p.locator('[data-setting="bots-sessions"] select').nth(1).selectOption('')
    // Start a test session.
    await p.locator('[data-setting="sessions-test"]').click()
    const f = p.locator('[data-setting="bots-sessions"] [data-setting="test-session"]')
    await f.locator('select').selectOption(HI)
    await f.locator('textarea').fill('Who is on the panel for Kim?')
    await f.locator('button[type="submit"]').click()
    const t = await called(S.st, 'test')
    ok(t?.[1] === HI && t?.[2]?.text === 'Who is on the panel for Kim?', 'Start a test session: asked of Hiring, as you', t)
    ok(await shown(p, '.bh-sv[data-session="s9"]') && /Who is on the panel for Kim\?/.test(await textOf(p, '.bh-sv .bp-name')), 'and it opens, as any session')
    ok(/a test session/.test(await textOf(p, '.bh-sv-meta')), 'saying it\'s a test session')
    await shot(p, `${tag}bots-ui-sessions-light`)
  })

  await part('a session: its Thread', async () => {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { session: 's1' } })))
    ok(await shown(p, '.bh-sv[data-session="s1"] .bh-turns'), 'a session opens at its Thread')
    ok(/Waiting for you: a reply to check/.test(await textOf(p, '.bh-sv-meta')) && /3 of 240 min this turn/.test(await textOf(p, '.bh-sv-meta')), 'saying what waits for you, and how long it has run of its Longest Run', await textOf(p, '.bh-sv-meta'))
    ok((await p.locator('.bh-turn').count()) === 6, 'its six turns')
    ok(/Sam at 2 and Lee at 4\./.test(await textOf(p, '.bh-turn[data-turn="q1"]')) && /Sent without asking/.test(await textOf(p, '.bh-turn[data-turn="q1"]')), 'a turn: what was asked, its answer and how it went')
    // A reply to check: edited, then sent.
    const draft = p.locator('.bh-turn[data-turn="q2"] textarea')
    ok((await draft.inputValue()) === 'Tomorrow: Kim at 10.', 'a reply waiting, to edit right there')
    await draft.fill('Tomorrow: Kim at 10, and Lee at 3.')
    await p.locator('.bh-turn[data-turn="q2"] button', { hasText: /^\s*Send\s*$/ }).click()
    const sent = await called(S.st, 'answer')
    ok(sent?.[1] === 'q2' && sent?.[2]?.send === true && sent?.[2]?.text === 'Tomorrow: Kim at 10, and Lee at 3.', 'Send: sent as you edited it', sent)
    ok(!!(await until(async () => /Tomorrow: Kim at 10, and Lee at 3\./.test(await textOf(p, '.bh-turn[data-turn="q2"] .bh-reply')), 8000)), 'and the turn shows it sent')
    // A push to approve.
    ok(/Update the interview notes/.test(await textOf(p, '.bh-turn[data-turn="q4"]')) && /bot\/hiring\/notes/.test(await textOf(p, '.bh-turn[data-turn="q4"]')), 'a push waiting: what and which branch')
    await p.locator('.bh-turn[data-turn="q4"] button', { hasText: 'Approve the push' }).click()
    const push = await called(S.st, 'push')
    ok(push?.[1] === 'q4' && push?.[2]?.act === 'approve' && push?.[2]?.hash === 'h4', 'Approve the push: with its hash', push)
    // A change made, undone.
    await p.locator('.bh-turn[data-turn="q3"] button', { hasText: 'Undo' }).click()
    ok((await called(S.st, 'undo'))?.[1] === 'w1', 'Undo on a change it made')
    // A run at its time limit: silence carries on, and Carry on says so.
    ok(/With no answer from you it carries on, up to its Longest Run of 240 minutes\./.test(await textOf(p, '.bh-turn[data-turn="q5"]')), 'a run at its time limit: with no answer it carries on')
    await p.locator('.bh-turn[data-turn="q5"] button', { hasText: 'Carry on' }).click()
    ok((await called(S.st, 'limit'))?.[2]?.act === 'continue', 'Carry on')
    ok(/Reading notes\.md/.test(await textOf(p, '.bh-thread .bh-doing')), 'what its pane is doing now, under the thread')
    // Your own step in's answer: kept here, until you post it to the thread.
    ok(/You stepped in/.test(await textOf(p, '.bh-turn[data-turn="q8"]')) && /Done: the March notes are in\./.test(await textOf(p, '.bh-turn[data-turn="q8"]')), 'your step in, and its answer to you, kept here')
    await p.locator('.bh-turn[data-turn="q8"] [data-setting="session-post"]').click()
    const posted = await until(() => S.st.calls.find((c) => c[0] === 'answer' && c[1] === 'q8') || null, 6000)
    ok(posted?.[2]?.send === true && posted?.[2]?.text === 'Done: the March notes are in.', 'Post to thread: sent where the session is', posted)
    await shot(p, `${tag}bots-ui-thread-light`)
  })

  await part('a session: Live', async () => {
    await p.locator('.bh-sv [data-view="live"]').click()
    ok(await shown(p, '.bh-live .console', 10000), 'Live: the session\'s pane, as an agent\'s console')
    const views = await p.locator('.bh-live .console .seg [role="tab"]').allInnerTexts()
    ok(views.map((x) => x.trim()).join('|') === 'Chat|Terminal', 'its Chat and Terminal only', views)
    const box = p.locator('.bh-live .composer-wrap textarea')
    ok((await box.getAttribute('placeholder')) === 'Step in: type to Hiring…', 'its message box is Step in')
    await box.fill('Use the March notes too')
    await box.press('Enter')
    const steer = await called(S.st, 'steer')
    ok(steer?.[1] === 's1' && steer?.[2]?.text === 'Use the March notes too', 'what you type goes to the session as Step in, not typed into its pane', steer)
    await p.locator('.bh-live .console .seg [role="tab"]', { hasText: 'Terminal' }).click()
    ok(await shown(p, '.bh-live .term-wrap:not([hidden])'), 'its Terminal')
    ok(!(await p.locator('[data-setting="session-stop"]').count()), 'Live has its pane\'s own Stop, not a second one over it')
    await shot(p, `${tag}bots-ui-live-light`)
    await p.locator('.bh-sv [data-view="thread"]').click()
    await p.locator('[data-setting="session-stop"]').click()
    ok((await called(S.st, 'stop'))?.[1] === 's1', 'Stop: the turn it\'s on')
    p.once('dialog', (d) => d.accept())
    await p.locator('[data-setting="session-more"]').click()
    await p.getByRole('menuitem', { name: 'End session' }).click()
    ok((await called(S.st, 'end'))?.[1] === 's1', 'End session, under ⋯, once you say so')
    // One whose pane closed: Open it now.
    await p.evaluate(() => { localStorage.setItem('cc-session-view-s2', 'live'); window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { session: 's2' } })) })
    ok(await shown(p, '.bh-sv[data-session="s2"] [data-setting="session-open"]'), 'a session whose pane closed: Open it now')
    ok(/remembers everything so far/.test(await textOf(p, '.bh-sv[data-session="s2"] .bh-live-off')), 'saying it remembers the thread')
    await p.locator('.bh-sv[data-session="s2"] [data-setting="session-open"]').click()
    ok((await called(S.st, 'open'))?.[1] === 's2', 'Open it now')
  })

  await part('old places, and Settings › Bots', async () => {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-bot', { detail: { id: 'connections' } })))
    ok(await shown(p, '.bh[data-tab="connections"]'), 'what still opens Connections as a bot page gets Bots at Connections')
    const x = await page(b, kit.url, { mode: 'light', before: S.install, store: { 'cc-ws': { tabs: ['view:bot:overview', `view:bot:routing:${C}`], active: `view:bot:routing:${C}`, side: null, split: false, group: 'main' } } })
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
    const D = standIns()
    const x = await page(b, kit.url, { mode: 'dark', theme: 'midnight', before: D.install })
    await x.p.locator('[data-setting="rail-bots"] .rail-nav-btn').click({ timeout: 20000 })
    for (const tb of ['connections', 'bots', 'sessions']) {
      await x.p.locator(`.bh-tabs [data-tab="${tb}"]`).click()
      ok(await shown(x.p, `.bh[data-tab="${tb}"] .bh-body > *`), `dark: ${tb}`)
      await x.p.waitForTimeout(300)
      await shot(x.p, `${tag}bots-ui-${tb}-dark`)
    }
    const bg = await x.p.evaluate(() => getComputedStyle(document.querySelector('.bh')).backgroundColor)
    ok(/rgb\((\d+), (\d+), (\d+)\)/.test(bg) && bg.match(/\d+/g).slice(0, 3).every((n) => +n < 90), 'dark: Bots is dark', bg)
    await x.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-bots', { detail: { session: 's1' } })))
    ok(await shown(x.p, '.bh-sv[data-session="s1"] .bh-turns'), 'dark: a session\'s Thread')
    await shot(x.p, `${tag}bots-ui-thread-dark`)
    await x.p.locator('.bh-sv [data-view="live"]').click()
    ok(await shown(x.p, '.bh-live .console', 10000), 'dark: its Live')
    await shot(x.p, `${tag}bots-ui-live-dark`)
    ok(x.errors.length === 0, 'dark: no page errors', x.errors)
    await x.ctx.close()
  })

  // ---------- A phone ----------
  for (const mode of ['light', 'dark']) {
    await part(`a phone, ${mode}`, async () => {
      const P = standIns()
      const x = await page(b, kit.url, { mode, phone: true, before: P.install })
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
      await x.p.locator('[data-setting="phone-bots"] [data-session="s1"]').click()
      ok(await shown(x.p, '.bh-sv.phone[data-session="s1"] .bh-turns'), `${mode}, a phone: a session, at its Thread`)
      await x.p.waitForTimeout(300)
      let faults = await fits(x.p, '.bh-sv.phone')
      ok(!Object.keys(faults).length, `${mode}, a phone: its Thread fits`, faults)
      await shot(x.p, `${tag}bots-ui-phone-thread-${mode}`)
      await x.p.locator('.bh-sv.phone [data-view="live"]').click()
      ok(await shown(x.p, '.bh-sv.phone .bh-live .console.v-mobile', 10000), `${mode}, a phone: its Live, the phone's agent console`)
      await x.p.locator('.bh-sv.phone .bh-live .composer-wrap textarea').fill('Phone step in')
      await x.p.locator('.bh-sv.phone .bh-live .composer-wrap button.send:not(.rec-stop)').click()
      ok((await called(P.st, 'steer'))?.[2]?.text === 'Phone step in', `${mode}, a phone: Step in`)
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
  // bots-ui-look-<desktop|phone>-<mode>-<screen>): Connections with a test's results, Bots, New bot's
  // three questions, Sessions, a session's Thread and Live, a bot's Overview and its Settings with
  // Advanced closed. And on each, nothing past the screen's edge on a phone.
  for (const [mode, phone] of [['light', false], ['dark', false], ['light', true], ['dark', true]]) {
    await part(`looks, ${mode}${phone ? ', a phone' : ''}`, async () => {
      const L = standIns()
      L.st.check = { at: new Date().toISOString(), state: 'warn', checks: [
        { id: 'tokens', label: 'Tokens', state: 'ok', detail: 'Both tokens work.' },
        { id: 'socket', label: 'Socket Mode', state: 'ok', detail: 'Connected, one copy.' },
        { id: 'events', label: 'Events arrive', state: 'ok', detail: 'A message posted came back in 1 s.' },
        { id: 'scopes', label: 'Scopes', state: 'warn', detail: 'chat:write.customize is missing.', fix: 'Update the app with its manifest.' },
      ] }
      const x = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', phone, before: L.install })
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
      await p.locator(`.bh-card[data-connection="${C}"] .bh-checks`).waitFor({ timeout: 10000 })
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
      await p.locator('[data-setting="bots-sessions"] [data-session="s1"]').click()
      await p.locator('.bh-sv[data-session="s1"] .bh-turns').waitFor({ timeout: 10000 })
      await look('thread', '.bh-sv')
      await p.locator('.bh-sv [data-view="live"]').click()
      await p.locator('.bh-live .console').waitFor({ timeout: 10000 })
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

  // ---------- Without sessions, checks or the quick New bot (a server before them) ----------
  await part('without them: each says so', async () => {
    const x = await page(b, kit.url, { mode: 'light', before: noServiceWorker })
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
    await q.locator('textarea').fill('Answers questions about the launch plan')
    await q.locator('input.mono').fill('~/Launch')
    await q.locator('button[type="submit"]').click()
    ok(!!(await until(async () => (await textOf(x.p, '.bp .bp-name')) === 'Launch Plan', 10000)), 'New bot, made the long way: Launch Plan, its page open', await textOf(x.p, '.bp .bp-name'))
    const made = (await kit.api('/bots')).bots.find((y) => y.name === 'Launch Plan')
    const full = made && await kit.api(`/bots/${made.id}`)
    ok(full?.description === 'Answers questions about the launch plan' && String(full?.settings.readsFrom?.[0] || '').replace(/\\/g, '/') === '~/Launch' && full?.settings.answerIn === 'thread', 'as asked: what it\'s for, its folder, answering in a thread', full && { d: full.description, r: full.settings.readsFrom, a: full.settings.answerIn, c: full.settings.changes })
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
