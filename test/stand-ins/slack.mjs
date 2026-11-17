// A Slack workspace for tests (Bots: slack-bot, bots-activity): Slack's Web API and Socket Mode on
// this computer, with two apps in it (two bots), so a test connects, asks and gets answers with
// nothing leaving the machine. The server reaches it as BRIDGE_SLACK_URL.
//   node slack.mjs <port> <log>
// The apps: A1 (tokens xapp-test and xoxb-test, its bot @bridge_ai, UBOT) and A2 (xapp-two and
// xoxb-two, @atlas, UBOT2), both in #launch, each with direct messages of its own. The Web API
// (POST /api/<method>, form-encoded, a bearer token), as Slack answers: auth.test (with the token's
// scopes in its x-oauth-scopes header, as every answer has), users.list and users.info (Dana, Sam
// and Eve are members; Gus a guest; Xena from another company, in no list, known to users.info as
// another team's, is_stranger), chat.postMessage, users.conversations, conversations.history,
// conversations.replies, conversations.info, pins.list, reactions.add and reactions.remove; with
// the bot token. apps.connections.open with the app-level token, giving ws://…/link?app=<id>, where
// Socket Mode says hello, sends events in envelopes and expects each one acknowledged. A wrong
// token: invalid_auth. Each call goes in the log, as { method, params, app }.
// Events, as Slack sends them to an app subscribed to app_mention and message.*: a message in a
// channel goes to each app as a message event (a mention of it besides, as app_mention); a direct
// message to its own app; an edit or deletion as a message event of that subtype.
// And, for tests:
//   POST /_test/ask { user, text, channel?, dm?, app?, thread? }   someone writes: in a channel
//                      (#launch unless said), a direct message to an app (app: A1 unless said), or a
//                      reply in a thread (thread: its ts). It's in the conversation (its history, or
//                      the thread's replies), and sent as events to the apps connected
//   POST /_test/edit { channel, ts, text }, /_test/delete { channel, ts }   a message changed, gone
//   POST /_test/pin { channel, ts }    a message pinned
//   POST /_test/scopes { app, scopes } the scopes an app's token has (an app made from an older
//                      manifest); without scopes, every one again
//   POST /_test/drop   every connection closes at once (a network that changed)
//   POST /_test/away   none can connect, and each one there goes dead without a word (a computer
//                      asleep, a lid closed); POST /_test/back to let them again
//   POST /_test/refresh  asks for a fresh connection (disconnect, refresh_requested)
//   POST /_test/limit { method, n, wait }   the next n calls to method answer 429, Retry-After wait
//   POST /_test/fail { method, error, n }   the next n calls to method answer { ok: false, error }
//   GET  /_test/state  { connections, hellos, envelopes, acks, posted: [{ app, channel, text,
//                      thread_ts, ts }], reactions: [{ app, channel, ts, name }] (those on now) }
import http from 'node:http'
import fs from 'node:fs'
import { WebSocketServer } from 'ws'

const [port, log] = process.argv.slice(2)
const ALL = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'im:write', 'users:read', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'mpim:history', 'mpim:read', 'reactions:write', 'pins:read']
const APPS = {
  A1: { app: 'xapp-test', bot: 'xoxb-test', who: { team_id: 'T0TEST', team: 'Acme Test', url: 'https://acme-test.slack.com/', user_id: 'UBOT', bot_id: 'BBOT', user: 'bridge_ai' }, scopes: ALL },
  A2: { app: 'xapp-two', bot: 'xoxb-two', who: { team_id: 'T0TEST', team: 'Acme Test', url: 'https://acme-test.slack.com/', user_id: 'UBOT2', bot_id: 'BBOT2', user: 'atlas' }, scopes: ALL },
}
const PEOPLE = [
  { id: 'U0DANA', team_id: 'T0TEST', name: 'dana', real_name: 'Dana Reyes', profile: { display_name: 'Dana', real_name: 'Dana Reyes', title: 'Sales' } },
  { id: 'U0SAM', team_id: 'T0TEST', name: 'sam', real_name: 'Sam Okafor', profile: { display_name: 'Sam', real_name: 'Sam Okafor', title: 'Support' } },
  { id: 'U0EVE', team_id: 'T0TEST', name: 'eve', real_name: 'Eve Mallory', profile: { display_name: 'Eve', real_name: 'Eve Mallory' } },
  { id: 'U0OWNER', team_id: 'T0TEST', name: 'tester', real_name: 'Tester', profile: { display_name: 'Tester', real_name: 'Tester' } },
  { id: 'U0GUS', team_id: 'T0TEST', name: 'gus', real_name: 'Gus Guest', is_restricted: true, profile: { display_name: 'Gus', real_name: 'Gus Guest', title: 'Contractor' } },
  { id: 'UOLDBOT', team_id: 'T0TEST', name: 'jira', is_bot: true, profile: { display_name: 'Jira' } },
  { id: 'U0GONE', team_id: 'T0TEST', name: 'gone', deleted: true, profile: { display_name: 'Gone' } },
]
// Someone from another company, in a shared channel: not in the members' list.
const STRANGERS = [{ id: 'U0XENA', team_id: 'T0OTHER', name: 'xena', real_name: 'Xena Partner', is_stranger: true, profile: { display_name: 'Xena', real_name: 'Xena Partner' } }]
const CHANNELS = {
  C0LAUNCH: { id: 'C0LAUNCH', name: 'launch', is_channel: true, apps: ['A1', 'A2'] },
  D0DANA: { id: 'D0DANA', is_im: true, user: 'U0DANA', apps: ['A1'] }, D0SAM: { id: 'D0SAM', is_im: true, user: 'U0SAM', apps: ['A1'] }, D0EVE: { id: 'D0EVE', is_im: true, user: 'U0EVE', apps: ['A1'] },
  D2DANA: { id: 'D2DANA', is_im: true, user: 'U0DANA', apps: ['A2'] }, D2EVE: { id: 'D2EVE', is_im: true, user: 'U0EVE', apps: ['A2'] },
}
const history = Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, []]))
const replies = {} // `${channel}:${thread}` -> [messages]
const pins = Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, []]))
const posted = []
let reactions = []
const limits = {}
const fails = {}
let away = false
let hellos = 0
let envelopes = 0
let acks = 0
let clock = Date.now() / 1000
// Message times as Slack's: seconds with six places, each later than the last.
const ts = () => { clock = Math.max(clock + 0.001, Date.now() / 1000); return clock.toFixed(6) }
const note = (o) => { if (log) fs.appendFileSync(log, `${JSON.stringify(o)}\n`) }
const find = (channel, at) => history[channel]?.find((m) => m.ts === at) || Object.entries(replies).filter(([k]) => k.startsWith(`${channel}:`)).flatMap(([, l]) => l).find((m) => m.ts === at) || null

const sockets = new Set()
const wss = new WebSocketServer({ noServer: true, autoPong: false })
function send(app, event) {
  const env = { envelope_id: `env-${++envelopes}`, type: 'events_api', accepts_response_payload: false, retry_attempt: 0, payload: { team_id: 'T0TEST', api_app_id: app, type: 'event_callback', event_id: `Ev${envelopes}`, event } }
  for (const s of sockets) if (s.app === app && s.readyState === 1 && !s.dead) s.send(JSON.stringify(env))
}
const live = (app) => [...sockets].some((s) => s.app === app && s.readyState === 1 && !s.dead)

const answer = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => r(b)) })

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const raw = await body(req)
  // ---------- test controls ----------
  if (url.pathname.startsWith('/_test/')) {
    const what = url.pathname.slice(7)
    const j = raw ? JSON.parse(raw) : {}
    if (what === 'ask') {
      const app = j.app || 'A1'
      const channel = j.channel || (j.dm ? Object.values(CHANNELS).find((c) => c.is_im && c.user === j.user && c.apps.includes(app))?.id : 'C0LAUNCH')
      const who = [...PEOPLE, ...STRANGERS].find((p) => p.id === j.user)
      const m = { type: 'message', user: j.user, text: j.text, ts: ts(), ...(j.thread ? { thread_ts: j.thread } : {}), ...(who?.team_id && who.team_id !== 'T0TEST' ? { user_team: who.team_id } : {}) }
      if (j.thread) (replies[`${channel}:${j.thread}`] ||= [find(channel, j.thread)].filter(Boolean)).push(m)
      else history[channel].push(m)
      const c = CHANNELS[channel]
      const dm = !!c?.is_im
      for (const a of c?.apps || []) {
        send(a, { ...m, channel, channel_type: dm ? 'im' : 'channel', event_ts: m.ts })
        if (!dm && String(j.text).includes(`<@${APPS[a].who.user_id}>`)) send(a, { ...m, type: 'app_mention', channel, event_ts: m.ts })
      }
      return answer(res, 200, { ok: true, ts: m.ts, channel, delivered: (c?.apps || []).some(live) })
    }
    if (what === 'edit' || what === 'delete') {
      const m = find(j.channel, j.ts)
      if (!m) return answer(res, 404, { ok: false, error: 'message_not_found' })
      const was = { ...m }
      if (what === 'edit') m.text = j.text
      else { history[j.channel] = history[j.channel].filter((x) => x !== m); for (const k of Object.keys(replies)) replies[k] = replies[k].filter((x) => x !== m) }
      for (const a of CHANNELS[j.channel].apps) send(a, what === 'edit'
        ? { type: 'message', subtype: 'message_changed', channel: j.channel, hidden: true, ts: ts(), message: { ...m, edited: { user: m.user, ts: ts() } }, previous_message: was }
        : { type: 'message', subtype: 'message_deleted', channel: j.channel, hidden: true, ts: ts(), deleted_ts: j.ts, previous_message: was })
      return answer(res, 200, { ok: true })
    }
    if (what === 'pin') { const m = find(j.channel, j.ts); if (m) pins[j.channel].push({ type: 'message', channel: j.channel, message: m }); return answer(res, 200, { ok: !!m }) }
    if (what === 'scopes') { APPS[j.app || 'A1'].scopes = Array.isArray(j.scopes) ? j.scopes : ALL; return answer(res, 200, { ok: true }) }
    if (what === 'drop') { for (const s of sockets) s.terminate(); return answer(res, 200, { ok: true }) }
    if (what === 'away') { away = true; for (const s of sockets) s.dead = true; return answer(res, 200, { ok: true }) }
    if (what === 'back') { away = false; return answer(res, 200, { ok: true }) }
    if (what === 'refresh') { for (const s of sockets) if (s.readyState === 1) s.send(JSON.stringify({ type: 'disconnect', reason: 'refresh_requested', debug_info: { host: 'test' } })); return answer(res, 200, { ok: true }) }
    if (what === 'limit') { limits[j.method] = { n: j.n || 1, wait: j.wait || 1 }; return answer(res, 200, { ok: true }) }
    if (what === 'fail') { fails[j.method] = { n: j.n || 1, error: j.error }; return answer(res, 200, { ok: true }) }
    if (what === 'state') return answer(res, 200, { connections: [...sockets].filter((s) => s.readyState === 1 && !s.dead).length, hellos, envelopes, acks, posted, reactions })
    return answer(res, 404, { error: 'no such control' })
  }
  // ---------- the Web API ----------
  const m = /^\/api\/([\w.]+)$/.exec(url.pathname)
  if (!m || req.method !== 'POST') return answer(res, 404, { ok: false, error: 'unknown_method' })
  const method = m[1]
  const params = Object.fromEntries(new URLSearchParams(raw))
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const appId = Object.keys(APPS).find((a) => APPS[a].bot === token || APPS[a].app === token) || null
  note({ method, params, app: appId })
  if (limits[method]?.n > 0) { limits[method].n--; return answer(res, 429, { ok: false, error: 'ratelimited' }, { 'retry-after': String(limits[method].wait) }) }
  if (fails[method]?.n > 0) { fails[method].n--; return answer(res, 200, { ok: false, error: fails[method].error }) }
  if (away) return req.socket.destroy() // nothing gets through
  if (method === 'apps.connections.open') {
    const a = Object.keys(APPS).find((x) => APPS[x].app === token)
    if (!a) return answer(res, 200, { ok: false, error: token.startsWith('xoxb-') ? 'not_allowed_token_type' : 'invalid_auth' })
    return answer(res, 200, { ok: true, url: `ws://127.0.0.1:${port}/link/?app=${a}&ticket=t${Date.now()}` })
  }
  const a = Object.keys(APPS).find((x) => APPS[x].bot === token)
  if (!a) return answer(res, 200, { ok: false, error: token.startsWith('xapp-') ? 'not_allowed_token_type' : 'invalid_auth' })
  const app = APPS[a]
  const ok = (j) => answer(res, 200, { ok: true, ...j }, { 'x-oauth-scopes': app.scopes.join(',') })
  const no = (error) => answer(res, 200, { ok: false, error }, { 'x-oauth-scopes': app.scopes.join(',') })
  const mine = (channel) => CHANNELS[channel]?.apps.includes(a)
  const needs = (scope) => (app.scopes.includes(scope) ? null : no('missing_scope'))
  if (method === 'auth.test') return ok(app.who)
  if (method === 'users.list') return ok({ members: PEOPLE, response_metadata: { next_cursor: '' } })
  if (method === 'users.info') { const u = [...PEOPLE, ...STRANGERS].find((x) => x.id === params.user); return u ? ok({ user: u }) : no('user_not_found') }
  if (method === 'users.conversations') return ok({ channels: Object.values(CHANNELS).filter((c) => c.apps.includes(a)).map(({ apps, ...c }) => c), response_metadata: { next_cursor: '' } }) // eslint-disable-line no-unused-vars
  if (method === 'conversations.info') return mine(params.channel) ? ok({ channel: (({ apps, ...c }) => c)(CHANNELS[params.channel]) }) : no('channel_not_found') // eslint-disable-line no-unused-vars
  if (method === 'conversations.history') {
    if (!mine(params.channel)) return no('channel_not_found')
    const from = Number(params.oldest || 0)
    const to = params.latest ? Number(params.latest) : Infinity
    return ok({ messages: history[params.channel].filter((x) => Number(x.ts) > from && Number(x.ts) < to).reverse().slice(0, Number(params.limit) || 100), has_more: false })
  }
  if (method === 'conversations.replies') {
    if (!mine(params.channel)) return no('channel_not_found')
    const list = replies[`${params.channel}:${params.ts}`] || [find(params.channel, params.ts)].filter(Boolean)
    if (!list.length) return no('thread_not_found')
    const from = Number(params.oldest || 0)
    return ok({ messages: list.filter((x) => Number(x.ts) > from || (!params.oldest && x.ts === params.ts)).slice(0, Number(params.limit) || 1000), has_more: false })
  }
  if (method === 'pins.list') return needs('pins:read') || (mine(params.channel) ? ok({ items: pins[params.channel] }) : no('channel_not_found'))
  if (method === 'reactions.add' || method === 'reactions.remove') {
    const lacks = needs('reactions:write')
    if (lacks) return lacks
    if (!mine(params.channel) || !find(params.channel, params.timestamp)) return no('message_not_found')
    const has = reactions.find((r) => r.app === a && r.channel === params.channel && r.ts === params.timestamp && r.name === params.name)
    if (method === 'reactions.add') { if (has) return no('already_reacted'); reactions.push({ app: a, channel: params.channel, ts: params.timestamp, name: params.name }); return ok({}) }
    if (!has) return no('no_reaction')
    reactions = reactions.filter((r) => r !== has)
    return ok({})
  }
  if (method === 'chat.postMessage') {
    if (!mine(params.channel)) return no('channel_not_found')
    const out = { app: a, channel: params.channel, text: params.text, thread_ts: params.thread_ts || null, ts: ts() }
    posted.push(out)
    const msg = { type: 'message', user: app.who.user_id, bot_id: app.who.bot_id, text: params.text, ts: out.ts, ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}) }
    if (params.thread_ts) (replies[`${params.channel}:${params.thread_ts}`] ||= [find(params.channel, params.thread_ts)].filter(Boolean)).push(msg)
    else history[params.channel].push(msg)
    return ok({ channel: params.channel, ts: out.ts, message: { text: params.text, user: app.who.user_id, bot_id: app.who.bot_id } })
  }
  return no('unknown_method')
})

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/link') || away) return socket.destroy()
  const app = new URL(req.url, 'http://x').searchParams.get('app')
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.app = app
    sockets.add(ws)
    ws.on('close', () => sockets.delete(ws))
    // A connection gone dead answers nothing, pings included.
    ws.on('ping', (d) => { if (!ws.dead) ws.pong(d) })
    ws.on('message', (raw) => {
      if (ws.dead) return
      try { const j = JSON.parse(String(raw)); if (j.envelope_id) acks++ } catch { /* not JSON */ }
    })
    hellos++
    ws.send(JSON.stringify({ type: 'hello', num_connections: sockets.size, debug_info: { host: 'stand-in', approximate_connection_time: 18060 }, connection_info: { app_id: app } }))
  })
})
server.listen(Number(port), '127.0.0.1', () => console.log(`stand-in Slack on ${port}`))
