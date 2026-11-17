// Bots in Discord, the client on its own (server/discordbot.js, and connector.js's shared parts),
// against a stand-in Discord (stand-ins/discord.mjs: its REST API and Gateway, on this computer).
//   A token: a wrong one is said at once and nothing's kept; a right one is kept for you only, and
//   never shown, logged or put in what's heard. Connecting: Identify with the four intents it
//   needs, heartbeats acknowledged; Message Content off in the Developer Portal is said, before
//   connecting (the app's flags) and when Discord closes for it (4014), with how to fix it, and
//   not tried again until it's on. Who asked: a member by their name; someone still to pass the
//   server's screening and a guest, guests; someone not in the server, or in another server,
//   external; a lookup that failed, or no server set, unknown (connector.js keeps it so). What's
//   heard: a mention, a direct message, a reply to the bot, and a message in a thread it follows;
//   not the rest, nor bots or webhooks. Replies: in a thread started from the question (or in the
//   channel, said, where it can't start one), in parts past 2,000 characters with code blocks kept
//   whole, pinging no one; a 429 waited out, then said with how long; a part posted once even when
//   tried again. Reactions on the message where it is; edits; typing; context (a thread with the
//   message it started from, a channel's latest with its pins, a direct message's, the message a
//   question replied to). Edits and deletions in its threads. Connections: dropped (resumed, and
//   what was sent meanwhile heard once), asked to reconnect, an invalid session (a fresh one, what
//   was asked meanwhile read back), gone quiet (no acknowledgement: ended, and resumed once back),
//   a token turned down (not tried again). Bridge AI closed: what was asked meanwhile, read back
//   late. People to pick, with Server Members Intent and without (those who've written, and why).
//   Several connectors as one channel (connector.js combine): ids kept apart by platform.
import fs from 'node:fs'
import path from 'node:path'
import { checks, until, sleep, startDiscord, OUT, IS_WIN } from '../lib/harness.mjs'

const { ok, done } = checks('discord-client')
const dc = await startDiscord('discord-client')
process.env.BRIDGE_DISCORD_URL = dc.url
const { makeDiscord, WANTED, plainText, invite, PERMISSIONS } = await import('../../server/discordbot.js')
const { combine, split, person, heard: heardOf } = await import('../../server/connector.js')

const DIR = path.join(OUT, 'discord-client')
fs.rmSync(DIR, { recursive: true, force: true })
fs.mkdirSync(DIR, { recursive: true })
const T1 = 'dtest.bot-one.0123456789abcdef'
const T2 = 'dtest.bot-two.0123456789abcdef'
const events = []
const heard = []
const changes = []
const followed = new Set()
const mk = (name) => makeDiscord({
  id: name, file: path.join(DIR, `${name}.json`), say: (e) => events.push({ bot: name, ...e }),
  threads: () => [...followed].map((k) => { const [channel, thread] = k.split(':'); return { channel, thread } }),
  follows: (c, t) => followed.has(`${c}:${t}`),
})
const listen = (bot) => Object.assign((m) => { heard.push({ bot, ...m }) }, { change: (m) => changes.push({ bot, ...m }) })
const heardLike = (re, ms = 8000) => until(() => heard.find((m) => re.test(m.text)), ms, 50)
const st = () => dc.state()
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const mode = (f) => fs.statSync(f).mode & 0o777
let d1 = null
let d2 = null

try {
  // ---------- connector.js on its own ----------
  await part('the shared parts', async () => {
    ok(plainText('<@1001> what about <@2002> in <#4001>? <:party:123> <t:0:R>', { me: '1001', mentions: [{ id: '2002', global_name: 'Sam Okafor', member: { nick: 'Sam' } }], channels: { 4001: { name: 'launch' } } }) === 'what about @Sam in #launch? :party: 1970-01-01T00:00:00.000Z', 'Discord\'s markup as plain words: its own mention taken out, others by name')
    const long = `${'Intro paragraph. '.repeat(40)}\n\n\`\`\`js\n${'const x = 1 // a line of code\n'.repeat(120)}\`\`\`\n\n${'The end of it. '.repeat(30)}`
    const parts = split(long, 2000)
    ok(parts.length >= 3 && parts.every((x) => x.length <= 2000) && parts.every((x) => ((x.match(/^```/gm) || []).length % 2) === 0), 'a long reply in parts of 2,000 characters at most, each code block closed and opened again', parts.map((x) => x.length))
    ok(parts.join('').replace(/```(js)?\n?/g, '').replace(/\s+/g, '') === long.replace(/```(js)?\n?/g, '').replace(/\s+/g, ''), 'and nothing lost between them')
    ok(split('short', 2000).length === 1 && split('', 2000)[0] === '', 'a short one is one part')
    const p = person({ name: 'Nobody' })
    ok(p.unknown === true && p.id === null && !!p.why, 'someone without an id is unknown (fails closed), with why', p)
    ok(person({ id: 'x', unknown: true, guest: false }).unknown === true && person({ id: 'x', guest: 'yes' }).guest === false, 'unknown stays unknown, and only true makes a guest')
    ok(heardOf({ channel: 'c' }) === null && heardOf({ ts: '1' }) === null && heardOf(null) === null, 'a message with no id or no place is malformed: null')
  })

  // ---------- A token ----------
  d1 = mk('d1')
  const f1 = path.join(DIR, 'd1.json')
  const bad = await d1.setToken({ token: 'dtest.not-a-real-token-000000' }).then(() => null, (e) => e)
  ok(/The bot token: Discord turned the bot token down/.test(bad?.message || '') && !fs.existsSync(f1), 'a wrong token is said at once, and nothing is kept', bad?.message)
  const short = await d1.setToken({ token: 'nope' }).then(() => null, (e) => e)
  ok(/doesn't look like a bot token/.test(short?.message || ''), 'something that isn\'t a token is said to be one it doesn\'t look like', short?.message)
  let s = await d1.setToken({ token: `Bot ${T1}` })
  ok(fs.existsSync(f1) && JSON.parse(fs.readFileSync(f1, 'utf8')).token === T1 && (IS_WIN || mode(f1) === 0o600), 'a right token is kept, without "Bot ", readable by you only', IS_WIN ? null : mode(f1).toString(8))
  ok(s.tokens?.bot === '…cdef' && !JSON.stringify(s).includes(T1), 'and shown only as its last four', s.tokens)
  ok(s.bot?.id === '1001' && s.bot.name === 'Bridge AI' && s.guilds.length === 2 && s.guild === null, 'who the bot is, and the two servers it\'s in, with none picked for it', s)
  ok(s.intents?.content === true && s.intents.members === true && s.intents.missing.length === 0, 'both privileged intents on, from its app\'s flags', s.intents)
  ok(s.invite === invite('1001') && s.invite.includes('client_id=1001') && s.invite.includes(`permissions=${PERMISSIONS}`) && s.invite.includes('scope=bot'), 'the invite link, to add it to a server with what it needs', s.invite)
  ok(BigInt(PERMISSIONS) === ((1n << 6n) | (1n << 10n) | (1n << 11n) | (1n << 15n) | (1n << 16n) | (1n << 35n) | (1n << 38n)), 'asking to see channels, read history, send, start threads and write in them, react and attach', PERMISSIONS)
  ok(!!(await d1.setGuild('3001').then((x) => x.guild?.name === 'Acme', () => false)) && !!(await d1.setGuild('9999').then(() => false, () => true)), 'the server it answers in is picked from the ones it\'s in, and only those')

  // ---------- Connecting ----------
  await dc.heartbeat({ ms: 600 })
  d1.start(listen('d1'))
  s = await until(() => (d1.state().state === 'connected' ? d1.state() : null), 15000, 50)
  ok(!!s, 'it connects', d1.state())
  const id1 = (await st()).identified.find((x) => x.app === 'D1')
  ok(id1?.intents === WANTED && WANTED === (1 | 1 << 9 | 1 << 12 | 1 << 15) && id1.properties?.browser === 'Bridge AI', 'identifying with servers, their messages, direct messages and Message Content', id1)
  ok(!!(await until(async () => (await st()).acks >= 2, 5000, 100)), 'its heartbeats are sent and acknowledged')
  ok(events.some((e) => e.bot === 'd1' && e.what === 'connected' && e.ok), 'and says it connected, for the record')

  // ---------- What's heard, and who asked ----------
  await part('who asked', async () => {
    const q1 = await dc.say({ user: '2001', text: '<@1001> what\'s the enterprise price?' })
    const m = await heardLike(/enterprise price/)
    ok(m?.mention === true && m.dm === false && m.channel === '4001' && m.thread === null && m.ts === q1.id, 'a mention in #launch is heard, at the top of the channel', m)
    ok(m?.from?.id === '2001' && m.from.name === 'Dana' && !m.from.guest && !m.from.external && !m.from.unknown, 'from a member, by their name in the server', m?.from)
    ok(m?.text === 'what\'s the enterprise price?' && m.place?.kind === 'channel' && m.place.name === 'launch' && m.place.within === 'Acme', 'its words without the mention, and where: #launch in Acme', m)
    ok(m?.reply?.start === true && m.reply.message === q1.id && m.reply.channel === '4001' && m.reply.thread === q1.id, 'its reply to go in a thread started from it', m?.reply)
    await dc.say({ user: '2002', text: 'just talking among ourselves' })
    await dc.say({ user: '2007', text: '<@1001> a bot asking' })
    await dc.say({ user: '2003', text: '<@1001> a webhook asking', webhook: true })
    await dc.say({ user: '2001', dm: true, text: 'a direct question' })
    const dm = await heardLike(/a direct question/)
    ok(dm?.dm === true && dm.place.kind === 'dm' && dm.reply.thread === null && !dm.from.external, 'a direct message is heard, from a member', dm)
    ok(!heard.some((x) => /among ourselves|a bot asking|a webhook asking/.test(x.text)), 'a channel message not to it, a bot and a webhook aren\'t heard', heard.map((x) => x.text))
    await dc.say({ user: '2005', text: '<@1001> I just joined' })
    await dc.say({ user: '2006', text: '<@1001> guest here' })
    await dc.say({ user: '2009', dm: true, text: 'from outside, directly' })
    await dc.say({ user: '2009', channel: '4101', text: '<@1001> from the other server' })
    const pat = await heardLike(/just joined/)
    const gwen = await heardLike(/guest here/)
    const xena = await heardLike(/from outside, directly/)
    const lobby = await heardLike(/from the other server/)
    ok(pat?.from.guest === true && /screening/.test(pat.from.why), 'someone still to pass the server\'s screening is a guest', pat?.from)
    ok(gwen?.from.guest === true, 'and so is a guest', gwen?.from)
    ok(xena?.from.external === true && /Not a member/.test(xena.from.why), 'someone not in the server writing directly is external', xena?.from)
    ok(lobby?.from.external === true && /another server/.test(lobby.from.why), 'and so is someone in another server', lobby?.from)
    await dc.fail({ route: 'GET /guilds/:id/members/:id', status: 500, n: 1 })
    await dc.say({ user: '2002', dm: true, text: 'lookup goes wrong' })
    const sam = await heardLike(/lookup goes wrong/)
    ok(sam?.from.unknown === true && /Couldn't check who they are/.test(sam.from.why), 'a lookup that failed: unknown, saying why (refused, never answered)', sam?.from)
    const answer = (await st()).posted.length
    void answer
  })

  // ---------- Replies ----------
  let q1 = null
  let thread = null
  await part('replies', async () => {
    q1 = heard.find((m) => /enterprise price/.test(m.text))
    const r = await d1.post(q1.reply, 'Enterprise is $40 a seat. @everyone should know.')
    const state = await st()
    thread = state.threads.find((t) => t.id === q1.ts)
    ok(thread?.parent === '4001' && /enterprise price/.test(thread.name) && r.channel === q1.ts, 'a thread is started from the question, named after it, and the answer goes in there', { thread, r })
    const p = state.posted.find((x) => x.id === r.ts)
    ok(p?.channel === q1.ts && p.in_thread === '4001' && JSON.stringify(p.allowed_mentions?.parse) === '[]', 'posted in the thread, pinging no one (not even @everyone)', p)
    const again = await d1.post(q1.reply, 'And yearly billing.')
    ok(again.channel === q1.ts && (await st()).threads.filter((t) => t.id === q1.ts).length === 1, 'a second reply to it goes in the same thread', again)
    followed.add(`4001:${q1.ts}`)
    await dc.say({ user: '2001', thread: q1.ts, text: 'and for 500 seats?' })
    const f = await heardLike(/500 seats/)
    ok(f?.mention === false && f.channel === '4001' && f.thread === q1.ts && f.reply.thread === q1.ts && !f.reply.start, 'a reply in a thread it follows is heard without a mention, as in that thread', f)
    const q2 = await dc.say({ user: '2002', text: '<@1001> a question nobody follows up' })
    await heardLike(/nobody follows up/)
    await d1.post(heard.find((m) => /nobody follows up/.test(m.text)).reply, 'ok')
    await dc.say({ user: '2002', thread: q2.id, text: 'unfollowed chatter' })
    await sleep(600)
    ok(!heard.some((m) => /unfollowed chatter/.test(m.text)), 'one in a thread it doesn\'t follow isn\'t')
    const dm = heard.find((m) => /a direct question/.test(m.text))
    const rd = await d1.post(dm.reply, 'Here you are.')
    ok((await st()).posted.find((x) => x.id === rd.ts)?.channel === dm.reply.channel, 'a direct message is answered in the direct message', rd)
    // A reply to the bot, without a mention, is for it.
    await dc.say({ user: '2003', channel: '4001', reply: r.ts, text: 'thanks, and the discount?' })
    ok((await heardLike(/the discount/))?.mention === true, 'a reply to one of its messages is heard as one to it')
    // A channel where it may not start threads: the answer goes in the channel, said.
    await dc.noThreads({ channel: '4002' })
    await dc.say({ user: '2001', channel: '4002', text: '<@1001> in general' })
    const g = await heardLike(/in general/)
    const rg = await d1.post(g.reply, 'Answered in the channel.')
    const pg = (await st()).posted.find((x) => x.id === rg.ts)
    ok(pg?.channel === '4002' && pg.message_reference?.message_id === g.ts && events.some((e) => e.what === 'threads' && /went in the channel/.test(e.why)), 'where it can\'t start a thread, it answers the question in the channel, and says so', { pg, ev: events.filter((e) => e.what === 'threads') })
    // A long answer, in parts.
    const long = `Here's the plan.\n\n${'A sentence about the plan that goes on. '.repeat(60)}\n\n\`\`\`\n${'step();\n'.repeat(300)}\`\`\``
    const rl = await d1.post(q1.reply, long)
    const parts = (await st()).posted.filter((x) => rl.parts.includes(x.id))
    ok(rl.parts.length >= 3 && parts.length === rl.parts.length && parts.every((x) => x.content.length <= 2000 && x.channel === q1.ts), 'a long answer goes in parts of at most 2,000 characters, in the thread', rl.parts.length)
    // Edited: longer, then shorter.
    const e1 = await d1.edit(rg, `${'More. '.repeat(400)}`)
    ok(e1.parts.length === 2 && e1.parts[0] === rg.ts && (await st()).edited.some((x) => x.id === rg.ts), 'an edit that makes it longer edits the first part and adds one', e1)
    const e2 = await d1.edit(e1, 'Short again.')
    ok(e2.parts.length === 1 && (await st()).deleted.some((x) => x.id === e1.parts[1]), 'and one that makes it shorter takes the extra part away', e2)
  })

  await part('rate limits and errors', async () => {
    const t0 = Date.now()
    await dc.limit({ route: 'POST /channels/:id/messages', n: 1, wait: 0.4 })
    const r = await d1.post(q1.reply, 'After a wait.')
    ok(!!r.ts && Date.now() - t0 >= 400, 'a 429 is waited out as long as Discord says, then posted', Date.now() - t0)
    await dc.limit({ route: 'POST /channels/:id/messages', n: 3, wait: 1 })
    const e = await d1.post(q1.reply, 'Too soon.').then(() => null, (x) => x)
    ok(e?.code === 'ratelimited' && e.retryAfter === 1 && /wait 1 s/.test(e.message), 'one that goes on is said, with how long to wait (for the desk to try again)', e && { code: e.code, retryAfter: e.retryAfter, message: e.message })
    await sleep(1100)
    await dc.limit({ route: 'POST /channels/:id/messages', n: 0 })
    await dc.fail({ route: 'POST /channels/:id/messages', status: 403, code: 50013, message: 'Missing Permissions', n: 1 })
    const p = await d1.post(q1.reply, 'Not allowed.').then(() => null, (x) => x)
    ok(p?.code === 'missing_permissions' && /lacks a permission/.test(p.message), 'a permission it lacks is said, as one not worth trying again', p?.code)
    await dc.fail({ route: 'POST /channels/:id/messages', status: 502, code: 0, message: 'Bad Gateway', n: 1 })
    const g = await d1.post(q1.reply, 'Discord down.').then(() => null, (x) => x)
    ok(g?.code === 'http_502', 'Discord failing is said as one to try again', g?.code)
    // Stopped partway through a long one: tried again, it goes on from there.
    const long = Array.from({ length: 700 }, (_, i) => `Part ${i}.`).join(' ')
    const before = (await st()).posted.length
    // (Its first part posted, its second turned away: tried again, it goes on from the second.)
    await dc.fail({ route: 'POST /channels/:id/messages', status: 500, n: 1, after: 1 })
    const first = await d1.post(q1.reply, long).then(() => null, (x) => x)
    ok(first?.code === 'http_500' && (await st()).posted.length === before + 1, 'a long reply that stops partway says so, its first part posted', first?.code)
    const lp = await d1.post(q1.reply, long).then((x) => x, (x) => x)
    const posted = (await st()).posted.slice(before)
    ok(!!lp.parts && lp.parts.length >= 3 && posted.length === lp.parts.length && new Set(posted.map((x) => x.content)).size === posted.length && lp.parts[0] === posted[0].id, 'tried again, it goes on from there: each part posted once', { parts: lp.parts?.length, posted: posted.length })
  })

  await part('reactions, typing, context', async () => {
    await d1.react({ channel: '4001', ts: q1.ts, name: 'eyes' })
    const f = heard.find((m) => /500 seats/.test(m.text))
    await d1.react({ channel: '4001', ts: f.ts, name: 'eyes' })
    let r = (await st()).reactions
    ok(r.some((x) => x.id === q1.ts && x.channel === '4001' && x.emoji === '👀') && r.some((x) => x.id === f.ts && x.channel === q1.ts && x.emoji === '👀'), '👀 on the question, and on one in a thread where it is (the thread)', r)
    await d1.react({ channel: '4001', ts: q1.ts, name: 'white_check_mark' })
    await d1.react({ channel: '4001', ts: q1.ts, name: 'eyes', off: true })
    r = (await st()).reactions
    ok(r.some((x) => x.id === q1.ts && x.emoji === '✅') && !r.some((x) => x.id === q1.ts && x.emoji === '👀'), '✅ once answered, and 👀 taken off', r)
    ok(await d1.typing(f.reply) === true && (await st()).typing.some((x) => x.channel === q1.ts), 'typing… where it was asked')
    // Context: the thread, with the message it was started from, and its own answers as its own.
    const c = await d1.context({ channel: '4001', thread: q1.ts, ts: f.ts })
    ok(c.kind === 'thread' && /enterprise price/.test(c.messages[0]?.text) && c.messages.some((m) => m.you && /\$40 a seat/.test(m.text)) && !c.messages.some((m) => m.ts === f.ts), 'a thread\'s context: the question it started from, its answers as its own, nothing from the question on', c.messages.map((m) => [m.you, m.text.slice(0, 30)]))
    const since = c.messages.find((m) => /\$40 a seat/.test(m.text)).ts
    const c2 = await d1.context({ channel: '4001', thread: q1.ts, ts: f.ts, since })
    ok(!c2.messages.some((m) => /enterprise price|\$40 a seat/.test(m.text)) && c2.messages.length >= 1, 'going on from an earlier answer: only what came since', c2.messages.map((m) => m.text.slice(0, 30)))
    const said = await dc.say({ user: '2003', text: 'The launch is on Friday.' })
    await dc.pin({ channel: '4001', id: said.id })
    const q3 = await dc.say({ user: '2002', reply: said.id, text: '<@1001> is this right?' })
    const h = await heardLike(/is this right/)
    const c3 = await d1.context({ channel: '4001', thread: null, ts: q3.id })
    ok(h?.ts === q3.id && c3.kind === 'channel' && c3.messages.at(-1)?.text === 'The launch is on Friday.' && c3.pins.some((p) => p.text === 'The launch is on Friday.') && !c3.problem, 'a question at the top of a channel: its latest messages, the one it replied to, and what\'s pinned', c3)
    const order = c3.messages.map((m) => BigInt(m.ts))
    ok(order.every((x, i) => !i || x > order[i - 1]) && c3.messages.length <= 20, 'oldest first, at most 20')
    const dm = heard.find((m) => /a direct question/.test(m.text))
    const c4 = await d1.context({ channel: dm.channel, thread: null, ts: dm.ts, dm: true })
    ok(c4.kind === 'dm' && Array.isArray(c4.messages) && !c4.pins.length, 'a direct message\'s context, without pins', c4)
  })

  await part('edits and deletions', async () => {
    const f = heard.find((m) => /500 seats/.test(m.text))
    await dc.edit({ channel: q1.ts, id: f.ts, text: 'and for 600 seats?' })
    await dc.remove({ channel: q1.ts, id: f.ts })
    const ch = await until(() => (changes.some((x) => x.kind === 'changed' && x.ts === f.ts) && changes.some((x) => x.kind === 'deleted' && x.ts === f.ts) ? changes : null), 5000, 50)
    const e = ch?.find((x) => x.kind === 'changed' && x.ts === f.ts)
    ok(e?.text === 'and for 600 seats?' && e.channel === '4001' && e.thread === q1.ts && e.from?.id === '2001', 'an edit in its thread is handed over, with what it says now', e)
    ok(!!ch?.find((x) => x.kind === 'deleted' && x.ts === f.ts && x.thread === q1.ts), 'and a deletion')
  })

  // ---------- Connections ----------
  await part('connections', async () => {
    let was = await st()
    await dc.drop()
    const q = await dc.say({ user: '2001', text: '<@1001> asked while it reconnects' })
    ok(!!(await until(async () => (await st()).resumes > was.resumes && d1.state().state === 'connected', 15000, 100)), 'a connection dropped is resumed, not started again', { state: d1.state(), was })
    ok((await st()).identifies === was.identifies, 'with no new Identify')
    await until(() => heard.some((m) => m.ts === q.id), 8000, 50)
    await sleep(300)
    ok(heard.filter((m) => m.ts === q.id).length === 1, 'what was sent meanwhile is heard, once', heard.filter((m) => m.ts === q.id).length)
    was = await st()
    await dc.reconnect()
    ok(!!(await until(async () => (await st()).resumes > was.resumes && d1.state().state === 'connected', 15000, 100)), 'Discord asking for a new connection: resumed at once')
    was = await st()
    await dc.invalid({ resumable: false })
    const q2 = await dc.say({ user: '2003', text: '<@1001> asked during a new session' })
    ok(!!(await until(async () => (await st()).identifies > was.identifies && d1.state().state === 'connected', 15000, 100)), 'an invalid session: a new one is started (Identify)')
    const late = await until(() => heard.find((m) => m.ts === q2.id), 10000, 50)
    ok(late?.late === true, 'and what was asked meanwhile is read back, late', late)
    // Gone quiet: no acknowledgements. Ended, tried again, and resumed once back.
    was = await st()
    await dc.away()
    ok(!!(await until(() => d1.state().state === 'reconnecting' && /quiet/.test(d1.state().why || '') ? true : null, 8000, 50)), 'a connection that goes quiet (heartbeats unacknowledged) is noticed', d1.state())
    const q3 = await dc.say({ user: '2001', text: '<@1001> asked while it was away' })
    await dc.back()
    ok(!!(await until(async () => d1.state().state === 'connected' && (await st()).resumes > was.resumes, 20000, 100)), 'and once back, resumed', d1.state())
    ok(!!(await until(() => heard.find((m) => m.ts === q3.id), 8000, 50)), 'what was asked while it was away is heard')
    // A token turned down: said, and not tried again.
    was = await st()
    await dc.close({ code: 4004 })
    await until(() => d1.state().state === 'error', 5000, 50)
    await sleep(2500)
    ok(d1.state().state === 'error' && /Reset Token/.test(d1.state().why) && (await st()).identifies === was.identifies && (await st()).hellos === was.hellos, 'Discord turning the token down is said with how to fix it, and not tried again', d1.state())
    d1.stop()
    ok(d1.state().state === 'off', 'stopped')
  })

  await part('Bridge AI closed', async () => {
    const q = await dc.say({ user: '2002', text: '<@1001> asked while Bridge AI was closed' })
    const dmq = await dc.say({ user: '2001', dm: true, text: 'a direct one while closed' })
    await dc.say({ user: '2002', text: 'and one not for it' })
    const d1b = mk('d1')
    const n = heard.length
    d1b.start(listen('d1'))
    ok(!!(await until(() => d1b.state().state === 'connected', 15000, 50)), 'started again with the token it kept')
    const a = await until(() => heard.find((m) => m.ts === q.id), 10000, 50)
    const b = await until(() => heard.find((m) => m.ts === dmq.id), 10000, 50)
    ok(a?.late === true && b?.late === true, 'what was asked meanwhile, in a channel and directly, is read back, late', { a: a?.late, b: b?.late })
    await sleep(500)
    ok(!heard.slice(n).some((m) => /not for it/.test(m.text)) && heard.slice(n).filter((m) => m.ts === q.id).length === 1, 'only what was for it, once', heard.slice(n).map((m) => m.text))
    ok(!heard.slice(n).some((m) => /enterprise price/.test(m.text)), 'and nothing it had heard before')
    const people = await d1b.people()
    ok(people.map((p) => p.name).join() === 'Dana,Eve,Sam Okafor,Tester' && !people.problem, 'its people, to pick: members only (no bots, guests, or anyone still to pass screening)', people)
    d1b.stop()
  })

  // ---------- Message Content off ----------
  await part('privileged intents', async () => {
    d2 = mk('d2')
    let s2 = await d2.setToken({ token: T2 })
    ok(s2.guild?.name === 'Acme' && s2.intents.content === false && s2.intents.missing.includes('Message Content Intent'), 'a bot in one server has it picked; Message Content off is known from its app', s2)
    d2.start(listen('d2'))
    await until(() => d2.state().state === 'error', 8000, 50)
    ok(d2.state().state === 'error' && /Message Content Intent/.test(d2.state().why) && /Developer Portal/.test(d2.state().why), 'and said, with where to turn it on, before connecting', d2.state())
    ok(!(await st()).identified.some((x) => x.app === 'D2'), 'without trying to connect')
    // Its flags unknown: Discord closes for it (4014), said the same way, not tried again.
    d2.stop()
    await dc.fail({ route: 'GET /oauth2/applications/@me', status: 500, n: 5 })
    const d2b = mk('d2')
    const hellos = (await st()).hellos
    d2b.start(listen('d2'))
    await until(() => d2b.state().state === 'error', 10000, 50)
    await sleep(2000)
    ok(d2b.state().state === 'error' && /Message Content Intent/.test(d2b.state().why) && (await st()).hellos === hellos + 1, 'with its flags unknown, Discord closing for it (4014) is said the same way, and not tried again', { state: d2b.state(), hellos: (await st()).hellos - hellos })
    d2b.stop()
    await dc.fail({ route: 'GET /oauth2/applications/@me', status: 500, n: 0 })
    await dc.intents({ app: 'D2', content: true })
    d2b.start(listen('d2'))
    ok(!!(await until(() => d2b.state().state === 'connected', 10000, 50)), 'turned on, and connected again: it connects')
    await dc.say({ user: '2003', dm: true, app: 'D2', text: 'hello atlas' })
    ok((await heardLike(/hello atlas/))?.bot === 'd2', 'and hears what\'s put to it')
    const people = await d2b.people()
    ok(people.some((p) => p.name === 'Eve') && /Server Members Intent/.test(people.problem || ''), 'without Server Members Intent: those who\'ve written to it, and why only those', people)
    d2b.forget()
    ok(!fs.existsSync(path.join(DIR, 'd2.json')) && d2b.state().state === 'no-tokens', 'forgotten: its token is gone')
  })

  // ---------- Several as one ----------
  await part('one channel of several', async () => {
    const got = []
    const fake = {
      start() {}, stop() {}, state: () => ({ state: 'connected', team: { id: 'T1' } }),
      post: async (reply, text) => ({ ts: 'S1', channel: reply.channel, text }), react: async () => {}, context: async (o) => ({ kind: 'channel', messages: [], pins: [], asked: o }), people: async () => [{ id: 'U0DANA', name: 'Dana' }],
    }
    fs.copyFileSync(path.join(DIR, 'd1.json'), path.join(DIR, 'b9.json')) // (the same bot, as part of one channel)
    const both = combine({ id: 'b9', follows: (c, t) => c === 'discord:4001' && t === q1.ts, threads: () => [{ channel: 'discord:4001', thread: q1.ts }, { channel: 'C0LAUNCH', thread: '1.2' }] }, { slack: () => fake, discord: (cb) => makeDiscord({ id: 'b9', file: path.join(DIR, 'b9.json'), ...cb }) })
    const disc = both.parts.discord
    both.start(Object.assign((m) => { got.push(m) }, { change: () => {} }))
    ok(!!(await until(() => disc.state().state === 'connected', 15000, 50)), 'its Discord part connects', disc.state())
    await dc.say({ user: '2001', thread: q1.ts, text: 'combined follow-up' })
    const m = await until(() => got.find((x) => /combined follow-up/.test(x.text)), 8000, 50)
    ok(m?.platform === 'discord' && m.channel === 'discord:4001' && m.from.id === 'discord:2001' && m.reply.platform === 'discord' && m.place.platform === 'discord', 'a Discord message through one channel: its platform said, its ids kept apart', m)
    ok(m?.thread === q1.ts, 'and the thread it follows (asked of the desk by the combined id)')
    const r = await both.post(m.reply, 'Combined answer.')
    ok((await st()).posted.some((x) => x.id === r.ts && x.channel === q1.ts) && r.platform === 'discord', 'a reply goes back through Discord, and says so')
    await both.edit(r, 'Combined answer, edited.')
    ok((await st()).edited.some((x) => x.id === r.ts && x.content === 'Combined answer, edited.'), 'and an edit of it goes back the same way')
    ok((await both.post({ channel: 'C0LAUNCH', thread: '1.2' }, 'slack one')).ts === 'S1', 'and a Slack one through Slack, its ids as they were')
    const c = await both.context({ channel: 'C0LAUNCH', thread: null, ts: '1.3' })
    ok(c.asked?.channel === 'C0LAUNCH', 'context asked of the right one, by its own ids')
    const ppl = await both.people()
    ok(ppl.some((p) => p.id === 'U0DANA' && p.platform === 'slack') && ppl.some((p) => p.id === 'discord:2001' && p.platform === 'discord'), 'people from each, told apart', ppl.map((p) => p.id))
    ok(both.state().platforms?.discord?.state === 'connected' && both.state().team?.id === 'T1', 'each one\'s state, and the first one\'s at the top')
    both.stop()
  })

  // ---------- No secret anywhere ----------
  const log = fs.readFileSync(dc.log, 'utf8')
  ok(!log.includes(T1) && !log.includes(T2), 'no token in what Discord was sent besides its header (the stand-in\'s log)')
  ok(!JSON.stringify(events).includes(T1) && !JSON.stringify(heard).includes(T1) && !JSON.stringify(changes).includes(T1), 'nor in anything said for the record, or heard')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  try { d1?.stop() } catch { /* stopped */ }
  try { d2?.stop() } catch { /* stopped */ }
  dc.stop()
}
process.exit(done().fail ? 1 : 0)
