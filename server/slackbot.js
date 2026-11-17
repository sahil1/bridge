// A bot's way in and out of Slack (Bots, a beta feature): your own Slack app, made from the
// manifest in Settings with the bot's name, reached from this computer through Socket Mode, so
// nothing reaches this computer from the internet and nothing goes through Bold Bridge or a relay.
// It's a channel of the front desk (frontdesk.js), one per bot, and does what a channel does there:
// connects and stays connected, says whether it is and why not, hands over each message put to the
// bot, reads the conversation a question was asked in, posts a reply where it was asked, marks a
// question with a reaction, and lists who can be picked to ask.
//
// Socket Mode: apps.connections.open, with the app-level token (xapp-, scope connections:write),
// gives a WebSocket address good for a while. Slack says hello on it, then sends each event in an
// envelope, acknowledged at once (Slack wants it within 3 seconds), and now and then asks for a
// fresh connection (disconnect, refresh_requested), which is made before the old one goes. One that
// goes quiet (a ping not answered: Wi-Fi gone, a lid closed) is ended and made again, and so is one
// after the computer slept; between tries it waits longer each time, up to a minute. What was asked
// while there was no connection (Bridge AI closed, the computer asleep) waits in Slack: once
// connected, each conversation the bot is in is read from the last message it saw
// (conversations.history), and each thread it's answering in from the last reply it saw
// (conversations.replies), and what was put to it meanwhile is handed over then.
//
// What it hands over: a mention, a direct message, a reply in a thread (the front desk keeps only
// those in threads it has answered in), and an edit or deletion of a message in a thread. A
// channel's other messages come too (message.channels, for the replies) and go no further. With
// each, who wrote it: a guest (is_restricted, is_ultra_restricted) or someone from another company
// (Slack Connect: another team, or is_stranger) says so, and one Slack couldn't say anything about
// says that, so the desk refuses them.
//
// The Web API takes the bot token (xoxb-): auth.test (which workspace, which bot, and the scopes the
// token has, in its x-oauth-scopes header), users.list and users.info (the members to pick askers
// from, and who someone is), chat.postMessage (a reply, in the question's thread),
// users.conversations, conversations.history and conversations.replies (what was missed, and a
// question's context), pins.list (a channel's pinned messages, for context), reactions.add and
// reactions.remove (👀 and ✅), conversations.info (a channel's name). Slack's rate limits are kept:
// a 429 waits as long as its Retry-After says, and replies go one at a time, a second apart.
//
// The tokens are kept in the bot's slack.json in the data folder, readable by you only (0600), with
// where the bot got to in each conversation: never in config.json, and never given to an agent.
// BRIDGE_SLACK_URL (tests): a stand-in for Slack (test/stand-ins/slack.mjs).
import fs from 'node:fs'
import WebSocket from 'ws'
import { writeFileAtomic } from './paths.js'

const API = () => `${String(process.env.BRIDGE_SLACK_URL || 'https://slack.com').replace(/\/+$/, '')}/api`
const PING_MS = Number(process.env.BRIDGE_SLACK_PING_MS) || 30 * 1000 // a ping this often; no pong by the next: gone
const BACKOFF = [1, 2, 5, 10, 30, 60] // seconds between tries to connect again
const SLEPT_MS = 30 * 1000 // a timer this late means the computer slept
const MISSED_DAYS = 3 // what was asked while away, read back this far at most
const MAX_CONVERSATIONS = 100
const THREAD_CONTEXT = 50 // earlier messages read from the thread a question is asked in
const CHANNEL_CONTEXT = 20 // and from the channel, for one asked at its top
const PINS = 10
const LONGEST_SAID = 1500 // a message read for context, in characters
const FOLLOW_DAYS = 7 // a thread it answered in is followed this long after it was last busy (frontdesk.js)
const MARK_MS = 2000 // where it got to, written this long after it moved
// A message's kinds that are someone writing: a reply sent to the channel too, one with a file.
const WRITTEN = new Set(['thread_broadcast', 'file_share'])

const read = (file) => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.() })
// A token shown: its kind and its last four, never the rest.
const masked = (t) => (t ? `${String(t).slice(0, 5)}…${String(t).slice(-4)}` : null)

// What Slack's error codes mean, for Settings: why it isn't connected, and what to do.
const WHY = {
  invalid_auth: 'Slack turned the token down (invalid_auth): copy it again from your Slack app',
  not_authed: 'No token was sent',
  account_inactive: 'The token belongs to an app or account that\'s no longer active',
  token_revoked: 'The token was revoked: make a new one in your Slack app',
  token_expired: 'The token has expired: turn off token rotation for the app, then reinstall it and copy the bot token again',
  not_allowed_token_type: 'That\'s the wrong kind of token here',
  missing_scope: 'The token is missing a scope',
  ratelimited: 'Slack asked Bridge AI to slow down',
  team_access_not_granted: 'The app isn\'t installed in this workspace',
  invalid_arguments: 'Slack didn\'t take what was sent',
  channel_not_found: 'The bot can\'t see that conversation any more',
  not_in_channel: 'The bot isn\'t in that channel any more',
  is_archived: 'That channel is archived',
  msg_too_long: 'The reply is too long for Slack',
}
const slackError = (method, j) => {
  const code = String(j?.error || 'unknown_error')
  const extra = code === 'missing_scope' && j?.needed ? ` (${j.needed})` : ''
  return Object.assign(new Error(`${WHY[code] || `Slack said ${code}`}${extra}`), { code, method })
}

// Slack's markup in a message, as plain words: mentions by name, channels by name, links with their
// text, and its three escapes undone.
export function plainText(text, { bot = null, names = {} } = {}) {
  return String(text || '')
    .replace(/<@([A-Z0-9]+)(\|[^>]*)?>/g, (_, id, label) => (id === bot ? '' : `@${names[id] || (label ? label.slice(1) : id)}`))
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').trim()
}
// What's posted: Slack's three escapes, so a reply's < or & isn't read as markup.
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The app's manifest, to paste when making the app: a bot with the name you gave it, mentioned in
// channels, messaged directly and followed in its threads, over Socket Mode, with the scopes the
// calls above need and no more. (A manifest can't carry an icon: that's set in Slack's app page.)
// An app made from an earlier one lacks some scopes: Settings says which, from auth.test.
export const SCOPES = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'im:write', 'users:read', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'mpim:history', 'mpim:read', 'reactions:write', 'pins:read']
export const EVENTS = ['app_mention', 'message.channels', 'message.groups', 'message.im', 'message.mpim']
export function manifest(bot = {}, you = '') {
  const who = String(you || '').trim()
  const name = String(bot.name || 'Bridge AI').slice(0, 35)
  return {
    display_information: { name, description: String(bot.description || (who ? `Answers questions for ${who}` : 'Answers questions from the folders you give it')).slice(0, 140), background_color: '#1d2330' },
    features: { app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false }, bot_user: { display_name: name, always_online: false } },
    oauth_config: { scopes: { bot: SCOPES } },
    settings: { event_subscriptions: { bot_events: EVENTS }, interactivity: { is_enabled: false }, org_deploy_enabled: false, socket_mode_enabled: true, token_rotation_enabled: false },
  }
}

// id: the bot's. file: where its tokens are kept. say(event): what happened, for its record
// ({ what, ok, why }). threads(): the threads it's answering in, to read for what was missed
// ([{ channel, thread, since, dm }]). follows(channel, thread): whether it's answering in that
// thread now (the desk knows), so only those threads' replies are kept track of.
export function makeSlack({ id = 'slack', file, say = () => {}, threads = () => [], follows = () => false } = {}) {
  const FILE = file
  let kept = read(FILE)
  const save = () => writeFileAtomic(FILE, JSON.stringify(kept, null, 2), { mode: 0o600 })
  // Where it got to in each conversation and each thread it follows moves with nearly every
  // message in a busy channel: written a moment later, once for all of them, and only when it
  // moved. Threads it no longer follows, or quiet for a week, are let go of then.
  let marking = null
  const tidy = () => {
    const old = Date.now() / 1000 - FOLLOW_DAYS * 86400
    for (const [k, ts] of Object.entries(kept.threads || {})) {
      const [channel, thread] = k.split(':')
      if (Number(ts) < old || !follows(channel, thread)) delete kept.threads[k]
    }
  }
  const marked = () => {
    if (marking) return
    marking = setTimeout(() => { marking = null; tidy(); try { save() } catch (e) { say({ what: 'save', ok: false, why: `Couldn't keep where it got to: ${e.message}` }) } }, MARK_MS)
    marking.unref?.()
  }
  const markedNow = () => { if (!marking) return; clearTimeout(marking); marking = null; tidy(); try { save() } catch { /* next time */ } }
  let hear = null // the front desk's, while started
  let ws = null
  let pinger = null
  let retry = null
  let tries = 0
  let gen = 0 // each connection's number: what an old one says after it's replaced is ignored
  let tick = Date.now()
  // off | no-tokens | connecting | connected | reconnecting | error
  let st = { state: kept.appToken && kept.botToken ? 'off' : 'no-tokens', why: null, since: new Date().toISOString(), lastEvent: null, connectedAt: null, drops: 0 }
  const set = (patch) => { st = { ...st, ...patch, since: patch.state && patch.state !== st.state ? new Date().toISOString() : st.since } }

  // ---------- The Web API ----------
  // One call, form-encoded (every method takes that), with the token as a bearer. A 429 waits as
  // long as Slack says (up to three times, a minute at most each), then says so.
  async function call(method, params = {}, { token = kept.botToken, waits = 3 } = {}) {
    if (!token) throw Object.assign(new Error('No token yet'), { code: 'not_authed' })
    const body = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]))
    for (let i = 0; ; i++) {
      let res
      try {
        res = await fetch(`${API()}/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) })
      } catch (e) {
        throw Object.assign(new Error(`Couldn't reach Slack: ${e.cause?.code || e.message}`), { code: 'offline', method })
      }
      if (res.status === 429) {
        const wait = Math.min(60, Math.max(1, Number(res.headers.get('retry-after')) || 1))
        if (i >= waits) throw Object.assign(new Error(`Slack asked to wait ${wait} s before more (rate limited)`), { code: 'ratelimited', retryAfter: wait, method })
        await sleep(wait * 1000)
        continue
      }
      const j = await res.json().catch(() => null)
      if (!res.ok && !j) throw Object.assign(new Error(`Slack answered ${res.status}`), { code: `http_${res.status}`, method })
      if (!j?.ok) throw slackError(method, j)
      // The scopes the token has, as Slack says them with each answer.
      if (method === 'auth.test') Object.defineProperty(j, 'scopes', { value: res.headers.has('x-oauth-scopes') ? String(res.headers.get('x-oauth-scopes')).split(',').map((x) => x.trim()).filter(Boolean) : null })
      return j
    }
  }

  // ---------- Connecting ----------
  const stopTimers = () => { clearInterval(pinger); pinger = null; clearTimeout(retry); retry = null }
  function drop(socket) {
    try { socket?.removeAllListeners('close'); socket?.terminate() } catch { /* gone */ }
  }
  // Try again in a while: longer each time, up to a minute. A token Slack turned down isn't tried
  // again until it's changed (it would only be turned down again).
  function later(why, { final = false } = {}) {
    stopTimers()
    if (!hear) return
    if (final) { set({ state: 'error', why }); say({ what: 'stopped', ok: false, why }); return }
    const wait = BACKOFF[Math.min(tries, BACKOFF.length - 1)]
    tries++
    set({ state: 'reconnecting', why, nextTry: new Date(Date.now() + wait * 1000).toISOString() })
    retry = setTimeout(() => { connect().catch(() => {}) }, wait * 1000)
  }

  async function connect() {
    if (!hear) return
    stopTimers()
    const mine = ++gen
    if (st.state !== 'reconnecting') set({ state: 'connecting', why: null })
    let url
    try {
      // Who the bot is, and where: once per connection, so a token that stopped working is noticed.
      const who = await call('auth.test')
      kept.team = { id: who.team_id, name: who.team, url: who.url }
      kept.bot = { userId: who.user_id, botId: who.bot_id || null, name: who.user }
      kept.scopes = who.scopes
      kept.since ||= String(Date.now() / 1000)
      save()
      url = (await call('apps.connections.open', {}, { token: kept.appToken })).url
    } catch (e) {
      if (mine !== gen) return
      const final = ['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired', 'not_allowed_token_type', 'missing_scope', 'team_access_not_granted'].includes(e.code)
      return later(e.method === 'apps.connections.open' && final ? `The app-level token: ${e.message}` : final ? `The bot token: ${e.message}` : e.message, { final })
    }
    if (mine !== gen || !hear) return
    const was = ws
    const socket = new WebSocket(url, { handshakeTimeout: 15000 })
    ws = socket
    let alive = true
    socket.on('open', () => {
      // A ping now and then; none answered by the next means the connection is gone (a pong is
      // answered by Slack itself, and so is any frame).
      pinger = setInterval(() => {
        if (mine !== gen) return
        if (!alive) { drop(socket); later('The connection went quiet; connecting again'); return }
        alive = false
        try { socket.ping() } catch { /* closing */ }
      }, PING_MS)
    })
    socket.on('pong', () => { alive = true })
    socket.on('message', (raw) => {
      alive = true
      let m
      try { m = JSON.parse(String(raw)) } catch { return }
      // Every envelope acknowledged, and every event taken, on whichever connection it came (the old
      // one, while a new one is made): the same one twice is heard once (frontdesk.js).
      if (m.envelope_id) { try { socket.send(JSON.stringify({ envelope_id: m.envelope_id })) } catch { /* closing */ } }
      if (m.type === 'events_api') return heard(m.payload?.event).catch((e) => say({ what: 'event', ok: false, why: e.message }))
      if (mine !== gen) return
      if (m.type === 'hello') {
        tries = 0
        if (was && was !== socket) drop(was)
        set({ state: 'connected', why: null, connectedAt: new Date().toISOString(), nextTry: null })
        say({ what: 'connected', ok: true })
        const lacks = missing()
        if (lacks?.length) say({ what: 'scopes-missing', ok: false, why: `The Slack app lacks ${lacks.join(', ')}: update it with the new manifest`, missing: lacks })
        missed().catch((e) => say({ what: 'missed', ok: false, why: `Couldn't read what was asked while away: ${e.message}` }))
      } else if (m.type === 'disconnect') {
        // Slack moves the bot: refresh_requested and warning, a new connection first; link_disabled,
        // Socket Mode turned off for the app.
        if (m.reason === 'link_disabled') { drop(socket); later('Socket Mode is turned off for your Slack app: turn it on in the app\'s settings › Socket Mode, then Connect again', { final: true }) } else connect().catch(() => {})
      }
    })
    socket.on('close', (code) => {
      if (mine !== gen || socket !== ws) return
      st.drops++
      say({ what: 'dropped', ok: false, why: `The connection closed (${code})` })
      later(`The connection closed (${code}); connecting again`)
    })
    socket.on('error', (e) => {
      if (mine !== gen || socket !== ws) return
      drop(socket)
      later(`The connection failed: ${e.message}`)
    })
  }

  // The computer slept (a timer far later than it should be): the connection is very likely dead,
  // so it's made again at once, which reads what was asked meanwhile too.
  const watch = setInterval(() => {
    const now = Date.now()
    if (now - tick > SLEPT_MS && hear && st.state === 'connected') { drop(ws); ws = null; tries = 0; set({ state: 'reconnecting', why: 'The computer slept; connecting again' }); connect().catch(() => {}) }
    tick = now
  }, 5000)
  watch.unref?.()

  // ---------- What comes in ----------
  const names = {} // user id -> name, from users.list and users.info
  const users = {} // user id -> { guest, team, stranger }, the same
  const places = {} // channel id -> { kind, name }
  async function placeOf(channel, type) {
    if (type === 'im' || String(channel).startsWith('D')) return { kind: 'dm', id: channel, name: null }
    if (places[channel]) return places[channel]
    let name = null
    try { name = (await call('conversations.info', { channel })).channel?.name || null } catch { /* no name: its id */ }
    places[channel] = { kind: 'channel', id: channel, name }
    return places[channel]
  }
  const learn = (u) => {
    if (!u?.id) return
    names[u.id] = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id
    users[u.id] = { guest: !!(u.is_restricted || u.is_ultra_restricted), team: u.team_id || null, stranger: u.is_stranger === true }
  }
  // Who wrote it: a member of this workspace, a guest, or someone from another company (Slack
  // Connect: the event says another team, or Slack does), from the members listed, else asked of
  // Slack (users.info). One Slack can't say anything about: unknown, and why (refused, as a guest is).
  async function person(e) {
    if (!users[e.user]) await people().catch(() => {})
    if (!users[e.user]) {
      try { learn((await call('users.info', { user: e.user })).user) } catch (err) { return { id: e.user, name: null, unknown: true, why: err.message } }
    }
    const u = users[e.user]
    if (!u) return { id: e.user, name: null, unknown: true, why: 'Slack said nothing about them' }
    const team = kept.team?.id
    const other = (t) => !!(t && team && t !== team)
    return { id: e.user, name: names[e.user] || null, guest: u.guest, external: u.stranger || other(u.team) || other(e.user_team) || other(e.source_team) }
  }

  // What comes in: a mention of the bot in a channel, a direct message to it, or a reply in a thread
  // (the desk keeps only those in threads it answers in), from a person; an edit or deletion. A
  // thread's reply goes in that thread, a channel's message in a thread of its own, a direct message
  // plainly back.
  async function heard(e, { late = false } = {}) {
    if (!e || !hear) return
    if (e.type === 'message' && (e.subtype === 'message_changed' || e.subtype === 'message_deleted')) return altered(e)
    if (e.type !== 'message' && e.type !== 'app_mention') return
    const dm = e.channel_type === 'im' || String(e.channel).startsWith('D')
    const thread = e.thread_ts && e.thread_ts !== e.ts ? e.thread_ts : null
    // Where it got to here, for what's missed next time: a conversation's own messages, and the
    // replies in each thread it's answering in (no other thread's).
    if (!thread) {
      if (!kept.seen) kept.seen = {}
      if (!kept.seen[e.channel] || Number(e.ts) > Number(kept.seen[e.channel])) { kept.seen[e.channel] = e.ts; marked() }
    } else if (follows(e.channel, thread)) {
      if (!kept.threads) kept.threads = {}
      const k = `${e.channel}:${thread}`
      if (!kept.threads[k] || Number(e.ts) > Number(kept.threads[k])) { kept.threads[k] = e.ts; marked() }
    }
    if (e.bot_id || (e.subtype && !WRITTEN.has(e.subtype)) || !e.user || e.user === kept.bot?.userId) return
    const mention = e.type === 'app_mention' || String(e.text || '').includes(`<@${kept.bot?.userId}>`)
    // A channel's own message that doesn't mention it: not for it.
    if (!dm && !mention && !thread) return
    set({ lastEvent: new Date().toISOString() })
    const place = await placeOf(e.channel, dm ? 'im' : null)
    await hear({
      ts: e.ts, channel: e.channel, thread, mention, dm,
      from: await person(e),
      text: plainText(e.text, { bot: kept.bot?.userId, names }),
      place,
      at: new Date(Number(e.ts) * 1000).toISOString(),
      late,
      reply: { channel: e.channel, thread: dm && !e.thread_ts ? null : e.thread_ts || e.ts },
    })
  }
  // An edit or a deletion, handed over as one (the desk keeps those in its threads).
  async function altered(e) {
    const now = e.message || {}
    const was = e.previous_message || {}
    const ts = now.ts || e.deleted_ts || was.ts
    const thread = now.thread_ts || was.thread_ts || null
    const user = now.user || was.user || null
    if (!ts || !hear?.change) return
    await hear.change({
      kind: e.subtype === 'message_deleted' ? 'deleted' : 'changed', channel: e.channel, ts, thread: thread || ts,
      from: user ? { id: user, name: names[user] || null } : null,
      text: e.subtype === 'message_deleted' ? null : plainText(now.text, { bot: kept.bot?.userId, names }),
      before: was.text != null ? plainText(was.text, { bot: kept.bot?.userId, names }) : null,
    })
  }

  // The conversation a question was asked in, as context: in a thread, its earlier messages (since
  // `since`, when the answer goes on from an earlier one); at the top of a channel, its latest
  // messages and what's pinned there; in a direct message, its latest messages. Each with who wrote
  // it, and whether that was this bot. { kind, messages: [{ ts, person, text, you }], pins, problem }
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  async function context({ channel, thread, ts, since = null, dm = false }) {
    const said = (m) => ({ ts: m.ts, person: { id: m.user || m.bot_id || null, name: names[m.user] || m.username || m.bot_profile?.name || m.user || null }, text: clip(plainText(m.text, { bot: kept.bot?.userId, names }), LONGEST_SAID), you: !!((m.user && m.user === kept.bot?.userId) || (m.bot_id && m.bot_id === kept.bot?.botId)) })
    if (!Object.keys(names).length) await people().catch(() => {})
    const before = (m) => Number(m.ts) < Number(ts) && (!since || Number(m.ts) > Number(since)) && String(m.text || '').trim()
    const order = (a, b) => Number(a.ts) - Number(b.ts)
    if (thread) {
      const j = await call('conversations.replies', { channel, ts: thread, limit: 200 })
      return { kind: 'thread', messages: (j.messages || []).filter(before).sort(order).slice(-THREAD_CONTEXT).map(said), pins: [] }
    }
    const j = await call('conversations.history', { channel, latest: ts, inclusive: false, limit: CHANNEL_CONTEXT })
    const messages = (j.messages || []).filter(before).sort(order).slice(-CHANNEL_CONTEXT).map(said)
    if (dm) return { kind: 'dm', messages, pins: [] }
    let pins = []
    let problem = null
    try { pins = ((await call('pins.list', { channel })).items || []).filter((i) => i.message?.text).slice(0, PINS).map((i) => said(i.message)) } catch (e) { problem = `Couldn't read what's pinned: ${e.message}` }
    return { kind: 'channel', messages, pins, problem }
  }

  // What was put to the bot while it wasn't connected: each conversation it's in, read from the
  // last message it saw there (or from when it was first connected, at most three days back), and
  // each thread it's answering in, from the last reply it saw there.
  let reading = null
  function missed() {
    if (reading) return reading
    reading = (async () => {
      const floor = Math.max(Number(kept.since || 0), Date.now() / 1000 - MISSED_DAYS * 86400)
      const chans = []
      let cursor
      do {
        const j = await call('users.conversations', { types: 'public_channel,private_channel,mpim,im', exclude_archived: true, limit: 200, cursor })
        chans.push(...(j.channels || []))
        cursor = j.response_metadata?.next_cursor || undefined
      } while (cursor && chans.length < MAX_CONVERSATIONS)
      let found = 0
      for (const c of chans.slice(0, MAX_CONVERSATIONS)) {
        const from = Math.max(floor, Number(kept.seen?.[c.id] || 0))
        const j = await call('conversations.history', { channel: c.id, oldest: from.toFixed(6), inclusive: false, limit: 100 })
        const msgs = (j.messages || []).filter((m) => Number(m.ts) > from).sort((a, b) => Number(a.ts) - Number(b.ts))
        for (const m of msgs) {
          const im = c.is_im === true
          if (!im && !String(m.text || '').includes(`<@${kept.bot?.userId}>`)) continue
          found++
          await heard({ ...m, type: im ? 'message' : 'app_mention', channel: c.id, channel_type: im ? 'im' : undefined }, { late: true })
        }
        if (msgs.length) { if (!kept.seen) kept.seen = {}; kept.seen[c.id] = msgs.at(-1).ts; marked() }
      }
      for (const t of (await Promise.resolve(threads()).catch(() => [])).slice(0, MAX_CONVERSATIONS)) {
        const from = Math.max(floor, Number(kept.threads?.[`${t.channel}:${t.thread}`] || 0), Number(t.since || 0))
        const j = await call('conversations.replies', { channel: t.channel, ts: t.thread, oldest: from.toFixed(6), inclusive: false, limit: 200 })
        const msgs = (j.messages || []).filter((m) => Number(m.ts) > from && m.ts !== t.thread).sort((a, b) => Number(a.ts) - Number(b.ts))
        for (const m of msgs) {
          found++
          await heard({ ...m, type: 'message', channel: t.channel, channel_type: t.dm ? 'im' : 'channel', thread_ts: m.thread_ts || t.thread }, { late: true })
        }
      }
      if (found) say({ what: 'missed', ok: true, why: `${found} asked while away` })
    })().finally(() => { reading = null })
    return reading
  }

  // ---------- What goes out ----------
  // Replies one at a time, a second apart (Slack's limit for posting to a conversation).
  let line = Promise.resolve()
  let lastPost = 0
  function post(reply, text) {
    const go = line.then(async () => {
      const wait = 1000 - (Date.now() - lastPost)
      if (wait > 0) await sleep(wait)
      try {
        return await call('chat.postMessage', { channel: reply.channel, text: escape(text), ...(reply.thread ? { thread_ts: reply.thread } : {}), unfurl_links: false, unfurl_media: false }, { waits: 1 })
      } finally { lastPost = Date.now() }
    })
    line = go.catch(() => {})
    return go.then((j) => ({ ts: j.ts, channel: j.channel }))
  }

  // A reaction on a question (👀 as it's taken, ✅ once answered), or taken off. One that's there
  // already, or gone already, is as asked. An app without reactions:write isn't asked: it says so
  // (and Settings says to update the app).
  async function react({ channel, ts, name, off = false }) {
    if (missing()?.includes('reactions:write')) throw Object.assign(new Error('The Slack app lacks reactions:write: update it with the new manifest'), { code: 'missing_scope' })
    try { await call(off ? 'reactions.remove' : 'reactions.add', { channel, timestamp: ts, name }, { waits: 1 }) } catch (e) { if (!['already_reacted', 'no_reaction'].includes(e.code)) throw e }
  }
  // The scopes the manifest asks for that the app's token doesn't have (null: Slack didn't say).
  const missing = () => (Array.isArray(kept.scopes) ? SCOPES.filter((x) => !kept.scopes.includes(x)) : null)

  // The workspace's people, to pick askers from: neither bots, deactivated accounts nor guests
  // (guests are never answered). Kept for 10 minutes.
  let memo = { at: 0, list: null }
  async function people({ fresh = false } = {}) {
    if (!fresh && memo.list && Date.now() - memo.at < 10 * 60 * 1000) return memo.list
    const out = []
    let cursor
    do {
      const j = await call('users.list', { limit: 200, cursor })
      for (const u of j.members || []) {
        learn(u)
        if (u.deleted || u.is_bot || u.id === 'USLACKBOT' || u.is_restricted || u.is_ultra_restricted) continue
        const name = names[u.id]
        out.push({ id: u.id, name, detail: [u.profile?.real_name && u.profile.real_name !== name ? u.profile.real_name : null, u.profile?.title || null].filter(Boolean).join(' · ') || null })
      }
      cursor = j.response_metadata?.next_cursor || undefined
    } while (cursor && out.length < 5000)
    memo = { at: Date.now(), list: out.sort((a, b) => a.name.localeCompare(b.name)) }
    return memo.list
  }

  // Connected and staying so, handing each question to hear(q).
  function start(fn) {
    hear = fn
    if (!kept.appToken || !kept.botToken) { set({ state: 'no-tokens', why: null }); return }
    if (['connected', 'connecting', 'reconnecting'].includes(st.state) && ws) return
    tries = 0
    connect().catch((e) => later(e.message))
  }
  function stop() {
    markedNow()
    hear = null
    gen++
    stopTimers()
    drop(ws)
    ws = null
    set({ state: kept.appToken && kept.botToken ? 'off' : 'no-tokens', why: null, nextTry: null })
  }
  const state = () => ({ ...st, team: kept.team || null, bot: kept.bot || null, tokens: kept.appToken || kept.botToken ? { app: masked(kept.appToken), bot: masked(kept.botToken) } : null, scopes: { missing: kept.botToken ? missing() : null, known: Array.isArray(kept.scopes) } })

  // New tokens: each checked with Slack before it's kept (the bot token with auth.test, the
  // app-level one by opening a connection's address), so a wrong one is said at once. Another
  // workspace's: where it got to in the last one's conversations goes.
  async function setTokens({ appToken, botToken }) {
    const app = String(appToken || '').trim()
    const bot = String(botToken || '').trim()
    if (!/^xapp-/.test(app)) throw new Error('The app-level token starts with xapp-: it\'s under Basic Information › App-Level Tokens')
    if (!/^xoxb-/.test(bot)) throw new Error('The bot token starts with xoxb-: it\'s under OAuth & Permissions, once the app is installed')
    const who = await call('auth.test', {}, { token: bot }).catch((e) => { throw new Error(`The bot token: ${e.message}`) })
    await call('apps.connections.open', {}, { token: app }).catch((e) => { throw new Error(`The app-level token: ${e.message}${e.code === 'missing_scope' ? ': give it connections:write' : ''}`) })
    const other = !!kept.team?.id && kept.team.id !== who.team_id
    kept = { ...(other ? {} : kept), appToken: app, botToken: bot, team: { id: who.team_id, name: who.team, url: who.url }, bot: { userId: who.user_id, botId: who.bot_id || null, name: who.user }, scopes: who.scopes, since: other || !kept.since ? String(Date.now() / 1000) : kept.since }
    save()
    memo = { at: 0, list: null }
    const was = hear
    stop()
    if (was) start(was)
    return state()
  }
  function forget() {
    stop()
    clearTimeout(marking)
    marking = null
    kept = {}
    try { fs.rmSync(FILE, { force: true }) } catch { /* gone */ }
    memo = { at: 0, list: null }
    set({ state: 'no-tokens', why: null })
  }

  return { id, label: 'Slack', start, stop, state, post, react, context, people, setTokens, forget, missed, masked }
}
