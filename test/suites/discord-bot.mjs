// Bots in Discord, end to end: a stand-in Discord (stand-ins/discord.mjs: its REST API and Gateway)
// and a stand-in Claude Code answering (stand-ins/helper-claude.cjs), in the browser named by
// BRIDGE_TEST_BROWSER.
//   Settings › Bots › Where It Answers › Discord: the steps for someone doing it the first time
//   (the Developer Portal, the token, the intents, the invite link), the token pasted and checked,
//   the server picked when it's in two, connected; a wrong token said at once. Who may ask, by
//   Discord's people (with their platform), and you in Discord. A mention: one read-only agent,
//   briefed as a bot in Discord with the question as someone else's words, its draft in Needs You
//   (👀, then ⏳), sent into a thread started from the question (✅); a reply in that thread with no
//   mention goes on from that answer. Refused, with no agent started: someone not named, someone
//   still to pass the server's screening, a guest, someone not in the server (directly) and a lookup
//   that failed; you in Discord always answered. The commands (!help says how to ask in Discord;
//   !what do you know about me only to them, in a direct message), "remember that" kept from
//   Settings and given with the next question, the limit a day, pause, and a change asked for in
//   Discord opening a draft pull request. Slack's own stay Slack's: no draft in a Slack direct
//   message, no status, no stream, a long answer whole (in parts). Every event names Discord, and
//   the token is in no log, record, command line or agent's environment. Settings in light and dark,
//   on a computer and a phone.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, startDiscord, checks, until, sleep, browser, page, shot, phoneFaults, TEST, IS_WIN } from '../lib/harness.mjs'
import { lookers, openSettings } from '../lib/bots.mjs'

const { ok, done } = checks('discord-bot')
const dc = await startDiscord('discord-bot')
await dc.heartbeat({ ms: 800 })
const T1 = 'dtest.bot-one.0123456789abcdef'
const gitDir = IS_WIN ? path.dirname(String(spawnSync('where', ['git'], { encoding: 'utf8' }).stdout || '').split(/\r?\n/)[0] || 'C:\\Program Files\\Git\\cmd\\git.exe') : null
const kit = await startKit('discord-bot', {
  config: { name: 'Tester', trials: { 'slack-bot': true, routines: true } },
  env: ({ home, PATH }) => {
    for (const d of ['pricing', 'code']) fs.mkdirSync(path.join(home, d), { recursive: true })
    return { BRIDGE_DISCORD_URL: dc.url, BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_HOLD_MS: '3000', ...(gitDir ? { PATH: `${PATH}${path.delimiter}${gitDir}`, BRIDGE_PATH: `${PATH}${path.delimiter}${gitDir}` } : {}) }
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
  await kit.api('/bots/b1/settings', { readsFrom: ['~/pricing'] })

  // ---------- Set up in Settings ----------
  await part('connecting in Settings', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await openSettings(p)
    const tabs = await p.locator('.sb-where-tabs [role="tab"]').allInnerTexts()
    ok(tabs.map((x) => x.trim()).join('|').replace(/(not set up|connected|not connected)/g, '').split('|').map((x) => x.trim()).join() === 'Slack,Discord,Microsoft Teams', 'Where It Answers: Slack, Discord and Microsoft Teams', tabs)
    await p.locator('.sb-where-tabs [data-platform="discord"]').click()
    const steps = await p.locator('[data-setting="discord-connect"] .sb-steps').innerText()
    ok(/Developer Portal/.test(steps) && /Reset Token/.test(steps) && /Message Content Intent/.test(steps) && /Server Members Intent/.test(steps) && /Add to Server/.test(steps) && /Ask it: mention @Atlas/.test(steps), 'the steps for a first time: the Developer Portal, the token, the intents, adding it to your server, asking it', steps)
    ok(await p.locator('[data-setting="discord-connect"] a[href="https://discord.com/developers/applications"]').count() === 1, 'with the Developer Portal a click away')
    await shot(p, `${tag}discord-bot-steps`)
    const input = p.locator('[data-setting="discord-connect"] input[type="password"]')
    await input.fill('dtest.not-a-real-token-000000')
    await p.locator('[data-setting="discord-connect"] button[type="submit"]').click()
    ok(!!(await until(async () => /turned the bot token down/.test(await p.locator('[data-setting="discord-connect"]').innerText()), 10000)), 'a wrong token: said, in Discord\'s words, at once')
    await input.fill(T1)
    await p.locator('[data-setting="discord-connect"] button[type="submit"]').click()
    ok(!!(await until(async () => (await p.locator('.sb-server select').count()) === 1, 15000)), 'a bot in two servers: pick the one it answers in')
    await p.locator('.sb-server select').selectOption('3001')
    ok(!!(await until(async () => /Connected to Acme as @Bridge AI/.test(await p.locator('[data-setting="discord-connect"]').innerText()), 20000)), 'connected to its server, said', await p.locator('[data-setting="discord-connect"]').innerText().catch(() => ''))
    ok(await p.locator('[data-setting="discord-connect"] a', { hasText: 'Add to Server' }).getAttribute('href').then((h) => /client_id=1001/.test(h || '')), 'with its invite link')
    ok(/…cdef/.test(await p.locator('[data-setting="discord-connect"] .sb-have').innerText()) && !(await p.content()).includes(T1), 'its token shown only as its last four')
    await sleep(400)
    await shot(p, `${tag}discord-bot-connected`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  const w = await where()
  ok(w.state === 'connected' && w.guild?.name === 'Acme' && w.intents?.content === true, 'connected, in Acme, with Message Content', w)
  const file = path.join(kit.data, 'bots', 'b1', 'discord.json')
  ok(fs.existsSync(file) && (IS_WIN || (fs.statSync(file).mode & 0o777) === 0o600), 'its token in its own folder, yours only', IS_WIN ? null : (fs.statSync(file).mode & 0o777).toString(8))
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
    ok(!/FILE:/.test(brief), 'and not offered files to send back (Slack\'s own)')
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
    // A reply in its thread, no mention: goes on from that answer.
    await dc.say({ user: '2001', thread: q1.id, text: 'and for 500 seats? [answer Same price at 500 seats.]' })
    const f = await startOf('500 seats')
    ok(/goes on from your earlier answers in this Discord thread/.test(briefOf(f)) && f.args.includes('--resume'), 'a reply in its thread, without a mention, goes on from that answer', f?.args)
    const d2 = await draftOf('500 seats')
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: true })
    ok(!!(await postedLike(/Same price at 500/)) && (await st()).posted.filter((x) => x.channel === q1.id).length === 2, 'answered in the same thread')
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
    ok(!!(await draftOf('the owner asks')), 'you in Discord, not named under Who Can Ask: answered all the same')
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
    await kit.api('/bots/b1/settings', { repo: '~/code/app', changes: 'pr' })
    ok(!!git(APP, 'rev-parse', 'HEAD') && (await botOf()).changes?.repo === '~/code/app', 'its repository: its own, and the one it changes', (await botOf()).changes)
    const q = await dc.say({ user: '2001', text: `${M} fix the README typo [edit README.md Hello world] [answer Fixed the typo.]` })
    const d = await draftOf('README typo', 40000)
    ok(/Draft pull request: \S+\/pull\/\d+/.test(d?.draft || '') && events().some((e) => e.type === 'pr.opened' && e.platform === 'discord'), 'a change asked for in Discord: a draft pull request, by your gh', d?.draft)
    const pr = logOf('gh-calls.log').find((c) => (c.args || []).includes('create'))
    ok(/in #launch \(Discord\)/.test(JSON.stringify(pr || {})), 'its description says where it was asked', pr)
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true })
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
    ok(sent && !sent.streamed && !events().some((e) => e.type === 'status' && e.platform === 'discord') && !events().some((e) => e.type === 'approval.asked' && e.platform === 'discord'), 'no stream, no working status, no Slack direct message for it', sent)
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
      await openSettings(p)
      await p.locator('.sb-where-tabs [data-platform="discord"]').click()
      await p.locator('[data-setting="discord-owner"]').waitFor({ timeout: 8000 })
      ok(/Tester/.test(await p.locator('[data-setting="discord-owner"]').innerText()), `${mode}${phone ? ', a phone' : ''}: you in Discord`)
      const asked = await p.locator('[data-setting="slack-askers"] .sb-askers').innerText()
      ok(/Dana\s*Discord/.test(asked), `${mode}${phone ? ', a phone' : ''}: who may ask, with where they're from`, asked)
      if (phone) {
        await sleep(300)
        const faults = await phoneFaults(p, '.modal.settings .sb')
        ok(!Object.keys(faults).length, `${mode}, a phone: nothing too small or wider than the screen`, faults)
      }
      await shot(p, `${tag}discord-bot-${mode}${phone ? '-phone' : ''}`)
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
