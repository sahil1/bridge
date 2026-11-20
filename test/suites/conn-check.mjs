// Test this connection and linking you there (Bots, a beta feature: server/conncheck.js,
// connections.js linkCode, connhub.js linked), with the stand-in Slack (stand-ins/slack.mjs: each
// envelope to one connection, an app's own posts back as events), a stand-in Discord, and the
// stand-in Claude Code answering (stand-ins/helper-claude.cjs).
//   You there, by a code: before it, your own direct message to your bot is turned away (no one may
//   ask it yet) with how to link yourself; a code made in Bridge AI and sent in your direct messages
//   makes you you there (the connection's owner), said back, in its record, and your next message is
//   answered; a wrong one is said and isn't you; five wrong and it's spent; one past its time has run
//   out; nothing but a code in a direct message is taken as one.
//   Test this connection, each check as { id, label, state, detail, fix }: unlinked, you there warns
//   and what needs your direct messages is skipped; linked, all ok (tokens, scopes, Socket Mode, you
//   there, events arriving, reactions, files in and out, the working status, reads, channels, who
//   answers "hello", the bot), its test message deleted after; kept and shown with the connection.
//   Then each going wrong: a scope missing; events not reaching this copy (deaf); a 429 on
//   conversations.replies; files not sent; the working status unknown; another copy connected to
//   the same app (said at Slack's next hello too, to you in your direct messages, and gone once it
//   is); Socket Mode turned off (link_disabled); a channel's bot where the app isn't; a paused
//   connection. A Discord connection: its basic checks (tokens, you there, its bot).
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import { startKit, startSlack, startDiscord, checks, until, sleep, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('conn-check')
const slack = await startSlack('conn-check')
const dc = await startDiscord('conn-check')
const ALL = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'im:write', 'users:read', 'users:read.email', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'mpim:history', 'mpim:read', 'reactions:write', 'pins:read', 'files:read', 'files:write', 'commands', 'assistant:write', 'chat:write.customize']
const kit = await startKit('conn-check', {
  config: { name: 'Tester', trials: { 'slack-bot': true } },
  env: ({ home }) => {
    fs.mkdirSync(path.join(home, 'pricing'), { recursive: true })
    fs.writeFileSync(path.join(home, 'pricing', 'pricing.md'), '# Pricing\n\nEnterprise is $40 a seat.\n')
    return {
      BRIDGE_SLACK_URL: slack.url, BRIDGE_DISCORD_URL: dc.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_CARRY_MS: '0',
      // (Short waits: a test's own event, another connection looked at again, a code's life.)
      BRIDGE_SLACK_ECHO_MS: '3000', BRIDGE_SLACK_GHOST_MS: '1500', BRIDGE_LINK_MS: '8000',
    }
  },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const conn = (id) => kit.api(`/connections/${id}`)
const check = (id) => kit.api(`/connections/${id}/check`, {})
const by = (r) => Object.fromEntries((r?.checks || []).map((x) => [x.id, x]))
const states = (r) => Object.fromEntries((r?.checks || []).map((x) => [x.id, x.state]))
const posted = async () => (await slack.state()).posted
const postedIn = (channel, re, ms = 15000) => until(async () => (await posted()).find((x) => x.channel === channel && re.test(x.text || '')), ms)
const routedOf = async (id) => (await kit.api(`/connections/${id}/activity`)).routed
const logOf = (f) => { try { return fs.readFileSync(path.join(kit.home, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const startOf = (words, ms = 20000) => until(() => logOf('helpers-started.log').find((x) => x.message.includes(words)), ms)

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const C = (await kit.api('/connections', { platform: 'slack', name: 'tester_bot' })).id
  await kit.api(`/connections/${C}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
  const PD = (await kit.api('/bots', { name: 'Pricing Desk', description: 'Answers pricing questions', readsFrom: ['~/pricing'] })).id
  const up = await until(async () => { const c = await conn(C); return c.state === 'connected' ? c : null }, 20000)
  ok(!!up && up.owner === null && up.chief === null && up.numConnections === 1 && up.others === null && up.check === null, 'a shared connection, connected: nobody linked as you, no Chief, Slack counting one connection, never tested', up && { owner: up.owner, chief: up.chief, n: up.numConnections, check: up.check })

  // ---------- Before you're linked ----------
  await part('unlinked', async () => {
    const r = await check(C)
    const s = states(r)
    ok(s.here === 'ok' && s.tokens === 'ok' && s.scopes === 'ok' && s.socket === 'ok' && s.owner === 'warn' && s.channels === 'ok', 'tested: tokens, scopes, Socket Mode and channels ok; nobody linked as you, a warning', s)
    ok(['events', 'reactions', 'files', 'status', 'reads'].every((k) => s[k] === 'skip') && /linked/.test(by(r).events?.detail || ''), 'what needs your direct messages is skipped, saying why', by(r).events)
    ok(/code under You Here/.test(by(r).owner?.fix || ''), 'with what to do: make a code and send it', by(r).owner)
    ok(r.state === 'warn' && r.counts.warn >= 1 && (await conn(C)).check?.at === r.at, 'its result: a warning, kept and shown with the connection', { state: r.state, counts: r.counts })
    // Your own direct message before linking: turned away (nobody may ask it yet), told how to link.
    await slack.ask({ user: 'U0OWNER', dm: true, text: 'what is the enterprise price?' })
    ok(!!(await postedIn('D0OWNER', /I only answer questions from people Tester has added/)), 'your own message to your bot, before linking: turned away')
    ok(!!(await postedIn('D0OWNER', /If you're Tester: link yourself/)), 'and told how to link yourself')
  })

  // ---------- Linking you ----------
  await part('linking', async () => {
    const r = await kit.api(`/connections/${C}/link`, {})
    ok(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(r.code || '') && Date.parse(r.expiresAt) > Date.now() && /Send .+ to @bridge_ai in a direct message/.test(r.send || ''), 'a code to send the app in a direct message, and until when it works', r)
    ok((await conn(C)).linking?.expiresAt === r.expiresAt, 'the connection says a code waits')
    // In a channel, the code is nothing (and isn't spent).
    await slack.ask({ user: 'U0OWNER', channel: 'C0LAUNCH', text: `<@UBOT> ${r.code}` })
    await sleep(800)
    ok((await conn(C)).owner === null, 'sent in a channel: nothing comes of it')
    await slack.ask({ user: 'U0OWNER', dm: true, text: 'ABCD-EFGH' })
    ok(!!(await postedIn('D0OWNER', /That isn't the code Bridge AI shows/)) && (await conn(C)).owner === null, 'a wrong code: said, and nobody linked')
    await slack.ask({ user: 'U0OWNER', dm: true, text: `link ${r.code.toLowerCase()}` })
    const linked = await until(async () => { const c = await conn(C); return c.owner ? c : null }, 10000)
    ok(linked?.owner?.id === 'U0OWNER' && linked.owner.name === 'Tester' && linked.linking === null, 'the code (any case, "link" before it): whoever sent it is you there now', linked?.owner)
    ok(!!(await postedIn('D0OWNER', /Linked: you're Tester here now/)), 'said back to you')
    ok((await routedOf(C)).some((e) => e.event === 'settings' && e.what === 'owner' && e.new === 'Tester' && e.how === 'link code'), 'in the connection\'s record')
    ok(!logOf('helpers-started.log').some((x) => x.message.includes(r.code)), 'and no bot was asked the code')
    // Now your own message is yours.
    await slack.ask({ user: 'U0OWNER', dm: true, text: 'what is the enterprise price now? [answer $40 a seat.]' })
    ok(!!(await startOf('enterprise price now')), 'linked: your own message is answered')
    // Five wrong: spent; one past its time: run out.
    const r2 = await kit.api(`/connections/${C}/link`, {})
    for (let i = 0; i < 5; i++) await slack.ask({ user: 'U0EVE', dm: true, text: `ZZZZ-ZZZ${i + 2}` })
    ok(!!(await postedIn('D0EVE', /five wrong codes, so it's cancelled/)) && (await conn(C)).linking === null, 'five wrong codes: it\'s cancelled')
    await slack.ask({ user: 'U0EVE', dm: true, text: r2.code })
    await sleep(800)
    ok((await conn(C)).owner?.id === 'U0OWNER', 'and the right one after them links no one')
    const r3 = await kit.api(`/connections/${C}/link`, {})
    await sleep(8500)
    await slack.ask({ user: 'U0EVE', dm: true, text: r3.code })
    ok(!!(await postedIn('D0EVE', /That code has run out/)) && (await conn(C)).owner?.id === 'U0OWNER', 'one past its time: it has run out')
    const bad = await kit.api('/connections/c99/link', {}).then(() => null, (e) => e)
    ok(bad?.status === 404, 'no such connection: no code', bad?.status)
  })

  // ---------- Linked: all ok ----------
  await part('all ok', async () => {
    const before = (await slack.state()).deleted.length
    const r = await check(C)
    const s = states(r)
    ok(['here', 'tokens', 'scopes', 'socket', 'owner', 'events', 'reactions', 'files', 'status', 'reads', 'channels', 'routing'].every((k) => s[k] === 'ok'), 'every check ok', r.checks.filter((x) => x.state !== 'ok'))
    ok(['ok', 'warn'].includes(s[`bot:${PD}`]) && /pricing/.test(by(r)[`bot:${PD}`]?.detail || ''), 'its bot: its folder, and what answers', by(r)[`bot:${PD}`])
    ok(/sent its message back as an event/.test(by(r).events.detail) && /shown and cleared/i.test(by(r).status.detail) && /sent and read back the same/.test(by(r).files.detail), 'its own message came back as an event; the status shown and cleared; a file sent and read back', [by(r).events.detail, by(r).status.detail, by(r).files.detail])
    ok(/goes to Pricing Desk/.test(by(r).routing.detail), '"hello" from you goes to Pricing Desk, which answers you', by(r).routing)
    const st = await slack.state()
    ok(st.deleted.length === before + 1 && st.statuses.some((x) => x.channel === 'D0OWNER' && x.status === 'processing') && st.files.some((f) => f.name === 'bridge-check.txt' && f.deleted), 'its test message deleted after, its file too', st.deleted.slice(-1))
    ok(r.checks.every((x) => typeof x.label === 'string' && 'detail' in x && 'fix' in x), 'each check with its label, detail and fix')
    const again = await kit.api(`/connections/${C}/check`)
    ok(again.at === r.at && again.state === 'ok', 'the last result, read back', again.state)
  })

  // ---------- Each going wrong ----------
  await part('a scope missing', async () => {
    await slack.scopes({ app: 'A1', scopes: ALL.filter((x) => x !== 'reactions:write') })
    const r = await check(C)
    ok(by(r).scopes?.state === 'warn' && /reactions:write/.test(by(r).scopes.detail) && /Update Your Slack App/.test(by(r).scopes.fix), 'a scope missing: said, with Update Your Slack App', by(r).scopes)
    ok(by(r).reactions?.state === 'warn' && /reactions:write/.test(by(r).reactions.detail), 'and reactions can\'t be made', by(r).reactions)
    const u = await kit.api(`/connections/${C}/manifest-url`)
    ok(u.update === true && u.missing.includes('reactions:write') && /^https:\/\/api\.slack\.com\/apps\/A1\/app-manifest$/.test(u.url || '') && u.manifest?.oauth_config?.scopes?.bot.includes('reactions:write'), 'where to update it: the app\'s App Manifest page, with the manifest', { url: u.url, update: u.update })
    await slack.scopes({ app: 'A1' })
    await check(C)
  })
  await part('events not reaching it', async () => {
    await slack.deaf({ app: 'A1' })
    const r = await check(C)
    ok(by(r).events?.state === 'fail' && /didn't send this copy the event/.test(by(r).events.detail) && /Event Subscriptions/.test(by(r).events.fix || ''), 'Slack sending no events: said, with what to check', by(r).events)
    await slack.deaf({ app: 'A1', on: false })
  })
  await part('a 429 reading a thread', async () => {
    await slack.limit({ method: 'conversations.replies', n: 1, wait: 3 })
    const r = await check(C)
    ok(by(r).reads?.state === 'warn' && /wait 3 s/.test(by(r).reads.detail) && /Marketplace/.test(by(r).reads.detail), 'a read Slack held back: a warning that says why', by(r).reads)
    await sleep(3200)
  })
  await part('files and status', async () => {
    await slack.fail({ method: 'files.completeUploadExternal', error: 'invalid_arguments' })
    await slack.fail({ method: 'agents.sessions.setStatus', error: 'unknown_method' })
    await slack.fail({ method: 'assistant.threads.setStatus', error: 'unknown_method' })
    const r = await check(C)
    ok(by(r).files?.state === 'fail' && /Couldn't send a file/.test(by(r).files.detail), 'a file Slack wouldn\'t take: said', by(r).files)
    ok(by(r).status?.state === 'warn' && /unknown_method/.test(by(r).status.detail) && /declares the app an agent/.test(by(r).status.fix || ''), 'the working status unknown to Slack: a warning, to update the app', by(r).status)
  })
  await part('another copy on the same app', async () => {
    // Another copy of Bridge AI: a connection of its own to the same app.
    const open = await (await fetch(`${slack.url}/api/apps.connections.open`, { method: 'POST', headers: { authorization: 'Bearer xapp-test' } })).json()
    const other = new WebSocket(open.url)
    const got = []
    other.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.envelope_id) { got.push(m); other.send(JSON.stringify({ envelope_id: m.envelope_id })) } })
    await new Promise((r) => other.once('open', r))
    const r = await check(C)
    ok(by(r).socket?.state === 'warn' && /another connection open for this app/.test(by(r).socket.detail) && /Quit Bridge AI on the other computer/.test(by(r).socket.fix), 'another copy: said, with what to do', by(r).socket)
    const v = await conn(C)
    ok(v.others?.n === 1 && v.numConnections >= 3, 'and on the connection', { others: v.others, n: v.numConnections })
    ok(!!(await postedIn('D0OWNER', /Another copy of Bridge AI .* is connected to this Slack app too/)), 'said to you in your direct messages')
    // Each message goes to one of them: some go to the other copy.
    for (let i = 0; i < 4; i++) await slack.ask({ user: 'U0DANA', channel: 'C0LAUNCH', text: `just chatting ${i}` })
    ok(!!(await until(() => got.some((m) => /just chatting/.test(m.payload?.event?.text || '')), 5000)), 'Slack gives some of the messages to the other copy, as it does')
    other.close()
    await sleep(500)
    const lists = slack.calls().filter((x) => x.method === 'users.conversations').length
    const h0 = (await slack.state()).hellos
    await slack.refresh({ app: 'A1' })
    ok(!!(await until(async () => (await conn(C)).others === null, 10000)), 'gone: said so at Slack\'s next hello')
    await until(async () => (await slack.state()).hellos > h0, 5000)
    await sleep(1500)
    ok(slack.calls().filter((x) => x.method === 'users.conversations').length === lists, 'a refresh Slack asked for leaves no gap: nothing read back for it')
  })
  await part('Socket Mode off', async () => {
    await slack.linkoff({ app: 'A1' })
    const v = await until(async () => { const c = await conn(C); return c.state === 'error' ? c : null }, 10000)
    ok(/Socket Mode is turned off/.test(v?.why || ''), 'Socket Mode turned off: the connection says so', v?.why)
    const r = await check(C)
    ok(by(r).socket?.state === 'fail' && /Socket Mode is turned off/.test(by(r).socket.detail), 'and the test', by(r).socket)
    await kit.api(`/connections/${C}/connect`, {})
    ok(!!(await until(async () => (await conn(C)).state === 'connected', 15000)), 'Connect: connected again')
  })
  await part('a channel it isn\'t in', async () => {
    await kit.api(`/connections/${C}`, { defaults: [{ id: 'C0NOTIN', name: 'not-here', bot: PD }] }, 'PATCH')
    const r = await check(C)
    ok(by(r).channels?.state === 'warn' && /#not-here \(Pricing Desk's channel\)/.test(by(r).channels.detail) && /\/invite @bridge_ai/.test(by(r).channels.fix), 'a channel\'s bot where the app isn\'t: said, with /invite', by(r).channels)
    await kit.api(`/connections/${C}`, { defaults: [] }, 'PATCH')
  })
  await part('paused', async () => {
    fs.writeFileSync(path.join(kit.data, 'connections', C, 'connection.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(kit.data, 'connections', C, 'connection.json'), 'utf8')), paused: true, pausedWhy: 'Moved to Laptop', pausedBy: 'move:m1' }))
    await sleep(1100)
    const r = await check(C)
    ok(by(r).here?.state === 'fail' && /Moved to Laptop/.test(by(r).here.detail) && /computer it moved to/.test(by(r).here.fix), 'a connection moved to another computer: said first', by(r).here)
    const j = JSON.parse(fs.readFileSync(path.join(kit.data, 'connections', C, 'connection.json'), 'utf8'))
    delete j.paused; delete j.pausedWhy; delete j.pausedBy
    fs.writeFileSync(path.join(kit.data, 'connections', C, 'connection.json'), JSON.stringify(j))
  })
  await part('held to a read a minute', async () => {
    // (A distributed app outside the Marketplace: Slack holds its reads of a conversation back.)
    await slack.limit({ method: 'conversations.history', n: 1, wait: 25 })
    await slack.drop()
    const v = await until(async () => { const c = await conn(C); return c.limited ? c : null }, 20000)
    ok(v?.limited?.method === 'conversations.history' && v.limited.wait === 25 && v.catchingUp?.waiting === 25, 'reading back what was missed, Slack holding it back: said on the connection, and the read waits as long as Slack says', v && { limited: v.limited, catchingUp: v.catchingUp })
    ok((await routedOf(C)).some((e) => e.event === 'rate-limited' && /one read a minute/.test(e.why || '')), 'and in its record, plainly')
  })

  // ---------- Discord: the basic checks ----------
  await part('Discord', async () => {
    const D = (await kit.api('/connections', { platform: 'discord', name: 'tester_bot' })).id
    let r = await check(D)
    ok(by(r).tokens?.state === 'fail' && by(r).owner?.state === 'skip' && by(r).routing?.state, 'no token: said, the rest skipped', states(r))
    await kit.api(`/connections/${D}/tokens`, { token: 'dtest.bot-one.0123456789abcdef', guild: '3001' })
    r = await check(D)
    ok(by(r).tokens?.state === 'ok' && by(r).owner?.state === 'warn' && ['ok', 'warn'].includes(by(r)[`bot:${PD}`]?.state) && !('events' in by(r)), 'a token: ok; nobody linked as you; its bot; nothing of Slack\'s', states(r))
  })

  const all = [JSON.stringify(await kit.api('/connections')), fs.readFileSync(path.join(kit.data, 'connections', C, 'check.json'), 'utf8')].join('\n')
  ok(!/xoxb-test|xapp-test|dtest\.bot-one/.test(all), 'no token in what\'s shown or kept of a test')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await kit.stop()
  slack.stop()
  dc.stop()
}
process.exit(done().fail ? 1 : 0)
