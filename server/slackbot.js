// A bot's way in and out of Slack (Bots, a beta feature): your own Slack app, made from the
// manifest in Settings with the bot's name, reached from this computer through Socket Mode, so
// nothing reaches this computer from the internet and nothing goes through Bold Bridge or a relay.
// It's a channel of the front desk (frontdesk.js), one per bot, and does what a channel does there:
// connects and stays connected, says whether it is and why not, hands over each message put to the
// bot, reads the conversation a question was asked in, posts a reply where it was asked (streamed,
// with files), marks a question with a reaction, shows Slack's working status, asks you about a
// draft in your direct messages, and lists who can be picked to ask. Everything that's Slack's own
// (Block Kit, modals, Socket Mode's envelopes) stays in this file: the desk sees plain questions,
// replies and decisions, so another platform can be a channel the same way.
//
// It's one app, a connection (connections.js): a bot's own, or the shared one many bots are reached
// through (connhub.js). A shared one's answers are posted as the bot answering (its name and icon:
// username and icon_emoji or icon_url, chat:write.customize, on chat.postMessage and on
// chat.startStream, which takes them too; from an app without that scope yet, its name in bold
// first), its Home tab lists each bot and how to ask it, and a question it can't tell the bot of is
// asked back with a button for each (choose, bb_pick).
//
// Socket Mode: apps.connections.open, with the app-level token (xapp-, scope connections:write),
// gives a WebSocket address good for a while. Slack says hello on it, then sends each event in an
// envelope, acknowledged at once (Slack wants it within 3 seconds), and now and then asks for a
// fresh connection (disconnect, refresh_requested), which is made before the old one goes. One that
// goes quiet (a ping not answered: Wi-Fi gone, a lid closed) is ended and made again, and so is one
// after the computer slept; between tries it waits longer each time, up to a minute.
// An app may have up to 10 connections open, and Slack sends each envelope to just one of them, any
// one: two copies of Bridge AI on the same app (another computer, an old install) would each get
// some of the questions. Slack's hello says how many are open (num_connections): more than this
// copy's is said plainly (another-copy), and, after a drop or a sleep, when Slack may still count
// the old one, looked at again a minute later (probe: a connection opened only to read its hello).
// What was asked while there was no connection (Bridge AI closed, the computer asleep) waits in
// Slack: once connected after a gap (not after a refresh, which leaves none), each conversation the
// bot is in is read from the last message it saw there or the moment the gap began, whichever is
// later (conversations.history, a few pages at most), and each thread it's answering in from the
// last reply it saw (conversations.replies): direct messages and its threads first, then the
// channels it listens in, then the rest; and what was put to it meanwhile is handed over then,
// oldest first. Slack holds a distributed app outside its Marketplace to one read a minute of those
// two (May 2025; an app made for its own workspace, as these are, isn't): a read Slack turns away
// waits as long as it says, in the background, a question's own conversation going first, and the
// connection says it's held (limited).
//
// Envelopes come in four kinds:
//   events_api       a message, a mention, an edit or deletion, the Home tab opened
//                    (app_home_opened), or Slack's Stop pressed on a working answer
//                    (agent_session_stopped). The same event sent twice (by its event id) is
//                    taken once.
//   interactive      a button pressed in your direct messages (Send, Edit, Discard, Approve, Keep;
//                    Continue and Stop for a run at its time limit; Approve and Deny for a change to
//                    files, Allow Once and Deny for a request held before it started), or where a
//                    question was asked (a change's Approve and Deny, Undo on its reply): who pressed
//                    it as Slack says, which the desk decides counts or not,
//                    a modal sent (the reply you edited, a question about a message), or the
//                    message shortcut "Ask <name> about this" (message_action)
//   slash_commands   /<name> and a question: posted in the conversation as the bot ("@Dana asked:
//                    …"), then answered in its thread, as a mention is; the acknowledgement waits
//                    for that post (two seconds at most) so a problem can be said to the asker alone
//   hello, disconnect   the connection itself
//
// What it hands over: a mention, a direct message, a reply in a thread it's answering in (follows:
// a reply in any other thread goes no further, and nothing is looked up for it), a message at the
// top of a channel it was told to answer without a mention (listens), /<name>, the shortcut, and an
// edit or deletion of a message in a thread. A channel's other messages come too (message.channels,
// for the replies) and go no further. With each, who wrote it (users.info for that person alone,
// once, never the whole workspace's list): a guest (is_restricted, is_ultra_restricted) or someone
// from another company (Slack Connect: another team, or is_stranger) says so, and one Slack
// couldn't say anything about says that, so the desk refuses them. Files attached come as their
// names, types and sizes; their contents are read only when the desk asks (download), from Slack's
// own addresses only, with the bot token, and never over 20 MB. Its own posts come back as events
// too: those go no further, but Test this connection waits for one (echo) to see events arrive.
//
// The Web API takes the bot token (xoxb-): auth.test (which workspace, which bot, and the scopes the
// token has, in its x-oauth-scopes header), users.list and users.info (the members to pick askers
// from, and who someone is), chat.postMessage (a reply, in the question's thread), chat.startStream,
// chat.appendStream and chat.stopStream (an answer sent without asking, streamed: 12,000 characters
// and 10 minutes at most, else posted plainly), files.getUploadURLExternal and
// files.completeUploadExternal (a file, and a long answer as one: files.upload was retired),
// users.conversations, conversations.history and conversations.replies (what was missed, and a
// question's context), pins.list (a channel's pinned messages, for context), reactions.add and
// reactions.remove (👀, ✅ and ⏳), conversations.info (a channel's name, and whether it's
// private), conversations.open and chat.update (your direct messages, with each draft and its
// buttons, settled once you've decided), chat.postEphemeral (a word to one person only),
// views.open and views.publish (the Edit and Ask modals, and the Home tab), agents.sessions.setStatus
// (Slack's "working" status and Stop button; assistant.threads.setStatus is its older name, tried
// when the new one isn't known). Slack's rate limits are kept: a 429 waits as long as its
// Retry-After says, for that method (a post's, in that channel only: Slack's limit for posting is
// per channel), and posts go one at a time in each conversation, a second apart, so one channel
// that's held up holds up no other. Posting where the app isn't a member (not_in_channel) is said to
// you (not-in-channel), not only to the record. check() is Test this connection's Slack part
// (conncheck.js): each check as { id, label, state: ok | warn | fail | skip, detail, fix }.
//
// The tokens are kept in the bot's slack.json in the data folder, readable by you only (0600), with
// where the bot got to in each conversation and who opened its Home tab lately: never in
// config.json, never given to an agent, never in its record. BRIDGE_SLACK_URL (tests): a stand-in
// for Slack (test/stand-ins/slack.mjs).
import fs from 'node:fs'
import WebSocket from 'ws'
import { writeFileAtomic } from './paths.js'

const BASE = () => String(process.env.BRIDGE_SLACK_URL || 'https://slack.com').replace(/\/+$/, '')
const API = () => `${BASE()}/api`
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
const STREAM_MAX = 12000 // a streamed message's words, all told (Slack's limit)
const FILE_MAX = 20 * 1024 * 1024 // a file attached to a question, read at most this big
const FILES_MAX = 10 // and this many of them
const PLACE_MS = 10 * 60 * 1000 // what a channel is (private, shared with another company), looked up again after this
const MEMBERS_MAX = 2000 // a channel with more members than this is taken as one whose members can't be checked
const SLASH_WAIT = 2000 // /<name>'s acknowledgement waits this long for its question to be posted
const HOME_DAYS = 30 // who opened its Home tab, remembered this long (to say it's offline)
const HOME_MAX = 50
const SEEN_MAX = 500 // envelopes and events remembered, so one sent twice is taken once
const READ_WAIT = 10 // seconds a question's conversation waits for Slack's rate limit at most (else it's read without)
// Seconds a reply waits for Slack's rate limit in its conversation at most: held longer, it's thrown
// (ratelimited, retryAfter), and the desk goes on with the rest and posts it again after that.
const POST_WAIT = 2
const CATCHUP_PAGES = 4 // pages of a conversation read for what was missed, at most
const GAP_SLACK = 60 // seconds before the gap began that what was missed is read from (events on their way)
const GHOST_MS = Number(process.env.BRIDGE_SLACK_GHOST_MS) || 60 * 1000 // after a drop, another connection seen is looked at again this much later
const NAMES_AT_ONCE = 20 // people looked up for a conversation's names, at most, each by users.info
const ECHO_MS = Number(process.env.BRIDGE_SLACK_ECHO_MS) || 10 * 1000 // Test this connection waits this long for its own message's event
const LIMITED_S = 20 // a read Slack holds back this long (or more) means the app is held to one a minute
const READS = new Set(['conversations.history', 'conversations.replies'])
// The methods that post: Slack's limit for them is per conversation, so a 429 holds up that one only.
const POSTS = new Set(['chat.postMessage', 'chat.update', 'chat.postEphemeral', 'chat.startStream', 'chat.appendStream', 'chat.stopStream', 'chat.delete'])
// A message's kinds that are someone writing: a reply sent to the channel too, one with a file.
const WRITTEN = new Set(['thread_broadcast', 'file_share'])

const read = (file) => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.() })
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
// A token shown: its kind and its last four, never the rest.
const masked = (t) => (t ? `${String(t).slice(0, 5)}…${String(t).slice(-4)}` : null)
const USER = /^[UW][A-Z0-9]{2,20}$/

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
  expired_trigger_id: 'Slack waited too long for the window to open: press the button again',
  message_not_in_streaming_state: 'The streamed answer ran out of time in Slack',
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
// What's posted: Slack's three escapes, so a reply's < or & isn't read as markup (a mention, an
// @channel) in a message or a stream.
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The app's manifest, to paste when making the app: a bot with the name you gave it, mentioned in
// channels, messaged directly and followed in its threads, asked with /<name> or the message
// shortcut, with a Home tab and buttons (interactivity), declared as an agent (Slack's working
// status and Stop button), over Socket Mode, with the scopes the calls above need and no more. (A
// manifest can't carry an icon: that's set in Slack's app page.) An app made from an earlier one
// lacks some scopes: Settings says which, from auth.test, and what each would let it do.
export const SCOPES = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'im:write', 'users:read', 'channels:history', 'channels:read', 'groups:history', 'groups:read', 'mpim:history', 'mpim:read', 'reactions:write', 'pins:read', 'files:read', 'files:write', 'commands', 'assistant:write']
// (And a channel shared with another organization, or no longer: told at once, not at the next look.)
export const EVENTS = ['app_mention', 'message.channels', 'message.groups', 'message.im', 'message.mpim', 'app_home_opened', 'agent_session_stopped', 'channel_shared', 'channel_unshared']
// What each scope lets it do, for "your app lacks …".
export const SCOPE_FOR = {
  'app_mentions:read': 'hear when it\'s mentioned',
  'chat:write': 'post its answers',
  'im:history': 'read its direct messages',
  'im:read': 'see its direct messages',
  'im:write': 'send you its drafts in a direct message',
  'users:read': 'tell who\'s asking, and turn away guests',
  'channels:history': 'follow replies in its threads in public channels',
  'channels:read': 'see the public channels it\'s in',
  'groups:history': 'follow replies in its threads in private channels',
  'groups:read': 'see the private channels it\'s in',
  'mpim:history': 'read group direct messages it\'s in',
  'mpim:read': 'see the group direct messages it\'s in',
  'reactions:write': 'react to questions (👀, ✅, ⏳)',
  'pins:read': 'read what\'s pinned in a channel',
  'files:read': 'read files attached to a question',
  'files:write': 'send files and long answers',
  commands: 'answer /<command>',
  'assistant:write': 'show Slack\'s working status and Stop button',
  'chat:write.customize': 'answer with each bot\'s own name and icon',
}
// A shared connection's app (connections.js) posts as each bot it reaches: its name and icon on each
// answer (chat:write.customize), so the manifest asks for that too.
export const SHARED_SCOPES = [...SCOPES, 'chat:write.customize']
// Its slash command, from its name: /pricing-desk for "Pricing Desk" (Slack's: lowercase, 32
// characters at most with the slash).
export function commandOf(name) {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31).replace(/-+$/, '')
  return slug ? `/${slug}` : '/ask-bot'
}
// Its message shortcut's name (Slack's: 25 characters at most).
export function shortcutOf(name) {
  const n = String(name || '').trim()
  if (n && `Ask ${n} about this`.length <= 25) return `Ask ${n} about this`
  if (n && `Ask ${n}`.length <= 25) return `Ask ${n}`
  return 'Ask about this'
}
// A shared connection's manifest: the app named as you named it, its one /command (a bot's name
// after it picks the bot), and each bot's own command too when you turned that on (perBot); the
// scopes to post as each bot. bots: the bots it reaches.
export function connectionManifest(c = {}, bots = [], you = '') {
  const who = String(you || '').trim()
  const m = manifest({ name: c.name, description: bots.length ? `Answers for ${who || 'its owner'}: ${bots.map((b) => b.name).join(', ')}` : '' }, you)
  if (c.perBot) m.features.slash_commands.push(...bots.map((b) => ({ command: commandOf(b.name), description: `Ask ${b.name} a question`.slice(0, 100), usage_hint: 'your question', should_escape: false })).filter((x) => x.command !== commandOf(c.name)).slice(0, 24))
  m.features.slash_commands[0].usage_hint = bots.length ? `${String(bots[0].name).toLowerCase().split(/\s+/)[0]} your question` : 'your question'
  m.oauth_config.scopes.bot = SHARED_SCOPES
  return m
}
export function manifest(bot = {}, you = '') {
  const who = String(you || '').trim()
  const name = String(bot.name || 'Bridge AI').slice(0, 35)
  const description = String(bot.description || (who ? `Answers questions for ${who}` : 'Answers questions from the folders you give it')).slice(0, 140)
  return {
    display_information: { name, description, background_color: '#1d2330' },
    features: {
      app_home: { home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: name, always_online: false },
      slash_commands: [{ command: commandOf(name), description: `Ask ${name} a question`.slice(0, 100), usage_hint: 'your question', should_escape: false }],
      shortcuts: [{ name: shortcutOf(name), type: 'message', callback_id: 'bb_ask', description: `Ask ${name} about this message`.slice(0, 150) }],
      agent_view: { agent_description: description },
    },
    oauth_config: { scopes: { bot: SCOPES } },
    settings: { event_subscriptions: { bot_events: EVENTS }, interactivity: { is_enabled: true }, org_deploy_enabled: false, socket_mode_enabled: true, token_rotation_enabled: false },
  }
}

// An address a file is read from or sent to: Slack's own (slack.com and the names under it, and
// its file servers), or the stand-in a test gives. Never anything else, whatever an event says.
function fromSlack(u) {
  let x
  try { x = new URL(String(u)) } catch { return false }
  if (process.env.BRIDGE_SLACK_URL) { try { if (x.origin === new URL(BASE()).origin) return true } catch { /* not a URL */ } }
  const host = x.hostname.toLowerCase()
  return x.protocol === 'https:' && (host === 'slack.com' || host.endsWith('.slack.com') || host.endsWith('.slack-edge.com'))
}
// The token goes only to Slack itself (slack.com and the names under it), not to its file servers'
// other names a download may be sent on to.
const tokenFor = (u) => { try { const x = new URL(u); return (process.env.BRIDGE_SLACK_URL && x.origin === new URL(BASE()).origin) || x.hostname === 'slack.com' || x.hostname.endsWith('.slack.com') } catch { return false } }

// id: the bot's. file: where its tokens are kept. say(event): what happened, for its record
// ({ what, ok, why }). threads(): the threads it's answering in, to read for what was missed
// ([{ channel, thread, since, dm }]). follows(channel, thread): whether it's answering in that
// thread now (the desk knows), so only those threads' replies are kept track of. listens(channel):
// whether it answers that channel's messages without a mention. info(): what its Home tab says
// ({ name, owner, you, description, paused, computer, command, shortcut; a shared connection's: bots,
// each with its name, description and command }). wanted: the scopes its manifest asks for (a
// shared connection's has chat:write.customize too).
export function makeSlack({ id = 'slack', file, say = () => {}, threads = () => [], follows = () => false, listens = () => false, info = () => ({}), wanted = SCOPES } = {}) {
  const FILE = file
  let kept = read(FILE)
  const save = () => writeFileAtomic(FILE, JSON.stringify(kept, null, 2), { mode: 0o600 })
  // Where it got to in each conversation and each thread it follows moves with nearly every
  // message in a busy channel: written a moment later, once for all of them, and only when it
  // moved. Threads it no longer follows, or quiet for a week, are let go of then, and so is who
  // opened its Home tab more than a month ago.
  let marking = null
  const tidy = () => {
    const old = Date.now() / 1000 - FOLLOW_DAYS * 86400
    for (const [k, ts] of Object.entries(kept.threads || {})) {
      const [channel, thread] = k.split(':')
      if (Number(ts) < old || !follows(channel, thread)) delete kept.threads[k]
    }
    if (kept.homes) {
      const since = Date.now() - HOME_DAYS * 86400000
      kept.homes = Object.fromEntries(Object.entries(kept.homes).filter(([, at]) => at > since).sort((a, b) => b[1] - a[1]).slice(0, HOME_MAX))
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
  let ghost = null // another connection, looked at again (GHOST_MS)
  let tries = 0
  let gen = 0 // each connection's number: what an old one says after it's replaced is ignored
  let tick = Date.now()
  // Why the next connection is made: start, refresh (Slack asked; the old one's still up), drop or
  // slept (there was a gap, and Slack may still count the old one for a while).
  let cause = 'start'
  // When the last connection was last heard from (seconds), so what's missed is read from then.
  let aliveAt = Number(kept.alive) || 0
  const lived = () => { const now = Date.now() / 1000; if (now - (Number(kept.alive) || 0) > 30) { kept.alive = now; marked() } aliveAt = now }
  // off | no-tokens | connecting | connected | reconnecting | error. numConnections: Slack's count at
  // the last hello; others: the connections that aren't this copy's ({ n, since }); limited: Slack
  // holding its reads back ({ method, wait, at }); catchingUp: what was missed, being read.
  let st = { state: kept.appToken && kept.botToken ? 'off' : 'no-tokens', why: null, since: new Date().toISOString(), lastEvent: null, connectedAt: null, drops: 0, hello: null, numConnections: null, others: null, limited: null, catchingUp: null }
  const set = (patch) => { st = { ...st, ...patch, since: patch.state && patch.state !== st.state ? new Date().toISOString() : st.since } }
  // Envelopes and events taken lately, so one Slack sends again is taken once.
  const seen = new Set()
  const fresh = (key) => {
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value)
    return true
  }

  // ---------- The Web API ----------
  // One call, form-encoded (every method takes that), with the token as a bearer. A 429 holds that
  // method back for as long as Slack says (a post's in that conversation only), for every call to
  // it: this one waits (up to `waits` times, `most` seconds at most each), then says so.
  const gates = new Map() // method (a post's with its channel) -> until (ms)
  const gateOf = (method, params) => (POSTS.has(method) ? `post:${params.channel || params.channel_id || ''}` : method)
  const held = (method, wait) => Object.assign(new Error(`Slack asked to wait ${wait} s before more (rate limited)`), { code: 'ratelimited', retryAfter: wait, method })
  async function call(method, params = {}, { token = kept.botToken, waits = 3, most = 60 } = {}) {
    if (!token) throw Object.assign(new Error('No token yet'), { code: 'not_authed' })
    const body = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]))
    const gate = gateOf(method, params)
    for (let i = 0; ; i++) {
      const shut = (gates.get(gate) || 0) - Date.now()
      if (shut > 0) {
        if (i > waits || !waits || shut > most * 1000) throw held(method, Math.ceil(shut / 1000))
        await sleep(shut)
      }
      let res
      try {
        res = await fetch(`${API()}/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) })
      } catch (e) {
        throw Object.assign(new Error(`Couldn't reach Slack: ${e.cause?.code || e.message}`), { code: 'offline', method })
      }
      if (res.status === 429) {
        const said = Math.max(1, Number(res.headers.get('retry-after')) || 1)
        gates.set(gate, Date.now() + Math.min(600, said) * 1000)
        if (READS.has(method) && said >= LIMITED_S) limitedNow(method, said)
        continue
      }
      const j = await res.json().catch(() => null)
      if (!res.ok && !j) throw Object.assign(new Error(`Slack answered ${res.status}`), { code: `http_${res.status}`, method })
      if (!j?.ok) throw slackError(method, j)
      // (A read that gave 15 when more were asked for, and more wait: Slack's limit for a held app.)
      if (READS.has(method) && Number(params.limit) > 15 && j.has_more && Array.isArray(j.messages) && j.messages.length === 15) limitedNow(method, null)
      // The scopes the token has, as Slack says them with each answer.
      if (method === 'auth.test') Object.defineProperty(j, 'scopes', { value: res.headers.has('x-oauth-scopes') ? String(res.headers.get('x-oauth-scopes')).split(',').map((x) => x.trim()).filter(Boolean) : null })
      return j
    }
  }
  // Slack holding back the app's reads of conversations: said once a connection, kept in its state.
  function limitedNow(method, wait) {
    const was = st.limited
    st.limited = { method, wait: wait ?? was?.wait ?? null, at: new Date().toISOString() }
    if (!was) say({ what: 'rate-limited', ok: false, why: `Slack holds this app to about one read a minute of a conversation (${method}), as it does a distributed app outside its Marketplace: what was missed is read slowly, and some answers may come without their conversation. An app made in and for this workspace isn't held back.` })
  }
  // The scopes the manifest asks for that the app's token doesn't have (null: Slack didn't say).
  const missing = () => (Array.isArray(kept.scopes) ? wanted.filter((x) => !kept.scopes.includes(x)) : null)
  const lacks = (scope) => !!missing()?.includes(scope)
  const lacking = (scope) => Object.assign(new Error(`The Slack app lacks ${scope}: update it with the new manifest`), { code: 'missing_scope' })

  // ---------- Connecting ----------
  const stopTimers = () => { clearInterval(pinger); pinger = null; clearTimeout(retry); retry = null; clearTimeout(ghost); ghost = null }
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
    cause = 'drop'
    set({ state: 'reconnecting', why, nextTry: new Date(Date.now() + wait * 1000).toISOString() })
    retry = setTimeout(() => { connect().catch(() => {}) }, wait * 1000)
  }

  // One envelope, on whichever connection it came (the old one while a new one is made, or one
  // opened only to read its hello): acknowledged once, at once (a slash command's when its question
  // is posted, within two seconds), and every event taken; the same one twice is heard once.
  function envelope(m, socket) {
    let acked = false
    const ack = (payload) => {
      if (acked || !m.envelope_id) return
      acked = true
      try { socket.send(JSON.stringify({ envelope_id: m.envelope_id, ...(payload ? { payload } : {}) })) } catch { /* closing */ }
    }
    if (m.envelope_id && !fresh(`env:${m.envelope_id}`)) return ack()
    if (m.type === 'slash_commands') return slash(m.payload, ack).catch((e) => { ack(); say({ what: 'command', ok: false, why: e.message }) })
    if (m.type === 'interactive') return interact(m.payload, ack).catch((e) => { ack(); say({ what: 'interaction', ok: false, why: e.message }) })
    ack()
    if (m.type === 'events_api') {
      if (!fresh(m.payload?.event_id ? `ev:${m.payload.event_id}` : null)) return
      return heard(m.payload?.event, { team: m.payload?.team_id }).catch((e) => say({ what: 'event', ok: false, why: e.message }))
    }
  }

  // How many connections Slack has open for the app, against how many are this copy's: more is
  // another copy (or another program) on the same app, said plainly; fewer again, said too.
  function counted(n, ours) {
    if (!Number.isFinite(n)) return
    st.numConnections = n
    const extra = n - ours
    if (extra > 0) {
      const first = !st.others
      st.others = { n: extra, since: st.others?.since || new Date().toISOString() }
      if (first) say({ what: 'another-copy', ok: false, why: `Another copy of Bridge AI (or another program) is connected to this Slack app too${extra > 1 ? ` (${extra} more connections)` : ''}: Slack gives each message to just one of them, so some questions go there and not here. Quit Bridge AI on the other computer, or give each computer its own Slack app.` })
    } else if (st.others) {
      st.others = null
      say({ what: 'another-copy', ok: true, why: 'No other copy is connected to this Slack app now' })
    }
  }
  // A connection opened only to read Slack's hello (num_connections, with this one counted), then
  // closed: { ok, n, ours } (ours: this copy's own, the probe's included), or { ok: false, why }.
  // Whatever Slack sends it meanwhile is taken as on any other.
  async function probe() {
    let url
    try { url = (await call('apps.connections.open', {}, { token: kept.appToken, waits: 1 })).url } catch (e) { return { ok: false, why: e.message } }
    return new Promise((resolve) => {
      const s = new WebSocket(url, { handshakeTimeout: 15000 })
      let over = false
      const done = (x) => { if (over) return; over = true; clearTimeout(t); try { s.close() } catch { /* gone */ } resolve(x) }
      const t = setTimeout(() => done({ ok: false, why: 'Slack said nothing on a new connection' }), 15000)
      t.unref?.()
      s.on('message', (raw) => {
        let m
        try { m = JSON.parse(String(raw)) } catch { return }
        if (m.type === 'hello') return done({ ok: true, n: Number(m.num_connections), ours: 1 + (ws?.readyState === WebSocket.OPEN && st.state === 'connected' ? 1 : 0) })
        if (m.envelope_id) envelope(m, s)
      })
      s.on('error', (e) => done({ ok: false, why: `The connection failed: ${e.message}` }))
      s.on('close', () => done({ ok: false, why: 'Slack closed the connection before saying hello' }))
    })
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
    const why = cause
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
    socket.on('pong', () => { alive = true; if (mine === gen) lived() })
    socket.on('message', (raw) => {
      alive = true
      let m
      try { m = JSON.parse(String(raw)) } catch { return }
      if (m.envelope_id) return envelope(m, socket)
      if (mine !== gen) return
      if (m.type === 'hello') {
        tries = 0
        // (Which app it is, from Slack's hello: Settings links to its page, for its icon.)
        const appId = String(m.connection_info?.app_id || '')
        if (/^A[A-Z0-9]{1,20}$/.test(appId) && kept.appId !== appId) { kept.appId = appId; marked() }
        // (The old one still up when this one said hello: Slack moved it, and nothing was missed.)
        const seamless = !!was && was !== socket && was.readyState === WebSocket.OPEN
        const gapFrom = aliveAt || Number(kept.alive) || 0
        if (was && was !== socket) drop(was)
        set({ state: 'connected', why: null, connectedAt: new Date().toISOString(), nextTry: null, hello: new Date().toISOString() })
        lived()
        say({ what: 'connected', ok: true })
        const short = missing()
        if (short?.length) say({ what: 'scopes-missing', ok: false, why: `The Slack app lacks ${short.join(', ')}: update it with the new manifest`, missing: short })
        // Slack's count of connections: this copy's is one (two while the old one's still up). After
        // a gap, Slack may count the old one a while yet: looked at again before it's said.
        const n = Number(m.num_connections)
        if (Number.isFinite(n) && n > 1 + (seamless ? 1 : 0) && (why === 'drop' || why === 'slept')) {
          st.numConnections = n
          clearTimeout(ghost)
          ghost = setTimeout(() => { if (mine === gen) probe().then((r) => { if (r.ok && mine === gen) counted(r.n, r.ours) }).catch(() => {}) }, GHOST_MS)
          ghost.unref?.()
        } else counted(n, 1 + (seamless ? 1 : 0))
        cause = 'drop'
        if (!seamless) missed({ from: gapFrom }).catch((e) => say({ what: 'missed', ok: false, why: `Couldn't read what was asked while away: ${e.message}` }))
      } else if (m.type === 'disconnect') {
        // Slack moves the bot: refresh_requested and warning, a new connection first; link_disabled,
        // Socket Mode turned off for the app.
        if (m.reason === 'link_disabled') { drop(socket); later('Socket Mode is turned off for your Slack app: turn it on in the app\'s settings › Socket Mode, then Connect again', { final: true }) } else { cause = 'refresh'; connect().catch(() => {}) }
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
    if (now - tick > SLEPT_MS && hear && st.state === 'connected') { drop(ws); ws = null; tries = 0; cause = 'slept'; set({ state: 'reconnecting', why: 'The computer slept; connecting again' }); connect().catch(() => {}) }
    tick = now
  }, 5000)
  watch.unref?.()

  // ---------- What comes in ----------
  const names = {} // user id -> name, from users.list and users.info
  const users = {} // user id -> { guest, team, stranger }, the same
  const places = {} // channel id -> { kind, id, name, private, shared, at }
  // Where a message was: a direct message, or a channel by its name and whether it's private or
  // shared with another company (a lookup that fails says neither, and is tried again next time).
  // Looked up again after PLACE_MS, and at once when Slack says it's been shared or unshared.
  async function placeOf(channel, type) {
    if (type === 'im' || String(channel).startsWith('D')) return { kind: 'dm', id: channel, name: null, private: true, shared: false }
    if (places[channel] && Date.now() - places[channel].at < PLACE_MS) return places[channel]
    try {
      const c = (await call('conversations.info', { channel })).channel || {}
      places[channel] = { kind: 'channel', id: channel, name: c.name || null, private: !!(c.is_private || c.is_im || c.is_mpim), shared: !!(c.is_ext_shared || c.is_shared), at: Date.now() }
      return places[channel]
    } catch { return { kind: 'channel', id: channel, name: null, private: false, shared: false } }
  }
  const learn = (u) => {
    if (!u?.id) return
    names[u.id] = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id
    users[u.id] = { guest: !!(u.is_restricted || u.is_ultra_restricted), team: u.team_id || null, stranger: u.is_stranger === true, bot: !!(u.is_bot || u.id === 'USLACKBOT') }
  }
  // Who's in a channel (conversations.members), each as person() has them (a guest, someone from
  // another company, a bot); null when Slack can't say, or there are more than MEMBERS_MAX. (Many
  // not known yet: the workspace's list once, rather than each of them on their own.)
  async function members(channel) {
    const ids = []
    let cursor
    do {
      const j = await call('conversations.members', { channel, limit: 200, cursor })
      ids.push(...(j.members || []))
      cursor = j.response_metadata?.next_cursor || undefined
    } while (cursor && ids.length < MEMBERS_MAX)
    if (cursor) return null
    if (ids.filter((u) => !users[u]).length > NAMES_AT_ONCE) await people().catch(() => {})
    const out = []
    for (const u of ids) out.push(u === kept.bot?.userId ? { id: u, bot: true } : { ...(await person({ user: u })), bot: !!users[u]?.bot })
    return out
  }
  // Who wrote it: a member of this workspace, a guest, or someone from another company (Slack
  // Connect: the event says another team, or Slack does), as Slack says of them alone (users.info,
  // once, kept). One Slack can't say anything about: unknown, and why (refused, as a guest is).
  async function person(e) {
    if (!users[e.user]) {
      try { learn((await call('users.info', { user: e.user })).user) } catch (err) { return { id: e.user, name: null, unknown: true, why: err.message } }
    }
    const u = users[e.user]
    if (!u) return { id: e.user, name: null, unknown: true, why: 'Slack said nothing about them' }
    const team = kept.team?.id
    const other = (t) => !!(t && team && t !== team)
    return { id: e.user, name: names[e.user] || null, guest: u.guest, external: u.stranger || other(u.team) || other(e.user_team) || other(e.source_team) }
  }
  // Its own messages waited for as events (Test this connection): `${channel}:${ts}` -> resolve;
  // and the last of them that came, for one that came before it was waited for.
  const echoes = new Map()
  const recent = new Set()
  // The names of the people in a conversation read for context, each not known yet asked of Slack
  // on its own (users.info, NAMES_AT_ONCE at most), never the whole workspace's list.
  async function named(ids) {
    const want = [...new Set(ids)].filter((u) => u && USER.test(u) && !names[u]).slice(0, NAMES_AT_ONCE)
    await Promise.all(want.map((u) => call('users.info', { user: u }, { waits: 1 }).then((j) => learn(j.user), () => {})))
  }
  // Files attached to a message: their names, types and sizes for the desk; where each is kept by
  // Slack, remembered here for download() (the last 500).
  const urls = new Map()
  const filesOf = (e) => (Array.isArray(e.files) ? e.files : []).filter((f) => f?.id && f.mode !== 'tombstone').slice(0, FILES_MAX).map((f) => {
    const url = f.url_private_download || f.url_private || null
    if (url) { urls.set(f.id, url); if (urls.size > 500) urls.delete(urls.keys().next().value) }
    return { id: f.id, name: String(f.name || f.title || f.id).slice(0, 200), type: f.mimetype || f.filetype || null, size: Number(f.size) || 0, url }
  })

  // What comes in: a mention of the bot in a channel, a direct message to it, a reply in a thread
  // (the desk keeps only those in threads it answers in), or a message at the top of a channel it
  // answers without a mention, from a person; an edit or deletion; its Home tab opened; Stop
  // pressed. A thread's reply goes in that thread, a channel's message in a thread of its own or,
  // where the bot answers in the channel (its Answer In: the desk picks), in the channel (top), a
  // direct message plainly back.
  async function heard(e, { late = false, team = null } = {}) {
    if (!e || !hear) return
    if (e.type === 'app_home_opened') return home(e)
    if (e.type === 'agent_session_stopped') return stopped(e, team)
    if (e.type === 'channel_shared' || e.type === 'channel_unshared') { delete places[e.channel]; return }
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
    // (Its own message, back as an event: what Test this connection waits for.)
    if ((e.bot_id && e.bot_id === kept.bot?.botId) || (e.user && e.user === kept.bot?.userId)) {
      const k = `${e.channel}:${e.ts}`
      recent.add(k)
      if (recent.size > 50) recent.delete(recent.values().next().value)
      echoes.get(k)?.()
    }
    if (e.bot_id || (e.subtype && !WRITTEN.has(e.subtype)) || !e.user || e.user === kept.bot?.userId) return
    const mention = e.type === 'app_mention' || String(e.text || '').includes(`<@${kept.bot?.userId}>`)
    // A channel's own message that doesn't mention it: not for it, unless it answers that channel
    // without a mention. A reply in a thread it isn't answering in: not for it either, and nothing's
    // looked up for it (who wrote it, the channel).
    const listened = !dm && !mention && !thread && !!listens(e.channel)
    if (!dm && !mention && !thread && !listened) return
    if (thread && !dm && !mention && !follows(e.channel, thread)) return
    set({ lastEvent: new Date().toISOString() })
    const place = await placeOf(e.channel, dm ? 'im' : null)
    const files = filesOf(e)
    const from = await person(e)
    // (The people it mentions, by name.)
    await named([...String(e.text || '').matchAll(/<@([UW][A-Z0-9]{2,20})>/g)].map((x) => x[1]).filter((u) => u !== kept.bot?.userId))
    await hear({
      ts: e.ts, channel: e.channel, thread, mention, dm,
      ...(listened ? { via: 'listen' } : {}),
      from,
      text: plainText(e.text, { bot: kept.bot?.userId, names }),
      ...(files.length ? { files } : {}),
      place,
      at: new Date(Number(e.ts) * 1000).toISOString(),
      late,
      reply: { channel: e.channel, thread: dm && !e.thread_ts ? null : e.thread_ts || e.ts, user: e.user },
      ...(!dm && !thread ? { top: { channel: e.channel, thread: null, user: e.user } } : {}),
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

  // ---------- Decisions, modals, /<name> and the shortcut ----------
  // A decision handed to the desk; one it couldn't take is said to whoever pressed the button, to
  // them only (in that conversation, else in their direct messages).
  const who = (u) => ({ id: u?.id || null, name: (u?.id && names[u.id]) || u?.name || u?.username || null })
  async function act(a, where) {
    if (!hear?.act) return null
    let r
    try { r = await hear.act(a) } catch (e) { r = { ok: false, error: e.message } }
    if (r && r.ok === false && r.error && a.user?.id) await tell(where, a.user.id, r.error)
    return r
  }
  async function tell(where, user, text) {
    try {
      if (where?.channel) await call('chat.postEphemeral', { channel: where.channel, user, text: escape(text), ...(where.thread ? { thread_ts: where.thread } : {}) }, { waits: 1 })
      else await dm(user, text)
    } catch (e) { say({ what: 'ephemeral', ok: false, why: `Couldn't tell them: ${e.message}` }) }
  }
  const plainIn = (text) => ({ type: 'plain_text', text: clip(text, 75) })
  // What was typed in a modal: the value of its one box.
  const typed = (view, block, action) => {
    const v = view?.state?.values?.[block]?.[action]
    return String(v?.value ?? '').trim()
  }

  // A button pressed, a modal sent, or the message shortcut. Acknowledged before anything is
  // waited on (Slack waits 3 seconds): a modal sent empty is acknowledged with what's wrong, so the
  // modal stays open saying so.
  async function interact(p, ack) {
    if (!p) return ack()
    const user = who(p.user)
    const team = p.team?.id || p.user?.team_id || null
    if (p.type === 'view_submission') {
      const v = p.view || {}
      if (v.callback_id === 'bb_edit') {
        const text = typed(v, 'reply', 'text')
        if (!text) return ack({ response_action: 'errors', errors: { reply: 'Write the reply first' } })
        ack()
        let meta
        try { meta = JSON.parse(v.private_metadata) } catch { meta = { q: String(v.private_metadata || '') } }
        if (typeof meta === 'string') meta = { q: meta }
        return act({ act: 'edit', q: meta.q, user, team, text }, meta.channel ? { channel: meta.channel } : null)
      }
      if (v.callback_id === 'bb_wapprove') {
        ack()
        let meta = {}
        try { meta = JSON.parse(v.private_metadata) || {} } catch { /* nothing to go on */ }
        return act({ act: 'wok', q: meta.q, change: meta.change || null, nonce: meta.nonce || null, user, team }, meta.channel ? { channel: meta.channel, thread: meta.thread || null } : null)
      }
      if (v.callback_id === 'bb_ask') {
        const q = typed(v, 'q', 'text')
        if (!q) return ack({ response_action: 'errors', errors: { q: 'Write a question first' } })
        ack()
        let meta = {}
        try { meta = JSON.parse(v.private_metadata) || {} } catch { /* nothing to go on */ }
        return asked({ user, team, channel: meta.channel, thread: meta.thread || meta.ts, text: q })
      }
      return ack()
    }
    ack()
    if (!hear) return
    if (p.type === 'block_actions') {
      const a = p.actions?.[0]
      if (!a) return
      const where = { channel: p.container?.channel_id || p.channel?.id || null, thread: p.container?.thread_ts || null }
      if (['bb_send', 'bb_discard', 'bb_approve'].includes(a.action_id)) return act({ act: a.action_id.slice(3), q: a.value, user, team }, where)
      if (a.action_id === 'bb_keep' || a.action_id === 'bb_drop') return act({ act: a.action_id.slice(3), memory: a.value, user, team }, where)
      // (A run at its time limit: Continue, its value the question and the minutes; Stop.)
      if (a.action_id === 'bb_continue') { const [q, n] = String(a.value || '').split(' '); return act({ act: 'continue', q, minutes: Number(n) || null, user, team }, where) }
      if (a.action_id === 'bb_halt') return act({ act: 'halt', q: a.value, user, team }, where)
      // (A change to files: Approve and Deny, in your direct messages or where it was asked; Undo on
      // its reply; Allow Once and Deny for a request held before it started. Its value: the question,
      // the change and that change's own code. Who pressed it is Slack's to say: the desk decides
      // whether that counts.)
      if (['bb_wno', 'bb_sok', 'bb_sno', 'bb_undo'].includes(a.action_id)) { const [q, change, nonce] = String(a.value || '').split(' '); return act({ act: a.action_id.slice(3), q, change: change || null, nonce: nonce || null, user, team }, where) }
      // (Approve: first the whole change to look at, for you alone; its own Approve makes it.)
      if (a.action_id === 'bb_wok') { const [q, change, nonce] = String(a.value || '').split(' '); return approver(p, { q, change: change || null, nonce: nonce || null, user, team }, where) }
      if (a.action_id === 'bb_edit') return editor(p, a.value, user, where)
      // (A bot picked for a question on a shared connection: connhub.js.)
      if (a.action_id === 'bb_pick') { const [key, bot] = String(a.value || '').split(' '); return act({ act: 'pick', key, bot, user, team }, where) }
      return
    }
    if (p.type === 'message_action' && p.callback_id === 'bb_ask') {
      const msg = p.message || {}
      const channel = p.channel?.id || null
      const thread = msg.thread_ts || msg.ts || p.message_ts || null
      const title = shortcutOf(info().name || kept.bot?.name || '').replace(/ about this$/, '')
      try {
        await call('views.open', {
          trigger_id: p.trigger_id,
          view: {
            type: 'modal', callback_id: 'bb_ask', private_metadata: JSON.stringify({ channel, ts: msg.ts || p.message_ts || null, thread }),
            title: { type: 'plain_text', text: clip(title, 24) }, submit: { type: 'plain_text', text: 'Ask' }, close: { type: 'plain_text', text: 'Cancel' },
            blocks: [
              { type: 'context', elements: [{ type: 'mrkdwn', text: clip(`About: ${escape(plainText(msg.text, { bot: kept.bot?.userId, names }) || 'this message')}`, 2900) }] },
              { type: 'input', block_id: 'q', label: { type: 'plain_text', text: 'What do you want to know?' }, element: { type: 'plain_text_input', action_id: 'text', multiline: true, initial_value: 'Is this right?' } },
            ],
          },
        }, { waits: 0 })
      } catch (e) { await tell(channel ? { channel, thread } : null, user.id, `Couldn't open the question: ${e.message}`) }
    }
  }
  // A change to files' Approve, pressed (in your direct messages or where it was asked): the desk says
  // whether it's yours to approve and gives the whole change; a modal shows all of it (who asked,
  // why it waits, every line of its diff) with Approve, which makes it. One too long for Slack to show
  // whole, or with a file that can't be shown at all, has no Approve there: Needs You has it. Anyone
  // else is told, privately, that only you can.
  async function approver(p, a, where) {
    const r = await act({ act: 'wview', ...a }, where)
    if (!r?.ok || !r.view) return
    const v = r.view
    const head = { type: 'section', text: { type: 'mrkdwn', text: clip(`*${md(v.who)}* asked *${md(v.bot)}* ${md(v.where)} for a change to ${v.files.length === 1 ? '1 file' : `${v.files.length} files`}:\n${v.files.slice(0, 20).map((f) => `• \`${md(f.path)}\`${f.op === 'add' ? ' (new)' : f.op === 'remove' ? ' (deleted)' : f.op === 'move' ? ` (moved from \`${md(f.from)}\`)` : ''}`).join('\n')}${v.files.length > 20 ? `\n…and ${v.files.length - 20} more` : ''}`, 3000) } }
    const why = v.held ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: clip(`:warning: It waits for you whoever asks: ${md(v.held)}`, 2000) }] }] : []
    const text = md(v.diff).replace(/```/g, '`​``')
    const chunks = []
    for (let i = 0; i < text.length; i += 2800) chunks.push(text.slice(i, i + 2800))
    const fits = chunks.length <= 90
    // (A file in it that can't be shown at all, binary or too long: no Approve here either.)
    const approvable = fits && !v.unshown
    const blocks = [head, ...why, ...(fits ? chunks.map((c) => ({ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${c}\`\`\`` } })) : [{ type: 'section', text: { type: 'mrkdwn', text: 'Its diff is too long to show here: approve it in Needs You in Bridge AI, which shows all of it.' } }]),
      ...(fits && v.unshown ? [{ type: 'section', text: { type: 'mrkdwn', text: 'Part of it can\'t be shown here (a binary file, or one too long): approve it in Needs You in Bridge AI, where its files can be opened.' } }] : [])]
    try {
      await call('views.open', {
        trigger_id: p.trigger_id,
        view: {
          type: 'modal', callback_id: 'bb_wapprove', private_metadata: JSON.stringify({ q: v.q, change: v.change, nonce: v.nonce, channel: where?.channel || null, thread: where?.thread || null }),
          title: { type: 'plain_text', text: 'Approve the change' }, ...(approvable ? { submit: { type: 'plain_text', text: 'Approve' } } : {}), close: { type: 'plain_text', text: 'Cancel' }, blocks,
        },
      }, { waits: 0 })
    } catch (e) { await tell(where, a.user.id, `Couldn't show the change: ${e.message}`) }
  }
  // Edit: a modal with the draft in it, to change and send.
  async function editor(p, q, user, where) {
    let d = null
    try { d = await hear.draft?.(q) } catch { /* said below */ }
    if (!d || d.editable === false) return tell(where, user.id, 'That isn\'t waiting any more')
    try {
      await call('views.open', {
        trigger_id: p.trigger_id,
        view: {
          type: 'modal', callback_id: 'bb_edit', private_metadata: JSON.stringify({ q, channel: where?.channel || null }),
          title: { type: 'plain_text', text: 'Edit the reply' }, submit: { type: 'plain_text', text: 'Send' }, close: { type: 'plain_text', text: 'Cancel' },
          blocks: [{ type: 'input', block_id: 'reply', label: { type: 'plain_text', text: 'Reply' }, element: { type: 'plain_text_input', action_id: 'text', multiline: true, ...(d.text ? { initial_value: clip(d.text, 3000) } : {}) } }],
        },
      }, { waits: 0 })
    } catch (e) { await tell(where, user.id, `Couldn't open the reply to edit: ${e.message}`) }
  }

  // A question put through /<name> or the shortcut: posted where it was asked, as the bot, so the
  // conversation shows it, then handed over as a mention is, its answer in that post's thread, or in
  // the channel where the bot answers there (the shortcut's in the message's own thread). { ts }
  // back, or why not.
  async function asked({ user, team, channel, thread = null, text, via = 'shortcut', command = null }) {
    if (!hear || !channel || !USER.test(String(user?.id || ''))) return { error: 'Slack didn\'t say who or where' }
    const dmd = String(channel).startsWith('D')
    let posted
    try {
      posted = await call('chat.postMessage', { channel, text: `<@${user.id}> ${via === 'slash' ? 'asked' : 'asked me about this'}: ${escape(text)}`, ...(thread ? { thread_ts: thread } : {}), unfurl_links: false, unfurl_media: false }, { waits: 0 })
    } catch (e) {
      notIn(channel, e)
      const why = ['not_in_channel', 'channel_not_found'].includes(e.code) ? `Invite me to this channel first: /invite @${kept.bot?.name || info().name || 'me'}` : `Couldn't take that: ${e.message}`
      if (via !== 'slash') await tell(null, user.id, why)
      return { error: why }
    }
    set({ lastEvent: new Date().toISOString() })
    const place = await placeOf(channel, dmd ? 'im' : null)
    const top = thread || posted.ts
    hear({
      ts: posted.ts, channel, thread: thread || null, mention: true, dm: dmd, via, ...(command ? { command } : {}),
      from: await person({ user: user.id, user_team: team && team !== kept.team?.id ? team : undefined }),
      text: plainText(text, { bot: kept.bot?.userId, names }),
      place, at: new Date(Number(posted.ts) * 1000).toISOString(), late: false,
      reply: { channel, thread: top, user: user.id },
      ...(!dmd && !thread ? { top: { channel, thread: null, user: user.id } } : {}),
    })?.catch?.((e) => say({ what: 'event', ok: false, why: e.message }))
    return { ts: posted.ts }
  }
  // /<name> and a question: its acknowledgement waits for the question to be posted (two seconds at
  // most), so a problem (the bot not in that channel, no question) is said to the asker alone.
  async function slash(p, ack) {
    if (!p || !hear) return ack()
    const cmd = p.command || commandOf(info().name || kept.bot?.name || '')
    const text = String(p.text || '').trim()
    if (!text) return ack({ response_type: 'ephemeral', text: `Ask me something after ${cmd}, like ${cmd} what's the enterprise price?` })
    let gone = false
    const once = (payload) => { if (gone) return; gone = true; ack(payload) }
    const timer = setTimeout(() => once(), SLASH_WAIT)
    timer.unref?.()
    const r = await asked({ user: { id: p.user_id, name: p.user_name }, team: p.team_id, channel: p.channel_id, text, via: 'slash', command: p.command || null })
    clearTimeout(timer)
    if (!r?.error) return once()
    // (Too late to say it with the acknowledgement: said to them alone instead.)
    if (gone) return tell({ channel: p.channel_id }, p.user_id, r.error)
    once({ response_type: 'ephemeral', text: r.error })
  }

  // Slack's Stop pressed on a working answer: handed to the desk to stop, and its working status
  // ended (Slack leaves that to the app).
  async function stopped(e, team) {
    if (!e.channel) return
    await act({ act: 'stop', channel: e.channel, thread: e.thread_ts || null, user: who({ id: e.user }), team }, { channel: e.channel, thread: e.thread_ts || null })
    if (e.thread_ts) await status({ channel: e.channel, thread: e.thread_ts }, false)
  }

  // ---------- The Home tab ----------
  // Whose bot it is, whether it's online, how to ask it and its commands. Who opened it lately is
  // remembered (a month, 50 people at most), so it can say it's offline when it stops.
  const homeView = (online) => {
    const x = info() || {}
    const name = x.name || kept.bot?.name || 'This bot'
    const you = x.you || x.owner?.name || 'its owner'
    const cmd = x.command || commandOf(name)
    const state = !online ? `:white_circle: Offline since ${new Date().toUTCString().replace(/:\d\d GMT$/, ' UTC')}: ${you}'s computer isn't answering.` : x.paused ? `:double_vertical_bar: Paused: questions go to ${you}.` : ':large_green_circle: Online now.'
    // A shared connection: each bot it reaches, and how to ask each.
    if (x.shared) {
      const word = (n) => String(n || '').toLowerCase().split(/\s+/)[0]
      return {
        type: 'home',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: clip(name, 150) } },
          { type: 'section', text: { type: 'mrkdwn', text: clip(`*${escape(name)}* is ${escape(you)}'s way to their bots in Bridge AI, on ${escape(you)}'s computer${x.computer ? ` (${escape(x.computer)})` : ''}.`, 3000) } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: state }] },
          ...(x.bots || []).slice(0, 40).map((b) => ({ type: 'section', text: { type: 'mrkdwn', text: clip(`*${escape(b.name)}*${b.paused ? ' (paused)' : ''}${b.description ? `\n${escape(b.description)}` : ''}\nAsk: \`${escape(b.name)}: your question\`, or ${escape(cmd)} ${escape(word(b.name))} your question${b.command ? `, or ${escape(b.command)}` : ''}${b.channels?.length ? `\nAnswers in ${b.channels.map((c) => `#${escape(c)}`).join(', ')}` : ''}`, 3000) } })),
          { type: 'section', text: { type: 'mrkdwn', text: clip(`*How to ask*\n• Mention @${escape(name)} with a bot's name first, or send a direct message (it goes to the bot you asked last)\n• Type ${escape(cmd)}, a bot's name and your question\n• Not sure which? Just ask: it picks the bot, or asks you which.\nA reply in a thread goes to the bot that answered there.`, 3000) } },
          { type: 'section', text: { type: 'mrkdwn', text: '*Commands*, after a bot\'s name (like `Pricing Desk: !status`)\n`!help` the bots here, or what one does\n`!status` `!mute` `!unmute` `!stop` `!what do you know about me` `!forget me`' } },
        ],
      }
    }
    return {
      type: 'home',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: clip(name, 150) } },
        { type: 'section', text: { type: 'mrkdwn', text: clip(`*${escape(name)}* is ${escape(you)}'s bot. It answers from Bridge AI on ${escape(you)}'s computer${x.computer ? ` (${escape(x.computer)})` : ''}.${x.description ? `\n${escape(x.description)}` : ''}`, 3000) } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: state }] },
        { type: 'section', text: { type: 'mrkdwn', text: clip(`*How to ask*\n• Mention it in a channel it's in: @${escape(name)} and your question\n• Send it a direct message\n• Type ${escape(cmd)} and your question\n• On a message: More actions › ${escape(x.shortcut || shortcutOf(name))}\nA reply in a thread it answered in needs no mention.`, 3000) } },
        { type: 'section', text: { type: 'mrkdwn', text: '*Commands*, after a mention or in a direct message\n`!help` what it does and whose it is\n`!status` whether it\'s connected, and its queue\n`!mute` and `!unmute` this channel\n`!stop` stops the answer it\'s working on\n`!what do you know about me`\n`!forget me` deletes what it remembers about you' } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: clip(`If nothing answers, ${escape(you)}'s computer may be off: your question waits in Slack and is answered when it's back (up to 3 days).`, 3000) }] },
      ],
    }
  }
  async function home(e) {
    if (!e.user || (e.tab && e.tab !== 'home')) return
    if (!kept.homes) kept.homes = {}
    kept.homes[e.user] = Date.now()
    marked()
    try { await call('views.publish', { user_id: e.user, view: homeView(true) }, { waits: 1 }) } catch (err) { say({ what: 'home', ok: false, why: `Couldn't show its Home tab: ${err.message}` }) }
  }
  // Stopped: the Home tab says it's offline, to who opened it lately (without holding up the stop).
  function offline() {
    const list = Object.keys(kept.homes || {})
    if (!list.length || !kept.botToken) return
    const view = homeView(false)
    ;(async () => { for (const u of list) { try { await call('views.publish', { user_id: u, view }, { waits: 0 }) } catch { /* next time it opens */ } } })()
  }

  // The conversation a question was asked in, as context: in a thread, its earlier messages (since
  // `since`, when the answer goes on from an earlier one); at the top of a channel, its latest
  // messages and what's pinned there; in a direct message, its latest messages. Each with who wrote
  // it, and whether that was this bot. { kind, messages: [{ ts, person, text, you }], pins, problem }
  // (A question's conversation goes before reading what was missed: catch-up waits while one's read,
  // and one waits READ_WAIT seconds at most for Slack's rate limit, else goes without.)
  let reads = 0
  async function context({ channel, thread, ts, since = null, dm = false }) {
    // (A message posted as one of a shared connection's bots carries that bot's name: username.)
    // (What's known of who wrote it, as person() says of an asker: a guest, someone from another
    // organization (also from the message's own team); a bot or an integration (a webhook, a workflow),
    // whose words are anyone's. A post of this app's own: as, the name it was posted as, one of a shared
    // connection's bots, so a bot takes only its own as its own words: frontdesk.js heardFrom.)
    const team = kept.team?.id
    const other = (t) => !!(t && team && t !== team)
    const said = (m) => {
      const own = !!((m.user && m.user === kept.bot?.userId) || (m.bot_id && m.bot_id === kept.bot?.botId))
      const u = m.user ? users[m.user] : null
      const flags = { ...(u?.guest ? { guest: true } : {}), ...(u?.stranger || other(u?.team) || other(m.user_team) || other(m.source_team) ? { external: true } : {}) }
      return {
        ts: m.ts, person: { id: m.user || m.bot_id || null, name: (m.bot_id && m.username) || names[m.user] || m.username || m.bot_profile?.name || m.user || null, ...flags },
        text: clip(plainText(m.text, { bot: kept.bot?.userId, names }), LONGEST_SAID), you: own,
        ...(own ? { as: m.username || /^\*([^*\n]{1,80}):\*/.exec(String(m.text || ''))?.[1] || null } : (m.bot_id || m.subtype === 'bot_message' || u?.bot) ? { bot: true } : {}),
      }
    }
    const before = (m) => Number(m.ts) < Number(ts) && (!since || Number(m.ts) > Number(since)) && String(m.text || '').trim()
    const order = (a, b) => Number(a.ts) - Number(b.ts)
    // (Names in the words too: <@U…> mentions.)
    const who = async (list) => named(list.flatMap((m) => [m.user, ...[...String(m.text || '').matchAll(/<@([UW][A-Z0-9]{2,20})>/g)].map((x) => x[1])]))
    let messages
    reads++
    try {
      if (thread) {
        const j = await call('conversations.replies', { channel, ts: thread, limit: 200 }, { waits: 1, most: READ_WAIT })
        const list = (j.messages || []).filter(before).sort(order).slice(-THREAD_CONTEXT)
        await who(list)
        return { kind: 'thread', messages: list.map(said), pins: [] }
      }
      const j = await call('conversations.history', { channel, latest: ts, inclusive: false, limit: CHANNEL_CONTEXT }, { waits: 1, most: READ_WAIT })
      const list = (j.messages || []).filter(before).sort(order).slice(-CHANNEL_CONTEXT)
      await who(list)
      messages = list.map(said)
    } finally { reads-- }
    if (dm) return { kind: 'dm', messages, pins: [] }
    let pins = []
    let problem = null
    try { pins = ((await call('pins.list', { channel })).items || []).filter((i) => i.message?.text).slice(0, PINS).map((i) => said(i.message)) } catch (e) { problem = `Couldn't read what's pinned: ${e.message}` }
    return { kind: 'channel', messages, pins, problem }
  }

  // What was put to the bot while it wasn't connected: each conversation it's in, read from the
  // last message it saw there, or from when the gap began (from: seconds; GAP_SLACK before it, for
  // events on their way), whichever is later, never before it was first connected nor more than
  // three days back; and each thread it's answering in, from the last reply it saw there. In three
  // rounds, each handed over oldest first once it's read, so what matters most isn't held up by the
  // rest: its direct messages and threads, then group messages and the channels it listens in, then
  // its other channels (mentions only). A read Slack holds back waits as long as Slack says, a
  // question's own conversation going first; asked again meanwhile (another gap), it reads again
  // from the earlier point once it's done.
  let reading = null
  let again = null
  function missed({ from: gap = 0 } = {}) {
    if (reading) { again = again == null ? gap : Math.min(again, gap); return reading }
    reading = (async () => {
      const floor = Math.max(Number(kept.since || 0), Date.now() / 1000 - MISSED_DAYS * 86400, gap ? gap - GAP_SLACK : 0)
      const handed = new Set()
      const problems = []
      let n = 0
      // A read, as slow as Slack wants: a 429 waits its Retry-After; a question's read goes first.
      const slow = async (method, params) => {
        for (;;) {
          if (!hear) throw Object.assign(new Error('Stopped'), { code: 'stopped' })
          while (reads > 0) await sleep(250)
          try { return await call(method, params, { waits: 0 }) } catch (e) {
            if (e.code !== 'ratelimited') throw e
            st.catchingUp = { ...st.catchingUp, waiting: e.retryAfter }
            await sleep(Math.min(600, e.retryAfter || 1) * 1000)
            if (st.catchingUp) st.catchingUp = { ...st.catchingUp, waiting: null }
          }
        }
      }
      const chans = []
      let cursor
      do {
        const j = await call('users.conversations', { types: 'public_channel,private_channel,mpim,im', exclude_archived: true, limit: 200, cursor })
        chans.push(...(j.channels || []))
        cursor = j.response_metadata?.next_cursor || undefined
      } while (cursor && chans.length < MAX_CONVERSATIONS)
      const all = chans.slice(0, MAX_CONVERSATIONS)
      const follow = (await Promise.resolve(threads()).catch(() => [])).slice(0, MAX_CONVERSATIONS)
      const rounds = [
        { chans: all.filter((c) => c.is_im === true), threads: follow },
        { chans: all.filter((c) => c.is_mpim === true || (c.is_im !== true && listens(c.id))), threads: [] },
        { chans: all.filter((c) => c.is_im !== true && c.is_mpim !== true && !listens(c.id)), threads: [] },
      ]
      st.catchingUp = { of: all.length + follow.length, done: 0, since: new Date().toISOString(), waiting: null }
      // One conversation's messages since `from`, a few pages at most.
      const history = async (c, from) => {
        const out = []
        let more
        for (let page = 0; page < CATCHUP_PAGES; page++) {
          const j = await slow('conversations.history', { channel: c.id, oldest: from.toFixed(6), inclusive: false, limit: 100, ...(more ? { cursor: more } : {}) })
          out.push(...(j.messages || []))
          more = j.has_more ? j.response_metadata?.next_cursor : null
          if (!more) break
        }
        return out
      }
      try {
        for (const r of rounds) {
          const found = []
          for (const c of r.chans) {
            const from = Math.max(floor, Number(kept.seen?.[c.id] || 0))
            let list
            try { list = await history(c, from) } catch (e) { if (e.code === 'stopped') throw e; problems.push(`${c.name ? `#${c.name}` : c.id}: ${e.message}`); continue } finally { st.catchingUp.done++ }
            const msgs = list.filter((m) => Number(m.ts) > from).sort((a, b) => Number(a.ts) - Number(b.ts))
            const im = c.is_im === true
            for (const m of msgs) {
              const mention = String(m.text || '').includes(`<@${kept.bot?.userId}>`)
              if (!im && !mention && !(!m.thread_ts && listens(c.id))) continue
              found.push({ ...m, type: im || !mention ? 'message' : 'app_mention', channel: c.id, channel_type: im ? 'im' : undefined })
            }
            if (msgs.length) { if (!kept.seen) kept.seen = {}; if (Number(msgs.at(-1).ts) > Number(kept.seen[c.id] || 0)) kept.seen[c.id] = msgs.at(-1).ts; marked() }
          }
          for (const t of r.threads) {
            const from = Math.max(floor, Number(kept.threads?.[`${t.channel}:${t.thread}`] || 0), Number(t.since || 0))
            let j
            try { j = await slow('conversations.replies', { channel: t.channel, ts: t.thread, oldest: from.toFixed(6), inclusive: false, limit: 200 }) } catch (e) { if (e.code === 'stopped') throw e; if (e.code !== 'thread_not_found') problems.push(`a thread in ${t.channel}: ${e.message}`); continue } finally { st.catchingUp.done++ }
            const msgs = (j.messages || []).filter((m) => Number(m.ts) > from && m.ts !== t.thread)
            for (const m of msgs) found.push({ ...m, type: 'message', channel: t.channel, channel_type: t.dm ? 'im' : 'channel', thread_ts: m.thread_ts || t.thread })
          }
          // (A mention in a thread it follows comes both ways: once is enough.)
          const once = new Map()
          for (const m of found) { const k = `${m.channel}:${m.ts}`; if (handed.has(k)) continue; if (!once.has(k) || m.type === 'app_mention') once.set(k, m) }
          const list = [...once.values()].sort((a, b) => Number(a.ts) - Number(b.ts))
          for (const m of list) { handed.add(`${m.channel}:${m.ts}`); n++; await heard(m, { late: true }) }
        }
      } catch (e) { if (e.code !== 'stopped') throw e }
      if (n) say({ what: 'missed', ok: true, why: `${n} asked while away` })
      if (problems.length) say({ what: 'missed', ok: false, why: `Couldn't read what was asked while away in ${problems.slice(0, 3).join('; ')}` })
    })().finally(() => {
      reading = null
      st.catchingUp = null
      if (again != null && hear) { const g = again; again = null; missed({ from: g }).catch((e) => say({ what: 'missed', ok: false, why: `Couldn't read what was asked while away: ${e.message}` })) } else again = null
    })
    return reading
  }

  // ---------- What goes out ----------
  // Posts one at a time in each conversation, a second apart (Slack's limit for posting is per
  // conversation): one held up (a 429 there) holds up no other.
  const lines = new Map() // channel -> { line, last, n }
  function inLine(channel, fn) {
    const key = String(channel || '')
    const l = lines.get(key) || { line: Promise.resolve(), last: 0, n: 0 }
    lines.set(key, l)
    l.n++
    const go = l.line.then(async () => {
      const wait = 1000 - (Date.now() - l.last)
      if (wait > 0) await sleep(wait)
      try { return await fn() } finally { l.last = Date.now() }
    })
    l.line = go.catch(() => {}).finally(() => { if (--l.n === 0 && lines.get(key) === l) setTimeout(() => { if (l.n === 0 && lines.get(key) === l) lines.delete(key) }, 1500).unref?.() })
    return go
  }
  // Posting where the app isn't (not_in_channel, or a channel it can't see): said to you, with what
  // to do, then thrown as it was.
  function notIn(channel, e) {
    if (!['not_in_channel', 'channel_not_found'].includes(e?.code) || String(channel).startsWith('D')) return e
    const name = places[channel]?.name
    const app = kept.bot?.name || info().name || 'the app'
    say({ what: 'not-in-channel', ok: false, channel, why: `I couldn't post in ${name ? `#${name}` : `a channel (${channel})`}: ${app} isn't in it. Invite it there with /invite @${app}, or pick a channel it's in.` })
    return e
  }

  // An answer streamed into its thread: started, added to, and ended, in at most three calls, its
  // words split at spaces. Slack's limits: 12,000 characters and 10 minutes in all.
  function parts(text, n = 3) {
    const out = []
    let rest = text
    for (let i = n; i > 1 && rest.length; i--) {
      const size = Math.ceil(rest.length / i)
      let cut = rest.lastIndexOf(' ', size)
      if (cut < size / 2) cut = size
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    if (rest.length) out.push(rest)
    return out
  }
  async function streamed(reply, text, as = {}) {
    const dmd = String(reply.channel).startsWith('D')
    if (!dmd && !reply.user) throw Object.assign(new Error('Slack needs to know who a stream is for'), { code: 'no_recipient' })
    const [first, ...more] = parts(text).map(escape)
    const j = await call('chat.startStream', { channel: reply.channel, thread_ts: reply.thread, markdown_text: first, ...(reply.user ? { recipient_user_id: reply.user, recipient_team_id: kept.team?.id } : {}), ...as }, { waits: 1, most: POST_WAIT })
    const ts = j.ts
    const last = more.pop()
    try {
      for (const p of more) await call('chat.appendStream', { channel: reply.channel, ts, markdown_text: p }, { waits: 2 })
      await call('chat.stopStream', { channel: reply.channel, ts, ...(last ? { markdown_text: last } : {}) }, { waits: 2 })
    } catch (e) {
      // Started, then cut short: what's posted so far is put right with the whole answer.
      try { await call('chat.stopStream', { channel: reply.channel, ts }, { waits: 0 }) } catch { /* ended already */ }
      await call('chat.update', { channel: reply.channel, ts, text: escape(text) }, { waits: 1 })
      return { ts, channel: j.channel || reply.channel, streamError: e.code || e.message }
    }
    return { ts, channel: j.channel || reply.channel }
  }

  // A file, sent the way Slack takes them now: an address to send it to (getUploadURLExternal), the
  // bytes sent there, then the upload finished into the conversation (completeUploadExternal). One
  // that can't go says why, without failing the reply it goes with.
  const fileName = (n) => String(n || 'file.txt').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/^\.+/, '').slice(0, 120) || 'file.txt'
  async function upload(reply, f, ts) {
    const name = fileName(f.name)
    const bytes = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content ?? ''), 'utf8')
    try {
      if (lacks('files:write')) throw lacking('files:write')
      const u = await call('files.getUploadURLExternal', { filename: name, length: bytes.length }, { waits: 2 })
      if (!fromSlack(u.upload_url)) throw new Error('Slack gave an address that isn\'t its own to send the file to')
      let res
      try {
        res = await fetch(u.upload_url, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes, signal: AbortSignal.timeout(60000) })
      } catch (e) { throw Object.assign(new Error(`Couldn't reach Slack: ${e.cause?.code || e.message}`), { code: 'offline' }) }
      if (!res.ok) throw Object.assign(new Error(`Slack didn't take the file (${res.status})`), { code: `http_${res.status}` })
      const thread = reply.thread || ts || null
      await call('files.completeUploadExternal', { files: [{ id: u.file_id, title: f.title || name }], channel_id: reply.channel, ...(thread ? { thread_ts: thread } : {}), ...(f.comment ? { initial_comment: f.comment } : {}) }, { waits: 2 })
      return { id: u.file_id, name, size: bytes.length, ok: true }
    } catch (e) { return { id: null, name, size: bytes.length, ok: false, error: e.message, code: e.code || null } }
  }

  // As a bot on a shared connection (as: { name, icon }): its name and icon on the message (Slack's
  // username and icon_emoji or icon_url, with chat:write.customize; chat.startStream takes them too),
  // or, from an app without that scope yet, its name in bold first.
  const persona = (as) => {
    if (!as?.name || lacks('chat:write.customize') || !Array.isArray(kept.scopes)) return {}
    const icon = String(as.icon || '')
    return { username: clip(as.name, 80), ...(/^:[\w+-]{1,60}:$/.test(icon) ? { icon_emoji: icon } : /^https:\/\/\S{1,500}$/.test(icon) ? { icon_url: icon } : {}) }
  }

  // A reply where the question was asked: streamed when asked to (an answer sent without asking, in
  // a thread, short enough for a stream), else posted plainly, then its files. A stream Slack won't
  // take falls back to a plain post, saying why. Throws { code, retryAfter } when the words can't
  // go; a file that can't go is said in files[], not thrown. as: the bot it's posted as, on a shared
  // connection.
  // buttons: [{ id, label, value, style }], under the words (a change's Approve and Deny, or Undo),
  // remembered as a draft's are, so settle() can put the outcome in their place.
  function post(reply, text, { files = [], stream = false, as = null, buttons = null } = {}) {
    return inLine(reply.channel, async () => {
      const out = { ts: null, channel: reply.channel, streamed: false, streamError: null, files: [], ...(as?.name ? { as: as.name, customized: !!persona(as).username } : {}) }
      const raw = String(text ?? '')
      const body = as?.name && !persona(as).username ? `*${as.name}:* ${raw}` : raw
      if (buttons?.length) {
        const blocks = [
          { type: 'section', text: { type: 'mrkdwn', text: clip(escape(body), 3000) } },
          { type: 'actions', block_id: `bb_t_${Date.now().toString(36)}`, elements: buttons.slice(0, 5).map((b) => button(b.id, b.label, b.value, b.style || null)) },
        ]
        const j = await call('chat.postMessage', { channel: reply.channel, text: escape(clip(body, 3000)), blocks, ...(reply.thread ? { thread_ts: reply.thread } : {}), unfurl_links: false, unfurl_media: false, ...persona(as) }, { waits: 1, most: POST_WAIT })
        Object.assign(out, { ts: j.ts, channel: j.channel || reply.channel })
        asks.set(`${out.channel}:${out.ts}`, blocks)
        if (asks.size > 200) asks.delete(asks.keys().next().value)
      } else if (body.trim() || !files.length) {
        if (stream && reply.thread && body.length <= STREAM_MAX && !lacks('chat:write')) {
          try {
            const s = await streamed(reply, body, persona(as))
            Object.assign(out, { ts: s.ts, channel: s.channel, streamed: !s.streamError, streamError: s.streamError || null })
          } catch (e) { out.streamError = e.code || e.message }
        } else if (stream) out.streamError = !reply.thread ? 'not_in_thread' : body.length > STREAM_MAX ? 'too_long' : 'missing_scope'
        if (!out.ts) {
          const j = await call('chat.postMessage', { channel: reply.channel, text: escape(body), ...(reply.thread ? { thread_ts: reply.thread } : {}), unfurl_links: false, unfurl_media: false, ...persona(as) }, { waits: 1, most: POST_WAIT })
          Object.assign(out, { ts: j.ts, channel: j.channel || reply.channel })
        }
      }
      for (const f of files.slice(0, FILES_MAX)) out.files.push(await upload(reply, f, out.ts))
      return out
    }).catch((e) => { throw notIn(reply.channel, e) })
  }
  // "Pricing Desk or Docs Helper?": the question's asker picks with a button (bb_pick, its value the
  // question's key and the bot's id), in the question's thread.
  const choose = (reply, { text, key, options = [] }) => inLine(reply.channel, async () => {
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: clip(escape(text), 3000) } },
      { type: 'actions', block_id: `bb_p_${String(key).slice(0, 200)}`, elements: options.slice(0, 5).map((o, i) => button('bb_pick', o.label, `${key} ${o.id}`, i === 0 ? 'primary' : null)) },
    ]
    const j = await call('chat.postMessage', { channel: reply.channel, text: escape(clip(text, 300)), blocks, ...(reply.thread ? { thread_ts: reply.thread } : {}), unfurl_links: false, unfurl_media: false }, { waits: 1 })
    const handle = { channel: j.channel || reply.channel, ts: j.ts }
    asks.set(`${handle.channel}:${handle.ts}`, blocks)
    return handle
  })
  // A word to one person only, where they asked.
  const whisper = (reply, user, text) => call('chat.postEphemeral', { channel: reply.channel, user, text: escape(text), ...(reply.thread ? { thread_ts: reply.thread } : {}) }, { waits: 1 })

  // Slack's working status on the question's thread, and its Stop button (an agent's session):
  // processing while an agent answers, active once it's done. Never throws: { ok, method, error }.
  async function status(reply, on) {
    if (!reply?.thread) return { ok: false, error: 'not in a thread' }
    if (lacks('assistant:write')) return { ok: false, error: 'missing assistant:write' }
    const args = { channel_id: reply.channel, thread_ts: reply.thread }
    try {
      await call('agents.sessions.setStatus', { ...args, status: on ? 'processing' : 'active' }, { waits: 1 })
      return { ok: true, method: 'agents.sessions.setStatus' }
    } catch (e) {
      if (e.code !== 'unknown_method') return { ok: false, method: 'agents.sessions.setStatus', error: e.code || e.message }
      try {
        await call('assistant.threads.setStatus', { ...args, status: on ? 'is looking into it…' : '' }, { waits: 1 })
        return { ok: true, method: 'assistant.threads.setStatus' }
      } catch (x) { return { ok: false, method: 'assistant.threads.setStatus', error: x.code || x.message } }
    }
  }

  // ---------- Your direct messages ----------
  const dms = new Map() // user id -> their direct message with the bot
  async function openDm(user) {
    if (dms.has(user)) return dms.get(user)
    const j = await call('conversations.open', { users: user }, { waits: 2 })
    const channel = j.channel?.id
    if (!channel) throw new Error('Slack didn\'t open a direct message')
    dms.set(user, channel)
    return channel
  }
  async function dm(user, text) {
    const channel = await openDm(user)
    const j = await inLine(channel, () => call('chat.postMessage', { channel, text: escape(text), unfurl_links: false, unfurl_media: false }, { waits: 1 }))
    return { channel: j.channel || channel, ts: j.ts }
  }

  // A draft or something to remember, in your direct messages, with its buttons: Send, Edit and
  // Discard (Approve and open a pull request, for a change waiting on you), or Keep and Discard; a
  // run at its time limit, Continue or Stop.
  // Its blocks are remembered (the last 200) so settle() can put the outcome in their place.
  const asks = new Map()
  const md = (s) => escape(String(s ?? ''))
  const quote = (s) => `>${md(s).replace(/\n/g, '\n>')}`
  const button = (action, label, value, style) => ({ type: 'button', action_id: action, text: plainIn(label), value: String(value).slice(0, 2000), ...(style ? { style } : {}) })
  const sized = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`)
  function draftBlocks(it) {
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: clip(`${it.shared && it.bot ? `${md(it.bot)} · ` : ''}*${md(it.who || 'Someone')}* asked ${md(it.where || 'in Slack')}:\n${quote(it.question || '')}`, 3000) } }]
    if (it.needsOwner) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(`Nothing could answer it: ${md(it.why || 'no answer')}`, 3000) } })
    else blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(`*Draft:*\n${md(it.draft || '')}`, 3000) } })
    const notes = [
      it.sources?.length ? `From ${it.sources.slice(0, 6).map(md).join(', ')}` : null,
      it.files?.length ? `Files: ${it.files.map((f) => `${md(f.name)}${f.size ? ` (${sized(f.size)})` : ''}${f.from ? ` from ${md(f.from)}` : ''}`).join(', ')}` : null,
      it.warn ? `:warning: ${md(it.warn)}` : null,
      !it.needsOwner && it.why ? md(it.why) : null,
    ].filter(Boolean)
    if (notes.length) blocks.push({ type: 'context', elements: notes.slice(0, 10).map((n) => ({ type: 'mrkdwn', text: clip(n, 2000) })) })
    if (it.change) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(`*A change* on \`${md(it.change.branch || '')}\`${it.change.mode === 'suggest' ? ', waiting for you' : ''}${it.change.stat ? `\n${md(it.change.stat)}` : ''}`, 3000) } })
      if (it.change.diff) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${clip(md(it.change.diff).replace(/```/g, '`​``'), 2500)}\`\`\`` } })
    }
    // (A change to files: what it changes and why it waits for you, its diff; Approve and Deny while it
    // waits, Undo once it's made.)
    const w = it.write
    if (w) {
      const files = (w.files || []).slice(0, 8).map((f) => `\`${md(f.path)}\`${f.op === 'add' ? ' (new)' : f.op === 'remove' ? ' (deleted)' : f.op === 'move' ? ` (moved from \`${md(f.from)}\`)` : ''}`).join(', ')
      const state = w.state === 'waiting' ? `asked by *${md(it.who || 'someone')}*, waiting for you` : w.state === 'applied' ? 'made already' : w.state === 'refused' ? 'refused, so nothing was changed' : w.state
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(`*A change to files*, ${state}: ${files}${(w.files || []).length > 8 ? `, and ${w.files.length - 8} more` : ''}`, 3000) } })
      const why = [...(w.held || []).map((h) => `:warning: Waits for you whoever asks: ${md(h.said)}`), ...(w.refused || []).slice(0, 3).map((r) => `:no_entry: ${md(r.file)}: ${md(r.said)}`)]
      if (why.length) blocks.push({ type: 'context', elements: why.slice(0, 10).map((n) => ({ type: 'mrkdwn', text: clip(n, 2000) })) })
      if (w.diff) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${clip(md(w.diff).replace(/```/g, '`​``'), 2500)}\`\`\`` } })
      // (Only its start fits in Slack: the whole diff is in Needs You and its Activity.)
      if (w.diffCut || md(w.diff || '').length > 2500) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Only the start of the diff fits here: Needs You and its Activity in Bridge AI have all of it.' }] })
    }
    const approve = it.change && it.change.mode === 'suggest'
    const waits = w?.state === 'waiting' && w.value
    blocks.push({
      type: 'actions', block_id: `bb_${String(it.q).slice(0, 200)}`,
      elements: waits
        ? [button('bb_wok', 'Approve and send', w.value, 'primary'), button('bb_wno', 'Deny', w.value, 'danger')]
        : [
          approve ? button('bb_approve', 'Approve and open a pull request', it.q, 'primary') : button('bb_send', 'Send', it.q, 'primary'),
          button('bb_edit', it.needsOwner ? 'Write the reply' : 'Edit', it.q),
          button('bb_discard', 'Discard', it.q, 'danger'),
          ...(w?.state === 'applied' && w.undo ? [button('bb_undo', 'Undo the change', w.undo)] : []),
        ],
    })
    // (Stopped at its time limit for want of your answer: Continue, as long as it can be.)
    if (it.limit?.choices?.length) {
      const how = it.limit.how === 'session' ? 'picks it up where it stopped' : it.limit.how === 'messages' ? 'starts it again with what it had so far' : 'starts it again from the question'
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: clip(`Stopped at its time limit, after ${minutes(it.limit.ran)}, as nobody said to carry on. Continue ${how}, for a day.`, 2000) }] })
      blocks.push({ type: 'actions', block_id: `bb_lc_${String(it.q).slice(0, 200)}`, elements: it.limit.choices.slice(0, 3).map((n) => button('bb_continue', `Continue ${n} more minutes`, `${it.q} ${n}`)) })
    }
    const text = clip(`${it.bot ? `${it.bot}: ` : ''}${it.who || 'Someone'} asked ${it.where || 'in Slack'}: ${it.question || ''}${it.needsOwner ? '' : ` — Draft: ${it.draft || ''}`}`, 300)
    return { text: escape(text), blocks }
  }
  const minutes = (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`
  // A run at its time limit: how long it has run and what it's doing, the question, and Continue
  // (10 or 30 more minutes, fewer near its Longest Run) or Stop.
  function limitBlocks(it) {
    const said = `*${md(it.bot || 'Your bot')}*'s answer to *${md(it.who || 'someone')}* in ${md(it.where || 'Slack')} has run ${minutes(it.ran)}: ${md(it.doing || 'still working')}.`
    const notes = [`It goes on for ${minutes(it.grace || 1)} more while you decide; with no answer, it stops and comes to you, and Continue still picks it up where it stopped for a day.`, it.left < 30 ? `At most ${minutes(it.left)} more: its Longest Run is ${it.longest} minutes.` : null].filter(Boolean)
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: clip(`${said}\n${quote(it.question || '')}`, 3000) } },
      { type: 'context', elements: notes.map((n) => ({ type: 'mrkdwn', text: clip(md(n), 2000) })) },
      { type: 'actions', block_id: `bb_l_${String(it.q).slice(0, 200)}`, elements: [...(it.choices || []).slice(0, 3).map((n, i) => button('bb_continue', `Continue ${n} more minutes`, `${it.q} ${n}`, i === 0 ? 'primary' : null)), button('bb_halt', 'Stop', it.q, 'danger')] },
    ]
    return { text: escape(clip(`${it.bot || 'Your bot'}'s answer to ${it.who || 'someone'} in ${it.where || 'Slack'} has run ${minutes(it.ran)}: ${it.doing || 'still working'}`, 300)), blocks }
  }
  function memoryBlocks(it) {
    const about = it.about ? ` (about ${md(it.about)})` : ''
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: clip(`*${md(it.bot || 'Your bot')}* would like to remember${about}:\n${quote(it.text || '')}`, 3000) } },
      { type: 'actions', block_id: `bb_m_${String(it.memory).slice(0, 200)}`, elements: [button('bb_keep', 'Keep', it.memory, 'primary'), button('bb_drop', 'Discard', it.memory, 'danger')] },
    ]
    return { text: escape(clip(`${it.bot || 'Your bot'} would like to remember: ${it.text || ''}`, 300)), blocks }
  }
  // A request to a bot that changes files, held before it started: who asked, where and what, why it
  // was held, and Allow Once or Deny.
  function screenBlocks(it) {
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: clip(`*${md(it.who || 'Someone')}* asked *${md(it.bot || 'your bot')}* ${md(it.where || 'in Slack')}:\n${quote(it.question || '')}`, 3000) } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: clip(`:warning: It wasn't started, as ${md(it.why || 'it looks odd')}${it.by === 'model' ? ' (AI Assist\'s read of it)' : ''}. Allow it once to let it go ahead, under every limit as always.`, 2000) }] },
      { type: 'actions', block_id: `bb_s_${String(it.q).slice(0, 200)}`, elements: [button('bb_sok', 'Allow Once', it.q, 'primary'), button('bb_sno', 'Deny', it.q, 'danger')] },
    ]
    return { text: escape(clip(`${it.bot || 'Your bot'}: ${it.who || 'Someone'} asked ${it.where || 'in Slack'}, held for you: ${it.question || ''}`, 300)), blocks }
  }
  async function askOwner(owner, item) {
    if (!owner?.id) throw new Error('Set who you are in Slack first')
    const channel = await openDm(owner.id)
    const { text, blocks } = item?.kind === 'memory' ? memoryBlocks(item) : item?.kind === 'limit' ? limitBlocks(item) : item?.kind === 'screen' ? screenBlocks(item) : draftBlocks(item || {})
    const j = await inLine(channel, () => call('chat.postMessage', { channel, text, blocks, unfurl_links: false, unfurl_media: false }, { waits: 1 }))
    const handle = { channel: j.channel || channel, ts: j.ts }
    asks.set(`${handle.channel}:${handle.ts}`, blocks)
    if (asks.size > 200) asks.delete(asks.keys().next().value)
    return handle
  }
  // A draft in your direct messages, decided: its buttons give way to what came of it. (body: what the
  // message said, for one whose blocks aren't remembered here any more, so its words stay.)
  async function settle(handle, { outcome, by = null, text = null, link = null, body = null } = {}) {
    if (!handle?.channel || !handle?.ts) return { ok: false, error: 'nothing to settle' }
    const said = {
      sent: `Sent${by ? ` by ${by}` : ''}`, discarded: `Discarded${by ? ` by ${by}` : ''}`, approved: `Approved${by ? ` by ${by}` : ''}`,
      kept: `Kept${by ? ` by ${by}` : ''}`, dropped: `Discarded${by ? ` by ${by}` : ''}`, edited: `Sent as edited${by ? ` by ${by}` : ''}`,
    }[outcome] || outcome || 'Done'
    const words = [said, link ? `Pull request: ${link}` : null, text].filter(Boolean).join(' · ')
    const before = (asks.get(`${handle.channel}:${handle.ts}`) || []).filter((b) => b.type !== 'actions')
    const kept = before.length ? before : [{ type: 'section', text: { type: 'mrkdwn', text: clip(md(body || words), 3000) } }]
    const blocks = [...kept, { type: 'context', elements: [{ type: 'mrkdwn', text: clip(`:white_check_mark: ${md(words)}`, 2000) }] }]
    try {
      await inLine(handle.channel, () => call('chat.update', { channel: handle.channel, ts: handle.ts, text: escape(clip(words, 300)), blocks }, { waits: 1 }))
      asks.delete(`${handle.channel}:${handle.ts}`)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  }

  // A reaction on a question (👀 as it's taken, ⏳ while a draft waits, ✅ once answered), or taken
  // off. One that's there already, or gone already, is as asked. An app without reactions:write
  // isn't asked: it says so (and Settings says to update the app).
  async function react({ channel, ts, name, off = false }) {
    if (lacks('reactions:write')) throw lacking('reactions:write')
    try { await call(off ? 'reactions.remove' : 'reactions.add', { channel, timestamp: ts, name }, { waits: 1 }) } catch (e) { if (!['already_reacted', 'no_reaction'].includes(e.code)) throw notIn(channel, e) }
  }

  // A file attached to a question, read: from Slack's own addresses only (a redirect followed only
  // to another of them, the token sent only to Slack itself), 20 MB at most. Slack sends a sign-in
  // page instead of a file the token can't read: that's said, not handed on.
  async function download(f) {
    if (lacks('files:read')) throw lacking('files:read')
    const name = String(f?.name || f?.id || 'the file')
    if (Number(f?.size) > FILE_MAX) throw Object.assign(new Error(`${name} is over 20 MB, too big to read`), { code: 'too_big' })
    let url = (f?.id && urls.get(f.id)) || f?.url || null
    if (!url && f?.id) {
      const j = await call('files.info', { file: f.id })
      url = j.file?.url_private_download || j.file?.url_private || null
    }
    for (let hop = 0; ; hop++) {
      if (!url || !fromSlack(url)) throw Object.assign(new Error(`${name} isn't at one of Slack's addresses, so it wasn't read`), { code: 'not_slack' })
      let res
      try {
        res = await fetch(url, { headers: tokenFor(url) ? { authorization: `Bearer ${kept.botToken}` } : {}, redirect: 'manual', signal: AbortSignal.timeout(60000) })
      } catch (e) { throw Object.assign(new Error(`Couldn't reach Slack for ${name}: ${e.cause?.code || e.message}`), { code: 'offline' }) }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location') && hop < 3) { url = new URL(res.headers.get('location'), url).href; continue }
      if (!res.ok) throw Object.assign(new Error(`Slack wouldn't give ${name} (${res.status})`), { code: `http_${res.status}` })
      if (/text\/html/i.test(res.headers.get('content-type') || '') && !/html?$/i.test(name)) throw Object.assign(new Error(`Slack sent a sign-in page instead of ${name}: the app may lack files:read`), { code: 'not_a_file' })
      const chunks = []
      let n = 0
      for await (const c of res.body) {
        n += c.length
        if (n > FILE_MAX) throw Object.assign(new Error(`${name} is over 20 MB, too big to read`), { code: 'too_big' })
        chunks.push(Buffer.from(c))
      }
      return Buffer.concat(chunks)
    }
  }

  // The workspace's people, to pick askers from: neither bots, deactivated accounts nor guests
  // (guests are never answered). Kept for 10 minutes.
  let memo = { at: 0, list: null }
  async function people({ fresh: again = false } = {}) {
    if (!again && memo.list && Date.now() - memo.at < 10 * 60 * 1000) return memo.list
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
  // The channels it's in, to pick from (where it answers without a mention, where it posts on a
  // schedule): [{ id, name, private }].
  async function channels() {
    const out = []
    let cursor
    do {
      const j = await call('users.conversations', { types: 'public_channel,private_channel', exclude_archived: true, limit: 200, cursor })
      for (const c of j.channels || []) {
        places[c.id] = { kind: 'channel', id: c.id, name: c.name || null, private: !!c.is_private, shared: !!(c.is_ext_shared || c.is_shared), at: Date.now() }
        out.push({ id: c.id, name: c.name || c.id, private: !!c.is_private })
      }
      cursor = j.response_metadata?.next_cursor || undefined
    } while (cursor && out.length < 1000)
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  // ---------- Test this connection (conncheck.js) ----------
  // Slack's checks, in order, each { id, label, state: ok | warn | fail | skip, detail, fix }: its
  // tokens; its scopes (a shared app's chat:write.customize too); Socket Mode (connected, its last
  // hello, and how many connections Slack has open for the app, from one opened to count them: more
  // than this copy's is another copy); you there, and your direct messages with it opening; then a
  // message it posts there (deleted at the end): its own event coming back to this copy (events
  // arrive, and not to another copy), a reaction put on it and taken off, a file sent into its
  // thread and read back, Slack's working status on that thread, and how long Slack takes to let it
  // read a conversation and a thread (a 429: held back, as a distributed app outside the
  // Marketplace is); and the channels it's in against those it's meant to answer or post in.
  // owner: you there ({ id, name }); want: [{ id, name, why }] the channels it's meant to be in.
  async function check({ owner = null, want = [] } = {}) {
    const out = []
    const add = (id, label, state, detail = null, fix = null) => { out.push({ id, label, state, detail, fix }); return state }
    const LATER = [['scopes', 'Scopes'], ['socket', 'Socket Mode'], ['owner', 'You here'], ['events', 'Events arrive'], ['reactions', 'Reactions'], ['files', 'Files in and out'], ['status', 'Working status'], ['reads', 'Reading conversations'], ['channels', 'Channels']]
    const skipRest = (from, why) => { for (const [id, label] of LATER.slice(LATER.findIndex(([x]) => x === from))) add(id, label, 'skip', why) }
    const app = () => kept.bot?.name || 'the app'
    if (!kept.appToken || !kept.botToken) { add('tokens', 'Tokens', 'fail', 'No tokens yet', 'Paste the app-level token (xapp-) and the bot token (xoxb-) from your Slack app'); skipRest('scopes', 'Needs the tokens first'); return out }
    // 1. Tokens: the bot token (who and where) and the app-level one (a connection's address).
    let who = null
    let bad = null
    try {
      who = await call('auth.test', {}, { waits: 1 })
      kept.scopes = who.scopes
      kept.team = { id: who.team_id, name: who.team, url: who.url }
      kept.bot = { userId: who.user_id, botId: who.bot_id || null, name: who.user }
    } catch (e) { bad = { detail: `The bot token: ${e.message}`, fix: 'Copy the Bot User OAuth Token (xoxb-) again from OAuth & Permissions in your Slack app, and paste it in Advanced' } }
    if (!bad) {
      try { await call('apps.connections.open', {}, { token: kept.appToken, waits: 1 }) } catch (e) { bad = { detail: `The app-level token: ${e.message}`, fix: e.code === 'missing_scope' ? 'Give the app-level token the connections:write scope (Basic Information › App-Level Tokens)' : 'Copy the app-level token (xapp-) again from Basic Information › App-Level Tokens, and paste it in Advanced' } }
    }
    if (bad) { add('tokens', 'Tokens', 'fail', bad.detail, bad.fix); skipRest('scopes', 'Needs working tokens first'); return out }
    add('tokens', 'Tokens', 'ok', `@${who.user} in ${who.team}`)
    // 2. Scopes.
    const short = missing()
    if (short == null) add('scopes', 'Scopes', 'warn', 'Slack didn\'t say which scopes the app has', null)
    else if (!short.length) add('scopes', 'Scopes', 'ok', 'Every scope its manifest asks for')
    else add('scopes', 'Scopes', short.includes('chat:write') ? 'fail' : 'warn', `It lacks ${short.join(', ')}: ${short.map((x) => SCOPE_FOR[x]).filter(Boolean).join('; ')}`, 'Update Your Slack App: paste the new manifest in its App Manifest page, save, then reinstall it to the workspace')
    // 3. Socket Mode: connected, the last hello, and the connections Slack has open for it.
    const connected = st.state === 'connected'
    const r = await probe()
    if (r.ok) counted(r.n, r.ours)
    const others = r.ok ? Math.max(0, r.n - r.ours) : 0
    if (!connected) add('socket', 'Socket Mode', 'fail', st.why || `Not connected (${st.state})`, 'Press Connect; if it stays off, check Socket Mode is on in the app\'s settings')
    else if (others) add('socket', 'Socket Mode', 'warn', `Connected since ${st.connectedAt}, but Slack has ${others === 1 ? 'another connection' : `${others} other connections`} open for this app: another copy of Bridge AI (or another program) gets some of its messages`, 'Quit Bridge AI on the other computer, or give each computer its own Slack app')
    else add('socket', 'Socket Mode', r.ok ? 'ok' : 'warn', `Connected since ${st.connectedAt}${st.hello ? `, Slack's last hello ${st.hello}` : ''}${r.ok ? ', and no other copy is connected' : `; couldn't count its connections: ${r.why}`}`)
    // 4. You there, and your direct messages with it.
    let dmc = null
    if (!owner?.id) add('owner', 'You here', 'warn', 'Nobody is linked as you here: your bots don\'t know it\'s you, so they answer you as anyone else (or turn you away), and can\'t ask you anything in Slack', `Make a code under You Here, then send it to @${app()} in a direct message`)
    else {
      try { dmc = await openDm(owner.id); add('owner', 'You here', 'ok', `${owner.name || owner.id}, and your direct messages with @${app()} open`) } catch (e) { add('owner', 'You here', 'fail', `${owner.name || owner.id} is linked, but your direct messages with it don't open: ${e.message}`, e.code === 'missing_scope' ? 'Update Your Slack App (it needs im:write), then reinstall it' : null) }
    }
    if (!dmc) { skipRest('events', owner?.id ? 'Needs your direct messages with it' : 'Needs you linked here: it tests in your direct messages'); return out.concat(await channelsCheck(want)) }
    // 5–10. A message in your direct messages, to test with (deleted at the end).
    let msg = null
    let arrived = null
    try {
      const j = await inLine(dmc, () => call('chat.postMessage', { channel: dmc, text: 'Testing this connection from Bridge AI: this message goes in a moment.', unfurl_links: false, unfurl_media: false }, { waits: 1 }))
      msg = { channel: j.channel || dmc, ts: j.ts }
    } catch (e) { add('events', 'Events arrive', 'fail', `Couldn't post in your direct messages: ${e.message}`, e.code === 'missing_scope' ? 'Update Your Slack App, then reinstall it' : null); skipRest('reactions', 'Needs a message to test with'); return out.concat(await channelsCheck(want)) }
    const t0 = Date.now()
    const key = `${msg.channel}:${msg.ts}`
    if (!connected) add('events', 'Events arrive', 'skip', 'Not connected')
    else {
      arrived = recent.has(key) || await new Promise((resolve) => {
        const t = setTimeout(() => { echoes.delete(key); resolve(false) }, ECHO_MS)
        t.unref?.()
        echoes.set(key, () => { clearTimeout(t); echoes.delete(key); resolve(true) })
      })
      if (arrived) add('events', 'Events arrive', 'ok', `Slack sent its message back as an event in ${Date.now() - t0} ms`)
      else add('events', 'Events arrive', 'fail', `Slack didn't send this copy the event for a message it posted (${Math.round(ECHO_MS / 1000)} s)${others ? ': another copy connected to the app may have had it' : ''}`, others ? 'Quit Bridge AI on the other computer, or give each computer its own Slack app' : 'Check Event Subscriptions is on in your Slack app, with message.im among its bot events: Update Your Slack App with the manifest')
    }
    // Reactions: on, then off.
    try {
      await react({ channel: msg.channel, ts: msg.ts, name: 'eyes' })
      await react({ channel: msg.channel, ts: msg.ts, name: 'eyes', off: true })
      add('reactions', 'Reactions', 'ok', '👀 put on and taken off')
    } catch (e) { add('reactions', 'Reactions', e.code === 'missing_scope' ? 'warn' : 'fail', e.message, e.code === 'missing_scope' ? 'Update Your Slack App (reactions:write), then reinstall it' : null) }
    // A file, sent into its thread and read back.
    const nonce = `bridge-check ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}\n`
    const up = await upload({ channel: msg.channel, thread: msg.ts }, { name: 'bridge-check.txt', content: nonce, title: 'Bridge AI connection test' }, msg.ts)
    if (!up.ok) add('files', 'Files in and out', up.code === 'missing_scope' ? 'warn' : 'fail', `Couldn't send a file: ${up.error}`, up.code === 'missing_scope' ? 'Update Your Slack App (files:write), then reinstall it' : null)
    else {
      try {
        const got = await download({ id: up.id, name: up.name })
        if (got.toString('utf8') === nonce) add('files', 'Files in and out', 'ok', 'A file sent and read back the same')
        else add('files', 'Files in and out', 'fail', 'A file sent came back different', null)
      } catch (e) { add('files', 'Files in and out', e.code === 'missing_scope' ? 'warn' : 'fail', `Sent a file, but couldn't read it back: ${e.message}`, e.code === 'missing_scope' ? 'Update Your Slack App (files:read), then reinstall it' : null) }
      call('files.delete', { file: up.id }, { waits: 0 }).catch(() => {})
    }
    // Slack's working status (and Stop) on its thread, then done.
    const s = await status({ channel: msg.channel, thread: msg.ts }, true)
    if (s.ok) { await status({ channel: msg.channel, thread: msg.ts }, false); add('status', 'Working status', 'ok', `Shown and cleared (${s.method})`) } else add('status', 'Working status', 'warn', `Slack's working status and Stop aren't shown: ${s.error}${s.method ? ` (${s.method})` : ''}`, /assistant:write|unknown_method|not_allowed|feature/.test(String(s.error)) ? 'Update Your Slack App with the manifest (it declares the app an agent), then reinstall it' : null)
    // How quickly Slack lets it read a conversation and a thread.
    const timed = async (method, params) => { const a = Date.now(); try { await call(method, params, { waits: 0 }); return { ms: Date.now() - a } } catch (e) { return { ms: Date.now() - a, e } } }
    const h = await timed('conversations.history', { channel: msg.channel, limit: 1 })
    const t = await timed('conversations.replies', { channel: msg.channel, ts: msg.ts, limit: 1 })
    const held = [h, t].find((x) => x.e?.code === 'ratelimited')
    const broke = [h, t].find((x) => x.e && x.e.code !== 'ratelimited')
    if (held) add('reads', 'Reading conversations', 'warn', `Slack asked it to wait ${held.e.retryAfter} s after a read (${held.e.method}): it holds a distributed app outside its Marketplace to about one read a minute, so catching up after time away is slow, and some answers may come without their conversation`, 'Make the app in and for this workspace only (not distributed), from the manifest here')
    else if (broke) add('reads', 'Reading conversations', 'fail', `${broke.e.method}: ${broke.e.message}`, broke.e.code === 'missing_scope' ? 'Update Your Slack App, then reinstall it' : null)
    else add('reads', 'Reading conversations', 'ok', `A conversation in ${h.ms} ms, a thread in ${t.ms} ms`)
    // (The test message goes: its thread's file and all.)
    call('chat.delete', { channel: msg.channel, ts: msg.ts }, { waits: 1 }).catch(() => {})
    return out.concat(await channelsCheck(want))
  }
  // The channels it's in against those it's meant to be in: each it isn't, said with what to do.
  async function channelsCheck(want) {
    const mine = await channels().catch((e) => ({ error: e }))
    if (mine.error) return [{ id: 'channels', label: 'Channels', state: 'fail', detail: `Couldn't list the channels it's in: ${mine.error.message}`, fix: null }]
    const ids = new Set(mine.map((c) => c.id))
    const out = (want || []).filter((w) => w?.id && !String(w.id).startsWith('D') && !ids.has(w.id))
    const first = (x) => `#${x.name || x.id}${x.why ? ` (${x.why})` : ''}`
    if (out.length) return [{ id: 'channels', label: 'Channels', state: 'warn', detail: `Not in ${out.slice(0, 5).map(first).join(', ')}${out.length > 5 ? ` and ${out.length - 5} more` : ''}: it can't hear or answer there`, fix: `Invite it in each: /invite @${kept.bot?.name || 'the app'}`, channels: out.map((x) => ({ id: x.id, name: x.name || null })) }]
    return [{ id: 'channels', label: 'Channels', state: 'ok', detail: `In ${mine.length} ${mine.length === 1 ? 'channel' : 'channels'}${(want || []).length ? ', every one it\'s meant to answer or post in among them' : ''}` }]
  }

  // Connected and staying so, handing each question to hear(q).
  function start(fn) {
    hear = fn
    if (!kept.appToken || !kept.botToken) { set({ state: 'no-tokens', why: null }); return }
    if (['connected', 'connecting', 'reconnecting'].includes(st.state) && ws) return
    tries = 0
    cause = 'start'
    connect().catch((e) => later(e.message))
  }
  // Stopped (quiet: only for a moment, new tokens taking over, so its Home tab isn't told).
  function stop({ quiet = false } = {}) {
    if (!quiet && st.state === 'connected') offline()
    markedNow()
    hear = null
    gen++
    stopTimers()
    drop(ws)
    ws = null
    set({ state: kept.appToken && kept.botToken ? 'off' : 'no-tokens', why: null, nextTry: null, others: null, numConnections: null })
  }
  const state = () => ({ ...st, team: kept.team || null, bot: kept.bot || null, appId: kept.appId || null, tokens: kept.appToken || kept.botToken ? { app: masked(kept.appToken), bot: masked(kept.botToken) } : null, scopes: { missing: kept.botToken ? missing() : null, known: Array.isArray(kept.scopes) } })

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
    dms.clear()
    gates.clear()
    st.limited = null
    const was = hear
    stop({ quiet: true })
    if (was) start(was)
    return state()
  }
  function forget() {
    stop({ quiet: true })
    clearTimeout(marking)
    marking = null
    kept = {}
    try { fs.rmSync(FILE, { force: true }) } catch { /* gone */ }
    memo = { at: 0, list: null }
    dms.clear()
    set({ state: 'no-tokens', why: null })
  }

  return { id, label: 'Slack', platform: 'slack', start, stop, state, post, react, context, people, channels, members, setTokens, forget, missed, masked, whisper, status, askOwner, settle, dm, download, choose, check, probe }
}
