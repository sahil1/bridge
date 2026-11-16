// The Slack Bot's way in and out of Slack (a beta feature): your own Slack app, reached from this
// computer through Socket Mode, so nothing reaches this computer from the internet and nothing goes
// through Bold Bridge or a relay. It's the front desk's first channel (frontdesk.js) and does what
// a channel does there: connects and stays connected, says whether it is and why not, hands over
// each question put to the bot, posts a reply where the question was asked, and lists who can be
// picked to ask.
//
// Socket Mode: apps.connections.open, with the app-level token (xapp-, scope connections:write),
// gives a WebSocket address good for a while. Slack says hello on it, then sends each event in an
// envelope, acknowledged at once (Slack wants it within 3 seconds), and now and then asks for a
// fresh connection (disconnect, refresh_requested), which is made before the old one goes. One that
// goes quiet (a ping not answered: Wi-Fi gone, a lid closed) is ended and made again, and so is one
// after the computer slept; between tries it waits longer each time, up to a minute. What was asked
// while there was no connection (Bridge AI closed, the computer asleep) waits in Slack: once
// connected, each conversation the bot is in is read from the last message it saw
// (conversations.history), and what was put to it meanwhile is handed over then. (A mention in a
// thread's replies isn't in a conversation's history, so one made while it was away is missed.)
//
// The Web API takes the bot token (xoxb-): auth.test (which workspace, which bot), users.list (the
// members to pick askers from), chat.postMessage (a reply, in the question's thread),
// users.conversations and conversations.history (what was missed), conversations.info (a
// channel's name). Slack's rate limits are kept: a 429 waits as long as its Retry-After says, and
// replies go one at a time, a second apart.
//
// The tokens are kept in slack-bot.json in the data folder, readable by you only (0600), with where
// the bot got to in each conversation: never in config.json, and never given to an agent.
// BRIDGE_SLACK_URL (tests): a stand-in for Slack (test/stand-ins/slack.mjs).
import fs from 'node:fs'
import WebSocket from 'ws'
import { dataFile, writeFileAtomic } from './paths.js'

const FILE = dataFile('slack-bot.json')
const API = () => `${String(process.env.BRIDGE_SLACK_URL || 'https://slack.com').replace(/\/+$/, '')}/api`
const PING_MS = Number(process.env.BRIDGE_SLACK_PING_MS) || 30 * 1000 // a ping this often; no pong by the next: gone
const BACKOFF = [1, 2, 5, 10, 30, 60] // seconds between tries to connect again
const SLEPT_MS = 30 * 1000 // a timer this late means the computer slept
const MISSED_DAYS = 3 // what was asked while away, read back this far at most
const MAX_CONVERSATIONS = 100

const read = () => { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }
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

// The app's manifest, to paste when making the app: a bot that's mentioned in channels and messaged
// directly, over Socket Mode, with the scopes the calls above need and no more.
export const SCOPES = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'users:read', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'mpim:history', 'mpim:read']
export function manifest(you = '') {
  const who = String(you || '').trim()
  return {
    display_information: { name: 'Bridge AI', description: who ? `Answers questions for ${who}, from the folders they open to it` : 'Answers questions from the folders you open to it', background_color: '#1d2330' },
    features: { app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false }, bot_user: { display_name: 'Bridge AI', always_online: false } },
    oauth_config: { scopes: { bot: SCOPES } },
    settings: { event_subscriptions: { bot_events: ['app_mention', 'message.im'] }, interactivity: { is_enabled: false }, org_deploy_enabled: false, socket_mode_enabled: true, token_rotation_enabled: false },
  }
}

// say(event): what happened, for Settings' log ({ what, ok, why }).
export function makeSlack({ say = () => {} } = {}) {
  let kept = read()
  const save = () => writeFileAtomic(FILE, JSON.stringify(kept, null, 2), { mode: 0o600 })
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
  const names = {} // user id -> name, from users.list
  const places = {} // channel id -> { kind, name }
  async function placeOf(channel, type) {
    if (type === 'im' || String(channel).startsWith('D')) return { kind: 'dm', id: channel, name: null }
    if (places[channel]) return places[channel]
    let name = null
    try { name = (await call('conversations.info', { channel })).channel?.name || null } catch { /* no name: its id */ }
    places[channel] = { kind: 'channel', id: channel, name }
    return places[channel]
  }
  // A question: a mention of the bot in a channel, or a direct message to it, from a person. A
  // thread's reply goes in that thread, a channel's message in a thread of its own, a direct message
  // plainly back.
  async function heard(e, { late = false } = {}) {
    if (!e || !hear) return
    if (e.bot_id || e.subtype || !e.user || e.user === kept.bot?.userId) return
    const dm = e.channel_type === 'im' || String(e.channel).startsWith('D')
    if (e.type === 'message' && !dm) return
    if (e.type !== 'message' && e.type !== 'app_mention') return
    // Where it got to here, for what's missed next time (only a top-level message moves it).
    if (!e.thread_ts || e.thread_ts === e.ts) {
      if (!kept.seen) kept.seen = {}
      if (!kept.seen[e.channel] || Number(e.ts) > Number(kept.seen[e.channel])) { kept.seen[e.channel] = e.ts; save() }
    }
    set({ lastEvent: new Date().toISOString() })
    const place = await placeOf(e.channel, dm ? 'im' : null)
    if (!names[e.user]) await people().catch(() => {})
    await hear({
      key: `${e.channel}:${e.ts}`,
      from: { id: e.user, name: names[e.user] || null },
      text: plainText(e.text, { bot: kept.bot?.userId, names }),
      place,
      at: new Date(Number(e.ts) * 1000).toISOString(),
      late,
      reply: { channel: e.channel, thread: dm && !e.thread_ts ? null : e.thread_ts || e.ts },
    })
  }

  // What was put to the bot while it wasn't connected: each conversation it's in, read from the
  // last message it saw there (or from when it was first connected, at most three days back).
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
        if (msgs.length) { if (!kept.seen) kept.seen = {}; kept.seen[c.id] = msgs.at(-1).ts; save() }
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

  // The workspace's people, to pick askers from: neither bots nor deactivated accounts. Kept for 10
  // minutes.
  let memo = { at: 0, list: null }
  async function people({ fresh = false } = {}) {
    if (!fresh && memo.list && Date.now() - memo.at < 10 * 60 * 1000) return memo.list
    const out = []
    let cursor
    do {
      const j = await call('users.list', { limit: 200, cursor })
      for (const u of j.members || []) {
        if (u.deleted || u.is_bot || u.id === 'USLACKBOT') continue
        const name = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name
        names[u.id] = name
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
    hear = null
    gen++
    stopTimers()
    drop(ws)
    ws = null
    set({ state: kept.appToken && kept.botToken ? 'off' : 'no-tokens', why: null, nextTry: null })
  }
  const state = () => ({ ...st, team: kept.team || null, bot: kept.bot || null, tokens: kept.appToken || kept.botToken ? { app: masked(kept.appToken), bot: masked(kept.botToken) } : null })

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
    kept = { ...(other ? {} : kept), appToken: app, botToken: bot, team: { id: who.team_id, name: who.team, url: who.url }, bot: { userId: who.user_id, botId: who.bot_id || null, name: who.user }, since: other || !kept.since ? String(Date.now() / 1000) : kept.since }
    save()
    memo = { at: 0, list: null }
    const was = hear
    stop()
    if (was) start(was)
    return state()
  }
  function forget() {
    stop()
    kept = {}
    try { fs.rmSync(FILE, { force: true }) } catch { /* gone */ }
    memo = { at: 0, list: null }
    set({ state: 'no-tokens', why: null })
  }

  return { id: 'slack', label: 'Slack', start, stop, state, post, people, setTokens, forget, missed }
}
