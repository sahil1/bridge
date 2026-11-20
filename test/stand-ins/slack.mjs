// A Slack workspace for tests (Bots: slack-bot, bots-activity and the suites after them): Slack's Web
// API and Socket Mode on this computer, with two apps in it (two bots), so a test connects, asks and
// gets answers with nothing leaving the machine. The server reaches it as BRIDGE_SLACK_URL.
//   node slack.mjs <port> <log>
// The apps: A1 (tokens xapp-test and xoxb-test, its bot @bridge_ai, UBOT) and A2 (xapp-two and
// xoxb-two, @atlas, UBOT2), both in #launch (public), A1 in #secret-project (C0PRIV, private), each
// with direct messages of its own (the owner, U0OWNER "Tester", has D0OWNER with A1 and D2OWNER with
// A2). The Web API (POST /api/<method>, form-encoded, a bearer token), as Slack answers: auth.test
// (with the token's scopes in its x-oauth-scopes header, as every answer has), users.list and
// users.info (Dana, Sam and Eve are members; Gus a guest; Xena from another company, in no list,
// known to users.info as another team's, is_stranger), chat.postMessage (blocks kept), chat.update,
// chat.postEphemeral, users.conversations, conversations.history, conversations.replies,
// conversations.info (is_private), conversations.open (a direct message, made when there's none),
// pins.list, reactions.add and reactions.remove, views.open (with a trigger it gave, at most 10 s
// old) and views.publish, agents.sessions.setStatus and assistant.threads.setStatus (assistant:write),
// chat.startStream, chat.appendStream and chat.stopStream (12,000 characters and 10 minutes in all,
// recipient_user_id and recipient_team_id needed outside a direct message), files.getUploadURLExternal
// (an address here, /upload/<id>, taking the raw bytes) and files.completeUploadExternal (the file
// shared in the thread), files.info; with the bot token, each checking its scope as Slack does.
// chat.postMessage and chat.startStream post as someone else (username, icon_emoji or icon_url: one
// app reaching several bots, server/connhub.js) only for an app with chat:write.customize, and
// ignore them otherwise, as Slack does; what they posted as is on posted and streams.
// apps.connections.open with the app-level token, giving ws://…/link?app=<id>, where Socket Mode
// says hello, sends events in envelopes and expects each one acknowledged. A wrong token:
// invalid_auth. Each call goes in the log, as { method, params, app }. A file attached to a message
// is served at GET /files/<id>/<name>, only with a bot token (else 403).
// Events, as Slack sends them to an app subscribed to app_mention and message.*: a message in a
// channel goes to each app as a message event (a mention of it besides, as app_mention); a direct
// message to its own app; an edit or deletion as a message event of that subtype; and what an app
// posts (chat.postMessage, a stream started, a file shared), back to the apps in that conversation
// as a message event with its bot_id, as Slack sends an app its own messages. As Slack does, each
// envelope goes to ONE of an app's open connections (the next in turn), never to each of them, and
// hello's num_connections counts that app's connections open (with this one).
// And, for tests:
//   POST /_test/ask { user, text, channel?, dm?, app?, thread?, files? }   someone writes: in a
//                      channel (#launch unless said), a direct message to an app (app: A1 unless
//                      said), or a reply in a thread (thread: its ts), with files ([{ name, type,
//                      content }]: a file_share message). It's in the conversation (its history, or
//                      the thread's replies), and sent as events to the apps connected
//   POST /_test/edit { channel, ts, text }, /_test/delete { channel, ts }   a message changed, gone
//   POST /_test/pin { channel, ts }    a message pinned
//   POST /_test/channel { channel, members?, shared? }   a channel's members set; shared with another company
//                      (or no longer), told to the apps in it (channel_shared, channel_unshared)
//   POST /_test/name { user, name }  a person sets their own display name, as anyone may
//   POST /_test/scopes { app, scopes } the scopes an app's token has (an app made from an older
//                      manifest); without scopes, every one again
//   POST /_test/drop   every connection closes at once (a network that changed)
//   POST /_test/away   none can connect, and each one there goes dead without a word (a computer
//                      asleep, a lid closed); POST /_test/back to let them again
//   POST /_test/refresh { app? }  asks for a fresh connection (disconnect, refresh_requested)
//   POST /_test/linkoff { app? }  Socket Mode turned off for the app (disconnect, link_disabled)
//   POST /_test/limit { method, n, wait, channel? }   the next n calls to method (in that channel
//                      only, when it's given) answer 429, Retry-After wait
//   POST /_test/fail { method, error, n }   the next n calls to method answer { ok: false, error }
//   POST /_test/deaf { app?, on? }   the app's Event Subscriptions off (on: false, back on): no
//                      events_api envelopes reach it, interactivity and commands still do
//   POST /_test/click { app?, user, action_id, value, channel?, ts? }   a button pressed (block_actions,
//                      in an interactive envelope): on the message given, else the latest one the
//                      app posted with that button and value
//   POST /_test/submit { app?, user, callback_id, private_metadata, values: { <block>: { <action>:
//                      value } } }   a modal sent (view_submission)
//   POST /_test/slash { app?, user, command, text, channel }   /<command> typed (slash_commands)
//   POST /_test/shortcut { app?, user, channel, ts }   the message shortcut on a message
//                      (message_action, callback_id bb_ask)
//   POST /_test/home { app?, user, tab? }   its Home tab opened (app_home_opened)
//   POST /_test/stop { app?, user, channel, thread }   Slack's Stop pressed (agent_session_stopped)
//   GET  /_test/state  { connections, hellos, envelopes, acks, ackPayloads: [{ envelope_id, payload }],
//                      posted: [{ app, channel, text, thread_ts, ts, blocks?, streamed?, username?,
//                      icon_emoji?, icon_url? }],
//                      reactions: [{ app, channel, ts, name }] (those on now), updated: [{ app,
//                      channel, ts, text, blocks }], ephemeral: [{ app, channel, user, text,
//                      thread_ts }], views: [{ app, kind: 'open' | 'publish', user, trigger, view }],
//                      statuses: [{ app, method, channel, thread, status }], streams: [{ app,
//                      channel, thread, ts, text, stopped, calls, username? }], files: [{ id, name, size,
//                      channel, thread, app, title, content, sha256 }], dms: [{ app, users, channel }],
//                      deleted: [{ app, channel, ts }], perSocket: { <app>: [envelopes each of its
//                      open connections had] } }
import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'

const [port, log] = process.argv.slice(2)
const ALL = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'im:write', 'users:read', 'users:read.email', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'mpim:history', 'mpim:read', 'reactions:write', 'pins:read', 'files:read', 'files:write', 'commands', 'assistant:write', 'chat:write.customize']
const APPS = {
  A1: { app: 'xapp-test', bot: 'xoxb-test', who: { team_id: 'T0TEST', team: 'Acme Test', url: 'https://acme-test.slack.com/', user_id: 'UBOT', bot_id: 'BBOT', user: 'bridge_ai' }, scopes: ALL },
  A2: { app: 'xapp-two', bot: 'xoxb-two', who: { team_id: 'T0TEST', team: 'Acme Test', url: 'https://acme-test.slack.com/', user_id: 'UBOT2', bot_id: 'BBOT2', user: 'atlas' }, scopes: ALL },
}
const PEOPLE = [
  { id: 'U0DANA', team_id: 'T0TEST', name: 'dana', real_name: 'Dana Reyes', profile: { display_name: 'Dana', real_name: 'Dana Reyes', title: 'Sales', email: 'dana@acme.test' } }, // private-ok: a stand-in person's made-up email
  { id: 'U0SAM', team_id: 'T0TEST', name: 'sam', real_name: 'Sam Okafor', profile: { display_name: 'Sam', real_name: 'Sam Okafor', title: 'Support', email: 'sam@acme.test' } }, // private-ok: a stand-in person's made-up email
  { id: 'U0EVE', team_id: 'T0TEST', name: 'eve', real_name: 'Eve Mallory', profile: { display_name: 'Eve', real_name: 'Eve Mallory' } },
  { id: 'U0OWNER', team_id: 'T0TEST', name: 'tester', real_name: 'Tester', profile: { display_name: 'Tester', real_name: 'Tester', email: 'tester@acme.test' } }, // private-ok: a stand-in person's made-up email
  { id: 'U0GUS', team_id: 'T0TEST', name: 'gus', real_name: 'Gus Guest', is_restricted: true, profile: { display_name: 'Gus', real_name: 'Gus Guest', title: 'Contractor' } },
  { id: 'UOLDBOT', team_id: 'T0TEST', name: 'jira', is_bot: true, profile: { display_name: 'Jira' } },
  { id: 'U0GONE', team_id: 'T0TEST', name: 'gone', deleted: true, profile: { display_name: 'Gone' } },
]
// Someone from another company, in a shared channel: not in the members' list.
const STRANGERS = [{ id: 'U0XENA', team_id: 'T0OTHER', name: 'xena', real_name: 'Xena Partner', is_stranger: true, profile: { display_name: 'Xena', real_name: 'Xena Partner' } }]
const CHANNELS = {
  C0LAUNCH: { id: 'C0LAUNCH', name: 'launch', is_channel: true, is_private: false, apps: ['A1', 'A2'] },
  C0PRIV: { id: 'C0PRIV', name: 'secret-project', is_channel: true, is_group: true, is_private: true, apps: ['A1'] },
  D0DANA: { id: 'D0DANA', is_im: true, user: 'U0DANA', apps: ['A1'] }, D0SAM: { id: 'D0SAM', is_im: true, user: 'U0SAM', apps: ['A1'] }, D0EVE: { id: 'D0EVE', is_im: true, user: 'U0EVE', apps: ['A1'] },
  D0OWNER: { id: 'D0OWNER', is_im: true, user: 'U0OWNER', apps: ['A1'] },
  D2DANA: { id: 'D2DANA', is_im: true, user: 'U0DANA', apps: ['A2'] }, D2EVE: { id: 'D2EVE', is_im: true, user: 'U0EVE', apps: ['A2'] }, D2OWNER: { id: 'D2OWNER', is_im: true, user: 'U0OWNER', apps: ['A2'] },
}
const history = Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, []]))
const replies = {} // `${channel}:${thread}` -> [messages]
const pins = Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, []]))
const posted = []
let reactions = []
const updated = []
const ephemeral = []
const views = []
const statuses = []
const streams = []
const files = [] // files the apps shared
const dms = []
const deleted = []
const ackPayloads = []
const attachments = {} // file id -> { name, type, bytes } (attached by someone, or uploaded by an app)
const uploads = {} // file id -> { name, length, app, bytes }
const triggers = new Map() // trigger id -> { at, user, app }
const limits = {}
const fails = {}
let away = false
let hellos = 0
let envelopes = 0
let acks = 0
let fileN = 0
let triggerN = 0
let clock = Date.now() / 1000
// Message times as Slack's: seconds with six places, each later than the last.
const ts = () => { clock = Math.max(clock + 0.001, Date.now() / 1000); return clock.toFixed(6) }
const note = (o) => { if (log) fs.appendFileSync(log, `${JSON.stringify(o)}\n`) }
const find = (channel, at) => history[channel]?.find((m) => m.ts === at) || Object.entries(replies).filter(([k]) => k.startsWith(`${channel}:`)).flatMap(([, l]) => l).find((m) => m.ts === at) || null
const strip = ({ apps, members, ...c }) => c // eslint-disable-line no-unused-vars
// Who's in each channel (conversations.members): #launch everyone, #secret-project Dana, Eve, you and
// the first app's bot; a direct message, its person and the app's bot (or as /_test/channel set).
const membersOf = (c) => c.members || (c.is_im ? [c.user, c.apps.includes('A2') ? 'UBOT2' : 'UBOT'] : c.id === 'C0PRIV' ? ['U0DANA', 'U0EVE', 'U0OWNER', 'UBOT'] : [...PEOPLE.filter((p) => !p.deleted && !p.is_bot).map((p) => p.id), 'UBOT', 'UBOT2'])
const textLike = (name, type) => /^text\/|json|csv|svg|xml|markdown/i.test(String(type || '')) || /\.(txt|md|csv|json|svg|xml|html?|tsv|ya?ml|js|ts|py)$/i.test(String(name || ''))
// A message in a conversation: at its top, or in a thread (the thread made with its first message).
const put = (channel, m) => {
  if (m.thread_ts && m.thread_ts !== m.ts) (replies[`${channel}:${m.thread_ts}`] ||= [find(channel, m.thread_ts)].filter(Boolean)).push(m)
  else history[channel].push(m)
}
const trigger = (user, app) => { const id = `${++triggerN}.${Date.now()}.tr${triggerN}`; triggers.set(id, { at: Date.now(), user, app }); return id }

const sockets = new Set()
const wss = new WebSocketServer({ noServer: true, autoPong: false })
const deaf = new Set() // apps whose Event Subscriptions are off
const turn = {} // app -> the next of its connections in turn
// An envelope of any kind to ONE live connection of an app, the next in turn (Slack sends each to
// any one of them); events_api's wrap an event, and reach no app that's deaf.
function envelope(app, type, payload, extra = {}) {
  const env = { envelope_id: `env-${++envelopes}`, type, accepts_response_payload: type !== 'events_api', retry_attempt: 0, retry_reason: '', payload, ...extra }
  if (type === 'events_api' && deaf.has(app)) return env.envelope_id
  const open = [...sockets].filter((s) => s.app === app && s.readyState === 1 && !s.dead)
  if (open.length) {
    const s = open[(turn[app] = ((turn[app] ?? -1) + 1)) % open.length]
    s.got = (s.got || 0) + 1
    s.send(JSON.stringify(env))
  }
  return env.envelope_id
}
const send = (app, event) => envelope(app, 'events_api', { team_id: 'T0TEST', api_app_id: app, type: 'event_callback', event_id: `Ev${envelopes + 1}`, event_time: Math.floor(Date.now() / 1000), event })
const live = (app) => [...sockets].some((s) => s.app === app && s.readyState === 1 && !s.dead)
// What an app posted, back to the apps in that conversation as a message event (after the answer
// to the call that posted it, as Slack's usually comes).
const echo = (channel, m) => {
  const c = CHANNELS[channel]
  if (!c) return
  setImmediate(() => { for (const a of c.apps) send(a, { ...m, channel, channel_type: c.is_im ? 'im' : c.is_private ? 'group' : 'channel', event_ts: m.ts }) })
}
const personOf = (id) => [...PEOPLE, ...STRANGERS].find((p) => p.id === id) || { id, name: id, team_id: 'T0TEST' }
const userOf = (id) => { const p = personOf(id); return { id: p.id, username: p.name, name: p.name, team_id: p.team_id } }

const answer = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
const bodyOf = (req) => new Promise((r) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => r(Buffer.concat(parts))) })
const json = (s) => { try { return JSON.parse(s) } catch { return null } }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const bytes = await bodyOf(req)
  const raw = bytes.toString('utf8')
  // ---------- test controls ----------
  if (url.pathname.startsWith('/_test/')) {
    const what = url.pathname.slice(7)
    const j = raw ? JSON.parse(raw) : {}
    const app = j.app || 'A1'
    if (what === 'ask') {
      const channel = j.channel || (j.dm ? Object.values(CHANNELS).find((c) => c.is_im && c.user === j.user && c.apps.includes(app))?.id : 'C0LAUNCH')
      const who = personOf(j.user)
      const att = (j.files || []).map((f) => {
        const id = `F0ATT${++fileN}`
        const b = Buffer.from(String(f.content ?? ''), f.base64 ? 'base64' : 'utf8')
        attachments[id] = { name: f.name, type: f.type || 'text/plain', bytes: b }
        const href = `http://127.0.0.1:${port}/files/${id}/${encodeURIComponent(f.name)}`
        return { id, name: f.name, title: f.name, mimetype: f.type || 'text/plain', filetype: String(f.name).split('.').pop(), size: b.length, url_private: href, url_private_download: `${href}?download=1`, mode: 'hosted' }
      })
      // (Typed in Slack: a client's own id; posted by an app as the person, with their token: an app_id (asApp), or neither (untyped).)
      const m = { type: 'message', user: j.user, text: j.text || '', ts: ts(), ...(j.asApp ? { app_id: 'A0ZAPIER' } : j.untyped ? {} : { client_msg_id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }), ...(j.thread ? { thread_ts: j.thread } : {}), ...(who?.team_id && who.team_id !== 'T0TEST' ? { user_team: who.team_id } : {}), ...(att.length ? { subtype: 'file_share', files: att } : {}) }
      put(channel, m)
      const c = CHANNELS[channel]
      const dm = !!c?.is_im
      for (const a of c?.apps || []) {
        send(a, { ...m, channel, channel_type: dm ? 'im' : c.is_private ? 'group' : 'channel', event_ts: m.ts })
        if (!dm && String(j.text).includes(`<@${APPS[a].who.user_id}>`)) send(a, { ...m, type: 'app_mention', channel, event_ts: m.ts })
      }
      return answer(res, 200, { ok: true, ts: m.ts, channel, delivered: (c?.apps || []).some(live), files: att.map((f) => f.id) })
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
    if (what === 'click') {
      // On the message given, else the latest the app posted with that button.
      let channel = j.channel
      let at = j.ts
      if (!channel || !at) {
        const p = [...posted, ...updated].reverse().find((x) => x.app === app && JSON.stringify(x.blocks || []).includes(`"action_id":"${j.action_id}"`) && JSON.stringify(x.blocks || []).includes(`"value":${JSON.stringify(String(j.value))}`))
        channel ||= p?.channel
        at ||= p?.ts
      }
      const msg = channel && at ? find(channel, at) : null
      const payload = {
        type: 'block_actions', user: userOf(j.user), api_app_id: app, token: 'verification-token', trigger_id: trigger(j.user, app), team: { id: 'T0TEST', domain: 'acme-test' },
        container: { type: 'message', message_ts: at || null, channel_id: channel || null, is_ephemeral: false, ...(msg?.thread_ts ? { thread_ts: msg.thread_ts } : {}) },
        channel: channel ? { id: channel, name: CHANNELS[channel]?.name || 'directmessage' } : undefined,
        message: msg || undefined, response_url: 'https://hooks.slack.invalid/actions/x',
        actions: [{ type: 'button', action_id: j.action_id, block_id: j.block_id || 'b', value: String(j.value ?? ''), action_ts: String(Date.now() / 1000) }],
      }
      return answer(res, 200, { ok: true, envelope_id: envelope(app, 'interactive', payload), channel, ts: at, delivered: live(app) })
    }
    if (what === 'submit') {
      const values = Object.fromEntries(Object.entries(j.values || {}).map(([b, acts]) => [b, Object.fromEntries(Object.entries(acts).map(([a, v]) => [a, { type: 'plain_text_input', value: v }]))]))
      const payload = {
        type: 'view_submission', user: userOf(j.user), api_app_id: app, token: 'verification-token', trigger_id: trigger(j.user, app), team: { id: 'T0TEST', domain: 'acme-test' },
        view: { id: `V${envelopes + 1}`, type: 'modal', callback_id: j.callback_id, private_metadata: typeof j.private_metadata === 'string' ? j.private_metadata : JSON.stringify(j.private_metadata ?? ''), state: { values }, hash: 'h' },
        response_urls: [],
      }
      return answer(res, 200, { ok: true, envelope_id: envelope(app, 'interactive', payload), delivered: live(app) })
    }
    if (what === 'slash') {
      const c = CHANNELS[j.channel]
      const payload = {
        token: 'verification-token', team_id: 'T0TEST', team_domain: 'acme-test', channel_id: j.channel, channel_name: c?.is_im ? 'directmessage' : c?.name || 'unknown',
        user_id: j.user, user_name: personOf(j.user).name, command: j.command, text: j.text ?? '', api_app_id: app, is_enterprise_install: 'false',
        response_url: 'https://hooks.slack.invalid/commands/x', trigger_id: trigger(j.user, app),
      }
      return answer(res, 200, { ok: true, envelope_id: envelope(app, 'slash_commands', payload), delivered: live(app) })
    }
    if (what === 'shortcut') {
      const msg = find(j.channel, j.ts)
      if (!msg) return answer(res, 404, { ok: false, error: 'message_not_found' })
      const c = CHANNELS[j.channel]
      const payload = {
        type: 'message_action', token: 'verification-token', action_ts: String(Date.now() / 1000), team: { id: 'T0TEST', domain: 'acme-test' }, user: userOf(j.user),
        channel: { id: j.channel, name: c?.is_im ? 'directmessage' : c?.name }, callback_id: j.callback_id || 'bb_ask', trigger_id: trigger(j.user, app),
        message_ts: msg.ts, message: msg, response_url: 'https://hooks.slack.invalid/actions/y',
      }
      return answer(res, 200, { ok: true, envelope_id: envelope(app, 'interactive', payload), delivered: live(app) })
    }
    if (what === 'home') {
      const dm = Object.values(CHANNELS).find((c) => c.is_im && c.user === j.user && c.apps.includes(app))
      return answer(res, 200, { ok: true, envelope_id: send(app, { type: 'app_home_opened', user: j.user, channel: dm?.id || 'D0HOME', tab: j.tab || 'home', event_ts: ts() }), delivered: live(app) })
    }
    if (what === 'stop') {
      const s = streams.filter((x) => x.app === app && x.channel === j.channel && x.thread === j.thread && !x.stopped).map((x) => x.ts)
      return answer(res, 200, { ok: true, envelope_id: send(app, { type: 'agent_session_stopped', channel: j.channel, thread_ts: j.thread, user: j.user, streaming_message_ts: s, event_ts: ts() }), delivered: live(app) })
    }
    // A channel's members set, or shared with another company (or no longer): channel_shared and
    // channel_unshared to the apps in it, as Slack sends them.
    if (what === 'channel') {
      const c = CHANNELS[j.channel]
      if (!c) return answer(res, 404, { ok: false })
      if (Array.isArray(j.members)) c.members = j.members
      if (j.shared !== undefined && !!c.is_ext_shared !== !!j.shared) {
        c.is_ext_shared = !!j.shared
        for (const x of c.apps) send(x, { type: j.shared ? 'channel_shared' : 'channel_unshared', channel: c.id, connected_team_id: 'T0OTHER', event_ts: ts() })
      }
      return answer(res, 200, { ok: true })
    }
    if (what === 'pin') { const m = find(j.channel, j.ts); if (m) pins[j.channel].push({ type: 'message', channel: j.channel, message: m }); return answer(res, 200, { ok: !!m }) }
    // (A person's display name, as anyone may set their own.)
    if (what === 'name') { const p = personOf(j.user); if (p.profile) p.profile.display_name = String(j.name); return answer(res, 200, { ok: !!p.profile }) }
    if (what === 'scopes') { APPS[j.app || 'A1'].scopes = Array.isArray(j.scopes) ? j.scopes : ALL; return answer(res, 200, { ok: true }) }
    if (what === 'drop') { for (const s of sockets) s.terminate(); return answer(res, 200, { ok: true }) }
    if (what === 'away') { away = true; for (const s of sockets) s.dead = true; return answer(res, 200, { ok: true }) }
    if (what === 'back') { away = false; return answer(res, 200, { ok: true }) }
    if (what === 'refresh') { for (const s of sockets) if (s.readyState === 1 && (!j.app || s.app === j.app)) s.send(JSON.stringify({ type: 'disconnect', reason: 'refresh_requested', debug_info: { host: 'test' } })); return answer(res, 200, { ok: true }) }
    // Socket Mode turned off for an app: its connections told so (link_disabled), and closed.
    if (what === 'linkoff') { for (const s of sockets) if (s.readyState === 1 && s.app === app) { s.send(JSON.stringify({ type: 'disconnect', reason: 'link_disabled', debug_info: { host: 'test' } })); setTimeout(() => s.terminate(), 50) } return answer(res, 200, { ok: true }) }
    if (what === 'limit') { limits[j.method] = { n: j.n || 1, wait: j.wait || 1, channel: j.channel || null }; return answer(res, 200, { ok: true }) }
    if (what === 'fail') { fails[j.method] = { n: j.n || 1, error: j.error }; return answer(res, 200, { ok: true }) }
    if (what === 'deaf') { if (j.on === false) deaf.delete(app); else deaf.add(app); return answer(res, 200, { ok: true }) }
    if (what === 'state') {
      const perSocket = {}
      for (const s of sockets) if (s.readyState === 1 && !s.dead) (perSocket[s.app] ||= []).push(s.got || 0)
      return answer(res, 200, { connections: [...sockets].filter((s) => s.readyState === 1 && !s.dead).length, hellos, envelopes, acks, ackPayloads, posted, reactions, updated, ephemeral, views, statuses, streams, files, dms, deleted, perSocket })
    }
    return answer(res, 404, { error: 'no such control' })
  }
  // ---------- A file's bytes: one attached by someone (with a bot token), one an app uploads ----------
  const got = /^\/files\/([\w]+)\/[^/]*$/.exec(url.pathname)
  if (got && req.method === 'GET') {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const f = attachments[got[1]]
    if (!Object.values(APPS).some((a) => a.bot === token)) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('Not signed in') }
    if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('No such file') }
    res.writeHead(200, { 'content-type': f.type || 'application/octet-stream', 'content-length': f.bytes.length })
    return res.end(f.bytes)
  }
  const up = /^\/upload\/([\w]+)$/.exec(url.pathname)
  if (up && req.method === 'POST') {
    const u = uploads[up[1]]
    if (!u) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('No such upload') }
    u.bytes = bytes
    note({ method: 'upload', params: { file: up[1], size: bytes.length }, app: u.app })
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end(`OK - ${bytes.length}`)
  }
  // ---------- the Web API ----------
  const m = /^\/api\/([\w.]+)$/.exec(url.pathname)
  if (!m || req.method !== 'POST') return answer(res, 404, { ok: false, error: 'unknown_method' })
  const method = m[1]
  const params = Object.fromEntries(new URLSearchParams(raw))
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const appId = Object.keys(APPS).find((a) => APPS[a].bot === token || APPS[a].app === token) || null
  note({ method, params, app: appId })
  const lim = limits[method]
  if (lim?.n > 0 && (!lim.channel || [params.channel, params.channel_id].includes(lim.channel))) { lim.n--; return answer(res, 429, { ok: false, error: 'ratelimited' }, { 'retry-after': String(lim.wait) }) }
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
  const no = (error, extra = {}) => answer(res, 200, { ok: false, error, ...extra }, { 'x-oauth-scopes': app.scopes.join(',') })
  const mine = (channel) => CHANNELS[channel]?.apps.includes(a)
  const needs = (scope) => (app.scopes.includes(scope) ? null : no('missing_scope', { needed: scope, provided: app.scopes.join(',') }))
  const botMsg = (text, extra = {}) => ({ type: 'message', user: app.who.user_id, bot_id: app.who.bot_id, text, ts: ts(), ...extra })
  // (Posted as someone else: only with chat:write.customize.)
  const as = app.scopes.includes('chat:write.customize') ? Object.fromEntries(['username', 'icon_emoji', 'icon_url'].filter((k) => params[k]).map((k) => [k, params[k]])) : {}
  if (method === 'auth.test') return ok(app.who)
  if (method === 'users.list') return ok({ members: PEOPLE, response_metadata: { next_cursor: '' } })
  if (method === 'users.info') { const u = [...PEOPLE, ...STRANGERS].find((x) => x.id === params.user); return u ? ok({ user: u }) : no('user_not_found') }
  if (method === 'users.conversations') {
    const types = String(params.types || 'public_channel').split(',')
    const kind = (c) => (c.is_im ? 'im' : c.is_mpim ? 'mpim' : c.is_private ? 'private_channel' : 'public_channel')
    return ok({ channels: Object.values(CHANNELS).filter((c) => c.apps.includes(a) && types.includes(kind(c))).map(strip), response_metadata: { next_cursor: '' } })
  }
  if (method === 'conversations.info') return mine(params.channel) ? ok({ channel: strip(CHANNELS[params.channel]) }) : no('channel_not_found')
  if (method === 'conversations.members') return mine(params.channel) ? ok({ members: membersOf(CHANNELS[params.channel]), response_metadata: { next_cursor: '' } }) : no('channel_not_found')
  if (method === 'conversations.open') {
    const lacks = needs('im:write')
    if (lacks) return lacks
    const user = String(params.users || '').split(',')[0]
    if (!personOf(user) || !/^[UW]/.test(user)) return no('user_not_found')
    let c = Object.values(CHANNELS).find((x) => x.is_im && x.user === user && x.apps.includes(a))
    if (!c) {
      c = { id: `D${a}${user.replace(/^U0?/, '')}`, is_im: true, user, apps: [a] }
      CHANNELS[c.id] = c
      history[c.id] = []
      pins[c.id] = []
    }
    dms.push({ app: a, users: user, channel: c.id })
    return ok({ channel: { id: c.id } })
  }
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
    const lacks = needs('chat:write')
    if (lacks) return lacks
    if (!mine(params.channel)) return no(CHANNELS[params.channel] ? 'not_in_channel' : 'channel_not_found')
    const blocks = params.blocks ? json(params.blocks) : null
    const out = { app: a, channel: params.channel, text: params.text, thread_ts: params.thread_ts || null, ts: ts(), ...(blocks ? { blocks } : {}), ...as }
    posted.push(out)
    const msg = { ...botMsg(params.text), ts: out.ts, ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}), ...(blocks ? { blocks } : {}), ...as }
    put(params.channel, msg)
    echo(params.channel, msg)
    return ok({ channel: params.channel, ts: out.ts, message: { text: params.text, user: app.who.user_id, bot_id: app.who.bot_id } })
  }
  if (method === 'chat.delete') {
    const lacks = needs('chat:write')
    if (lacks) return lacks
    const msg = mine(params.channel) ? find(params.channel, params.ts) : null
    if (!msg) return no('message_not_found')
    if (msg.user !== app.who.user_id) return no('cant_delete_message')
    history[params.channel] = history[params.channel].filter((x) => x !== msg)
    for (const k of Object.keys(replies)) replies[k] = replies[k].filter((x) => x !== msg)
    deleted.push({ app: a, channel: params.channel, ts: params.ts })
    return ok({ channel: params.channel, ts: params.ts })
  }
  if (method === 'chat.update') {
    const lacks = needs('chat:write')
    if (lacks) return lacks
    const msg = mine(params.channel) ? find(params.channel, params.ts) : null
    if (!msg || msg.user !== app.who.user_id) return no(msg ? 'cant_update_message' : 'message_not_found')
    const blocks = params.blocks ? json(params.blocks) : null
    msg.text = params.text ?? msg.text
    if (blocks) msg.blocks = blocks
    const p = posted.find((x) => x.channel === params.channel && x.ts === params.ts)
    if (p) { p.text = msg.text; if (blocks) p.blocks = blocks }
    updated.push({ app: a, channel: params.channel, ts: params.ts, text: params.text ?? null, blocks })
    return ok({ channel: params.channel, ts: params.ts, text: msg.text })
  }
  if (method === 'chat.postEphemeral') {
    const lacks = needs('chat:write')
    if (lacks) return lacks
    if (!mine(params.channel)) return no(CHANNELS[params.channel] ? 'not_in_channel' : 'channel_not_found')
    if (!personOf(params.user)) return no('user_not_in_channel')
    ephemeral.push({ app: a, channel: params.channel, user: params.user, text: params.text, thread_ts: params.thread_ts || null })
    return ok({ message_ts: ts() })
  }
  if (method === 'views.open' || method === 'views.publish') {
    const view = json(params.view)
    if (!view || !Array.isArray(view.blocks)) return no('invalid_arguments')
    if (method === 'views.open') {
      const t = triggers.get(params.trigger_id)
      if (!t) return no('invalid_trigger_id')
      if (Date.now() - t.at > 10000) return no('expired_trigger_id')
      triggers.delete(params.trigger_id)
      views.push({ app: a, kind: 'open', user: t.user, trigger: params.trigger_id, view })
    } else {
      if (!params.user_id) return no('invalid_arguments')
      if (view.type !== 'home') return no('invalid_arguments')
      views.push({ app: a, kind: 'publish', user: params.user_id, trigger: null, view })
    }
    return ok({ view: { id: `V${views.length}`, ...view } })
  }
  if (method === 'agents.sessions.setStatus' || method === 'assistant.threads.setStatus') {
    const lacks = needs('assistant:write')
    if (lacks) return lacks
    if (!params.channel_id || !params.thread_ts) return no('invalid_arguments')
    if (!mine(params.channel_id)) return no('channel_not_found')
    statuses.push({ app: a, method, channel: params.channel_id, thread: params.thread_ts, status: params.status ?? '' })
    return ok({})
  }
  if (method === 'chat.startStream') {
    const lacks = needs('chat:write')
    if (lacks) return lacks
    if (!mine(params.channel)) return no(CHANNELS[params.channel] ? 'not_in_channel' : 'channel_not_found')
    if (!params.thread_ts || params.thread_ts === '0') return no('invalid_arguments')
    if (!CHANNELS[params.channel].is_im && (!params.recipient_user_id || !params.recipient_team_id)) return no('invalid_arguments')
    const text = params.markdown_text || ''
    if (text.length > 12000) return no('msg_too_long')
    const s = { app: a, channel: params.channel, thread: params.thread_ts, ts: ts(), text, stopped: false, calls: 1, at: Date.now(), recipient: params.recipient_user_id || null, ...as }
    streams.push(s)
    const p = { app: a, channel: params.channel, text, thread_ts: params.thread_ts, ts: s.ts, streamed: true, ...as }
    posted.push(p)
    const msg = { ...botMsg(text), ts: s.ts, thread_ts: params.thread_ts, ...as }
    put(params.channel, msg)
    echo(params.channel, msg)
    return ok({ channel: params.channel, ts: s.ts })
  }
  if (method === 'chat.appendStream' || method === 'chat.stopStream') {
    const lacks = needs('chat:write')
    if (lacks) return lacks
    const s = streams.find((x) => x.app === a && x.channel === params.channel && x.ts === params.ts)
    if (!s) return no('message_not_found')
    if (s.stopped || Date.now() - s.at > 10 * 60 * 1000) return no('message_not_in_streaming_state')
    const more = params.markdown_text || ''
    if (s.text.length + more.length > 12000) return no('msg_too_long')
    s.text += more
    s.calls++
    if (method === 'chat.stopStream') s.stopped = true
    const p = posted.find((x) => x.channel === s.channel && x.ts === s.ts)
    if (p) p.text = s.text
    const msg = find(s.channel, s.ts)
    if (msg) msg.text = s.text
    return ok({ channel: s.channel, ts: s.ts })
  }
  if (method === 'files.getUploadURLExternal') {
    const lacks = needs('files:write')
    if (lacks) return lacks
    const length = Number(params.length)
    if (!params.filename || !Number.isFinite(length) || length < 0) return no('invalid_arguments')
    const id = `F0UP${++fileN}`
    uploads[id] = { name: params.filename, length, app: a, bytes: null }
    return ok({ upload_url: `http://127.0.0.1:${port}/upload/${id}`, file_id: id })
  }
  if (method === 'files.completeUploadExternal') {
    const lacks = needs('files:write')
    if (lacks) return lacks
    const list = json(params.files)
    if (!Array.isArray(list) || !list.length) return no('invalid_arguments')
    if (params.channel_id && !mine(params.channel_id)) return no(CHANNELS[params.channel_id] ? 'not_in_channel' : 'channel_not_found')
    const done = []
    for (const f of list) {
      const u = uploads[f.id]
      if (!u || u.app !== a || !u.bytes) return no('file_not_found')
      attachments[f.id] = { name: u.name, type: 'application/octet-stream', bytes: u.bytes }
      const shared = { id: f.id, name: u.name, title: f.title || u.name, size: u.bytes.length, channel: params.channel_id || null, thread: params.thread_ts || null, app: a, content: textLike(u.name) ? u.bytes.toString('utf8').slice(0, 20000) : null, sha256: crypto.createHash('sha256').update(u.bytes).digest('hex') }
      files.push(shared)
      done.push({ id: f.id, title: shared.title })
      if (params.channel_id) {
        const msg = { ...botMsg(params.initial_comment || ''), subtype: 'file_share', ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}), files: [{ id: f.id, name: u.name, title: shared.title, size: shared.size }] }
        put(params.channel_id, msg)
        echo(params.channel_id, msg)
      }
      delete uploads[f.id]
    }
    return ok({ files: done })
  }
  if (method === 'files.delete') {
    const lacks = needs('files:write')
    if (lacks) return lacks
    const f = files.find((x) => x.id === params.file && x.app === a)
    if (!f) return no('file_not_found')
    f.deleted = true
    delete attachments[params.file]
    return ok({})
  }
  if (method === 'files.info') {
    const lacks = needs('files:read')
    if (lacks) return lacks
    const f = attachments[params.file]
    if (!f) return no('file_not_found')
    const href = `http://127.0.0.1:${port}/files/${params.file}/${encodeURIComponent(f.name)}`
    return ok({ file: { id: params.file, name: f.name, mimetype: f.type, size: f.bytes.length, url_private: href, url_private_download: `${href}?download=1` } })
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
      try { const j = JSON.parse(String(raw)); if (j.envelope_id) { acks++; if (j.payload) ackPayloads.push({ envelope_id: j.envelope_id, payload: j.payload }) } } catch { /* not JSON */ }
    })
    hellos++
    // (Slack's count: the app's connections it holds open, this one with them, whether or not the
    // other end is still there.)
    ws.send(JSON.stringify({ type: 'hello', num_connections: [...sockets].filter((s) => s.app === app && s.readyState === 1).length, debug_info: { host: 'stand-in', approximate_connection_time: 18060 }, connection_info: { app_id: app } }))
  })
})
server.listen(Number(port), '127.0.0.1', () => console.log(`stand-in Slack on ${port}`))
