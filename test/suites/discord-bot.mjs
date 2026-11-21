// Bots in Discord, end to end: a stand-in Discord (stand-ins/discord.mjs: its REST API and Gateway)
// and a stand-in Claude Code answering (stand-ins/helper-claude.cjs), in the browser named by
// BRIDGE_TEST_BROWSER.
//   A bot with no connection says so on its page, with Open in Connections; there, Add a Connection ›
//   Discord › An App of Its Own gives it a card with the steps for someone doing it the first time
//   (the Developer Portal, the token, the intents, the invite link), the token pasted and checked,
//   the server picked when it's in two, right on the card, connected; a wrong token said at once.
//   Who may ask, by Discord's people (with their platform), and you in Discord (You Here). A mention: one read-only agent,
//   briefed as a bot in Discord with the question as someone else's words, its draft in Needs You
//   (👀, then ⏳), sent into a thread started from the question (✅); a reply in that thread with no
//   mention goes on from that answer. Answering in the channel (Answer In), a message there and no
//   thread. Refused, with no agent started: someone not named, someone
//   still to pass the server's screening, a guest, someone not in the server (directly) and a lookup
//   that failed; you in Discord always answered. The commands (!help says how to ask in Discord;
//   !what do you know about me only to them, in a direct message), "remember that" kept from
//   Settings and given with the next question, the limit a day, pause, and a change asked for in
//   Discord opening a draft pull request. A run at its time limit: you're asked in your direct
//   messages, in words, the asker told once in its thread; the asker's "continue 30" refused; your
//   "continue 10" goes on with no gap; no answer stops it, you're told how to pick it up, and your
//   "continue 30" later goes on from where it stopped; "stop". Slack's own stay Slack's: no draft in a Slack direct
//   message, no status, no stream, a long answer whole (in parts). Every event names Discord, and
//   the token is in no log, record, command line or agent's environment. Settings in light and dark,
//   on a computer and a phone.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, startDiscord, checks, until, sleep, browser, page, shot, phoneFaults, TEST, IS_WIN } from '../lib/harness.mjs'
import { lookers, ownFile, openBot, openBots } from '../lib/bots.mjs'

const { ok, done } = checks('discord-bot')
const dc = await startDiscord('discord-bot')
await dc.heartbeat({ ms: 800 })
const T1 = 'dtest.bot-one.0123456789abcdef'
const gitDir = IS_WIN ? path.dirname(String(spawnSync('where', ['git'], { encoding: 'utf8' }).stdout || '').split(/\r?\n/)[0] || 'C:\\Program Files\\Git\\cmd\\git.exe') : null
const kit = await startKit('discord-bot', {
  config: { name: 'Tester', trials: { 'slack-bot': true, routines: true } },
  env: ({ home, PATH }) => {
    for (const d of ['pricing', 'code']) fs.mkdirSync(path.join(home, d), { recursive: true })
    // (Each question its own conversation: the same person asking again soon after carries none on.)
    // (A "minute" of a run's time limit is 3 seconds, and the grace window 9.)
    return { BRIDGE_DISCORD_URL: dc.url, BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_HOLD_MS: '3000', BRIDGE_BOT_CARRY_MS: '0', BRIDGE_BOT_MINUTE_MS: '3000', BRIDGE_BOT_GRACE_MS: '9000', ...(gitDir ? { PATH: `${PATH}${path.delimiter}${gitDir}`, BRIDGE_PATH: `${PATH}${path.delimiter}${gitDir}` } : {}) }
  },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
kit.program('gh', fs.readFileSync(path.join(TEST, 'stand-ins', 'gh.cjs'), 'utf8'))
const { needs, draftOf, startOf, startsOf, briefOf, logOf, botOf, events } = lookers(kit, null)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const st = () => dc.state()
const postedLike = (re, ms = 20000) => until(async () => (await st()).posted.find((x) => re.test(x.content)), ms)
const reacted = async (id, emoji) => (await st()).reactions.some((r) => r.id === id && r.emoji === emoji)
const where = async () => (await botOf()).where?.discord || {}
const M = '<@1001>'
const PRICING = path.join(kit.home, 'pricing')
fs.writeFileSync(path.join(PRICING, 'pricing.md'), '# Pricing\n\nEnterprise is $40 a seat, billed yearly.\n')

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  await kit.api('/bots', { name: 'Atlas' })
  await kit.api('/bots/b1/settings', { readsFrom: ['~/pricing'], answerIn: 'thread' })

  // ---------- Set up in Connections ----------
  await part('connecting in Connections', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await openBot(p)
    const line = await p.locator('.bp [data-setting="bot-where"]').innerText()
    ok(/Not on Slack, Discord or Microsoft Teams yet/.test(line) && /Open in Connections/.test(line), 'its page: not on Slack, Discord or Microsoft Teams yet, with Open in Connections', line)
    await p.locator('.bp [data-setting="bot-where"] button', { hasText: 'Open in Connections' }).click()
    await p.locator('.bh [data-setting="connections-new"]').waitFor({ timeout: 10000 })
    const adds = await p.locator('.bh [data-setting="connections-new"] .cn-new-one').evaluateAll((l) => l.map((e) => e.dataset.platform))
    ok(adds.join() === 'slack,discord,teams', 'Connections: Slack, Discord and Microsoft Teams, each to add', adds)
    const add = p.locator('.bh [data-setting="connections-new"] .cn-new-one[data-platform="discord"]')
    await add.locator(':scope > summary').click()
    await add.locator('[data-setting="connection-own"] option', { hasText: 'Atlas' }).waitFor({ state: 'attached', timeout: 10000 })
    await add.locator('[data-setting="connection-own"] select').selectOption({ label: 'Atlas' })
    await add.locator('[data-setting="connection-own"] button', { hasText: 'Give it its own app' }).click()
    const card = p.locator('.bh .cn-card[data-platform="discord"][data-kind="own"]')
    await card.locator('[data-setting="discord-guide"]').waitFor({ timeout: 10000 })
    const steps = await card.locator('[data-setting="discord-guide"]').innerText()
    ok(/Developer Portal/.test(steps) && /Reset Token/.test(steps) && /Message Content Intent/.test(steps) && /Server Members Intent/.test(steps) && /Add to Server/.test(steps) && /Mention @Atlas with a question/.test(steps), 'An App of Its Own: a card with the steps for a first time, as a checklist: the Developer Portal, the token, the intents, adding it to your server, asking it', steps)
    ok(await card.locator('[data-setting="discord-connect"] a[href="https://discord.com/developers/applications"]').count() === 1, 'with the Developer Portal a click away')
    await shot(p, `${tag}discord-bot-steps`)
    const input = card.locator('[data-setting="discord-connect"] input[type="password"]')
    await input.fill('dtest.not-a-real-token-000000')
    await card.locator('[data-setting="discord-connect"] button[type="submit"]').click()
    ok(!!(await until(async () => /turned the bot token down/.test(await card.locator('[data-setting="discord-connect"]').innerText()), 10000)), 'a wrong token: said, in Discord\'s words, at once')
    await card.locator('[data-setting="discord-connect"] input[type="password"]').fill(T1)
    await card.locator('[data-setting="discord-connect"] button[type="submit"]').click()
    ok(!!(await until(async () => (await card.locator('[data-setting="connection-fix"] .sb-server select').count()) === 1, 15000)), 'a bot in two servers: pick the one it answers in, right on its card')
    await card.locator('.sb-server select').selectOption('3001')
    ok(!!(await until(async () => /Connected to Acme as @Bridge AI/.test(await card.locator('.cn-state').innerText()), 20000)), 'connected to its server, said', await card.locator('.cn-state').innerText().catch(() => ''))
    await card.locator('[data-setting="connection-advanced"] > summary').click()
    ok(await card.locator('[data-setting="discord-connect"] a', { hasText: 'Add to Server' }).getAttribute('href').then((h) => /client_id=1001/.test(h || '')), 'with its invite link')
    ok(/…cdef/.test(await card.locator('[data-setting="discord-connect"] .sb-have').innerText()) && !(await p.content()).includes(T1), 'its token shown only as its last four')
    await sleep(400)
    await shot(p, `${tag}discord-bot-connected`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  const w = await where()
  ok(w.state === 'connected' && w.guild?.name === 'Acme' && w.intents?.content === true, 'connected, in Acme, with Message Content', w)
  const file = ownFile(kit, 'b1', 'discord')
  ok(fs.existsSync(file) && (IS_WIN || (fs.statSync(file).mode & 0o777) === 0o600), 'its token with its own connection, yours only', IS_WIN ? null : (fs.statSync(file).mode & 0o777).toString(8))
  ok((await botOf()).state === 'no-tokens', 'Slack, not set up, as it was')

  // ---------- Who may ask ----------
  const people = (await kit.api('/bots/b1/people')).people
  ok(people.some((x) => x.id === 'discord:2001' && x.name === 'Dana' && x.platform === 'discord') && !people.some((x) => /discord:(2005|2006|2007)/.test(x.id)), 'its people from Discord, named as there (no bots, guests, or anyone still to pass screening)', people)
  await kit.api('/bots/b1/settings', { askers: [{ id: 'discord:2001', name: 'Dana' }, { id: 'discord:2003', name: 'Eve' }], owners: { discord: { id: 'discord:2004', name: 'Tester' } } })
  ok((await botOf()).settings.owners?.discord?.id === 'discord:2004', 'you in Discord, kept')

  // ---------- A question, answered ----------
  let q1 = null
  let thread = null
  await part('a question', async () => {
    q1 = await dc.say({ user: '2001', text: `${M} what's the enterprise price? [answer Enterprise is $40 a seat, billed yearly.]` })
    const s = await startOf('enterprise price')
    const brief = briefOf(s)
    ok(/You're Atlas, Tester's bot in Discord/.test(brief) && /Tester's Discord server/.test(brief) && /as Dana wrote it in Discord/.test(brief) && /as it should appear in Discord/.test(brief), 'one agent, briefed as a bot in Discord, the question as Dana wrote it there', brief.slice(0, 600))
    ok(/save it with your save_file tool/.test(brief) && /attach it with your attach_file tool/.test(brief) && /Discord takes a file of up to 10\.0 MB from a bot: a bigger one stays with Tester in Bridge AI/.test(brief) && !/FILE:|text files only/.test(brief), 'and offered files to send back, made or from its folder (PDFs too), which Discord takes as attachments, with its limit', brief.slice(-1400))
    ok(s?.args.includes('--add-dir') || s?.cwd?.endsWith('pricing'), 'reading its folder', s?.args)
    ok(!!(await until(() => reacted(q1.id, '👀'), 8000)), '👀 on the question as it starts')
    const d = await draftOf('enterprise price')
    ok(d?.draft === 'Enterprise is $40 a seat, billed yearly.' && d.bot?.name === 'Atlas' && d.place?.name === 'launch' && d.from?.id === 'discord:2001', 'its draft in Needs You, from Dana in #launch', d)
    ok(!!(await until(() => reacted(q1.id, '⏳'), 8000)), '⏳ while it waits for you')
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true })
    const p = await postedLike(/\$40 a seat/)
    thread = (await st()).threads.find((t) => t.id === q1.id)
    ok(p?.channel === q1.id && thread?.parent === '4001', 'sent, into a thread started from the question', { p, thread })
    ok(!!(await until(async () => (await reacted(q1.id, '✅')) && !(await reacted(q1.id, '👀')) && !(await reacted(q1.id, '⏳')), 8000)), '✅ once sent, 👀 and ⏳ off')
    // A reply in its thread, no mention: its session's next turn.
    await dc.say({ user: '2001', thread: q1.id, text: 'and for 500 seats? [answer Same price at 500 seats.]' })
    const f = await until(() => logOf('turns.log').find((x) => x.text.includes('500 seats')), 30000)
    ok(!!f && /----- question from Dana -----/.test(f.text) && !startsOf('500 seats').length, 'a reply in its thread, without a mention, goes on in that answer\'s session, as its next turn', f?.text?.slice(0, 300))
    const d2 = await draftOf('500 seats')
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: true })
    ok(!!(await postedLike(/Same price at 500/)) && (await st()).posted.filter((x) => x.channel === q1.id).length === 2, 'answered in the same thread')
  })

  // ---------- Answer In: The Channel ----------
  await part('answered in the channel', async () => {
    await kit.api('/bots/b1/settings', { answerIn: 'channel' })
    const q = await dc.say({ user: '2001', text: `${M} is there a startup discount? [answer Yes, half off for a year.]` })
    await draftOf('startup discount')
    // (Sent from Needs You, which says where it went: Discord, not Slack.)
    const x = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await x.p.locator('.needs-chip').click({ timeout: 15000 })
    const item = x.p.locator('.ny-item.t-slack', { hasText: 'startup discount' }).first()
    await item.waitFor({ timeout: 10000 })
    await item.getByRole('button', { name: 'Send' }).click()
    const note = await until(async () => { const s = await x.p.locator('.ny-note').innerText().catch(() => ''); return /Sent to/.test(s) ? s : null }, 10000)
    ok(/Sent to Dana in Discord/.test(note || ''), 'Send in Needs You: it says it went to Dana in Discord', note)
    ok(x.errors.length === 0, 'no page errors', x.errors)
    await x.ctx.close()
    const p = await postedLike(/half off for a year/)
    ok(p?.channel === '4001' && !(await st()).threads.some((t) => t.id === q.id), 'The Channel: answered in the channel itself, with no thread started', { p, threads: (await st()).threads })
    await kit.api('/bots/b1/settings', { answerIn: 'thread' })
  })

  // ---------- Who's refused ----------
  await part('refusals', async () => {
    const before = startsOf('').length
    await dc.say({ user: '2002', text: `${M} what's the discount? [answer nope]` })
    ok(!!(await postedLike(/I only answer questions from people Tester has added/)), 'someone not named: a polite no')
    await dc.say({ user: '2005', text: `${M} I just joined [answer nope]` })
    await dc.say({ user: '2006', text: `${M} guest here [answer nope]` })
    await dc.say({ user: '2009', dm: true, text: 'from outside, directly [answer nope]' })
    await until(() => events().some((e) => e.type === 'refused' && e.why === 'external'), 8000)
    await dc.fail({ route: 'GET /guilds/:id/members/:id', status: 500, n: 1 })
    await dc.say({ user: '2003', dm: true, text: 'lookup fails [answer nope]' })
    const refused = await until(() => { const r = events().filter((e) => e.type === 'refused' && e.platform === 'discord').map((e) => e.why); return ['not-allowed', 'guest', 'external', 'unknown'].every((x) => r.includes(x)) ? r : null }, 15000)
    ok(!!refused && refused.filter((x) => x === 'guest').length >= 2, 'not named, still to pass screening, a guest, not in the server, a lookup that failed: each refused, saying why', events().filter((e) => e.type === 'refused').map((e) => e.why))
    await sleep(800)
    ok(startsOf('').length === before, 'and no agent started for any of them', startsOf('').length - before)
    await dc.say({ user: '2004', text: `${M} the owner asks [answer Yes, boss.]` })
    ok(!!(await postedLike(/Yes, boss\./)), 'you in Discord, not named under Who Can Ask: answered all the same, and at once')
  })

  // ---------- Commands, memory, limits, pause ----------
  await part('commands and memory', async () => {
    await dc.say({ user: '2001', text: `${M} !help` })
    const h = await postedLike(/I'm Atlas, Tester's bot/)
    ok(/Ask me by mentioning me, or in a direct message\./.test(h?.content || '') && !/shortcut|\/atlas/.test(h?.content || ''), '!help says how to ask in Discord, without Slack\'s command or shortcut', h?.content)
    await dc.say({ user: '2001', text: `${M} remember that I prefer short answers` })
    ok(!!(await postedLike(/I'll remember that once Tester says so/)), '"remember that…": a learning waiting for you')
    const mem = await until(async () => (await kit.api('/bots/b1/memory')).items.find((x) => /short answers/.test(x.text)), 8000)
    ok(mem?.state === 'proposed' && mem.kind === 'person' && mem.of === 'discord:2001', 'about Dana, by her Discord id, waiting', mem)
    await kit.api(`/bots/b1/memory/${mem.id}`, { keep: true }, 'PATCH')
    const dmq = await dc.say({ user: '2001', dm: true, text: '!what do you know about me' })
    ok(!!(await postedLike(/Here's what I remember about you:\n• I prefer short answers/)), '!what do you know about me')
    await dc.say({ user: '2001', text: `${M} !what do you know about me` })
    const told = await until(async () => { const l = (await st()).posted.filter((x) => /Here's what I remember about you/.test(x.content)); return l.length >= 2 ? l : null }, 10000)
    ok(!!told && told.every((x) => x.channel === dmq.channel_id), 'asked in a channel: told only them, in a direct message', (await st()).posted.filter((x) => /remember about you/.test(x.content)))
    await dc.say({ user: '2001', text: `${M} what should I know? [recall]` })
    ok(/I prefer short answers/.test(briefOf(await startOf('what should I know'))), 'what it was kept, given with her next question')
    await kit.api('/bots/b1/settings', { limits: { day: 1 } })
    await dc.say({ user: '2003', text: `${M} first of the day [answer One.]` })
    await draftOf('first of the day')
    await dc.say({ user: '2003', text: `${M} second of the day [answer Two.]` })
    ok(!!(await postedLike(/You've asked me 1 questions today/)), 'past the limit a day: said, and nothing more answered')
    await kit.api('/bots/b1/settings', { limits: { day: 30 }, paused: true })
    await dc.say({ user: '2001', text: `${M} while paused [answer No.]` })
    ok(!!(await postedLike(/passed this on to Tester/)) && events().some((e) => e.type === 'refused' && e.why === 'paused' && e.platform === 'discord'), 'paused: passed to you, the asker told')
    await kit.api('/bots/b1/settings', { paused: false })
  })

  // ---------- At the time limit: asked in your direct messages, in words ----------
  await part('at the time limit', async () => {
    await kit.api('/bots/b1/settings', { limits: { day: 200, minutes: 1 } })
    const ask = (n) => until(async () => (await st()).posted.filter((x) => /^Atlas's answer to Dana in #launch has run \d+ minutes?: .+ Reply “continue 10”, “continue 30” or “stop”\.$/.test(x.content))[n], 20000)
    const q = await dc.say({ user: '2001', text: `${M} compare every price [work 14] [answer All the same.]` })
    const a = await ask(0)
    ok(!!a && a.channel !== '4001' && a.channel !== q.id, 'at its time limit: you\'re asked in your Discord direct messages, how long it has run and what it\'s doing, and how to answer', a?.content)
    const told = await postedLike(/^This is taking a while; I'm still on it\.$/)
    ok(told?.channel === q.id, 'Dana is told it\'s taking a while, in the question\'s thread', told)
    // Hers isn't an answer: only yours is.
    await dc.say({ user: '2001', dm: true, text: 'continue 30' })
    ok(!!(await postedLike(/^Only Tester can let me carry on, and I've asked them\.$/)) && !events().some((e) => e.type === 'limit.continued'), 'Dana\'s "continue 30": refused, and said, and nothing goes on for it')
    const mine = await dc.say({ user: '2004', dm: true, text: 'continue 10' })
    ok(mine.channel_id === a.channel, '(the question was in your direct messages)')
    const ack = await postedLike(/^Atlas carries on with its answer to Dana, for 10 minutes more\.$/)
    const c = await until(() => events().find((e) => e.type === 'limit.continued'), 8000)
    ok(ack?.channel === a.channel && c?.by === 'Tester' && c.via === 'discord' && c.minutes === 10 && c.platform === 'discord', 'your "continue 10": it goes on, you\'re told so, and it\'s in the record, by you from Discord', c)
    const d = await draftOf('compare every price', 30000)
    ok(d?.draft === 'All the same.' && events().filter((e) => e.type === 'run.started' && e.q === d.id).length === 1, 'with no gap: one run, to its answer')
    ok((await st()).posted.filter((x) => /taking a while/.test(x.content) && x.channel === q.id).length === 1, 'and Dana was told once')
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
    // No answer in time: that's a yes, and it carries on to its answer.
    const q2 = await dc.say({ user: '2001', text: `${M} list every discount [work 20] [answer Two discounts.]` })
    await ask(1)
    const carried = await until(() => events().find((e) => e.type === 'limit.carried'), 30000)
    ok(!!carried && !(await st()).posted.some((x) => x.channel === q2.id && /stopped/.test(x.content)), 'no answer in the grace window: it carries on, nothing stopped', carried)
    const d2 = await until(async () => (await needs()).find((x) => x.text.includes('list every discount') && x.draft === 'Two discounts.'), 30000)
    ok(startsOf('list every discount').length === 1, 'one run, to its answer')
    ok(d2?.place?.name === 'launch', 'and answered for the same place', d2?.place)
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: true })
    ok(!!(await until(async () => (await st()).posted.find((x) => x.channel === q2.id && x.content === 'Two discounts.'), 15000)), 'sent in its thread')
    // "stop".
    await dc.say({ user: '2001', text: `${M} audit every invoice [work 30] [answer Audited.]` })
    await ask(2)
    await dc.say({ user: '2004', dm: true, text: 'stop' })
    ok(!!(await postedLike(/^Stopped\. Dana is told it's passed on to you\.$/)), 'your "stop": stopped, and said')
    const d3 = await draftOf('audit every invoice', 15000)
    ok(d3?.needsOwner && /Stopped by Tester at its time limit/.test(d3.why || '') && events().some((e) => e.type === 'limit.stopped' && e.via === 'discord' && e.by === 'Tester'), 'passed to you, and in the record', d3?.why)
    await kit.api(`/bots/questions/${encodeURIComponent(d3.id)}`, { send: false })
    await kit.api('/bots/b1/settings', { limits: { day: 30, minutes: 10 } })
  })

  // ---------- A scheduled post, in a Discord channel ----------
  await part('a scheduled post', async () => {
    const chans = (await kit.api('/bots/b1/channels')).channels
    ok(chans.some((c) => c.id === 'discord:4001' && c.name === 'launch' && c.platform === 'discord'), 'its Discord channels, to pick where it posts', chans)
    const r = await kit.api('/routines', { name: 'Morning post', command: 'Write the morning post [answer Good morning, team.]', to: 'bot', bot: 'b1', channel: { id: 'discord:4001', name: 'launch' } })
    await kit.api(`/routines/${r.id}/run`, {})
    const d = await draftOf('morning post')
    ok(d?.place?.id === 'discord:4001', 'run: its draft waits for you', d?.place)
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true })
    const p = await postedLike(/Good morning, team/)
    ok(p?.channel === '4001' && !p.message_reference, 'sent: posted at the top of #launch', p)
    await kit.api(`/routines/${r.id}`, null, 'DELETE')
  })

  // ---------- A change, asked for in Discord ----------
  await part('a change', async () => {
    const APP = path.join(kit.home, 'code', 'app')
    const ORIGIN = path.join(kit.dir, 'origin.git')
    const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, HOME: kit.home, GIT_CONFIG_NOSYSTEM: '1' } }); return (r.stdout || '').trim() }
    fs.mkdirSync(APP, { recursive: true })
    git(kit.dir, 'init', '-q', '--bare', '-b', 'main', ORIGIN)
    git(APP, 'init', '-q', '-b', 'main')
    git(APP, 'config', 'user.name', 'Tester')
    git(APP, 'config', 'user.email', 'tester@example.com')
    fs.writeFileSync(path.join(APP, 'README.md'), 'Hello wrold\n')
    git(APP, 'add', '-A')
    git(APP, 'commit', '-q', '-m', 'First')
    git(APP, 'remote', 'add', 'origin', ORIGIN)
    git(APP, 'push', '-q', '-u', 'origin', 'main')
    git(APP, 'remote', 'set-head', 'origin', 'main')
    await kit.api('/bots/b1/settings', { readsFrom: ['~/code/app'] })
    // (The folder as it's kept: ~\code\app on Windows.)
    const kept = (await botOf()).settings.readsFrom[0]
    await kit.api('/bots/b1/settings', { repo: kept, changes: 'pr' })
    ok(!!git(APP, 'rev-parse', 'HEAD') && String((await botOf()).changes?.repo || '').replace(/\\/g, '/') === '~/code/app', 'its repository: its own, and the one it changes', (await botOf()).changes)
    const q = await dc.say({ user: '2001', text: `${M} fix the README typo [edit README.md Hello world] [answer Fixed the typo.]` })
    const d = await draftOf('README typo', 40000)
    ok(d?.change && !d.change.pr && !logOf('gh-calls.log').length, 'a change asked for in Discord waits for you (pr proposes, as suggest does)', d && { draft: d.draft, change: d.change })
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true })
    ok(events().some((e) => e.type === 'pr.opened' && e.platform === 'discord'), 'approved: a draft pull request, by your gh')
    const pr = logOf('gh-calls.log').find((c) => (c.args || []).includes('create'))
    ok(/in #launch \(Discord\)/.test(JSON.stringify(pr || {})), 'its description says where it was asked', pr)
    ok(!!(await postedLike(/Draft pull request/)) && (await st()).posted.find((x) => /Draft pull request/.test(x.content))?.channel === q.id, 'its link in the thread')
    await kit.api('/bots/b1/settings', { changes: 'none', repo: null })
    await kit.api('/bots/b1/settings', { readsFrom: ['~/pricing'] })
  })

  // ---------- Slack's own stay Slack's ----------
  await part('what\'s Slack\'s own', async () => {
    await kit.api('/bots/b1/settings', { auto: true })
    const ql = await dc.say({ user: '2001', text: `${M} tell me everything [long]` })
    const p = await until(async () => { const list = (await st()).posted.filter((x) => x.channel === ql.id); return list.length >= 2 && list.reduce((n, x) => n + x.content.length, 0) > 3500 ? list : null }, 40000)
    ok(!!p && p.length >= 2 && p.every((x) => x.content.length <= 2000) && !(await st()).posted.some((x) => /answer\.md/.test(x.content)), 'a long answer sent without asking: whole, in parts, not as a file', p?.map((x) => x.content.length) || (await st()).posted.slice(-6).map((x) => [x.channel, x.content.length, ql.id]))
    const sent = events().filter((e) => e.type === 'sent' && e.platform === 'discord' && e.how === 'auto').at(-1)
    ok(sent && !sent.streamed && !events().some((e) => e.type === 'status' && e.platform === 'discord') && !events().some((e) => e.type === 'approval.asked' && e.platform === 'discord' && e.via !== 'discord'), 'no stream, no working status, no Slack direct message for it (a run at its time limit asks in Discord\'s own)', sent)
    await kit.api('/bots/b1/settings', { auto: false })
  })

  // ---------- The record, and no secret anywhere ----------
  await part('the record', async () => {
    const evs = events()
    const rec = evs.filter((e) => e.type === 'received' && /^discord:/.test(e.channel))
    ok(rec.length >= 5 && rec.every((e) => e.platform === 'discord'), 'each question in the record names Discord', rec.map((e) => e.platform))
    ok(evs.some((e) => e.type === 'connection' && e.platform === 'discord' && e.what === 'connected'), 'and its connection')
    const convs = (await kit.api('/bots/b1/activity?platform=discord')).conversations
    ok(convs.length >= 3 && convs.every((c) => c.platform === 'discord'), 'Activity, by platform', convs.map((c) => c.platform))
    const md = await fetch(`${kit.url}/api/bots/b1/export?format=md&conv=${encodeURIComponent(convs.at(-1).id)}`).then((r) => r.text())
    ok(/\(Discord\)/.test(md), 'the export says it was Discord', md.slice(0, 300))
    ok((await kit.api('/bots/b1/activity')).integrity?.ok, 'the record whole')
    const all = [fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8'), ...fs.readdirSync(path.join(kit.data, 'bots', 'b1', 'trace')).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(kit.data, 'bots', 'b1', 'trace', f), 'utf8')), fs.readFileSync(path.join(kit.dir, 'server.log'), 'utf8'), JSON.stringify(await botOf())].join('\n')
    ok(!all.includes(T1), 'its token in no setting, record, log or view')
    const runs = startsOf('')
    ok(runs.length > 5 && runs.every((x) => !JSON.stringify(x.args).includes(T1) && !x.message.includes(T1) && !(x.secrets || []).length), 'nor on an agent\'s command line, nor in its environment', runs.map((x) => x.secrets))
  })

  // ---------- Settings, light and dark, computer and phone ----------
  await part('Settings', async () => {
    for (const [mode, phone] of [['dark', false], ['light', true], ['dark', true]]) {
      const { ctx, p, errors } = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', phone })
      await openBot(p)
      const line = await p.locator('.bp [data-setting="bot-where"]').innerText()
      ok(/Reached through @Atlas\s*·\s*Discord\s*·\s*its own app\s*·\s*connected/.test(line), `${mode}${phone ? ', a phone' : ''}: where it answers, in a line`, line)
      const asked = await p.locator('[data-setting="slack-askers"] .sb-askers').innerText()
      ok(/Dana\s*Discord/.test(asked), `${mode}${phone ? ', a phone' : ''}: who may ask, with where they're from`, asked)
      if (phone) {
        await sleep(300)
        const faults = await phoneFaults(p, '.bp.phone .bp-main')
        ok(!Object.keys(faults).length, `${mode}, a phone: nothing too small or wider than the screen`, faults)
      }
      await shot(p, `${tag}discord-bot-${mode}${phone ? '-phone' : ''}`)
      await openBots(p, 'connections')
      const you = p.locator('.bh .cn-card[data-platform="discord"] [data-setting="connection-you"]')
      ok(/Tester/.test(await you.innerText()), `${mode}${phone ? ', a phone' : ''}: you in Discord, under You Here on its card`)
      if (phone) {
        await sleep(300)
        const f = await phoneFaults(p, '[data-setting="phone-bots"]')
        if (f.covered) f.covered = f.covered.filter((x) => !/ under Sections <nav\.tabbar>$/.test(x))
        if (!f.covered?.length) delete f.covered
        ok(!Object.keys(f).length, `${mode}, a phone: its card fits`, f)
      }
      await shot(p, `${tag}discord-bot-card-${mode}${phone ? '-phone' : ''}`)
      ok(errors.length === 0, `${mode}${phone ? ', a phone' : ''}: no page errors`, errors)
      await ctx.close()
    }
  })

  // ---------- Disconnected ----------
  await kit.api('/bots/b1/discord', null, 'DELETE')
  ok(!fs.existsSync(file) && (await where()).state === 'no-tokens', 'disconnected: its token deleted from this computer')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  await kit.stop()
  dc.stop()
}
process.exit(done().fail ? 1 : 0)
