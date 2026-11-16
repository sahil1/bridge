// A Slack workspace for tests (the Slack Bot, slack-bot): Slack's Web API and Socket Mode on this
// computer, so a test connects, asks and gets answers with nothing leaving the machine. The server
// reaches it as BRIDGE_SLACK_URL.
//   node slack.mjs <port> <log>
// The Web API (POST /api/<method>, form-encoded, a bearer token), as Slack answers: auth.test and
// users.list, chat.postMessage, users.conversations, conversations.history and conversations.info
// with the bot token (xoxb-test); apps.connections.open with the app-level token (xapp-test), giving
// ws://…/link, where Socket Mode says hello, sends events in envelopes and expects each one
// acknowledged. A wrong token: invalid_auth. Each call goes in the log, as { method, params }.
// And, for tests:
//   POST /_test/ask { user, text, channel?, dm?, thread? }   someone writes to the bot: a mention
//                      in a channel (its text should hold <@UBOT>), or a direct message. It's in the
//                      conversation's history, and sent as an event to the connection, if there is one
//   POST /_test/drop   every connection closes at once (a network that changed)
//   POST /_test/away   none can connect, and each one there goes dead without a word (a computer
//                      asleep, a lid closed); POST /_test/back to let them again
//   POST /_test/refresh  asks for a fresh connection (disconnect, refresh_requested)
//   POST /_test/limit { method, n, wait }   the next n calls to method answer 429, Retry-After wait
//   POST /_test/fail { method, error, n }   the next n calls to method answer { ok: false, error }
//   GET  /_test/state  { connections, hellos, envelopes, acks, posted: [{ channel, text, thread_ts }] }
import http from 'node:http'
import fs from 'node:fs'
import { WebSocketServer } from 'ws'

const [port, log] = process.argv.slice(2)
const BOT = { team_id: 'T0TEST', team: 'Acme Test', url: 'https://acme-test.slack.com/', user_id: 'UBOT', bot_id: 'BBOT', user: 'bridge_ai' }
const PEOPLE = [
  { id: 'U0DANA', name: 'dana', real_name: 'Dana Reyes', profile: { display_name: 'Dana', real_name: 'Dana Reyes', title: 'Sales' } },
  { id: 'U0SAM', name: 'sam', real_name: 'Sam Okafor', profile: { display_name: 'Sam', real_name: 'Sam Okafor', title: 'Support' } },
  { id: 'U0EVE', name: 'eve', real_name: 'Eve Mallory', profile: { display_name: 'Eve', real_name: 'Eve Mallory' } },
  { id: 'U0OWNER', name: 'tester', real_name: 'Tester', profile: { display_name: 'Tester', real_name: 'Tester' } },
  { id: 'UOLDBOT', name: 'jira', is_bot: true, profile: { display_name: 'Jira' } },
  { id: 'U0GONE', name: 'gone', deleted: true, profile: { display_name: 'Gone' } },
]
const CHANNELS = { C0LAUNCH: { id: 'C0LAUNCH', name: 'launch', is_channel: true }, D0DANA: { id: 'D0DANA', is_im: true, user: 'U0DANA' }, D0SAM: { id: 'D0SAM', is_im: true, user: 'U0SAM' }, D0EVE: { id: 'D0EVE', is_im: true, user: 'U0EVE' } }
const history = Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, []]))
const posted = []
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

const sockets = new Set()
const wss = new WebSocketServer({ noServer: true, autoPong: false })
function send(event) {
  const env = { envelope_id: `env-${++envelopes}`, type: 'events_api', accepts_response_payload: false, retry_attempt: 0, payload: { team_id: BOT.team_id, api_app_id: 'A0TEST', type: 'event_callback', event_id: `Ev${envelopes}`, event } }
  for (const s of sockets) if (s.readyState === 1 && !s.dead) s.send(JSON.stringify(env))
}

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
      const channel = j.channel || (j.dm ? Object.values(CHANNELS).find((c) => c.is_im && c.user === j.user)?.id : 'C0LAUNCH')
      const m = { type: 'message', user: j.user, text: j.text, ts: ts(), ...(j.thread ? { thread_ts: j.thread } : {}) }
      if (!j.thread) history[channel].push(m)
      const dm = !!CHANNELS[channel]?.is_im
      if (dm) send({ ...m, channel, channel_type: 'im', event_ts: m.ts })
      else if (String(j.text).includes(`<@${BOT.user_id}>`)) send({ ...m, type: 'app_mention', channel, event_ts: m.ts })
      return answer(res, 200, { ok: true, ts: m.ts, channel, delivered: [...sockets].some((s) => s.readyState === 1 && !s.dead) })
    }
    if (what === 'drop') { for (const s of sockets) s.terminate(); return answer(res, 200, { ok: true }) }
    if (what === 'away') { away = true; for (const s of sockets) s.dead = true; return answer(res, 200, { ok: true }) }
    if (what === 'back') { away = false; return answer(res, 200, { ok: true }) }
    if (what === 'refresh') { for (const s of sockets) if (s.readyState === 1) s.send(JSON.stringify({ type: 'disconnect', reason: 'refresh_requested', debug_info: { host: 'test' } })); return answer(res, 200, { ok: true }) }
    if (what === 'limit') { limits[j.method] = { n: j.n || 1, wait: j.wait || 1 }; return answer(res, 200, { ok: true }) }
    if (what === 'fail') { fails[j.method] = { n: j.n || 1, error: j.error }; return answer(res, 200, { ok: true }) }
    if (what === 'state') return answer(res, 200, { connections: [...sockets].filter((s) => s.readyState === 1 && !s.dead).length, hellos, envelopes, acks, posted })
    return answer(res, 404, { error: 'no such control' })
  }
  // ---------- the Web API ----------
  const m = /^\/api\/([\w.]+)$/.exec(url.pathname)
  if (!m || req.method !== 'POST') return answer(res, 404, { ok: false, error: 'unknown_method' })
  const method = m[1]
  const params = Object.fromEntries(new URLSearchParams(raw))
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  note({ method, params })
  if (limits[method]?.n > 0) { limits[method].n--; return answer(res, 429, { ok: false, error: 'ratelimited' }, { 'retry-after': String(limits[method].wait) }) }
  if (fails[method]?.n > 0) { fails[method].n--; return answer(res, 200, { ok: false, error: fails[method].error }) }
  if (away) return req.socket.destroy() // nothing gets through
  if (method === 'apps.connections.open') {
    if (token !== 'xapp-test') return answer(res, 200, { ok: false, error: token.startsWith('xoxb-') ? 'not_allowed_token_type' : 'invalid_auth' })
    return answer(res, 200, { ok: true, url: `ws://127.0.0.1:${port}/link/?ticket=t${Date.now()}` })
  }
  if (token !== 'xoxb-test') return answer(res, 200, { ok: false, error: token.startsWith('xapp-') ? 'not_allowed_token_type' : 'invalid_auth' })
  if (method === 'auth.test') return answer(res, 200, { ok: true, ...BOT })
  if (method === 'users.list') return answer(res, 200, { ok: true, members: PEOPLE, response_metadata: { next_cursor: '' } })
  if (method === 'users.conversations') return answer(res, 200, { ok: true, channels: Object.values(CHANNELS), response_metadata: { next_cursor: '' } })
  if (method === 'conversations.info') return CHANNELS[params.channel] ? answer(res, 200, { ok: true, channel: CHANNELS[params.channel] }) : answer(res, 200, { ok: false, error: 'channel_not_found' })
  if (method === 'conversations.history') {
    const list = history[params.channel]
    if (!list) return answer(res, 200, { ok: false, error: 'channel_not_found' })
    const from = Number(params.oldest || 0)
    return answer(res, 200, { ok: true, messages: list.filter((x) => Number(x.ts) > from).reverse().slice(0, Number(params.limit) || 100), has_more: false })
  }
  if (method === 'chat.postMessage') {
    if (!CHANNELS[params.channel]) return answer(res, 200, { ok: false, error: 'channel_not_found' })
    const out = { channel: params.channel, text: params.text, thread_ts: params.thread_ts || null, ts: ts() }
    posted.push(out)
    return answer(res, 200, { ok: true, channel: params.channel, ts: out.ts, message: { text: params.text, user: BOT.user_id, bot_id: BOT.bot_id } })
  }
  return answer(res, 200, { ok: false, error: 'unknown_method' })
})

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/link') || away) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws)
    ws.on('close', () => sockets.delete(ws))
    // A connection gone dead answers nothing, pings included.
    ws.on('ping', (d) => { if (!ws.dead) ws.pong(d) })
    ws.on('message', (raw) => {
      if (ws.dead) return
      try { const j = JSON.parse(String(raw)); if (j.envelope_id) acks++ } catch { /* not JSON */ }
    })
    hellos++
    ws.send(JSON.stringify({ type: 'hello', num_connections: sockets.size, debug_info: { host: 'stand-in', approximate_connection_time: 18060 }, connection_info: { app_id: 'A0TEST' } }))
  })
})
server.listen(Number(port), '127.0.0.1', () => console.log(`stand-in Slack on ${port}`))
