// Bots in Microsoft Teams, the client on its own (server/teamsbot.js and teamsapp.js), against a
// stand-in for Microsoft (stand-ins/teams.mjs: the Bot Framework's signing keys, Microsoft Entra
// ID's token endpoint and the Bot Connector, on this computer).
//   Credentials: a wrong client secret, app ID or tenant is said at once and nothing's kept; right
//   ones are kept for you only and never shown, logged or sent anywhere but to sign in. Listening:
//   on this computer only, at /api/messages. Every activity's token checked before anything else:
//   none, garbage, a forged signature, a key Microsoft doesn't publish, one not endorsed for
//   Teams, another app's audience, another issuer, expired, not valid yet, another address's
//   serviceurl, alg none, HS256 with the public key, an address that isn't Microsoft's: each
//   turned away (401) and nothing heard, the count and the last reason kept, said in the record
//   once. Microsoft's keys read once, and again for a key it doesn't know (a new one), but not for
//   each made-up one. A malformed body (400), too big (413), the wrong method or path. Who asked:
//   a member by name and Entra ID; a guest; someone from another organization; no Entra ID, or a
//   lookup that failed: unknown. What's heard: a mention in a channel (thread kept), a chat with
//   the bot, a reply in a thread it follows; not the rest. Replies in the thread, escaped, with one
//   token reused; a 429 waited out, then said; Teams' errors said; an address not Microsoft's gets
//   nothing. Edits, typing for 👀, no reactions (said). Context from what it was sent, a quoted
//   message, and, in a thread it knows nothing of, why. People to pick, a page at a time, without
//   guests. The tunnel check. The Teams app: its manifest, two icons as Teams wants them, a zip,
//   its version raised when it changes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { checks, until, sleep, startTeams, OUT, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('teams-client')
const tm = await startTeams('teams-client')
process.env.BRIDGE_TEAMS_URL = tm.url
const { makeTeams, trustedService, plainText } = await import('../../server/teamsbot.js')
const { unzip } = await import('../../server/teamsapp.js')

const DIR = path.join(OUT, 'teams-client')
fs.rmSync(DIR, { recursive: true, force: true })
fs.mkdirSync(DIR, { recursive: true })
const FILE = path.join(DIR, 't1.json')
const { appId, password, tenantId } = tm.app
const events = []
const heard = []
const changes = []
const followed = new Set()
const t1 = makeTeams({ id: 't1', file: FILE, say: (e) => events.push(e), follows: (c, t) => followed.has(`${c}:${t}`), port: 0 })
const heardLike = (re, ms = 6000) => until(() => heard.find((m) => re.test(m.text)), ms, 50)
const st = () => tm.state()
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
let port = null

try {
  await part('addresses and words', async () => {
    ok(trustedService('https://smba.trafficmanager.net/amer/') && trustedService('https://smba.infra.gov.teams.microsoft.us/') && trustedService('https://europe.webchat.botframework.com/'), 'Microsoft\'s Bot Connector addresses are trusted')
    ok(!trustedService('http://smba.trafficmanager.net/amer/') && !trustedService('https://smba.trafficmanager.net.evil.test/') && !trustedService('https://evil.trafficmanager.net/') && !trustedService('https://u:p@smba.trafficmanager.net/') && !trustedService('not a url'), 'and nothing else: not over http, not a look-alike, not another Traffic Manager name, not with a password in it') // private-ok: a made-up address with a password in it, to check it's refused
    ok(plainText('<at>Atlas</at> what about <at>Sam</at>?&nbsp;It&#39;s &lt;soon&gt;<br>ok', { me: '28:x', mentions: [{ text: '<at>Atlas</at>', mentioned: { id: '28:x' } }, { text: '<at>Sam</at>', mentioned: { id: '29:sam' } }] }) === 'what about @Sam? It\'s <soon>\nok', 'Teams\' text as plain words: its own mention out, others by name, markup undone')
  })

  // ---------- Credentials ----------
  const bad = await t1.setCredentials({ appId, password: 'wrong-secret', tenantId }).then(() => null, (e) => e)
  ok(/turned the client secret down/.test(bad?.message || '') && !fs.existsSync(FILE), 'a wrong client secret is said at once (Value, not ID), and nothing is kept', bad?.message)
  const badTenant = await t1.setCredentials({ appId, password, tenantId: '33333333-3333-4333-8333-333333333333' }).then(() => null, (e) => e)
  ok(/no organization with that tenant ID/.test(badTenant?.message || ''), 'an unknown tenant is said', badTenant?.message)
  const badApp = await t1.setCredentials({ appId: '44444444-4444-4444-8444-444444444444', password, tenantId }).then(() => null, (e) => e)
  ok(/no app with that app ID/.test(badApp?.message || ''), 'an app ID that isn\'t there is said', badApp?.message)
  const notGuid = await t1.setCredentials({ appId: 'my-bot', password, tenantId }).then(() => null, (e) => e)
  ok(/GUID/.test(notGuid?.message || '') && !fs.existsSync(FILE), 'and one that isn\'t an app ID at all, before asking anyone', notGuid?.message)
  let s = await t1.setCredentials({ appId, password, tenantId })
  const kept = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  ok(kept.password === password && kept.appId === appId && kept.tenantId === tenantId && /^[0-9a-f-]{36}$/.test(kept.teamsAppId) && (IS_WIN || (fs.statSync(FILE).mode & 0o777) === 0o600), 'right ones are kept, readable by you only, with a Teams app ID of its own', IS_WIN ? null : (fs.statSync(FILE).mode & 0o777).toString(8))
  ok(s.tokens?.secret === '…et-1' && !JSON.stringify(s).includes(password), 'the secret shown only as its last four', s.tokens)

  // ---------- Listening ----------
  t1.start(Object.assign((m) => { heard.push(m) }, { change: (m) => changes.push(m) }))
  s = await until(() => (t1.state().state === 'connected' ? t1.state() : null), 10000, 50)
  ok(!!s && s.listening?.host === '127.0.0.1' && s.listening.port > 0, 'it listens, on this computer only, and signs in', t1.state())
  port = s?.listening?.port
  await tm.endpoint(`http://127.0.0.1:${port}/api/messages`)
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)
  if (!lan) skip('not reachable from the network', 'this computer has no network address')
  else ok(!!(await fetch(`http://${lan.address}:${port}/api/messages`, { method: 'POST', signal: AbortSignal.timeout(3000) }).then(() => false, () => true)), 'and can\'t be reached from the network: only through your tunnel', lan.address)
  ok((await st()).keyFetches === 1 && (await st()).metadataFetches === 1, 'Microsoft\'s signing keys read once, from the OpenID metadata', await st())

  // ---------- Every token checked ----------
  await part('tokens', async () => {
    const good = await tm.say({ user: 'dana', text: 'hello there' })
    const m = await heardLike(/hello there/)
    ok(good.status === 200 && m?.dm === true && m.from.id === 'aad-dana-0001' && m.from.name === 'Dana Reyes' && !m.from.guest && !m.from.external && !m.from.unknown, 'a message signed as Microsoft signs it is taken (200) and heard, from a member', { status: good.status, m })
    const wrong = ['none', 'garbage', 'bad-signature', 'not-endorsed', 'wrong-audience', 'wrong-issuer', 'expired', 'not-yet', 'serviceurl-mismatch', 'alg-none', 'hs256', 'untrusted-service']
    const why = {}
    for (const w of wrong) {
      const r = await tm.say({ user: 'dana', text: `forged: ${w}`, token: w })
      why[w] = { status: r.status, why: t1.state().rejected.why }
    }
    await sleep(300)
    ok(Object.values(why).every((x) => x.status === 401), 'each token wrong in any way is turned away (401)', why)
    ok(!heard.some((x) => /forged/.test(x.text)), 'and nothing of any of them is heard')
    const expect = { none: /No Bot Framework token/, garbage: /No Bot Framework token/, 'bad-signature': /signature doesn't match/, 'not-endorsed': /not endorsed for Teams/, 'wrong-audience': /another app/, 'wrong-issuer': /not the Bot Framework/, expired: /expired/, 'not-yet': /not valid yet/, 'serviceurl-mismatch': /another address/, 'alg-none': /not RS256/, hs256: /not RS256/, 'untrusted-service': /isn't Microsoft's/ }
    const off = Object.entries(expect).filter(([k, re]) => !re.test(why[k].why || ''))
    ok(!off.length, 'each for the right reason', off.map(([k]) => [k, why[k].why]))
    ok(t1.state().rejected.n === wrong.length, 'the count kept, for Settings', t1.state().rejected)
    ok(events.filter((e) => e.what === 'rejected').length === 1 && /turned away/.test(events.find((e) => e.what === 'rejected').why), 'said in the record once, not once for each (anyone can send junk)', events.filter((e) => e.what === 'rejected'))
    // A key Microsoft has just started using: read again, and taken.
    const before = (await st()).keyFetches
    await tm.rotate()
    const r = await tm.say({ user: 'dana', text: 'signed with a new key' })
    ok(r.status === 200 && !!(await heardLike(/new key/)) && (await st()).keyFetches === before + 1, 'a key Microsoft has just started using: its keys read again, and the message taken', { status: r.status, fetches: (await st()).keyFetches - before })
    // Made-up keys, many: not read again for each.
    const n = (await st()).keyFetches
    for (let i = 0; i < 5; i++) await tm.say({ user: 'dana', text: 'made-up key', token: 'unknown-kid' })
    ok((await st()).keyFetches === n && /doesn't publish/.test(t1.state().rejected.why), 'a flood of made-up keys doesn\'t make it read Microsoft\'s keys again each time', (await st()).keyFetches - n)
    // Bodies.
    ok((await tm.raw({ body: '{"type": "message", ' })).status === 400, 'a body that isn\'t JSON, with a good token: 400')
    ok((await tm.raw({ body: '[1,2]' })).status === 400, 'nor one that isn\'t an activity')
    ok((await tm.raw({ body: '{"type":"message"}', token: 'none' })).status === 401, 'without a token, even a well-formed one: 401')
    ok((await tm.raw({ body: `{"type":"message","text":"${'x'.repeat(300 * 1024)}"}` })).status === 413, 'one too big: 413')
    ok((await fetch(`http://127.0.0.1:${port}/api/messages`)).status === 405 && (await fetch(`http://127.0.0.1:${port}/api/bots`)).status === 404 && (await fetch(`http://127.0.0.1:${port}/`)).status === 404, 'the wrong method: 405; anywhere else: nothing there (404)')
  })

  // ---------- Who asked, and what's heard ----------
  let post = null
  await part('who asked, where', async () => {
    const p = await tm.say({ user: 'sam', kind: 'channel', mention: true, text: 'what\'s our launch date?' })
    const m = await heardLike(/launch date/)
    post = m
    ok(m?.mention === true && m.dm === false && m.channel === '19:launch@thread.tacv2' && m.thread === null && m.ts === p.id, 'a mention in a channel post is heard, at the top', m)
    ok(m?.text === 'what\'s our launch date?' && m.place.kind === 'channel' && m.place.name === 'Launch' && m.place.within === 'Acme Team', 'its words without the mention, and where: Launch in Acme Team', m && { text: m.text, place: m.place })
    ok(m?.reply?.conversation === `19:launch@thread.tacv2;messageid=${p.id}` && m.reply.activity === p.id && m.reply.thread === p.id && /\/amer\/$/.test(m.reply.serviceUrl), 'its reply to go in the post\'s thread', m?.reply)
    await tm.say({ user: 'sam', kind: 'channel', text: 'a post not for it' })
    await tm.say({ user: 'eve', kind: 'channel', thread: p.id, text: 'chatter in a thread it doesn\'t follow' })
    await tm.say({ user: 'eve', kind: 'groupChat', text: 'group chat, no mention' })
    await sleep(500)
    ok(!heard.some((x) => /not for it|doesn't follow|no mention/.test(x.text)), 'a post not to it, a thread it doesn\'t follow and a group chat without a mention aren\'t heard')
    followed.add(`19:launch@thread.tacv2:${p.id}`)
    await tm.say({ user: 'dana', kind: 'channel', thread: p.id, text: 'and the time?' })
    const f = await heardLike(/and the time/)
    ok(f?.mention === false && f.thread === p.id && f.channel === '19:launch@thread.tacv2' && f.reply.conversation === m.reply.conversation, 'a reply in a thread it follows is heard without a mention, in that thread', f)
    await tm.say({ user: 'eve', kind: 'groupChat', mention: true, text: 'group chat question' })
    const g = await heardLike(/group chat question/)
    ok(g?.dm === false && g.place.name === 'Launch crew' && g.thread === null, 'a mention in a group chat is heard', g)
    await tm.say({ user: 'gus', kind: 'channel', mention: true, text: 'guest asking' })
    await tm.say({ user: 'xena', mention: true, text: 'from another organization' })
    await tm.say({ user: 'eve', noAad: true, text: 'nobody knows who' })
    const gus = await heardLike(/guest asking/)
    const xena = await heardLike(/another organization/)
    const anon = await heardLike(/nobody knows who/)
    ok(gus?.from.guest === true && gus.from.id === 'aad-gus-0005', 'a guest account in your organization is a guest', gus?.from)
    ok(xena?.from.external === true && /another organization/.test(xena.from.why), 'someone from another organization is external', xena?.from)
    ok(anon?.from.unknown === true && anon.from.id === null, 'one without an Entra ID is unknown', anon?.from)
    await tm.fail({ route: 'GET /v3/conversations/:conv/members/:user', status: 500, n: 1 })
    await tm.say({ user: 'tester', text: 'lookup fails' })
    const u = await heardLike(/lookup fails/)
    ok(u?.from.unknown === true && /Couldn't check who they are/.test(u.from.why), 'a lookup that failed: unknown, saying why', u?.from)
    await tm.say({ user: 'dana', text: 'here is a file', files: ['plan.xlsx'] })
    const fm = await heardLike(/here is a file/)
    ok(fm?.attachments?.[0]?.name === 'plan.xlsx' && fm.attachments[0].type === 'xlsx' && !JSON.stringify(fm.attachments).includes('downloadUrl'), 'a file sent with it is named, its address not passed on', fm?.attachments)
    await tm.install()
    ok(!!(await until(() => events.find((e) => e.what === 'installed' && /Acme Team/.test(e.why)), 3000, 50)), 'added to a team: said')
  })

  // ---------- Replies ----------
  await part('replies', async () => {
    const before = (await st()).tokenRequests
    const r = await t1.post(post.reply, 'Friday at 10. <b>Bold?</b> & more')
    const p = (await st()).posted.find((x) => x.id === r.ts)
    ok(p?.conversation === post.reply.conversation && p.replyTo === post.ts && p.textFormat === 'markdown', 'a reply goes in the post\'s thread, replying to it', p)
    ok(p?.text === 'Friday at 10. &lt;b&gt;Bold?&lt;/b&gt; &amp; more', 'its words escaped, so nothing in them is read as markup', p?.text)
    await t1.post(post.reply, 'Again.')
    ok((await st()).tokenRequests === before, 'with the token it signed in with, kept until shortly before it expires', (await st()).tokenRequests - before)
    const t0 = Date.now()
    await tm.limit({ route: 'POST /v3/conversations/:conv/activities/:id', n: 1, wait: 1 })
    await t1.post(post.reply, 'After a wait.')
    ok(Date.now() - t0 >= 1000, 'a 429 is waited out as long as Retry-After says', Date.now() - t0)
    await tm.limit({ route: 'POST /v3/conversations/:conv/activities/:id', n: 3, wait: 2 })
    const e = await t1.post(post.reply, 'Too soon.').then(() => null, (x) => x)
    ok(e?.code === 'ratelimited' && e.retryAfter === 2, 'one that goes on is said, with how long to wait', e && { code: e.code, retryAfter: e.retryAfter })
    await tm.limit({ route: 'POST /v3/conversations/:conv/activities/:id', n: 0 })
    await tm.fail({ route: 'POST /v3/conversations/:conv/activities/:id', status: 404, n: 1 })
    ok((await t1.post(post.reply, 'gone').then(() => null, (x) => x))?.code === 'channel_not_found', 'a conversation gone, or the bot removed from it, is said')
    await tm.fail({ route: 'POST /v3/conversations/:conv/activities/:id', status: 503, n: 1 })
    ok((await t1.post(post.reply, 'down').then(() => null, (x) => x))?.code === 'http_503', 'Teams failing is said as one to try again')
    const sent = (await st()).posted.length
    const evil = await t1.post({ ...post.reply, serviceUrl: 'https://bots.evil.test/amer/' }, 'leak?').then(() => null, (x) => x)
    ok(evil?.code === 'invalid_service_url' && (await st()).posted.length === sent, 'an address that isn\'t Microsoft\'s gets nothing, not even the token', evil?.code)
    const ed = await t1.edit(r, 'Friday at 11.')
    ok((await st()).updated.some((x) => x.id === r.ts && x.text === 'Friday at 11.') && ed.ts === r.ts, 'an edit changes the reply')
    const shown = await t1.react({ channel: post.channel, ts: post.ts, name: 'eyes' })
    const none = await t1.react({ channel: post.channel, ts: post.ts, name: 'white_check_mark' })
    ok(shown?.shown === 'typing' && (await st()).typing.some((x) => x.conversation === post.reply.conversation), 'for 👀, typing… where it was asked', shown)
    ok(/doesn't let a bot react/.test(none?.skipped || ''), 'and no reaction otherwise, said (Teams has none for bots)', none)
  })

  // ---------- Context ----------
  await part('context', async () => {
    const f = heard.find((m) => /and the time/.test(m.text))
    await tm.say({ user: 'eve', kind: 'channel', thread: post.ts, mention: true, text: 'one more thing' })
    const q = await heardLike(/one more thing/)
    const c = await t1.context({ channel: q.channel, thread: q.thread, ts: q.ts })
    ok(c.kind === 'thread' && c.messages[0]?.text === 'what\'s our launch date?' && c.messages.some((m) => m.you && /Friday/.test(m.text)) && c.messages.some((m) => m.ts === f.ts) && !c.messages.some((m) => m.ts === q.ts) && !c.problem, 'a thread\'s context: what it was sent there, its own answers as its own, up to the question', c.messages.map((m) => [m.you, m.text]))
    const since = c.messages.find((m) => m.you).ts
    const c2 = await t1.context({ channel: q.channel, thread: q.thread, ts: q.ts, since })
    ok(!c2.messages.some((m) => /launch date/.test(m.text)) && c2.messages.length >= 1, 'going on from an earlier answer: only what came since', c2.messages.map((m) => m.text))
    await tm.say({ user: 'dana', text: 'is this right?', quote: { name: 'Sam Okafor', text: 'Pricing is $40 a seat' } })
    const qq = await heardLike(/is this right/)
    const c3 = await t1.context({ channel: qq.channel, thread: null, ts: qq.ts, dm: true })
    ok(c3.kind === 'dm' && c3.messages.some((m) => m.text === 'Pricing is $40 a seat' && m.person.name === 'Sam Okafor'), 'a question quoting a message has it in its context', c3.messages)
    const c4 = await t1.context({ channel: '19:other@thread.tacv2', thread: '1600000000000', ts: '1600000000001' })
    ok(c4.messages.length === 0 && /doesn't let a bot read/.test(c4.problem || ''), 'in a thread it was sent nothing of: said why there\'s no context', c4)
  })

  await part('edits and deletions', async () => {
    const f = heard.find((m) => /and the time/.test(m.text))
    await tm.edit({ kind: 'channel', thread: post.ts, id: f.ts, text: 'and the time, roughly?' })
    await tm.remove({ kind: 'channel', thread: post.ts, id: f.ts })
    const e = await until(() => changes.find((x) => x.kind === 'changed' && x.ts === f.ts), 3000, 50)
    ok(e?.text === 'and the time, roughly?' && e.before === 'and the time?' && e.thread === post.ts, 'an edit in its thread is handed over, with what it said before', e)
    ok(!!(await until(() => changes.find((x) => x.kind === 'deleted' && x.ts === f.ts), 3000, 50)), 'and a deletion')
  })

  await part('people, the tunnel, the app', async () => {
    const ppl = await t1.people()
    ok(ppl.map((p) => p.name).join() === 'Dana Reyes,Eve,Sam Okafor,Tester' && ppl.every((p) => /^aad-/.test(p.id)) && !ppl.problem, 'people to pick, from the teams and chats it\'s in, a page at a time: by Entra ID, without guests, bots or other organizations', ppl)
    let x = await t1.setEndpoint({ publicUrl: `http://127.0.0.1:${port}/api/messages` })
    ok(x.endpoint.url === `http://127.0.0.1:${port}/api/messages`, 'the tunnel\'s address, pasted with or without /api/messages', x.endpoint)
    x = await t1.checkEndpoint()
    ok(x.endpoint.ok === true && !x.endpoint.why, 'Check: the tunnel reaches this bot', x.endpoint)
    await t1.setEndpoint({ publicUrl: 'http://127.0.0.1:9' })
    x = await t1.checkEndpoint()
    ok(x.endpoint.ok === false && /Couldn't reach/.test(x.endpoint.why), 'and when it doesn\'t, why', x.endpoint)
    const was = process.env.BRIDGE_TEAMS_URL
    delete process.env.BRIDGE_TEAMS_URL
    const h = await t1.setEndpoint({ publicUrl: 'http://bot.example.test' }).then(() => null, (e) => e)
    process.env.BRIDGE_TEAMS_URL = was
    ok(/only over https/.test(h?.message || ''), 'an address that isn\'t https is turned down: Teams won\'t use it', h?.message)
    const app = t1.teamsApp({ name: 'Atlas', you: 'Tester' })
    const files = unzip(app.zip)
    const m = JSON.parse(files['manifest.json'] || '{}')
    ok(Object.keys(files).sort().join() === 'color.png,manifest.json,outline.png', 'the Teams app: a zip of its manifest and two icons', Object.keys(files))
    ok(m.bots?.[0]?.botId === appId && m.id === kept.teamsAppId && m.name.short === 'Atlas' && m.manifestVersion === '1.17' && m.version === '1.0.0' && m.bots[0].scopes.join() === 'personal,team,groupChat', 'its manifest: the bot, its name, where it can be used', m)
    ok(m.authorization?.permissions?.resourceSpecific?.map((p) => p.name).join() === 'ChannelMessage.Read.Group,ChatMessage.Read.Chat' && m.webApplicationInfo?.id === appId, 'asking to be sent the messages of a channel or chat it\'s added to (for replies in its threads)', m.authorization)
    ok(!JSON.stringify(m).includes(password) && !app.zip.includes(Buffer.from(password)), 'with no secret in it')
    const dims = (png) => ({ sig: png.subarray(0, 8).toString('hex'), w: png.readUInt32BE(16), h: png.readUInt32BE(20), type: png[25] })
    ok(JSON.stringify(dims(files['color.png'])) === JSON.stringify({ sig: '89504e470d0a1a0a', w: 192, h: 192, type: 6 }) && JSON.stringify(dims(files['outline.png'])) === JSON.stringify({ sig: '89504e470d0a1a0a', w: 32, h: 32, type: 6 }), 'its icons: 192×192 and 32×32 PNGs', [dims(files['color.png']), dims(files['outline.png'])])
    // (The small one white on transparent, as Teams wants: every pixel white, some see-through.)
    const idat = []
    for (let i = 8; i < files['outline.png'].length;) { const n = files['outline.png'].readUInt32BE(i); const t = files['outline.png'].subarray(i + 4, i + 8).toString(); if (t === 'IDAT') idat.push(files['outline.png'].subarray(i + 8, i + 8 + n)); i += 12 + n }
    const raw = zlib.inflateSync(Buffer.concat(idat))
    let white = true
    let clear = 0
    let solid = 0
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const o = y * 129 + 1 + x * 4; if (raw[o + 3] > 0 && (raw[o] !== 255 || raw[o + 1] !== 255 || raw[o + 2] !== 255)) white = false; if (raw[o + 3] === 0) clear++; if (raw[o + 3] === 255) solid++ }
    ok(white && clear > 300 && solid > 30, 'the outline icon is white on transparent', { white, clear, solid })
    ok(t1.teamsApp({ name: 'Atlas', you: 'Tester' }).version === '1.0.0' && t1.teamsApp({ name: 'Atlas Two', you: 'Tester' }).version === '1.0.1', 'the same app again keeps its version; changed, its version goes up, for Teams to take it')
  })

  // ---------- Stopping, forgetting, no secret anywhere ----------
  t1.stop()
  ok(t1.state().state === 'off' && !(await fetch(`http://127.0.0.1:${port}/api/messages`, { method: 'POST' }).then(() => true, () => false)), 'stopped: it no longer listens')
  const log = fs.readFileSync(tm.log, 'utf8')
  ok(!log.includes(password), 'the client secret is in nothing Microsoft was sent but the sign-in (the stand-in\'s log)')
  ok(!JSON.stringify(events).includes(password) && !JSON.stringify(heard).includes(password) && !JSON.stringify(t1.state()).includes(password), 'nor in anything said for the record, heard, or shown')
  t1.forget()
  ok(!fs.existsSync(FILE) && t1.state().state === 'no-tokens', 'forgotten: its credentials are gone')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  try { t1.stop() } catch { /* stopped */ }
  tm.stop()
}
process.exit(done().fail ? 1 : 0)
