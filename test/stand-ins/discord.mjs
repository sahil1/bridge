// A Discord for tests (Bots: discord-client): Discord's REST API (v10) and its Gateway on this
// computer, with two bots and two servers, so a test connects, asks and gets answers with nothing
// leaving the machine. The server reaches it as BRIDGE_DISCORD_URL.
//   node discord.mjs <port> <log>
// The bots: D1 (token dtest.bot-one.0123456789abcdef, user 1001 "Bridge AI", in Acme and Other Co,
// its Message Content and Server Members intents on) and D2 (dtest.bot-two.0123456789abcdef, 1002
// "Atlas", in Acme only, no privileged intent on). Acme (3001) has #launch (4001) and #general
// (4002); its members Dana (2001), Sam (2002), Eve (2003) and Tester (2004, the owner), Pat (2005,
// still to pass its membership screening: pending), Gwen (2006, a guest: flag 1 << 4) and a bot,
// Jira (2007). Other Co (3002) has #lobby (4101) and Xena (2009), who isn't in Acme.
// The Gateway, as Discord's: Hello with the heartbeat interval, each heartbeat acknowledged,
// Identify (a wrong token: closed 4004; a privileged intent the app hasn't turned on: 4014), READY
// with a session and its resume address, then a GUILD_CREATE for each server; Resume replays what
// was sent since the sequence number given, then RESUMED (an unknown session: Invalid Session,
// false). Every event is kept for its session, so one sent while the bot was away is replayed.
// The REST API takes "Bot <token>" (a wrong one: 401), as Discord answers: users/@me,
// oauth2/applications/@me (its flags: which privileged intents are on), gateway/bot,
// users/@me/guilds, channels/:id, its messages (before, after, limit; newest first), one message,
// its pins (messages/pins), posting, editing and deleting a message, starting a thread from one
// (once: again is 160004), reactions (PUT and DELETE …/@me), typing, guilds/:id/members/:user (not
// one: 10007), and listing a server's members (403, 50001, without Server Members Intent). Webhooks,
// for one app posting as several bots (server/connhub.js): making one in a channel (POST
// /channels/:id/webhooks: 403, 50013, while webhooks aren't allowed), and posting through one (POST
// /webhooks/:id/:token, no bot token needed: wait=true answers the message; thread_id posts in that
// thread of its channel) with the username and avatar_url asked for; its message carries webhook_id,
// and is sent to the bots as any message is. Each call goes in the log, as { method, route, app,
// body } (never a token, a webhook's included).
// And, for tests:
//   POST /_test/say { user, text, channel?, dm?, app?, thread?, reply? }   someone writes: in a
//        channel (#launch unless said; a thread by its id), or directly to a bot (app: D1 unless
//        said); <@1001> in the text mentions D1; reply: the id of a message it replies to.
//        Sent as MESSAGE_CREATE to each bot that can see it. { id, channel_id }
//   POST /_test/edit { channel, id, text }, /_test/delete { channel, id }   changed, gone
//   POST /_test/pin { channel, id }
//   POST /_test/drop          every connection ends at once (a network that changed): resumable
//   POST /_test/away          none can connect or call, and each connection goes dead without a
//                             word (no acknowledgements, nothing sent); POST /_test/back
//   POST /_test/reconnect     Discord asks each connection to reconnect (op 7)
//   POST /_test/invalid { resumable }   Invalid Session (op 9) to each; not resumable: sessions gone
//   POST /_test/expire        every session forgotten (a resume is turned down)
//   POST /_test/close { code } every connection closed with that code
//   POST /_test/intents { app, content, members }   the Developer Portal's switches
//   POST /_test/limit { route, n, wait, global }    the next n calls to route answer 429
//   POST /_test/fail { route, status, code, message, n }   the next n calls to route answer that
//                             (route as "POST /channels/:id/messages": ids as :id, an emoji :emoji)
//   POST /_test/nothreads { channel }   the bots may not start threads there (403, 50013)
//   POST /_test/heartbeat { ms }   the heartbeat interval Hello gives (1000 unless said)
//   POST /_test/webhooks { allow }  whether the bots may make webhooks (Manage Webhooks; allowed
//                             unless said)
//   GET  /_test/state  { connections, hellos, identifies, resumes, heartbeats, acks, identified:
//                      [{ app, intents, properties }], posted (a webhook's with webhook: true,
//                      username, avatar_url), edited, deleted, reactions (on now), typing, threads,
//                      webhooks: [{ id, channel, app, name }] }
import http from 'node:http'
import fs from 'node:fs'
import { WebSocketServer } from 'ws'

const [port, log] = process.argv.slice(2)
const EPOCH = 1420070400000n
const CONTENT = 1 << 18
const MEMBERS = 1 << 14
const INTENT = { GUILDS: 1, GUILD_MESSAGES: 1 << 9, DIRECT_MESSAGES: 1 << 12, MESSAGE_CONTENT: 1 << 15, GUILD_MEMBERS: 1 << 1 }
let last = 0n
const snow = () => { let n = (BigInt(Date.now()) - EPOCH) << 22n; if (n <= last) n = last + 1n; last = n; return String(n) }
const note = (o) => { if (log) fs.appendFileSync(log, `${JSON.stringify(o)}\n`) }

const APPS = {
  D1: { token: 'dtest.bot-one.0123456789abcdef', user: { id: '1001', username: 'bridge_ai', global_name: 'Bridge AI', bot: true }, name: 'Bridge AI', flags: CONTENT | MEMBERS, guilds: ['3001', '3002'] },
  D2: { token: 'dtest.bot-two.0123456789abcdef', user: { id: '1002', username: 'atlas', global_name: 'Atlas', bot: true }, name: 'Atlas', flags: 0, guilds: ['3001'] },
}
const USERS = {
  2001: { id: '2001', username: 'dana', global_name: 'Dana Reyes' },
  2002: { id: '2002', username: 'sam', global_name: 'Sam Okafor' },
  2003: { id: '2003', username: 'eve', global_name: 'Eve' },
  2004: { id: '2004', username: 'tester', global_name: 'Tester' },
  2005: { id: '2005', username: 'pat', global_name: 'Pat New' },
  2006: { id: '2006', username: 'gwen', global_name: 'Gwen Guest' },
  2007: { id: '2007', username: 'jira', bot: true },
  2009: { id: '2009', username: 'xena', global_name: 'Xena Partner' },
  1001: APPS.D1.user, 1002: APPS.D2.user,
}
const GUILDS = {
  3001: { id: '3001', name: 'Acme', members: { 2001: { nick: 'Dana' }, 2002: {}, 2003: {}, 2004: {}, 2005: { pending: true }, 2006: { flags: 1 << 4 }, 2007: {}, 1001: {}, 1002: {} } },
  3002: { id: '3002', name: 'Other Co', members: { 2009: {}, 1001: {} } },
}
const CHANNELS = {
  4001: { id: '4001', type: 0, name: 'launch', guild_id: '3001', parent_id: null },
  4002: { id: '4002', type: 0, name: 'general', guild_id: '3001', parent_id: null },
  4003: { id: '4003', type: 2, name: 'Voice', guild_id: '3001', parent_id: null },
  4101: { id: '4101', type: 0, name: 'lobby', guild_id: '3002', parent_id: null },
}
const messages = Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, []]))
const pins = {}
const memberOf = (g, uid) => { const m = GUILDS[g]?.members[uid]; return m ? { user: USERS[uid], nick: m.nick || null, roles: [], joined_at: '2026-01-01T00:00:00.000Z', pending: !!m.pending, flags: m.flags || 0, deaf: false, mute: false } : null }
const appOf = (token) => Object.entries(APPS).find(([, a]) => a.token === token)?.[0] || null
const canSee = (key, ch) => (ch.type === 1 ? ch.recipients.includes(APPS[key].user.id) : APPS[key].guilds.includes(ch.guild_id))

const posted = []
const edited = []
const deleted = []
let reactions = []
const typing = []
const threads = []
const noThreads = new Set()
const hooks = {} // webhook id -> { id, token, channel, guild, app, name }
let hooksAllowed = true
const limits = {}
const fails = {}
let HB = 1000
let away = false
const count = { hellos: 0, identifies: 0, resumes: 0, heartbeats: 0, acks: 0 }
const identified = []

// ---------- The Gateway ----------
const sessions = new Map() // id -> { app, intents, seq, events, ws }
const sockets = new Set()
const wss = new WebSocketServer({ noServer: true })
const send = (ws, o) => { if (ws && ws.readyState === 1 && !ws.dead) ws.send(JSON.stringify(o)) }
// An event to every session of a bot (kept, to replay on a resume), sent where it's connected.
function emit(key, t, d, { intent = 0 } = {}) {
  for (const s of sessions.values()) {
    if (s.app !== key || (intent && !(s.intents & intent))) continue
    const ev = { op: 0, t, s: ++s.seq, d }
    s.events.push(ev)
    if (s.events.length > 1000) s.events.shift()
    send(s.ws, ev)
  }
}
function guildCreate(key, s) {
  for (const g of APPS[key].guilds) {
    const ev = { op: 0, t: 'GUILD_CREATE', s: ++s.seq, d: { id: g, name: GUILDS[g].name, unavailable: false, channels: Object.values(CHANNELS).filter((c) => c.guild_id === g && c.type !== 11), threads: Object.values(CHANNELS).filter((c) => c.guild_id === g && c.type === 11), member_count: Object.keys(GUILDS[g].members).length } }
    s.events.push(ev)
    send(s.ws, ev)
  }
}
wss.on('connection', (ws) => {
  sockets.add(ws)
  count.hellos++
  ws.on('close', () => { sockets.delete(ws); for (const s of sessions.values()) if (s.ws === ws) s.ws = null })
  ws.on('message', (raw) => {
    if (ws.dead) return
    let m
    try { m = JSON.parse(String(raw)) } catch { return ws.close(4002, 'Error while decoding payload.') }
    if (m.op === 1) { count.heartbeats++; count.acks++; send(ws, { op: 11 }); return }
    if (m.op === 2) {
      const key = appOf(m.d?.token)
      if (!key) return ws.close(4004, 'Authentication failed.')
      const intents = Number(m.d?.intents) || 0
      if ((intents & INTENT.MESSAGE_CONTENT && !(APPS[key].flags & CONTENT)) || (intents & INTENT.GUILD_MEMBERS && !(APPS[key].flags & MEMBERS))) return ws.close(4014, 'Disallowed intent(s).')
      count.identifies++
      identified.push({ app: key, intents, properties: m.d?.properties || null })
      note({ gateway: 'identify', app: key, intents })
      const id = `sess-${count.identifies}-${Date.now().toString(36)}`
      const s = { app: key, intents, seq: 0, events: [], ws }
      sessions.set(id, s)
      const ready = { op: 0, t: 'READY', s: ++s.seq, d: { v: 10, user: APPS[key].user, guilds: APPS[key].guilds.map((g) => ({ id: g, unavailable: true })), session_id: id, resume_gateway_url: `ws://127.0.0.1:${port}/resume`, application: { id: APPS[key].user.id, flags: APPS[key].flags } } }
      s.events.push(ready)
      send(ws, ready)
      guildCreate(key, s)
      return
    }
    if (m.op === 6) {
      const s = sessions.get(m.d?.session_id)
      if (!s || APPS[s.app].token !== m.d?.token) { send(ws, { op: 9, d: false }); return }
      count.resumes++
      note({ gateway: 'resume', app: s.app, seq: m.d.seq })
      s.ws = ws
      for (const ev of s.events.filter((e) => e.s > Number(m.d.seq))) send(ws, ev)
      const ev = { op: 0, t: 'RESUMED', s: ++s.seq, d: {} }
      s.events.push(ev)
      send(ws, ev)
    }
  })
  send(ws, { op: 10, d: { heartbeat_interval: HB } })
})

// ---------- The REST API ----------
const answer = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': '4', 'x-ratelimit-reset-after': '1', ...headers }); res.end(body == null ? undefined : JSON.stringify(body)) }
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => r(b)) })
const routeOf = (method, p) => { const parts = p.split('/'); return `${method} ${parts.map((x, i) => (parts[i - 1] === 'reactions' ? ':emoji' : /^\d+$/.test(x) ? ':id' : x)).join('/')}` }
const dmOf = (key, uid) => {
  const bot = APPS[key].user.id
  let c = Object.values(CHANNELS).find((x) => x.type === 1 && x.recipients.includes(uid) && x.recipients.includes(bot))
  if (!c) { c = { id: snow(), type: 1, recipients: [uid, bot], guild_id: null }; CHANNELS[c.id] = c; messages[c.id] = [] }
  return c
}
const mentionsIn = (text, guild) => [...String(text).matchAll(/<@!?(\d+)>/g)].map((x) => USERS[x[1]]).filter(Boolean).map((u) => ({ ...u, ...(guild ? { member: memberOf(guild, u.id) } : {}) }))
const find = (channel, id) => messages[channel]?.find((m) => m.id === id) || null
// A message as Discord sends it in MESSAGE_CREATE (with guild_id and the author's member) or from
// REST (without).
const wire = (m, { gateway = false } = {}) => {
  const { guild, ...rest } = m
  return gateway && guild ? { ...rest, guild_id: guild, member: memberOf(guild, m.author.id) } : rest
}
function deliver(m, t = 'MESSAGE_CREATE') {
  const ch = CHANNELS[m.channel_id]
  for (const key of Object.keys(APPS)) {
    if (!canSee(key, ch)) continue
    emit(key, t, wire(m, { gateway: true }), { intent: ch.type === 1 ? INTENT.DIRECT_MESSAGES : INTENT.GUILD_MESSAGES })
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const raw = await body(req)
  // ---------- test controls ----------
  if (url.pathname.startsWith('/_test/')) {
    const what = url.pathname.slice(7)
    const j = raw ? JSON.parse(raw) : {}
    if (what === 'say') {
      const key = j.app || 'D1'
      const ch = j.dm ? dmOf(key, String(j.user)) : CHANNELS[String(j.thread || j.channel || '4001')]
      if (!ch) return answer(res, 404, { error: 'no such channel' })
      const guild = ch.guild_id || null
      const ref = j.reply ? Object.values(messages).flat().find((x) => x.id === String(j.reply)) : null
      const m = {
        id: snow(), type: ref ? 19 : 0, channel_id: ch.id, guild, author: USERS[String(j.user)], content: String(j.text ?? ''), timestamp: new Date().toISOString(),
        mentions: mentionsIn(j.text, guild), attachments: j.attachments || [], pinned: false,
        ...(ref ? { message_reference: { message_id: ref.id, channel_id: ref.channel_id }, referenced_message: wire(ref) } : {}),
        ...(j.webhook ? { webhook_id: '5555' } : {}),
      }
      messages[ch.id].push(m)
      deliver(m)
      return answer(res, 200, { id: m.id, channel_id: ch.id })
    }
    if (what === 'edit' || what === 'delete') {
      const m = find(String(j.channel), String(j.id))
      if (!m) return answer(res, 404, { error: 'no such message' })
      if (what === 'edit') { m.content = j.text; m.edited_timestamp = new Date().toISOString(); deliver(m, 'MESSAGE_UPDATE') } else {
        messages[j.channel] = messages[j.channel].filter((x) => x !== m)
        for (const key of Object.keys(APPS)) if (canSee(key, CHANNELS[j.channel])) emit(key, 'MESSAGE_DELETE', { id: m.id, channel_id: m.channel_id, ...(m.guild ? { guild_id: m.guild } : {}) }, { intent: m.guild ? INTENT.GUILD_MESSAGES : INTENT.DIRECT_MESSAGES })
      }
      return answer(res, 200, { ok: true })
    }
    if (what === 'pin') { const m = find(String(j.channel), String(j.id)); if (m) (pins[j.channel] ||= []).push(m); return answer(res, 200, { ok: !!m }) }
    if (what === 'drop') { for (const s of sockets) s.terminate(); return answer(res, 200, { ok: true }) }
    if (what === 'away') { away = true; for (const s of sockets) s.dead = true; return answer(res, 200, { ok: true }) }
    if (what === 'back') { away = false; return answer(res, 200, { ok: true }) }
    if (what === 'reconnect') { for (const s of sockets) send(s, { op: 7, d: null }); return answer(res, 200, { ok: true }) }
    if (what === 'invalid') { for (const s of sockets) send(s, { op: 9, d: !!j.resumable }); if (!j.resumable) sessions.clear(); return answer(res, 200, { ok: true }) }
    if (what === 'expire') { sessions.clear(); return answer(res, 200, { ok: true }) }
    if (what === 'close') { for (const s of sockets) s.close(Number(j.code) || 4000, 'test'); return answer(res, 200, { ok: true }) }
    if (what === 'intents') {
      const a = APPS[j.app || 'D1']
      if (j.content != null) a.flags = j.content ? a.flags | CONTENT : a.flags & ~CONTENT
      if (j.members != null) a.flags = j.members ? a.flags | MEMBERS : a.flags & ~MEMBERS
      return answer(res, 200, { ok: true, flags: a.flags })
    }
    if (what === 'limit') { limits[j.route] = { n: j.n ?? 1, wait: j.wait ?? 1, global: !!j.global }; return answer(res, 200, { ok: true }) }
    if (what === 'fail') { fails[j.route] = { n: j.n ?? 1, after: j.after || 0, status: j.status || 500, code: j.code ?? 0, message: j.message || 'test' }; return answer(res, 200, { ok: true }) }
    if (what === 'nothreads') { noThreads.add(String(j.channel)); return answer(res, 200, { ok: true }) }
    if (what === 'heartbeat') { HB = Number(j.ms) || 1000; return answer(res, 200, { ok: true }) }
    if (what === 'webhooks') { hooksAllowed = j.allow !== false; return answer(res, 200, { ok: true }) }
    if (what === 'state') return answer(res, 200, { connections: [...sockets].filter((s) => s.readyState === 1 && !s.dead).length, ...count, identified, sessions: sessions.size, posted, edited, deleted, reactions, typing, threads, messages, webhooks: Object.values(hooks).map(({ token, ...h }) => h) }) // eslint-disable-line no-unused-vars
    return answer(res, 404, { error: 'no such control' })
  }
  // ---------- REST ----------
  if (!url.pathname.startsWith('/api/v10/')) return answer(res, 404, { message: '404: Not Found', code: 0 })
  const p = url.pathname.slice('/api/v10'.length)
  const method = req.method
  const route = routeOf(method, p)
  const key = appOf(String(req.headers.authorization || '').replace(/^Bot\s+/, ''))
  let j = {}
  try { j = raw ? JSON.parse(raw) : {} } catch { return answer(res, 400, { message: 'Invalid JSON', code: 50109 }) }
  // A webhook's token is in its address: logged without it.
  const hook = /^\/webhooks\/(\d+)\/([^/]+)$/.exec(p)
  note({ method, route: hook ? `${method} /webhooks/:id/:token` : route, path: hook ? `/webhooks/${hook[1]}/…` : p, app: hook ? hooks[hook[1]]?.app || null : key, ...(raw ? { body: j } : {}) })
  if (away) return req.socket.destroy()
  // ---------- Posting through a webhook (no bot token) ----------
  if (hook) {
    const h = hooks[hook[1]]
    if (!h || h.token !== hook[2]) return answer(res, 404, { message: 'Unknown Webhook', code: 10015 })
    if (method !== 'POST') return answer(res, 405, { message: '405: Method Not Allowed', code: 0 })
    const thread = url.searchParams.get('thread_id')
    const target = CHANNELS[thread || h.channel]
    if (!target || (thread && target.parent_id !== h.channel)) return answer(res, 400, { message: 'Unknown Channel', code: 10003 })
    const content = String(j.content || '')
    if (!content.trim()) return answer(res, 400, { message: 'Cannot send an empty message', code: 50006 })
    if (content.length > 2000) return answer(res, 400, { message: 'Invalid Form Body', code: 50035 })
    const m = { id: snow(), type: 0, channel_id: target.id, guild: target.guild_id || null, author: { id: h.id, username: String(j.username || h.name), avatar: null, bot: true }, webhook_id: h.id, content, timestamp: new Date().toISOString(), mentions: [], attachments: [] }
    messages[target.id].push(m)
    posted.push({ app: h.app, channel: target.id, id: m.id, content, webhook: true, username: j.username || null, avatar_url: j.avatar_url || null, allowed_mentions: j.allowed_mentions || null, in_thread: target.type === 11 ? target.parent_id : null })
    deliver(m)
    return url.searchParams.get('wait') === 'true' ? answer(res, 200, wire(m)) : answer(res, 204, null)
  }
  if (!key) return answer(res, 401, { message: '401: Unauthorized', code: 0 })
  if (limits[route]?.n > 0) {
    const l = limits[route]
    l.n--
    return answer(res, 429, { message: 'You are being rate limited.', retry_after: l.wait, global: l.global }, { 'retry-after': String(Math.ceil(l.wait)), 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': String(l.wait), ...(l.global ? { 'x-ratelimit-global': 'true' } : {}), 'x-ratelimit-scope': l.global ? 'global' : 'user' })
  }
  if (fails[route]?.after > 0) fails[route].after--
  else if (fails[route]?.n > 0) { const f = fails[route]; f.n--; return answer(res, f.status, { message: f.message, code: f.code }) }
  const a = APPS[key]
  const seg = p.split('/').filter(Boolean)
  const no = (status, code, message) => answer(res, status, { message, code })
  if (route === 'GET /users/@me') return answer(res, 200, a.user)
  if (route === 'GET /oauth2/applications/@me') return answer(res, 200, { id: a.user.id, name: a.name, flags: a.flags, bot_public: true, bot: a.user })
  if (route === 'GET /gateway/bot') return answer(res, 200, { url: `ws://127.0.0.1:${port}/gateway`, shards: 1, session_start_limit: { total: 1000, remaining: 999, reset_after: 60000, max_concurrency: 1 } })
  if (route === 'GET /users/@me/guilds') return answer(res, 200, a.guilds.map((g) => ({ id: g, name: GUILDS[g].name, owner: false, permissions: '0' })))
  if (route === 'POST /users/@me/channels') return answer(res, 200, dmOf(key, String(j.recipient_id)))
  if (seg[0] === 'guilds') {
    const g = GUILDS[seg[1]]
    if (!g || !a.guilds.includes(g.id)) return no(403, 50001, 'Missing Access')
    if (route === 'GET /guilds/:id/members/:id') { const m = memberOf(g.id, seg[3]); return m ? answer(res, 200, m) : no(404, 10007, 'Unknown Member') }
    if (route === 'GET /guilds/:id/members') {
      if (!(a.flags & MEMBERS)) return no(403, 50001, 'Missing Access')
      if (!/^\d*$/.test(url.searchParams.get('after') || '')) return no(400, 50035, 'Invalid Form Body: Value is not snowflake.')
      const after = BigInt(url.searchParams.get('after') || '0')
      const limit = Number(url.searchParams.get('limit') || 1)
      return answer(res, 200, Object.keys(g.members).filter((u) => BigInt(u) > after).sort((x, y) => Number(x) - Number(y)).slice(0, limit).map((u) => memberOf(g.id, u)))
    }
    return no(404, 0, '404: Not Found')
  }
  if (seg[0] === 'channels') {
    const ch = CHANNELS[seg[1]]
    if (!ch) return no(404, 10003, 'Unknown Channel')
    if (!canSee(key, ch)) return no(403, 50001, 'Missing Access')
    const list = messages[ch.id] || []
    if (route === 'GET /channels/:id') { const { recipients, ...c } = ch; return answer(res, 200, { ...c, ...(recipients ? { recipients: recipients.map((u) => USERS[u]) } : {}) }) }
    if (route === 'GET /channels/:id/messages') {
      const before = url.searchParams.get('before')
      const after = url.searchParams.get('after')
      const limit = Number(url.searchParams.get('limit') || 50)
      if ([before, after].some((x) => x != null && !/^\d+$/.test(x))) return no(400, 50035, 'Invalid Form Body: Value is not snowflake.')
      let out = list.filter((m) => (!before || BigInt(m.id) < BigInt(before)) && (!after || BigInt(m.id) > BigInt(after)))
      out = after ? out.slice(0, limit) : out.slice(-limit)
      return answer(res, 200, out.reverse().map((m) => wire(m)))
    }
    if (route === 'GET /channels/:id/messages/pins') return answer(res, 200, { items: (pins[ch.id] || []).map((m) => ({ pinned_at: m.timestamp, message: wire(m) })), has_more: false })
    if (route === 'GET /channels/:id/messages/:id') { const m = find(ch.id, seg[3]); return m ? answer(res, 200, wire(m)) : no(404, 10008, 'Unknown Message') }
    if (route === 'POST /channels/:id/messages') {
      const content = String(j.content || '')
      if (!content.trim()) return no(400, 50006, 'Cannot send an empty message')
      if (content.length > 2000) return no(400, 50035, 'Invalid Form Body')
      const m = { id: snow(), type: j.message_reference ? 19 : 0, channel_id: ch.id, guild: ch.guild_id || null, author: a.user, content, timestamp: new Date().toISOString(), mentions: [], attachments: [], ...(j.message_reference ? { message_reference: j.message_reference } : {}) }
      list.push(m)
      posted.push({ app: key, channel: ch.id, id: m.id, content, allowed_mentions: j.allowed_mentions || null, message_reference: j.message_reference || null, in_thread: ch.type === 11 ? ch.parent_id : null })
      deliver(m)
      return answer(res, 200, wire(m))
    }
    if (route === 'PATCH /channels/:id/messages/:id') { const m = find(ch.id, seg[3]); if (!m) return no(404, 10008, 'Unknown Message'); m.content = String(j.content); edited.push({ app: key, channel: ch.id, id: m.id, content: m.content }); return answer(res, 200, wire(m)) }
    if (route === 'DELETE /channels/:id/messages/:id') { const m = find(ch.id, seg[3]); if (!m) return no(404, 10008, 'Unknown Message'); messages[ch.id] = list.filter((x) => x !== m); deleted.push({ app: key, channel: ch.id, id: m.id }); return answer(res, 204, null) }
    if (route === 'POST /channels/:id/messages/:id/threads') {
      const m = find(ch.id, seg[3])
      if (!m) return no(404, 10008, 'Unknown Message')
      if (noThreads.has(ch.id)) return no(403, 50013, 'Missing Permissions')
      if (CHANNELS[m.id]) return no(400, 160004, 'A thread has already been created for this message')
      const t = { id: m.id, type: 11, name: String(j.name || 'thread').slice(0, 100), guild_id: ch.guild_id, parent_id: ch.id, owner_id: a.user.id }
      CHANNELS[t.id] = t
      messages[t.id] = []
      threads.push({ app: key, id: t.id, parent: ch.id, name: t.name })
      for (const k of Object.keys(APPS)) if (canSee(k, t)) emit(k, 'THREAD_CREATE', { ...t, newly_created: true }, { intent: INTENT.GUILDS })
      return answer(res, 201, t)
    }
    if (route === 'PUT /channels/:id/messages/:id/reactions/:emoji/@me' || route === 'DELETE /channels/:id/messages/:id/reactions/:emoji/@me') {
      if (!find(ch.id, seg[3])) return no(404, 10008, 'Unknown Message')
      const emoji = decodeURIComponent(seg[5])
      const has = reactions.find((r) => r.app === key && r.channel === ch.id && r.id === seg[3] && r.emoji === emoji)
      if (method === 'PUT' && !has) reactions.push({ app: key, channel: ch.id, id: seg[3], emoji })
      if (method === 'DELETE') reactions = reactions.filter((r) => r !== has)
      return answer(res, 204, null)
    }
    if (route === 'POST /channels/:id/typing') { typing.push({ app: key, channel: ch.id }); return answer(res, 204, null) }
    if (route === 'POST /channels/:id/webhooks') {
      if (!hooksAllowed) return no(403, 50013, 'Missing Permissions')
      if (ch.type !== 0) return no(400, 50024, 'Cannot execute action on this channel type')
      const h = { id: snow(), token: `whtok-${Math.random().toString(36).slice(2)}`, channel: ch.id, guild: ch.guild_id, app: key, name: String(j.name || 'Webhook').slice(0, 80) }
      hooks[h.id] = h
      return answer(res, 200, { id: h.id, type: 1, token: h.token, channel_id: ch.id, guild_id: ch.guild_id, name: h.name, application_id: a.user.id })
    }
  }
  return no(404, 0, '404: Not Found')
})

server.on('upgrade', (req, socket, head) => {
  if (away || !/^\/(gateway|resume)/.test(req.url)) return socket.destroy()
  const q = new URL(req.url, 'http://x').searchParams
  if (q.get('v') !== '10' || q.get('encoding') !== 'json') return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})
server.listen(Number(port), '127.0.0.1', () => console.log(`stand-in Discord on ${port}`))
