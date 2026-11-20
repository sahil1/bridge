// Bots' connections (a beta feature, its id slack-bot): one app on a platform reaching every bot
// (server/connections.js, connhub.js), with the stand-in Slack holding two apps, the stand-in
// Discord and Teams, a stand-in model for AI Assist (stand-ins/model.mjs) and the stand-in Claude
// Code answering (stand-ins/helper-claude.cjs).
//   Migration: a bot made before connections, its own Slack app's tokens in its folder, is a
//   connection of its own once Bridge AI starts (named as the bot, its tokens moved, yours only),
//   connected as before, said in its record, answering as itself.
//   A shared Slack connection, its tokens pasted once, reaching two bots made by name; each way a
//   question finds its bot, in order, each in the connection's own Activity: the connection's
//   /command with a bot's name, and each bot's own with per-bot commands on; a channel's bot over a
//   name in it; a name at the start (taken off what the bot is asked); a reply in a thread to the
//   bot that answered there; in a direct message the bot used last, unless another is named;
//   otherwise its Chief (one of its bots, whatever the words say), and with no Chief they may ask,
//   the asker picks with buttons (only they can); one bot they may ask, that one; none, the polite
//   no and no agent. A bot named that
//   they may not ask: its polite no. !help and the Home tab list the bots and how to ask each; a
//   draft in your direct messages says which bot. Each answer posted with its bot's name (and icon),
//   streamed so too; an app without chat:write.customize is told to update, and its answers start
//   with the bot's name. A bot given its own connection leaves the shared one; Move to shared takes
//   a bot off its own (its app's tokens deleted) and it answers through the shared app as itself.
//   Discord: through a channel's webhook as each bot, its name first where webhooks aren't allowed
//   and in a direct message. Teams: its name first in bold.
//   In the app: AI Assist's chat with a shared connection there (nothing to set up on the platform:
//   the card says how people reach it, its command and a channel it's the default bot in; after
//   Create, how to ask it, the people named found at once), and with none (it walks through making
//   the shared one, once, named as you like); Bots › Connections (a card each, which bot answered
//   and why under Advanced, no token in the page); a bot's Settings saying how it's reached, with
//   Give it its own connection; light and dark, on a computer and at a phone's width.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSlack, startDiscord, startTeams, startModel, checks, until, sleep, browser, page, shot, phoneFaults, TEST, IS_WIN } from '../lib/harness.mjs'
import { lookers, ownFile, openSettings, M, M2 } from '../lib/bots.mjs'

const { ok, done } = checks('bots-connections')
const slack = await startSlack('bots-connections')
const dc = await startDiscord('bots-connections')
const tm = await startTeams('bots-connections')
const model = await startModel('bots-connections')
// The stand-in Slack's scopes for an app made from the shared manifest, and one made before it.
const ALL = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'im:write', 'users:read', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'mpim:history', 'mpim:read', 'reactions:write', 'pins:read', 'files:read', 'files:write', 'commands', 'assistant:write', 'chat:write.customize']
const OLDER = ALL.filter((x) => x !== 'chat:write.customize')
const kit = await startKit('bots-connections', {
  config: { name: 'Tester', trials: { 'slack-bot': true } },
  env: ({ data, home }) => {
    for (const d of ['pricing', 'docs', 'launch']) fs.mkdirSync(path.join(home, d), { recursive: true })
    // A bot made before connections: Atlas, its own Slack app (A2) in its folder.
    const B1 = path.join(data, 'bots', 'b1')
    fs.mkdirSync(B1, { recursive: true })
    fs.writeFileSync(path.join(B1, 'bot.json'), JSON.stringify({ name: 'Atlas', description: 'Says where the launch stands', who: 'named', askers: [{ id: 'U0DANA', name: 'Dana' }], readsFrom: ['~/launch'], createdAt: '2026-11-01T00:00:00.000Z' }))
    fs.writeFileSync(path.join(B1, 'instructions.md'), '# Atlas\n\nSay where the launch stands.\n')
    fs.writeFileSync(path.join(B1, 'slack.json'), JSON.stringify({ appToken: 'xapp-two', botToken: 'xoxb-two', team: { id: 'T0TEST', name: 'Acme Test' }, since: String(Date.now() / 1000 - 60) }), { mode: 0o600 })
    return {
      BRIDGE_SLACK_URL: slack.url, BRIDGE_DISCORD_URL: dc.url, BRIDGE_TEAMS_URL: tm.url, BRIDGE_TEAMS_PORT: '0',
      BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000',
      // (Each question its own conversation: the same person asking again soon after carries none on.)
      BRIDGE_BOT_CARRY_MS: '0',
      // (No model on this computer is reached: AI Assist's is the stand-in's, once it's given.)
      OLLAMA_HOST: 'http://127.0.0.1:9', LM_STUDIO_BASE_URL: 'http://127.0.0.1:9/v1',
    }
  },
})
const { draftOf, startOf, startsOf, briefOf, botOf, events, posted, postedLike } = lookers(kit, slack)
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const state = () => slack.state()
fs.writeFileSync(path.join(kit.home, 'pricing', 'pricing.md'), '# Pricing\n\nEnterprise is $40 a seat, billed yearly.\n')
fs.writeFileSync(path.join(kit.home, 'docs', 'handbook.md'), '# Handbook\n\nThe style guide is on page 4.\n')
fs.writeFileSync(path.join(kit.home, 'launch', 'launch.md'), '# Launch\n\nOn track for Friday.\n')
const conn = (id) => kit.api(`/connections/${id}`)
const connectedConn = (id, ms = 20000) => until(async () => { const c = await conn(id); return c.state === 'connected' ? c : null }, ms)
// The connection's own record of where each question went (newest first), and what's new in it since
// mark(): an entry that says so.
const routedOf = async (id) => (await kit.api(`/connections/${id}/activity`)).routed
const marks = {}
const mark = async (id) => { marks[id] = (await routedOf(id)).length }
const routed = (id, fn, ms = 20000) => until(async () => { const l = await routedOf(id); return l.slice(0, Math.max(0, l.length - (marks[id] || 0))).find(fn) || null }, ms)
const send = (d) => kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true })
// The question as the bot's agent was asked it.
const asked = (s) => (/----- question from [^\n]+-----\n([^\n]*)/.exec(briefOf(s)) || [])[1] || ''
// The latest buttons to pick a bot with, and their values.
const picks = async () => {
  const p = [...(await posted())].reverse().find((x) => JSON.stringify(x.blocks || []).includes('"bb_pick"'))
  const els = (p?.blocks || []).find((x) => x.type === 'actions')?.elements || []
  return p ? { ...p, buttons: els.map((e) => ({ label: e.text?.text, value: e.value })) } : null
}

try {
  await kit.api('/setup', { name: 'Tester' })

  // ---------- A bot made before connections ----------
  let OWN = null
  await part('migration', async () => {
    const list = (await kit.api('/connections')).connections
    const c = list.find((x) => x.own?.id === 'b1')
    OWN = c?.id || null
    ok(list.length === 1 && c?.platform === 'slack' && c.name === 'Atlas' && c.shared === false && c.bots.map((x) => x.id).join() === 'b1', 'its own Slack app is a connection of its own, named as the bot, reaching only it', list)
    const file = ownFile(kit, 'b1', 'slack')
    ok(fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).botToken === 'xoxb-two' && !fs.existsSync(path.join(kit.data, 'bots', 'b1', 'slack.json')) && (IS_WIN || (fs.statSync(file).mode & 0o777) === 0o600), 'its tokens moved with it, yours only, and gone from its folder', IS_WIN ? null : (fs.statSync(file).mode & 0o777).toString(8))
    const on = await connectedConn(OWN)
    ok(on?.team?.name === 'Acme Test' && on.bot?.name === 'atlas' && /…/.test(on.tokens?.bot || '') && !JSON.stringify(on).includes('xoxb-two'), 'connected as before, as @atlas; its tokens shown only as their ends', on && { team: on.team, bot: on.bot, tokens: on.tokens })
    ok(events('b1').some((e) => e.type === 'settings.changed' && e.setting === 'connection' && /connection of its own/.test(e.why || '')), 'and its record says so')
    const v = await botOf('b1')
    ok(v.connections?.slack?.id === OWN && v.connections.slack.shared === false && v.state === 'connected', 'its page says it\'s reached through its own connection', v.connections)
  })

  // ---------- A shared Slack connection, and two bots on it ----------
  const made = await kit.api('/connections', { platform: 'slack', name: 'tester_bot' })
  const C = made.id
  ok(made.shared === true && made.name === 'tester_bot' && made.state === 'no-tokens' && made.command === '/tester_bot' && made.manifest?.oauth_config.scopes.bot.includes('chat:write.customize') && made.manifest.display_information.name === 'tester_bot', 'a shared connection by the name given: its own /command, and a manifest that can post as each bot', made)
  const twice = await kit.api('/connections', { platform: 'slack', name: 'another' }).then(() => null, (e) => e)
  ok(twice?.status === 409, 'one shared connection a platform', twice?.message)
  const wrong = await kit.api(`/connections/${C}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-wrong' }).then(() => null, (e) => e)
  ok(/invalid_auth/.test(wrong?.message || ''), 'a wrong token is said at once', wrong?.message)
  await kit.api(`/connections/${C}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots', { name: 'Pricing Desk', description: 'Answers pricing questions: plans, seats and enterprise prices' })
  await kit.api('/bots', { name: 'Docs Helper', description: 'Answers questions about the docs and the handbook' })
  await kit.api('/bots/b2/settings', { answerIn: 'thread', askers: [{ id: 'U0DANA', name: 'Dana' }, { id: 'U0SAM', name: 'Sam' }, { id: 'discord:2001', name: 'Dana' }, { id: 'teams:aad-dana-0001', name: 'Dana Reyes' }], readsFrom: ['~/pricing'], icon: ':moneybag:' })
  await kit.api('/bots/b3/settings', { answerIn: 'thread', askers: [{ id: 'U0DANA', name: 'Dana' }, { id: 'discord:2001', name: 'Dana' }, { id: 'teams:aad-dana-0001', name: 'Dana Reyes' }], readsFrom: ['~/docs'] })
  const shared = await connectedConn(C)
  ok(shared?.team?.name === 'Acme Test' && shared.bot?.name === 'bridge_ai' && shared.bots.map((x) => x.name).join() === 'Pricing Desk,Docs Helper', 'connected once, reaching both new bots (not Atlas, which has its own)', shared && { bots: shared.bots, bot: shared.bot })
  ok((await botOf('b2')).connections?.slack?.id === C && (await botOf('b2')).state === 'connected', 'a new bot needs nothing set up in Slack: it\'s on the shared connection, connected', (await botOf('b2')).connections)
  const badIcon = await kit.api('/bots/b3/settings', { icon: 'javascript:alert(1)' }).then(() => null, (e) => e)
  ok(/icon/.test(badIcon?.message || ''), 'an icon is an emoji\'s name or an https address, nothing else', badIcon?.message)

  // ---------- No Chief: the asker picks ----------
  let p0 = null
  await part('no chief', async () => {
    ok((await conn(C)).chief === null, 'no Chief for the connection yet')
    await mark(C)
    const q = await slack.ask({ user: 'U0DANA', text: `${M} could you look into this? [answer Looked into it.]` })
    p0 = await until(async () => { const x = await picks(); return x?.thread_ts === q.ts ? x : null }, 15000)
    ok(!(await routedOf(C)).some((e) => e.why === 'router' || e.why === 'chief'), 'with no Chief, nothing picks a bot (no model is asked)')
    ok(/^Pricing Desk or Docs Helper\? Pick who should answer this\./.test(p0?.text || '') && p0.buttons.map((x) => x.label).join() === 'Pricing Desk,Docs Helper' && p0.app === 'A1', 'it asks in the thread, "Pricing Desk or Docs Helper?", with a button for each', p0)
    ok(!!(await routed(C, (e) => e.why === 'asked')), 'asked: in its record')
    await sleep(500)
    ok(!startsOf('look into this').length, 'and nothing answers until someone picks')
  })

  // AI Assist's model from now on (a key, picked for Studio as AI Assist's), and Claude Code to answer.
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { studio: { model: 'openai:gpt-5' } }, 'PATCH')
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
  await kit.api('/agents/catalog')
  await kit.api(`/connections/${C}`, { owner: { id: 'U0OWNER', name: 'Tester' } }, 'PATCH')

  await part('picked by whoever asked', async () => {
    const docs = p0?.buttons.find((x) => x.label === 'Docs Helper')
    await mark(C)
    await slack.click({ user: 'U0SAM', action_id: 'bb_pick', value: docs?.value })
    ok(!!(await until(async () => (await state()).ephemeral.find((x) => x.user === 'U0SAM' && /Only whoever asked can pick/.test(x.text)), 10000)), 'someone else\'s pick is turned down, to them alone')
    await slack.click({ user: 'U0DANA', action_id: 'bb_pick', value: docs?.value })
    const s = await startOf('look into this')
    ok(/You're Docs Helper, Tester's bot in Slack/.test(briefOf(s)), 'the asker\'s pick: the question goes to that bot', briefOf(s).slice(0, 200))
    ok(!!(await routed(C, (e) => e.why === 'picked' && e.bot === 'b3')), 'picked: in the connection\'s record')
    ok(!!(await until(async () => (await state()).updated.find((x) => x.ts === p0.ts && /Docs Helper is answering/.test(JSON.stringify(x.blocks || x.text))), 10000)), 'and the buttons give way to who\'s answering')
    const again = await slack.click({ user: 'U0DANA', action_id: 'bb_pick', value: docs?.value, channel: p0.channel, ts: p0.ts })
    ok(again.delivered && !!(await until(async () => (await state()).ephemeral.find((x) => x.user === 'U0DANA' && /isn't waiting any more/.test(x.text)), 10000)), 'picked twice: it isn\'t waiting any more')
    const d = await draftOf('look into this')
    ok(d?.bot?.id === 'b3' && d.draft === 'Looked into it.', 'its draft is Docs Helper\'s', d && { bot: d.bot, draft: d.draft })
    const dm = await until(async () => (await posted()).find((x) => x.channel === 'D0OWNER' && x.app === 'A1' && JSON.stringify(x.blocks || []).includes('look into this')), 15000)
    ok(/^Docs Helper · \*Dana\* asked #launch/.test(dm?.blocks?.[0]?.text?.text || ''), 'and in your direct messages, its draft says which bot it\'s from', dm?.blocks?.[0])
  })

  // ---------- 1. A command ----------
  await part('a command', async () => {
    await mark(C)
    await slack.slash({ user: 'U0DANA', command: '/tester_bot', text: 'pricing how much is one seat? [answer $12 a seat.]', channel: 'C0LAUNCH' })
    const s = await startOf('how much is one seat')
    ok(/You're Pricing Desk/.test(briefOf(s)) && /^how much is one seat\?/.test(asked(s)), '/tester_bot pricing …: to Pricing Desk, asked without its name', asked(s))
    ok(!!(await routed(C, (e) => e.why === 'command' && e.bot === 'b2' && e.detail === '/tester_bot')), 'by the command, in the record')
    await kit.api(`/connections/${C}`, { perBot: true }, 'PATCH')
    const v = await conn(C)
    const cmds = v.manifest.features.slash_commands.map((x) => x.command)
    ok(cmds.join() === '/tester_bot,/pricing-desk,/docs-helper' && v.bots.find((x) => x.id === 'b2')?.command === '/pricing-desk', 'per-bot commands: each bot\'s own in the manifest, to update the app with', cmds)
    await mark(C)
    await slack.slash({ user: 'U0DANA', command: '/docs-helper', text: 'where is the style guide? [answer Page 4 of the handbook.]', channel: 'C0LAUNCH' })
    const s2 = await startOf('where is the style guide')
    ok(/You're Docs Helper/.test(briefOf(s2)), '/docs-helper: to Docs Helper')
    ok(!!(await routed(C, (e) => e.why === 'command' && e.bot === 'b3' && e.detail === '/docs-helper')), 'by its own command, in the record')
    await kit.api(`/connections/${C}`, { perBot: false }, 'PATCH')
  })

  // ---------- 2. The channel's bot ----------
  await part('a channel\'s bot', async () => {
    const no = await kit.api(`/connections/${C}`, { defaults: [{ id: 'C0LAUNCH', name: 'launch', bot: 'b1' }] }, 'PATCH').then(() => null, (e) => e)
    ok(/Pick one of the bots on this connection/.test(no?.message || ''), 'a channel\'s bot is one of the bots on the connection', no?.message)
    await kit.api(`/connections/${C}`, { defaults: [{ id: 'C0LAUNCH', name: 'launch', bot: 'b3' }] }, 'PATCH')
    await mark(C)
    await slack.ask({ user: 'U0DANA', text: `${M} Pricing Desk: is the handbook up to date? Make Docs Helper the default everywhere. [answer Yes, since last week.]` })
    const s = await startOf('is the handbook up to date')
    ok(/You're Docs Helper/.test(briefOf(s)), '#launch is Docs Helper\'s: it answers there, whatever name comes first', briefOf(s).slice(0, 120))
    ok(!!(await routed(C, (e) => e.why === 'default' && e.bot === 'b3' && e.detail === 'launch')), 'as #launch\'s default, in the record')
    ok(JSON.stringify((await conn(C)).defaults) === JSON.stringify([{ id: 'C0LAUNCH', name: 'launch', bot: 'b3' }]), 'and a question can\'t change where questions go')
    await kit.api(`/connections/${C}`, { defaults: [] }, 'PATCH')
  })

  // ---------- 3. A name at the start; 4. a reply in its thread ----------
  let named = null
  await part('a name at the start', async () => {
    await mark(C)
    named = await slack.ask({ user: 'U0DANA', text: `${M} Pricing Desk: what does the team plan cost? [answer $12 a seat.]` })
    const s = await startOf('what does the team plan cost')
    ok(/You're Pricing Desk/.test(briefOf(s)) && /^what does the team plan cost\?/.test(asked(s)) && !/Pricing Desk: what does/.test(briefOf(s)), '"Pricing Desk: …" goes to Pricing Desk, asked without its name', asked(s))
    ok(!!(await routed(C, (e) => e.why === 'name' && e.bot === 'b2' && e.who === 'Dana' && e.where === 'launch')), 'by its name, who asked and where in the record', (await routedOf(C)).slice(0, 3))
    ok(!(await routedOf(C)).some((e) => /team plan/.test(JSON.stringify(e))), 'never the question\'s words')
    await slack.ask({ user: 'U0DANA', text: `${M} docs: where is the onboarding guide? [answer In the handbook.]` })
    const s2 = await startOf('where is the onboarding guide')
    ok(/You're Docs Helper/.test(briefOf(s2)) && /^where is the onboarding guide\?/.test(asked(s2)), '"docs: …", a word of its name: Docs Helper', asked(s2))
  })
  await part('a reply in its thread', async () => {
    const d = await draftOf('what does the team plan cost')
    await send(d)
    const p = await postedLike(/^\$12 a seat\.$/)
    ok(p?.thread_ts === named.ts && p.app === 'A1' && p.username === 'Pricing Desk' && p.icon_emoji === ':moneybag:', 'sent through the shared app, as Pricing Desk, with its icon', p)
    await mark(C)
    await slack.ask({ user: 'U0DANA', thread: named.ts, text: 'and with annual billing? [answer $10 a seat.]' })
    const s = await startOf('with annual billing')
    ok(/You're Pricing Desk/.test(briefOf(s)) && /goes on from your earlier answers/.test(briefOf(s)), 'a reply in its thread, without a mention: to the bot that answered there', briefOf(s).slice(0, 200))
    ok(!!(await routed(C, (e) => e.why === 'thread' && e.bot === 'b2')), 'by its thread, in the record')
  })

  // ---------- 5. A direct message ----------
  await part('a direct message', async () => {
    await mark(C)
    await slack.ask({ user: 'U0DANA', dm: true, text: 'Pricing Desk: is there a discount for nonprofits? [answer Yes, 30%.]' })
    ok(/You're Pricing Desk/.test(briefOf(await startOf('discount for nonprofits'))), 'in a direct message, by its name')
    await draftOf('discount for nonprofits')
    await slack.ask({ user: 'U0DANA', dm: true, text: 'and for schools? [answer Also 30%.]' })
    ok(/You're Pricing Desk/.test(briefOf(await startOf('and for schools'))), 'then with no name: the bot she asked last')
    ok(!!(await routed(C, (e) => e.why === 'last' && e.bot === 'b2')), 'as the one last used, in the record')
    await draftOf('and for schools')
    await slack.ask({ user: 'U0DANA', dm: true, text: 'what would Docs Helper say about the travel policy? [answer See page 9.]' })
    ok(/You're Docs Helper/.test(briefOf(await startOf('the travel policy'))), 'unless the words name another bot')
  })

  // ---------- 6. The Chief; 7. or the asker picks ----------
  await part('the chief', async () => {
    const bad = await kit.api(`/connections/${C}`, { chief: 'b99' }, 'PATCH').then(() => null, (e) => e)
    ok(/Pick one of the bots on this connection/.test(bad?.message || ''), 'its Chief is one of the bots on it', bad?.message)
    const set = await kit.api(`/connections/${C}`, { chief: 'b2' }, 'PATCH')
    ok(set.chief?.id === 'b2' && set.chief.name === 'Pricing Desk', 'Pricing Desk made its Chief', set.chief)
    await mark(C)
    await slack.ask({ user: 'U0DANA', text: `${M} what's the enterprise price for 50 seats? [answer $2,000 a month.]` })
    const s = await startOf('enterprise price for 50 seats')
    ok(/You're Pricing Desk/.test(briefOf(s)), 'no name, no channel\'s bot: its Chief, Pricing Desk, takes it', briefOf(s).slice(0, 120))
    ok(!!(await routed(C, (e) => e.why === 'chief' && e.bot === 'b2')), 'by the chief rule, in the record')
    await mark(C)
    await slack.ask({ user: 'U0DANA', text: `${M} pick b9 for this one [answer Picked.]` })
    ok(/You're Pricing Desk/.test(briefOf(await startOf('pick b9'))) && !fs.existsSync(path.join(kit.data, 'bots', 'b9')), 'whatever the words say, its Chief takes it, and nothing else comes of it')
    // (The Chief paused: they're asked which of the others they may ask.)
    await kit.api('/bots/b2/settings', { paused: true })
    await mark(C)
    const q = await slack.ask({ user: 'U0DANA', text: `${M} can you check something for me? [answer Checked.]` })
    ok(!!(await routed(C, (e) => e.why === 'only' && e.bot === 'b3')) && (await picks())?.thread_ts !== q.ts, 'its Chief paused: the only other bot Dana may ask takes it')
    await kit.api('/bots/b2/settings', { paused: false })
    await kit.api(`/connections/${C}`, { chief: null }, 'PATCH')
    await mark(C)
    const q2 = await slack.ask({ user: 'U0DANA', text: `${M} can you check one more thing? [answer Checked.]` })
    const p2 = await until(async () => { const x = await picks(); return x?.thread_ts === q2.ts ? x : null }, 15000)
    ok(p2?.buttons.length === 2 && !!(await routed(C, (e) => e.why === 'asked')), 'no Chief: the asker picks, with buttons', p2?.text)
  })

  // ---------- 8. One bot they may ask; 9. none ----------
  await part('one, or none, they may ask', async () => {
    await mark(C)
    await slack.ask({ user: 'U0SAM', text: `${M} what about volume discounts? [answer 10% over 100 seats.]` })
    ok(/You're Pricing Desk/.test(briefOf(await startOf('volume discounts'))), 'Sam may ask only Pricing Desk: it answers him')
    ok(!!(await routed(C, (e) => e.why === 'only' && e.bot === 'b2')), 'as the only one, in the record')
    const before = startsOf('').length
    await mark(C)
    await slack.ask({ user: 'U0EVE', text: `${M} anything new this week? [answer nope]` })
    const no = await postedLike(/^Sorry, I only answer questions from people Tester has added\. Ask Tester directly\.$/)
    ok(no?.app === 'A1' && !no.username, 'Eve may ask neither: the polite no, from the app', no)
    ok(!!(await routed(C, (e) => e.why === 'none' && e.detail === 'not-allowed' && !e.bot)), 'none, in the record')
    await slack.ask({ user: 'U0SAM', text: `${M} Docs Helper: where is the handbook kept? [answer nope]` })
    const no2 = await until(async () => (await posted()).find((x) => /I only answer questions from people Tester has added/.test(x.text) && x.username === 'Docs Helper'), 15000)
    ok(!!no2, 'Sam naming Docs Helper, which he may not ask: its own polite no', no2)
    ok(!!(await until(() => events('b3').find((e) => e.type === 'refused' && e.why === 'not-allowed'), 8000)), 'refused in its record')
    await sleep(800)
    ok(startsOf('').length === before, 'and no agent started for either', startsOf('').length - before)
  })

  // ---------- !help, the Home tab ----------
  await part('help and the Home tab', async () => {
    await mark(C)
    await slack.ask({ user: 'U0DANA', text: `${M} !help` })
    const h = await postedLike(/^I'm tester_bot, Tester's way to these bots/)
    ok(/• Pricing Desk: Answers pricing questions[^\n]*Ask with "Pricing Desk: your question" or \/tester_bot pricing your question/.test(h?.text || '') && /• Docs Helper/.test(h?.text || ''), '!help naming no bot: each bot, and how to ask it', h?.text)
    ok(!!(await routed(C, (e) => e.why === 'help')), 'in the record')
    await slack.ask({ user: 'U0DANA', text: `${M} Pricing Desk: !help` })
    ok(!!(await postedLike(/^I'm Pricing Desk, Tester's bot[\s\S]*Ask me through @tester_bot: start with "Pricing Desk:"/)), 'a bot\'s own !help, by its name: how to reach it through the shared app')
    await slack.home({ user: 'U0DANA', app: 'A1' })
    const v = await until(async () => [...(await state()).views].reverse().find((x) => x.kind === 'publish' && x.app === 'A1'), 10000)
    const words = JSON.stringify(v?.view?.blocks || [])
    ok(/tester_bot/.test(words) && /Pricing Desk/.test(words) && /Docs Helper/.test(words) && /\/tester_bot pricing your question/.test(words), 'its Home tab: each bot, and how to ask it', words.slice(0, 600))
  })

  // ---------- Each bot's name and icon ----------
  await part('posting as each bot', async () => {
    const d = await draftOf('where is the onboarding guide')
    await send(d)
    const p = await postedLike(/^In the handbook\.$/)
    ok(p?.username === 'Docs Helper' && !p.icon_emoji, 'Docs Helper\'s answer, as Docs Helper (no icon of its own)', p)
    await kit.api('/bots/b3/settings', { auto: true })
    const q = await slack.ask({ user: 'U0DANA', text: `${M} docs: who owns the handbook? [answer The people team.]` })
    const st = await until(async () => (await state()).streams.find((x) => x.thread === q.ts && x.stopped), 20000)
    ok(st?.app === 'A1' && st.username === 'Docs Helper' && /The people team\./.test(st.text), 'one sent without asking is streamed as that bot too', st)
    await kit.api('/bots/b3/settings', { auto: false })
    // An app made before the shared manifest asked for chat:write.customize.
    await slack.scopes({ app: 'A1', scopes: OLDER })
    await kit.api(`/connections/${C}/connect`, {})
    const v = await until(async () => { const x = await conn(C); return x.state === 'connected' && x.updateApp?.missing?.includes('chat:write.customize') ? x : null }, 15000)
    ok(v?.updateApp.missing.join() === 'chat:write.customize' && /each bot's own name and icon/.test(v.updateApp.needs[0]?.for || ''), 'an app without chat:write.customize is told to update, and what for', v?.updateApp)
    const q2 = await slack.ask({ user: 'U0DANA', text: `${M} Pricing Desk: is there a free plan? [answer No free plan.]` })
    await send(await draftOf('is there a free plan'))
    const p2 = await until(async () => (await posted()).find((x) => x.channel === 'C0LAUNCH' && /No free plan\./.test(x.text || '')), 20000)
    ok(p2?.thread_ts === q2.ts && p2.text === '*Pricing Desk:* No free plan.' && !p2.username, 'meanwhile its answers start with the bot\'s name', p2)
    await slack.scopes({ app: 'A1' })
    await kit.api(`/connections/${C}/connect`, {})
    ok(!!(await until(async () => { const x = await conn(C); return x.state === 'connected' && !x.updateApp?.missing?.length }, 15000)), 'updated and connected again: nothing missing')
  })

  // ---------- A bot of its own alongside ----------
  await part('a connection of its own', async () => {
    await slack.ask({ user: 'U0DANA', text: `${M2} how is the launch going? [answer On track for Friday.]` })
    const s = await startOf('how is the launch going')
    ok(/You're Atlas/.test(briefOf(s)), 'Atlas, on its own app, answers its own mentions')
    await send(await draftOf('how is the launch going'))
    const p = await postedLike(/^On track for Friday\.$/)
    ok(p?.app === 'A2' && !p.username, 'as itself, its own app, with no name put on it', p)
    const v = await kit.api('/bots/b3/own', { platform: 'slack' })
    const own = (await kit.api('/connections')).connections.find((x) => x.own?.id === 'b3')
    ok(v.connections?.slack?.id === own?.id && own.state === 'no-tokens' && own.name === 'Docs Helper' && !(await conn(C)).bots.some((x) => x.id === 'b3'), 'given its own connection: Docs Helper leaves the shared one, its own to set up', { own, bots: (await conn(C)).bots })
    const m = await kit.api('/bots/b3/move', { platform: 'slack' })
    ok(m.moved?.to === 'tester_bot' && m.connections?.slack?.id === C && !(await kit.api('/connections')).connections.some((x) => x.own?.id === 'b3'), 'and moved back to the shared one', m.moved)
    const no = await kit.api('/bots/b2/move', { platform: 'slack' }).then(() => null, (e) => e)
    ok(no?.status === 409, 'a bot with nothing of its own can\'t be moved', no?.message)
  })
  await part('move to shared', async () => {
    const file = ownFile(kit, 'b1', 'slack')
    const m = await kit.api('/bots/b1/move', { platform: 'slack' })
    ok(m.moved?.from === 'Atlas' && m.moved.to === 'tester_bot' && m.moved.platform === 'slack' && m.connections?.slack?.id === C, 'Atlas moved to the shared connection: from its own app to tester_bot', m.moved)
    ok(!fs.existsSync(file) && !fs.existsSync(path.dirname(file)) && !(await kit.api('/connections')).connections.some((x) => x.id === OWN), 'its own connection gone, its tokens deleted from this computer')
    ok(events('b1').some((e) => e.type === 'settings.changed' && e.setting === 'connection' && e.new?.shared === true), 'in its record')
    await until(async () => (await state()).connections === 1, 10000)
    await slack.ask({ user: 'U0DANA', text: `${M} Atlas: what's left before launch? [answer The pricing page.]` })
    const s = await startOf('left before launch')
    ok(/You're Atlas/.test(briefOf(s)), 'it\'s reached through the shared app by its name')
    await send(await draftOf('left before launch'))
    const p = await postedLike(/^The pricing page\.$/)
    ok(p?.app === 'A1' && p.username === 'Atlas', 'answering through the shared app as Atlas', p)
  })

  // ---------- Discord ----------
  await part('Discord', async () => {
    const c = await kit.api('/connections', { platform: 'discord', name: 'tester_bot' })
    await kit.api(`/connections/${c.id}/tokens`, { token: 'dtest.bot-one.0123456789abcdef', guild: '3001' })
    const on = await connectedConn(c.id)
    ok(on?.status?.guild?.name === 'Acme' && /permissions=\d+/.test(on.status.invite || '') && (BigInt(/permissions=(\d+)/.exec(on.status.invite)[1]) & (1n << 29n)) !== 0n, 'a shared Discord connection, in Acme; its invite asks to manage webhooks', on?.status && { guild: on.status.guild, invite: on.status.invite })
    await dc.say({ user: '2001', text: '<@1001> Pricing Desk: what is the enterprise price? [answer $40 a seat.]' })
    ok(/You're Pricing Desk, Tester's bot in Discord/.test(briefOf(await startOf('what is the enterprise price?'))), 'its name first: Pricing Desk')
    await send(await draftOf('what is the enterprise price?'))
    const p = await until(async () => (await dc.state()).posted.find((x) => /\$40 a seat/.test(x.content)), 20000)
    ok(p?.webhook === true && p.username === 'Pricing Desk' && p.in_thread === '4001' && p.content === '$40 a seat.', 'posted in its thread through the channel\'s webhook, as Pricing Desk', p)
    ok((await dc.state()).webhooks.some((w) => w.channel === '4001' && w.app === 'D1'), 'a webhook made once for the channel')
    await fetch(`${dc.url}/_test/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allow: false }) })
    await dc.say({ user: '2001', channel: '4002', text: '<@1001> Pricing Desk: and the team plan? [answer $12 a seat.]' })
    await send(await draftOf('and the team plan?'))
    const p2 = await until(async () => (await dc.state()).posted.find((x) => /\$12 a seat/.test(x.content)), 20000)
    ok(p2 && !p2.webhook && p2.app === 'D1' && p2.content === '**Pricing Desk:** $12 a seat.' && p2.in_thread === '4002', 'where it may not make webhooks: by the app, the bot\'s name first', p2)
    await dc.say({ user: '2001', dm: true, text: 'Pricing Desk: is there a discount? [answer 10% off.]' })
    await send(await draftOf('is there a discount?'))
    const p3 = await until(async () => (await dc.state()).posted.find((x) => /10% off/.test(x.content)), 20000)
    ok(p3 && !p3.webhook && p3.content === '**Pricing Desk:** 10% off.', 'in a direct message, its name first', p3)
  })

  // ---------- Microsoft Teams ----------
  await part('Microsoft Teams', async () => {
    const c = await kit.api('/connections', { platform: 'teams', name: 'tester_bot' })
    await kit.api(`/connections/${c.id}/tokens`, tm.app)
    const on = await until(async () => { const x = await conn(c.id); return x.state === 'connected' && x.status?.listening?.port ? x : null }, 20000)
    ok(!!on && !JSON.stringify(on).includes(tm.app.password), 'a shared Teams connection, listening; its secret never shown', on?.status?.listening)
    await tm.endpoint(`http://127.0.0.1:${on.status.listening.port}/api/messages`)
    const r = await tm.say({ user: 'dana', text: 'Docs Helper: where is the handbook? [answer On the wiki.]' })
    ok(r.status === 200 && /You're Docs Helper, Tester's bot in Microsoft Teams/.test(briefOf(await startOf('where is the handbook?'))), 'its name first: Docs Helper')
    await send(await draftOf('where is the handbook?'))
    const p = await until(async () => (await tm.state()).posted.find((x) => /On the wiki/.test(x.text || '')), 20000)
    ok(p?.text === '**Docs Helper:** On the wiki.', 'its answer starts with its name, in bold', p?.text)
  })

  // ---------- No token anywhere ----------
  await part('no token anywhere', async () => {
    const all = [
      fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8'), fs.readFileSync(path.join(kit.dir, 'server.log'), 'utf8'),
      ...fs.readdirSync(path.join(kit.data, 'connections')).flatMap((d) => ['connection.json', 'routing.jsonl'].map((f) => { try { return fs.readFileSync(path.join(kit.data, 'connections', d, f), 'utf8') } catch { return '' } })),
      JSON.stringify(await kit.api('/connections')), model.asked().join('\n'),
    ].join('\n')
    ok(!/xoxb-test|xapp-test|dtest\.bot-one|teams-secret-1|whtok-/.test(all), 'no token or secret in any setting, record, log, view or what the model was sent')
  })

  // ---------- In the app ----------
  const { b, which } = await browser()
  const tag = which === 'webkit' ? 'webkit-' : ''
  const shown = (p, sel, ms = 10000) => p.locator(sel).first().waitFor({ timeout: ms }).then(() => true, () => false)
  const textOf = (p, sel) => p.locator(sel).first().innerText().catch(() => '')
  const SHARED = (await kit.api('/connections')).connections.find((c) => c.shared && c.platform === 'slack')
  try {
    // The chat with a shared connection there: nothing to set up on Slack, so it asks how people
    // reach the bot, shows it on the card, and after Create says how to ask it; the people named
    // are found at once.
    await part('the chat, with a shared connection', async () => {
      const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
      await p.locator('[data-setting="rail-bots"] .rail-tool[aria-label="New bot"]').click()
      await p.locator('[data-setting="bots-quick"] .ai-assist-link').click()
      await p.locator('.bc-say textarea').fill('A bot called Policy Desk that answers HR policy questions for Dana, from my docs folder, in Slack.')
      await p.locator('.bc-say button[type="submit"]').click()
      if (!ok(await shown(p, '.bc-proposal', 30000), 'a draft, its card', `${await textOf(p, '.bc')} | ${JSON.stringify((await kit.api('/bots')).bots.map((x) => [x.id, x.name, x.draft]))}`)) await shot(p, `${tag}bots-connections-no-proposal`)
      const via = await textOf(p, '[data-setting="bots-proposal-via"]')
      ok(/Reached through tester_bot, your shared Slack connection: nothing to set up there/.test(via), 'the card: reached through the shared connection, nothing to set up there', via)
      const reach = await textOf(p, '[data-setting="bots-proposal-reach"]')
      ok(/Policy Desk: …/.test(reach) && /\/tester_bot policy/.test(reach), 'how people reach it: its name first, the connection\'s command with its name', reach)
      ok(await shown(p, '.bc li[data-kind="reach"]'), 'the chat asks how people should reach it', await textOf(p, '.bc'))
      await p.locator('.bc-proposal form.sb-add input[aria-label="Add a channel it\'s the default bot in"]').fill('launch')
      await p.locator('.bc-proposal form.sb-add:has(input[aria-label="Add a channel it\'s the default bot in"]) button[type="submit"]').click()
      const id = (await kit.api('/bots')).bots.find((x) => x.draft && x.name === 'Policy Desk')?.id
      ok(!!(await until(async () => (await kit.api(`/bots/${id}/assist`)).proposal?.defaults?.includes('launch'), 8000)), 'a channel it\'s the default bot in, on the card')
      await p.locator('[data-setting="bots-proposal-via"]').scrollIntoViewIfNeeded().catch(() => {})
      await p.waitForTimeout(300)
      await shot(p, `${tag}bots-connections-proposal`)
      await p.locator('.bc-proposal .bc-create .btn.primary').click()
      ok(await shown(p, '.bp-cols .sb-tabs', 15000), 'Create: its page')
      const v = await botOf(id)
      ok(v.connections?.slack?.shared && v.connections.slack.name === 'tester_bot' && v.settings.askers.some((a) => a.id === 'U0DANA'), 'reached through tester_bot, and Dana found there at once', { via: v.connections, askers: v.settings.askers })
      ok((await conn(SHARED.id)).defaults.some((d) => d.id === 'C0LAUNCH' && d.bot === id), '#launch goes to it')
      const said = (await kit.api(`/bots/${id}/assist`)).messages.find((m) => m.kind === 'created')
      ok(said?.vars?.via?.shared && said.vars.via.name === 'tester_bot', 'the chat says it\'s reached through tester_bot', said?.vars)
      ok(await shown(p, '.bc-connect [data-setting="bots-reach"]') && !(await p.locator('.bc-connect form.sb-tokens').count()), 'no tokens to paste: how it\'s reached instead', await textOf(p, '.bc-connect'))
      await p.waitForTimeout(400)
      await shot(p, `${tag}bots-connections-created`)
      // (Put back: the rest of the suite's #launch is the router's.)
      await kit.api(`/connections/${SHARED.id}`, { defaults: [] }, 'PATCH')
      ok(!errors.length, 'no page errors', errors)
      await ctx.close()
    })

    // The chat with none there yet: it walks through making the shared one, once, named as you like.
    await part('the chat, without a connection', async () => {
      const teams = (await kit.api('/connections')).connections.find((c) => c.shared && c.platform === 'teams')
      if (teams) await kit.api(`/connections/${teams.id}`, null, 'DELETE')
      const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight' })
      await p.locator('[data-setting="rail-bots"] .rail-tool[aria-label="New bot"]').click()
      await p.locator('[data-setting="bots-quick"] .ai-assist-link').click()
      await p.locator('.bc-say textarea').fill('A bot called Leave Desk that answers leave questions for Dana in Teams.')
      await p.locator('.bc-say button[type="submit"]').click()
      ok(await shown(p, '.bc-proposal', 20000), 'a draft for Teams')
      ok(/No Microsoft Teams connection yet: after Create, you make one, once, for all your bots/.test(await textOf(p, '[data-setting="bots-proposal-via"]')), 'the card: no Teams connection yet, made once after Create', await textOf(p, '[data-setting="bots-proposal-via"]'))
      await p.locator('.bc-proposal .bc-create .btn.primary').click()
      ok(await shown(p, '.bc-connect [data-setting="teams-make-shared"]', 15000), 'Create: the chat walks through making the shared Teams connection', await textOf(p, '.bc-connect'))
      const id = (await kit.api('/bots')).bots.find((x) => x.name === 'Leave Desk')?.id
      ok(/make your shared connection there: once, for all your bots/.test(await textOf(p, '.bc li[data-kind="created"]')), 'and says so', await textOf(p, '.bc li[data-kind="created"]'))
      const input = p.locator('.bc-connect [data-setting="teams-make-shared"] input')
      ok(!!(await until(async () => (await input.inputValue()) === 'tester_bot', 8000, 200)), 'its name to start from: your first name\'s (once it\'s come)', await input.inputValue())
      await p.waitForTimeout(300)
      await shot(p, `${tag}bots-connections-make-shared`)
      await p.locator('.bc-connect [data-setting="teams-make-shared"] button[type="submit"]').click()
      ok(await shown(p, '.bc-connect .cn-card[data-platform="teams"]', 15000), 'made: its card, with its app\'s steps, in the chat', await textOf(p, '.bc-connect'))
      const v = await botOf(id)
      ok(v.connections?.teams?.shared && v.connections.teams.name === 'tester_bot', 'Leave Desk is reached through it', v.connections)
      ok((await kit.api('/connections')).connections.some((c) => c.shared && c.platform === 'teams' && c.bots.some((x) => x.id === id)), 'a shared Teams connection, reaching every bot without its own')
      await p.waitForTimeout(400)
      await shot(p, `${tag}bots-connections-made-shared`)
      ok(!errors.length, 'no page errors', errors)
      await ctx.close()
    })

    // Bots › Connections, from the sidebar: a card each; a bot's Settings say how it's reached, with
    // Give It Its Own Connection; light and dark.
    for (const mode of ['light', 'dark']) {
      await part(`Connections, ${mode}`, async () => {
        const { ctx, p, errors } = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky' })
        await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click()
        await p.locator('.bh-tabs [data-tab="connections"]').click()
        ok(await shown(p, '.bh [data-setting="bots-connections"] .cn-card'), `${mode}: Bots › Connections`)
        const cards = await p.locator('.bh .cn-card').allInnerTexts()
        ok(cards.some((x) => /tester_bot/.test(x) && /Slack/.test(x) && /Pricing Desk/.test(x) && /Docs Helper/.test(x) && /Connected to Acme Test/.test(x)), `${mode}: the shared Slack connection's card: connected, its bots`, cards[0])
        ok(cards.some((x) => /Discord/.test(x) && /Shared/i.test(x)), `${mode}: and Discord's`)
        const slackCard = p.locator('.bh .cn-card[data-platform="slack"]').first()
        await slackCard.locator('[data-setting="connection-advanced"] > summary').click()
        await slackCard.locator('[data-setting="connection-activity"] summary').first().click()
        ok(!!(await until(async () => /to Pricing Desk|to Docs Helper/.test(await slackCard.locator('[data-setting="connection-activity"]').innerText().catch(() => '')), 8000)), `${mode}: which bot answered, and why (under Advanced)`, await slackCard.locator('[data-setting="connection-activity"]').innerText().catch(() => ''))
        ok(!(await p.content()).includes('xoxb-test'), `${mode}: no token in the page`)
        await p.waitForTimeout(400)
        await shot(p, `${tag}bots-connections-page-${mode}`)
        const pd = (await kit.api('/bots')).bots.find((x) => x.name === 'Pricing Desk')
        await p.locator('.bh-tabs [data-tab="bots"]').click()
        await p.locator(`.bh .bo-card[data-bot="${pd.id}"]`).click()
        await p.locator('.bp .sb-tabs [data-tab="settings"]').click()
        const adv = p.locator('.bp [data-setting="bot-advanced"]')
        if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
        const reach = await until(async () => { const x = await textOf(p, '.bp [data-setting="bots-reach"]'); return /Reached through tester_bot/.test(x) ? x : null }, 10000)
        ok(!!reach && /Give it its own connection/.test(reach), `${mode}: a bot's Settings say it's reached through tester_bot, with Give it its own connection`, reach)
        ok(!(await p.locator('.bp [data-setting="slack-connect"]').count()), `${mode}: and no app of its own to make there`)
        await p.waitForTimeout(300)
        await shot(p, `${tag}bots-connections-bot-${mode}`)
        ok(!errors.length, `${mode}: no page errors`, errors)
        await ctx.close()
      })
    }

    // A phone: More › Bots › Connections, and a bot's page, at a phone's width.
    for (const mode of ['light', 'dark']) {
      await part(`a phone, ${mode}`, async () => {
        const { ctx, p, errors } = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', phone: true })
        await p.locator('.tabbar button', { hasText: 'More' }).click()
        await p.locator('.m-more-row[data-id="bots"]').click()
        await p.locator('[data-setting="phone-bots"] .bh-tabs [data-tab="connections"]').click()
        ok(await shown(p, '[data-setting="phone-bots"] [data-setting="bots-connections"] .cn-card'), `${mode}, a phone: More › Bots › Connections`)
        await sleep(400)
        let faults = await phoneFaults(p, '[data-setting="phone-bots"]')
        ok(!Object.keys(faults).length, `${mode}, a phone: Connections fits: nothing too small, off the screen or cut short`, faults)
        await shot(p, `${tag}bots-connections-phone-${mode}`)
        const pd = (await kit.api('/bots')).bots.find((x) => x.name === 'Pricing Desk')
        await p.locator('[data-setting="phone-bots"] .bh-tabs [data-tab="bots"]').click()
        await p.locator(`[data-setting="phone-bots"] .bo-card[data-bot="${pd.id}"]`).click()
        await p.locator('.bp.phone .sb-tabs [data-tab="settings"]').click()
        const adv = p.locator('.bp.phone [data-setting="bot-advanced"]')
        if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
        ok(!!(await until(async () => /Reached through tester_bot/.test(await textOf(p, '.bp.phone [data-setting="bots-reach"]')), 10000)), `${mode}, a phone: a bot's Settings say how it's reached`)
        await sleep(300)
        faults = await phoneFaults(p, '.bp.phone [data-setting="bots-reach"]')
        ok(!Object.keys(faults).length, `${mode}, a phone: and it fits`, faults)
        await shot(p, `${tag}bots-connections-phone-bot-${mode}`)
        ok(!errors.length, `${mode}, a phone: no page errors`, errors)
        await ctx.close()
      })
    }
  } finally {
    await b.close().catch(() => {})
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await kit.stop()
  slack.stop()
  dc.stop()
  tm.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
