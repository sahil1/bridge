// A bot's way in and out of Discord (Bots, a beta feature): your own Discord application, made in
// Discord's Developer Portal with the bot's name, added to your server with the invite link Settings
// gives, and reached from this computer through Discord's Gateway, a connection this computer opens:
// nothing reaches this computer from the internet, and nothing goes through Bold Bridge or a relay.
// It's a connector (connector.js), one per bot, and does what one does: connects and stays
// connected, says whether it is and why not, hands over each message put to the bot, reads the
// conversation a question was asked in, posts a reply where it was asked (in a thread of its own),
// marks a question with a reaction, and lists who can be picked to ask.
//
// The Gateway: GET /gateway/bot gives its address. Discord says Hello there with how often it wants
// a heartbeat, the first one sent after a random part of that (so many bots don't beat at once), and
// each one acknowledged; one not acknowledged by the next means the connection is dead (a zombie:
// Wi-Fi gone, a lid closed), so it's ended and made again. The bot identifies itself with its token
// and the events it wants (intents): servers and their channels (GUILDS), messages in them
// (GUILD_MESSAGES), direct messages (DIRECT_MESSAGES), and what messages say (MESSAGE_CONTENT, a
// privileged intent: it's turned on in the Developer Portal, under Bot › Privileged Gateway Intents,
// and without it Discord closes the connection with 4014, which Settings says how to fix). Discord
// gives a session, with an address to resume it at: a connection lost is resumed there, and Discord
// sends again what was missed; one it says can't be resumed (Invalid Session, 4007, 4009) is
// started afresh. Discord asking for a new connection (Reconnect) is resumed at once. Between tries
// it waits longer each time, up to a minute; a token turned down (4004) or intents not allowed
// aren't tried again until they're changed. After a fresh start (Bridge AI closed, the computer
// asleep a long while), what was put to it meanwhile is read back: each text channel of your server
// and each direct message, from the last message it saw (three days at most), and each thread it's
// answering in.
//
// What it hands over: a mention of the bot, a direct message to it, a reply to one of its
// messages, and a message in a thread it's answering in (frontdesk.js says which those are). With
// each, who wrote it, as the desk takes them (connector.js person): someone from another server, or
// someone not in your server writing directly, is external; a member who hasn't passed your
// server's membership screening yet, or a guest (Discord's guest invites, for one voice channel),
// is a guest; someone Discord couldn't say anything about (a lookup that failed), or anyone at all
// while no server is set, is unknown. Bots and webhooks are never heard.
//
// Replies: a question at the top of a channel gets a thread started from it, named after it, and
// the answer goes in there (so a follow-up is in the thread, needing no mention), or, where the bot
// answers in the channel (its Answer In), a message in the channel; a question in a thread or a
// direct message, a reply there. A reply over 2,000 characters (Discord's longest) goes in parts.
// Files a bot made (botfiles.js) go after its words, as attachments of a message of their own
// (multipart, as Discord takes files), so a file Discord turns away (too big, say) never keeps the
// words from going: it's said in what post() gives back. On a shared connection (connhub.js), an
// answer goes through the channel's webhook, made once and kept with the token, with the bot's name
// and picture; where the app can't make one (no
// Manage Webhooks), and in direct messages, it starts with the bot's name. Nothing posted can ping
// anyone (allowed_mentions: none). The REST API's rate limits are
// kept: each route's bucket as Discord's headers say, and a 429 waits as long as it says (a global
// one for every route), then says so.
//
// The bot token is kept in the bot's discord.json in the data folder, readable by you only (0600),
// with where the bot got to in each conversation: never in config.json, never in a log, a record or
// a command line, and never given to an agent.
// BRIDGE_DISCORD_URL (tests): a stand-in for Discord (test/stand-ins/discord.mjs).
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import { writeFileAtomic, ROOT } from './paths.js'
import { failure, masked, sleep, split, REACTIONS } from './connector.js'

const API = () => `${String(process.env.BRIDGE_DISCORD_URL || 'https://discord.com').replace(/\/+$/, '')}/api/v10`
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version } catch { return '0' } })()
const AGENT = `DiscordBot (https://github.com/sahil1/bridge, ${VERSION})`
const BACKOFF = [1, 2, 5, 10, 30, 60] // seconds between tries to connect again
const SLEPT_MS = 30 * 1000 // a timer this late means the computer slept
const MISSED_DAYS = 3
const MAX_CONVERSATIONS = 100
const THREAD_CONTEXT = 50
const CHANNEL_CONTEXT = 20
const PINS = 10
const LONGEST = 2000 // characters in a message
const LONGEST_SAID = 1500 // a message read for context
const MARK_MS = 2000
const EPOCH = 1420070400000n // Discord's ids count milliseconds from 2015
const DAY = 86400000

// The events it asks for. MESSAGE_CONTENT is privileged: on in the Developer Portal, or 4014.
export const INTENTS = { GUILDS: 1 << 0, GUILD_MESSAGES: 1 << 9, DIRECT_MESSAGES: 1 << 12, MESSAGE_CONTENT: 1 << 15 }
export const WANTED = INTENTS.GUILDS | INTENTS.GUILD_MESSAGES | INTENTS.DIRECT_MESSAGES | INTENTS.MESSAGE_CONTENT
// The application's flags that say a privileged intent is on (the _LIMITED ones, for a bot in fewer
// than 100 servers).
const FLAG = { MEMBERS: 1 << 14, MEMBERS_LIMITED: 1 << 15, CONTENT: 1 << 18, CONTENT_LIMITED: 1 << 19 }
// What it may do in your server, asked for by the invite link: see channels and read their history,
// send messages, start threads and write in them, add reactions, attach files (for long answers, later).
export const PERMISSIONS = [6, 10, 11, 15, 16, 35, 38].reduce((a, b) => a | (1n << BigInt(b)), 0n).toString()
// A shared connection's (connections.js) asks to manage webhooks too: each bot's answer is posted
// through a channel's webhook with that bot's name and avatar.
export const SHARED_PERMISSIONS = (BigInt(PERMISSIONS) | (1n << 29n)).toString()
export const invite = (appId, perms = PERMISSIONS) => `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&scope=bot&permissions=${perms}`
// A guild member's flag for a guest (in for one voice channel).
const IS_GUEST = 1 << 4
const THREADS = new Set([10, 11, 12]) // announcement, public and private threads
const TEXT = new Set([0, 5]) // text and announcement channels

// Close codes: those not worth trying again until something's changed, and those after which the
// session can't be resumed.
const FINAL = {
  4004: 'Discord turned the bot token down: copy it again from the Developer Portal (your app › Bot › Reset Token)',
  4010: 'Discord didn\'t take the connection\'s shard',
  4011: 'The bot is in too many servers to connect without sharding',
  4012: 'Discord didn\'t take the Gateway version asked for',
  4013: 'Discord didn\'t take the intents asked for',
  4014: 'Turn on Message Content Intent for the bot: Developer Portal › your app › Bot › Privileged Gateway Intents, then Connect again',
}
const FRESH = new Set([4007, 4009])

const read = (file) => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const big = (id) => { try { return BigInt(String(id)) } catch { return 0n } }
const later_ = (a, b) => big(a) > big(b)
const idAt = (ms) => String((BigInt(Math.max(0, Math.floor(ms))) - EPOCH) << 22n)
const order = (a, b) => (big(a.id) < big(b.id) ? -1 : big(a.id) > big(b.id) ? 1 : 0)
const nameOf = (u, m) => m?.nick || u?.global_name || u?.username || null

// What Discord's errors mean, by its JSON error code, then by HTTP status.
const WHY = {
  invalid_auth: 'Discord turned the bot token down: copy it again from the Developer Portal',
  not_in_channel: 'The bot can\'t see that channel (Missing Access)',
  missing_permissions: 'The bot lacks a permission it needs there (Missing Permissions)',
  channel_not_found: 'The bot can\'t find that channel any more',
  message_not_found: 'That message isn\'t there any more',
  member_not_found: 'They aren\'t a member of your server',
  cannot_dm: 'Discord won\'t let the bot message them directly',
  thread_exists: 'A thread was started from that message already',
  invalid_arguments: 'Discord didn\'t take what was sent',
}
const CODES = { 50001: 'not_in_channel', 50013: 'missing_permissions', 10003: 'channel_not_found', 10008: 'message_not_found', 10007: 'member_not_found', 10013: 'member_not_found', 50007: 'cannot_dm', 160004: 'thread_exists', 50035: 'invalid_arguments', 50083: 'thread_archived' }
function discordError(status, j) {
  const code = status === 401 ? 'invalid_auth' : CODES[j?.code] || (status === 403 ? 'missing_permissions' : status === 404 ? 'not_found' : status >= 500 ? `http_${status}` : `http_${status}`)
  return failure(WHY[code] || `Discord said ${j?.message || status}`, code, { status, discord: j?.code ?? null })
}

// Discord's markup in a message, as plain words: mentions by name (the bot's own taken out),
// channels by name, custom emoji by name, timestamps as times.
export function plainText(text, { me = null, mentions = [], channels = {} } = {}) {
  const names = Object.fromEntries((mentions || []).map((u) => [u.id, nameOf(u, u.member)]))
  return String(text || '')
    .replace(/<@!?(\d+)>/g, (_, id) => (id === me ? '' : `@${names[id] || id}`))
    .replace(/<@&(\d+)>/g, '@role')
    .replace(/<#(\d+)>/g, (_, id) => `#${channels[id]?.name || id}`)
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:(\d+)(?::[tTdDfFR])?>/g, (_, s) => new Date(Number(s) * 1000).toISOString())
    .replace(/[ \t]+/g, ' ').trim()
}

// id: the bot's. file: where its token is kept. say(event): what happened, for its record
// ({ what, ok, why }). threads(): the threads it's answering in, to read for what was missed
// ([{ channel, thread, since }], channel the thread's parent). follows(channel, thread): whether
// it's answering in that thread now (the desk knows).
// webhooks: a shared connection's, posting as each bot it reaches (post's as) through a webhook.
export function makeDiscord({ id = 'discord', file, say = () => {}, threads = () => [], follows = () => false, listens = () => false, webhooks = false } = {}) {
  const FILE = file
  let kept = read(FILE)
  const save = () => writeFileAtomic(FILE, JSON.stringify(kept, null, 2), { mode: 0o600 })
  let marking = null
  const marked = () => {
    if (marking) return
    marking = setTimeout(() => { marking = null; tidy(); try { save() } catch (e) { say({ what: 'save', ok: false, why: `Couldn't keep where it got to: ${e.message}` }) } }, MARK_MS)
    marking.unref?.()
  }
  const markedNow = () => { if (!marking) return; clearTimeout(marking); marking = null; tidy(); try { save() } catch { /* next time */ } }
  const tidy = () => {
    const old = idAt(Date.now() - 7 * DAY)
    for (const [k, at] of Object.entries(kept.threads || {})) {
      const [channel, thread] = k.split(':')
      if (!later_(at, old) || !follows(channel, thread)) delete kept.threads[k]
    }
  }

  let hear = null
  let ws = null
  let gen = 0 // each connection's number: what an old one says after it's replaced is ignored
  let tries = 0
  let retry = null
  let beatFirst = null
  let beating = null
  let acked = true
  let seq = null
  let session = null // { id, url } while it can be resumed
  let tick = Date.now()
  let guildsDue = null
  let waitingFor = null // the servers READY named, still to arrive (GUILD_CREATE)
  // off | no-tokens | connecting | connected | reconnecting | error
  let st = { state: kept.token ? 'off' : 'no-tokens', why: null, since: new Date().toISOString(), lastEvent: null, connectedAt: null, drops: 0, resumes: 0 }
  const set = (patch) => { st = { ...st, ...patch, since: patch.state && patch.state !== st.state ? new Date().toISOString() : st.since } }

  // ---------- The REST API ----------
  // Each route's bucket, as Discord's headers say (a route's own, keyed by its channel or server),
  // and the global limit: a call waits while its bucket is empty. A 429 waits as long as Discord
  // says, up to `waits` times, then says so.
  const buckets = new Map()
  let globalUntil = 0
  const bucketOf = (method, route) => `${method} ${route.replace(/^\/(channels|guilds)\/(\d+)/, '/$1/<$2>').replace(/\/\d+/g, '/:id').replace(/\/reactions\/[^/]+/, '/reactions/:e')}`
  async function call(method, route, { body = null, form = null, query = null, token = kept.token, waits = 3, hook = false } = {}) {
    if (!token && !hook) throw failure('No bot token yet', 'not_authed')
    const url = new URL(API() + route)
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v))
    const key = bucketOf(method, route)
    for (let i = 0; ; i++) {
      const hold = Math.max(globalUntil, buckets.get(key) || 0) - Date.now()
      if (hold > 0) await sleep(Math.min(hold, 60000))
      let res
      try {
        res = await fetch(url, { method, headers: { ...(hook ? {} : { authorization: `Bot ${token}` }), 'user-agent': AGENT, ...(body ? { 'content-type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(form ? 120000 : 20000) })
      } catch (e) {
        throw failure(`Couldn't reach Discord: ${e.cause?.code || e.message}`, 'offline')
      }
      const left = res.headers.get('x-ratelimit-remaining')
      const reset = Number(res.headers.get('x-ratelimit-reset-after'))
      if (left === '0' && reset > 0) buckets.set(key, Date.now() + reset * 1000)
      else if (left != null) buckets.delete(key)
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}))
        const wait = Math.max(0.05, Number(j?.retry_after ?? res.headers.get('retry-after')) || 1)
        if (j?.global || res.headers.get('x-ratelimit-global') === 'true') globalUntil = Date.now() + wait * 1000
        else buckets.set(key, Date.now() + wait * 1000)
        if (i >= waits || wait > 60) throw failure(`Discord asked to wait ${Math.ceil(wait)} s before more (rate limited)`, 'ratelimited', { retryAfter: Math.ceil(wait) })
        await sleep(wait * 1000)
        continue
      }
      if (res.status === 204) return null
      const j = await res.json().catch(() => null)
      if (res.ok) return j
      throw discordError(res.status, j)
    }
  }

  // Who the bot is, and whether its privileged intents are on (the application's flags).
  async function whoami(token = kept.token) {
    const me = await call('GET', '/users/@me', { token })
    const app = await call('GET', '/oauth2/applications/@me', { token }).catch(() => null)
    return { me, app }
  }
  const intents = () => {
    const f = kept.app?.flags
    if (f == null) return { content: null, members: null, missing: null }
    const content = !!(f & (FLAG.CONTENT | FLAG.CONTENT_LIMITED))
    const members = !!(f & (FLAG.MEMBERS | FLAG.MEMBERS_LIMITED))
    return { content, members, missing: [!content && 'Message Content Intent', !members && 'Server Members Intent'].filter(Boolean) }
  }

  // ---------- The Gateway ----------
  const stopTimers = () => { clearTimeout(beatFirst); beatFirst = null; clearInterval(beating); beating = null; clearTimeout(retry); retry = null; clearTimeout(guildsDue); guildsDue = null }
  const drop = (socket) => { try { socket?.removeAllListeners('close'); socket?.terminate() } catch { /* gone */ } }
  const send = (socket, o) => { try { socket.send(JSON.stringify(o)); return true } catch { return false } }

  // Try again in a while: longer each time, up to a minute (or as long as Discord said). What can't
  // work until it's changed isn't tried again.
  function later(why, { final = false, wait = null } = {}) {
    stopTimers()
    if (!hear) return
    if (final) { session = null; set({ state: 'error', why, nextTry: null }); say({ what: 'stopped', ok: false, why }); return }
    const s = wait ?? BACKOFF[Math.min(tries, BACKOFF.length - 1)]
    tries++
    set({ state: 'reconnecting', why, nextTry: new Date(Date.now() + s * 1000).toISOString() })
    retry = setTimeout(() => { connect().catch((e) => later(e.message)) }, s * 1000)
    retry.unref?.()
  }

  async function connect() {
    if (!hear) return
    stopTimers()
    const mine = ++gen
    if (st.state !== 'reconnecting') set({ state: 'connecting', why: null })
    let url = session?.url || null
    if (!url) {
      seq = null
      try {
        // Who it is, each fresh start, so a token that stopped working (or an intent turned off) is
        // noticed; then where to connect, and whether Discord lets it start a session now.
        const { me, app } = await whoami()
        if (mine !== gen) return
        kept.bot = { id: me.id, name: me.global_name || me.username, username: me.username }
        // (Its flags not to be had now: not known, rather than what they were.)
        kept.app = app ? { id: app.id, flags: app.flags ?? null, name: app.name || null } : { ...(kept.app || { id: me.id }), flags: null }
        kept.since ||= String(Date.now())
        save()
        if (intents().content === false) return later(FINAL[4014], { final: true })
        const g = await call('GET', '/gateway/bot')
        if (mine !== gen) return
        if (g?.session_start_limit?.remaining === 0) return later('Discord limits how often a bot may connect: it waits until it may again', { wait: Math.ceil((g.session_start_limit.reset_after || 60000) / 1000) })
        url = g.url
      } catch (e) {
        if (mine !== gen) return
        return later(e.code === 'invalid_auth' ? FINAL[4004] : e.message, { final: e.code === 'invalid_auth' })
      }
    }
    if (!hear || mine !== gen) return
    const was = ws
    if (was) drop(was)
    let socket
    try { socket = new WebSocket(`${String(url).replace(/\/+$/, '')}/?v=10&encoding=json`, { handshakeTimeout: 15000 }) } catch (e) { return later(`The connection failed: ${e.message}`) }
    ws = socket
    socket.on('message', (raw) => frame(socket, mine, raw))
    socket.on('close', (code, reason) => {
      if (mine !== gen || socket !== ws) return
      ws = null
      st.drops++
      if (FINAL[code]) return later(FINAL[code], { final: true })
      if (FRESH.has(code)) { session = null; seq = null }
      say({ what: 'dropped', ok: false, why: `The connection closed (${code}${String(reason || '') ? `: ${clip(String(reason), 120)}` : ''})` })
      later(`The connection closed (${code}); connecting again`)
    })
    socket.on('error', (e) => {
      if (mine !== gen || socket !== ws) return
      drop(socket)
      ws = null
      later(`The connection failed: ${e.message}`)
    })
  }

  // Heartbeats, at Discord's interval, the first after a random part of it. One not acknowledged by
  // the next: the connection is dead, so it's ended and resumed.
  function beat(socket, mine, every) {
    clearTimeout(beatFirst)
    clearInterval(beating)
    acked = true
    const one = () => {
      if (mine !== gen || socket !== ws) return
      if (!acked) { drop(socket); ws = null; later('The connection went quiet; connecting again'); return }
      acked = false
      send(socket, { op: 1, d: seq })
    }
    beatFirst = setTimeout(() => { one(); beating = setInterval(one, every); beating.unref?.() }, Math.floor(every * Math.random()))
    beatFirst.unref?.()
  }

  function frame(socket, mine, raw) {
    if (mine !== gen) return
    let m
    try { m = JSON.parse(String(raw)) } catch { return }
    if (m.s != null) seq = m.s
    if (m.op === 10) {
      beat(socket, mine, Math.max(250, Number(m.d?.heartbeat_interval) || 41250))
      if (session?.id && seq != null) send(socket, { op: 6, d: { token: kept.token, session_id: session.id, seq } })
      else send(socket, { op: 2, d: { token: kept.token, intents: WANTED, properties: { os: process.platform, browser: 'Bridge AI', device: 'Bridge AI' } } })
    } else if (m.op === 11) acked = true
    else if (m.op === 1) send(socket, { op: 1, d: seq })
    else if (m.op === 7) {
      // Discord asks for a new connection: resumed at once.
      drop(socket)
      ws = null
      set({ state: 'reconnecting', why: 'Discord asked for a new connection' })
      connect().catch((e) => later(e.message))
    } else if (m.op === 9) {
      // Invalid Session: resumed if Discord says it can be, else started afresh, after 1 to 5 s.
      if (m.d !== true) { session = null; seq = null }
      drop(socket)
      ws = null
      later(m.d === true ? 'Discord asked to resume the session' : 'Discord ended the session; starting a new one', { wait: 1 + Math.floor(Math.random() * 4) })
    } else if (m.op === 0) {
      dispatch(m.t, m.d || {}).catch((e) => say({ what: 'event', ok: false, why: e.message }))
    }
  }

  // ---------- What comes in ----------
  const guilds = {} // id -> { id, name }
  const chans = {} // id -> { id, type, name, parent, guild }
  const where = new Map() // message id -> the channel it's in (a thread's, for one in a thread)
  const quoted = new Map() // message id -> the message it replied to
  const seen = new Map() // user id -> name, of those who wrote, for picking askers without the members' list
  const members = new Map() // user id -> { at, m } (or { at, missing })
  const remember = (map, k, v, max = 2000) => { map.set(k, v); if (map.size > max) map.delete(map.keys().next().value) }
  const learnChannel = (c, guild) => { if (c?.id) chans[c.id] = { id: c.id, type: c.type, name: c.name || null, parent: c.parent_id || null, guild: c.guild_id || guild || null } }

  async function dispatch(t, d) {
    st.lastEvent = new Date().toISOString()
    if (t === 'READY') {
      session = { id: d.session_id, url: d.resume_gateway_url }
      kept.bot = { id: d.user?.id, name: d.user?.global_name || d.user?.username, username: d.user?.username }
      if (d.application?.id) kept.app = { ...(kept.app || {}), id: d.application.id, ...(d.application.flags != null ? { flags: d.application.flags } : {}) }
      tries = 0
      set({ state: 'connected', why: null, connectedAt: new Date().toISOString(), nextTry: null })
      say({ what: 'connected', ok: true })
      const due = new Set((d.guilds || []).map((g) => g.id))
      const go = () => { clearTimeout(guildsDue); guildsDue = null; settle(); missed().catch((e) => say({ what: 'missed', ok: false, why: `Couldn't read what was asked while away: ${e.message}` })) }
      if (!due.size) go()
      else { waitingFor = due; guildsDue = setTimeout(go, 3000); guildsDue.unref?.() }
      return
    }
    if (t === 'RESUMED') {
      tries = 0
      st.resumes++
      set({ state: 'connected', why: null, nextTry: null })
      say({ what: 'resumed', ok: true })
      return
    }
    if (t === 'GUILD_CREATE') {
      guilds[d.id] = { id: d.id, name: d.name || d.id }
      for (const c of [...(d.channels || []), ...(d.threads || [])]) learnChannel(c, d.id)
      if (waitingFor?.delete(d.id) && !waitingFor.size && guildsDue) { clearTimeout(guildsDue); guildsDue = null; waitingFor = null; settle(); missed().catch((e) => say({ what: 'missed', ok: false, why: `Couldn't read what was asked while away: ${e.message}` })) }
      return
    }
    if (t === 'GUILD_DELETE') {
      if (d.unavailable) return
      const was = guilds[d.id]
      delete guilds[d.id]
      if (kept.guild?.id === d.id) say({ what: 'removed', ok: false, why: `The bot was removed from ${was?.name || 'your server'}: add it again with the invite link` })
      return
    }
    if (['CHANNEL_CREATE', 'CHANNEL_UPDATE', 'THREAD_CREATE', 'THREAD_UPDATE'].includes(t)) return learnChannel(d)
    if (t === 'CHANNEL_DELETE' || t === 'THREAD_DELETE') { delete chans[d.id]; return }
    if (t === 'THREAD_LIST_SYNC') { for (const c of d.threads || []) learnChannel(c, d.guild_id); return }
    if (t === 'MESSAGE_CREATE') return heard(d)
    if (t === 'MESSAGE_UPDATE' || t === 'MESSAGE_DELETE') return altered(t, d)
  }
  // The servers it's in, known now: the one it answers in, if there's only one and none was set.
  function settle() {
    kept.guilds = Object.values(guilds).map((g) => ({ id: g.id, name: g.name }))
    if (kept.guild && guilds[kept.guild.id]) kept.guild.name = guilds[kept.guild.id].name
    if (!kept.guild && kept.guilds.length === 1) kept.guild = { ...kept.guilds[0] }
    if (!kept.guilds.length) say({ what: 'no-server', ok: false, why: 'The bot isn\'t in a server yet: add it to yours with the invite link in Settings' })
    else if (!kept.guild) say({ what: 'no-server', ok: false, why: 'The bot is in more than one server: pick the one it answers in, in Settings' })
    try { save() } catch { /* next time */ }
  }

  async function channelOf(cid, guild) {
    if (chans[cid]) return chans[cid]
    try { const c = await call('GET', `/channels/${cid}`); learnChannel(c, guild); return chans[cid] } catch { return null }
  }
  // A member of your server, asked of Discord now and then (ten minutes kept).
  async function memberOf(uid) {
    const had = members.get(uid)
    if (had && Date.now() - had.at < 10 * 60 * 1000) { if (had.missing) throw failure(WHY.member_not_found, 'member_not_found'); return had.m }
    try {
      const m = await call('GET', `/guilds/${kept.guild.id}/members/${uid}`)
      remember(members, uid, { at: Date.now(), m }, 500)
      return m
    } catch (e) {
      if (e.code === 'member_not_found') remember(members, uid, { at: Date.now(), missing: true }, 500)
      throw e
    }
  }

  // Who wrote it, as the desk takes them: from another server, or not in yours, external; still to
  // pass your server's screening, or a guest, a guest; anything Discord couldn't say, unknown.
  async function personOf(author, member, guild) {
    const id = author?.id || null
    const name = nameOf(author, member)
    if (!id) return { id: null, unknown: true, why: 'The message didn\'t say who sent it' }
    const home = kept.guild?.id
    if (!home) return { id, name, unknown: true, why: 'No server is set for the bot yet' }
    if (guild && guild !== home) return { id, name, external: true, why: `Asked in another server (${guilds[guild]?.name || guild})` }
    let m = guild === home && member ? member : null
    if (!m) {
      try { m = await memberOf(id) } catch (e) {
        if (e.code === 'member_not_found') return { id, name, external: true, why: 'Not a member of your server' }
        return { id, name, unknown: true, why: `Couldn't check who they are: ${e.message}` }
      }
    }
    const shown = m.nick || name
    if (m.pending === true) return { id, name: shown, guest: true, why: 'Hasn\'t passed your server\'s membership screening' }
    if ((Number(m.flags) || 0) & IS_GUEST) return { id, name: shown, guest: true, why: 'A guest in your server' }
    return { id, name: shown, guest: false, external: false }
  }

  // A message: a mention of the bot, a direct message, a reply to the bot, one in a thread it's
  // answering in, or one at the top of a channel it answers in without a mention (listens), from a
  // person, is handed over; anything else isn't for it and goes no further.
  async function heard(d, { late = false } = {}) {
    if (!d?.id || !d.channel_id || !hear) return
    const me = kept.bot?.id
    const dm = !d.guild_id
    const ch = dm ? null : await channelOf(d.channel_id, d.guild_id)
    const inThread = !!ch && THREADS.has(ch.type)
    const parent = inThread ? ch.parent || d.channel_id : d.channel_id
    const thread = inThread ? d.channel_id : null
    // Where it got to, for what's missed next time.
    if (!inThread) {
      kept.seen ||= {}
      if (!kept.seen[d.channel_id] || later_(d.id, kept.seen[d.channel_id])) { kept.seen[d.channel_id] = d.id; marked() }
      if (dm) { kept.dms ||= []; if (!kept.dms.includes(d.channel_id)) { kept.dms = [d.channel_id, ...kept.dms].slice(0, MAX_CONVERSATIONS); marked() } }
    } else if (follows(parent, thread)) {
      kept.threads ||= {}
      const k = `${parent}:${thread}`
      if (!kept.threads[k] || later_(d.id, kept.threads[k])) { kept.threads[k] = d.id; marked() }
    }
    remember(where, d.id, d.channel_id)
    if (d.author?.bot || d.webhook_id || !d.author?.id || d.author.id === me) return
    if (d.type !== 0 && d.type !== 19) return // a message, or a reply; not joins, pins or thread notices
    const toMe = d.referenced_message?.author?.id === me && !!me
    const mention = (d.mentions || []).some((u) => u.id === me) || toMe
    const listen = !dm && !inThread && !mention && listens(parent)
    if (!dm && !mention && !listen && !(inThread && follows(parent, thread))) return
    if (d.referenced_message?.id) remember(quoted, d.id, d.referenced_message, 500)
    const from = await personOf(d.author, d.member, d.guild_id || null)
    if (from.id && from.name) remember(seen, from.id, from.name, 1000)
    const text = plainText(d.content, { me, mentions: d.mentions, channels: chans })
    const top = !dm && !inThread
    await hear({
      ts: d.id, channel: parent, thread, mention, dm, from, text, ...(listen ? { via: 'listen' } : {}),
      place: dm ? { kind: 'dm', id: d.channel_id, name: null } : { kind: 'channel', id: parent, name: chans[parent]?.name || null, within: guilds[d.guild_id]?.name || null, ...(ch?.type === 12 ? { private: true } : {}) },
      at: d.timestamp || new Date().toISOString(),
      late,
      attachments: (d.attachments || []).map((a) => ({ id: a.id, name: a.filename, type: a.content_type || null, size: a.size })),
      reply: { channel: d.channel_id, message: d.id, thread: dm ? null : inThread ? d.channel_id : d.id, ...(top ? { start: true, name: clip(text.replace(/\s+/g, ' ').trim() || `Question from ${from.name || 'someone'}`, 90) } : {}) },
      // (Answered in the channel itself instead, where the bot answers there: the desk picks.)
      ...(top ? { top: { channel: d.channel_id, message: d.id, thread: null } } : {}),
    })
  }
  // An edit or a deletion in a channel or thread, handed over as one (the desk keeps those in its
  // threads). Discord doesn't say what a message said before.
  async function altered(t, d) {
    if (!hear?.change || !d?.id) return
    const ch = d.guild_id ? await channelOf(d.channel_id, d.guild_id) : null
    const inThread = !!ch && THREADS.has(ch.type)
    const parent = inThread ? ch.parent || d.channel_id : d.channel_id
    if (t === 'MESSAGE_UPDATE' && (d.content == null || d.author?.id === kept.bot?.id)) return // an embed shown, or its own
    await hear.change({
      kind: t === 'MESSAGE_DELETE' ? 'deleted' : 'changed', channel: parent, ts: d.id, thread: inThread ? d.channel_id : d.id,
      from: d.author?.id ? { id: d.author.id, name: nameOf(d.author, d.member) } : null,
      text: t === 'MESSAGE_DELETE' ? null : plainText(d.content, { me: kept.bot?.id, mentions: d.mentions, channels: chans }),
      before: null,
    })
  }

  // The conversation a question was asked in, as context: in a thread, its earlier messages and the
  // message it was started from (since `since`, when the answer goes on from an earlier one); at the
  // top of a channel, its latest messages and what's pinned there; in a direct message, its latest
  // messages; and the message a question replied to, if it did.
  async function context({ channel, thread, ts, since = null, dm = false }) {
    const mine = (m) => (!!kept.bot?.id && m.author?.id === kept.bot.id) || (!!m.webhook_id && Object.values(kept.hooks || {}).some((x) => x?.id === m.webhook_id))
    // (A post of this app's own, by one of its webhooks: as, the name it was posted as, so a bot takes
    // only its own as its own words; another bot's or a webhook's: bot, its words anyone's.)
    const said = (m) => {
      const own = mine(m)
      return { ts: m.id, person: { id: m.author?.id || null, name: nameOf(m.author, m.member) }, text: clip(plainText(m.content, { me: kept.bot?.id, mentions: m.mentions, channels: chans }), LONGEST_SAID), you: own, ...(own ? { as: m.webhook_id ? m.author?.username || null : null } : (m.author?.bot || m.webhook_id) ? { bot: true } : {}) }
    }
    // (A post you scheduled has no message of Discord's to read back from: the latest, then.)
    const own = /^\d+$/.test(String(ts))
    const before = (m) => m?.id && (!own || later_(ts, m.id)) && (!since || later_(m.id, since)) && String(m.content || '').trim()
    const withQuote = (list) => { const q = quoted.get(String(ts)); return q && !list.some((m) => m.id === q.id) ? [q, ...list] : list }
    if (thread) {
      const list = await call('GET', `/channels/${thread}/messages`, { query: { ...(own ? { before: ts } : {}), limit: THREAD_CONTEXT } }) || []
      let starter = null
      try { starter = await call('GET', `/channels/${channel}/messages/${thread}`) } catch { /* a thread not started from a message */ }
      const msgs = withQuote([...(starter ? [starter] : []), ...list]).filter(before).sort(order).slice(-THREAD_CONTEXT)
      return { kind: 'thread', messages: msgs.map(said), pins: [] }
    }
    const list = await call('GET', `/channels/${channel}/messages`, { query: { ...(own ? { before: ts } : {}), limit: CHANNEL_CONTEXT } }) || []
    const messages = withQuote(list).filter(before).sort(order).slice(-CHANNEL_CONTEXT).map(said)
    if (dm) return { kind: 'dm', messages, pins: [] }
    let pins = []
    let problem = null
    try {
      let items
      try { items = ((await call('GET', `/channels/${channel}/messages/pins`, { query: { limit: PINS } }))?.items || []).map((i) => i.message) } catch (e) {
        if (e.status !== 404 || e.discord) throw e
        items = await call('GET', `/channels/${channel}/pins`) || [] // (before Discord's newer pins list)
      }
      pins = items.filter((m) => m?.content).slice(0, PINS).map(said)
    } catch (e) { problem = `Couldn't read what's pinned: ${e.message}` }
    return { kind: 'channel', messages, pins, problem }
  }

  // What was put to the bot while it wasn't connected (after a fresh start; a resumed session gets
  // it from Discord): each text channel of your server and each direct message, from the last
  // message it saw there (three days at most), and each thread it's answering in.
  let reading = null
  function missed() {
    if (reading) return reading
    reading = (async () => {
      const floor = idAt(Math.max(Number(kept.since || 0), Date.now() - MISSED_DAYS * DAY))
      const from = (...ids) => ids.filter(Boolean).reduce((a, b) => (later_(b, a) ? b : a), floor)
      const home = kept.guild?.id
      const places = [
        ...Object.values(chans).filter((c) => home && c.guild === home && TEXT.has(c.type)).map((c) => ({ id: c.id, guild: home })),
        ...(kept.dms || []).map((x) => ({ id: x, guild: null })),
      ].slice(0, MAX_CONVERSATIONS)
      let found = 0
      for (const c of places) {
        let list
        try { list = await call('GET', `/channels/${c.id}/messages`, { query: { after: from(kept.seen?.[c.id]), limit: 100 } }) || [] } catch (e) {
          if (['not_in_channel', 'missing_permissions', 'channel_not_found', 'not_found'].includes(e.code)) continue // a channel the bot can't read: nothing was asked of it there
          throw e
        }
        for (const m of list.sort(order)) {
          const me = kept.bot?.id
          if (c.guild && !(m.mentions || []).some((u) => u.id === me) && m.referenced_message?.author?.id !== me) { kept.seen ||= {}; kept.seen[c.id] = m.id; continue }
          found++
          await heard({ ...m, guild_id: c.guild || undefined }, { late: true })
        }
      }
      for (const t of (await Promise.resolve(threads()).catch(() => [])).slice(0, MAX_CONVERSATIONS)) {
        let list
        try { list = await call('GET', `/channels/${t.thread}/messages`, { query: { after: from(kept.threads?.[`${t.channel}:${t.thread}`], t.since), limit: 100 } }) || [] } catch { continue }
        if (!chans[t.thread]) chans[t.thread] = { id: t.thread, type: 11, name: null, parent: t.channel, guild: home }
        for (const m of list.sort(order)) { found++; await heard({ ...m, guild_id: home || undefined }, { late: true }) }
      }
      marked()
      if (found) say({ what: 'missed', ok: true, why: `${found} asked while away` })
    })().finally(() => { reading = null })
    return reading
  }

  // ---------- What goes out ----------
  // Replies one at a time. A question at the top of a channel gets a thread started from it (named
  // after it), and the reply goes in there; where the bot can't start one, the reply answers the
  // question in the channel instead, and that's said. A reply too long for one message goes in
  // parts; one that stopped partway (a rate limit, Discord unreachable) goes on from there when
  // it's tried again, so no part is posted twice.
  let line = Promise.resolve()
  const partial = new Map() // `${message}:${text's length}` -> { target, ids }
  // As a bot on a shared connection (as: { name, icon }): through the channel's webhook (made once,
  // kept with the token), with that bot's name and its icon when it's a picture's address; where the
  // app may not make webhooks (no Manage Webhooks there), and in direct messages, its name first.
  const noHook = new Map() // channel -> when making its webhook was turned down
  const parentOf = (cid) => (THREADS.has(chans[cid]?.type) ? chans[cid].parent || cid : cid)
  async function hookOf(channel) {
    kept.hooks ||= {}
    if (kept.hooks[channel]?.token) return kept.hooks[channel]
    if (Date.now() - (noHook.get(channel) || 0) < 3600 * 1000) return null
    try {
      const w = await call('POST', `/channels/${channel}/webhooks`, { body: { name: clip(kept.bot?.name || 'Bridge AI', 80) }, waits: 1 })
      if (!w?.id || !w.token) throw failure('Discord gave no webhook', 'invalid_arguments')
      kept.hooks[channel] = { id: w.id, token: w.token }
      save()
      return kept.hooks[channel]
    } catch (e) {
      if (!['missing_permissions', 'not_in_channel', 'invalid_arguments', 'not_found', 'channel_not_found'].includes(e.code)) throw e
      noHook.set(channel, Date.now())
      say({ what: 'webhooks', ok: false, why: `Couldn't make a webhook in a channel (${e.message}): each answer there says its bot's name first. Give the app Manage Webhooks there to post as each bot.` })
      return null
    }
  }
  // Files, as a message of their own after the words (where they went: hook, target): each said in
  // what comes back, { name, size, ok, error }, never thrown.
  async function attach(files, { hook, target, as }) {
    const fd = new FormData()
    const named = files.map((f) => String(f.name || 'file').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').slice(0, 120) || 'file')
    fd.append('payload_json', JSON.stringify({ content: '', attachments: named.map((n, i) => ({ id: i, filename: n })), allowed_mentions: { parse: [] }, ...(hook ? { username: clip(as.name, 80), ...(/^https:\/\/\S{1,500}$/.test(String(as.icon || '')) ? { avatar_url: as.icon } : {}) } : {}) }))
    const sizes = []
    files.forEach((f, i) => { const b = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content ?? ''), 'utf8'); sizes.push(b.length); fd.append(`files[${i}]`, new Blob([b]), named[i]) })
    try {
      const j = hook
        ? await call('POST', `/webhooks/${hook.id}/${hook.token}`, { hook: true, query: { wait: 'true', ...(target !== parentOf(target) ? { thread_id: target } : {}) }, form: fd, waits: 1 })
        : await call('POST', `/channels/${target}/messages`, { form: fd, waits: 1 })
      if (j?.id) remember(where, j.id, target)
      return named.map((n, i) => ({ id: j?.attachments?.[i]?.id || null, name: n, size: sizes[i], ok: true }))
    } catch (e) { return named.map((n, i) => ({ id: null, name: n, size: sizes[i], ok: false, error: e.message, code: e.code || null })) }
  }
  function post(reply, text, { as = null, files = [] } = {}) {
    const go = line.then(async () => {
      if (!reply?.channel) throw failure('Nowhere to reply to', 'invalid_arguments')
      const key = `${reply.message}:${String(text).length}`
      const had = partial.get(key)
      let target = had?.target || (reply.thread && !reply.start ? reply.thread : reply.channel)
      let reference = null
      if (!had && reply.start && reply.message) {
        try {
          const t = await call('POST', `/channels/${reply.channel}/messages/${reply.message}/threads`, { body: { name: reply.name || 'Question', auto_archive_duration: 1440 }, waits: 1 })
          learnChannel(t, chans[reply.channel]?.guild)
          target = t.id
        } catch (e) {
          if (e.code === 'thread_exists') target = reply.message
          else if (['missing_permissions', 'not_in_channel', 'invalid_arguments', 'thread_archived'].includes(e.code)) {
            say({ what: 'threads', ok: false, why: `Couldn't start a thread for the answer (${e.message}): it went in the channel` })
            reference = { message_id: reply.message, channel_id: reply.channel, fail_if_not_exists: false }
          } else throw e
        }
      }
      const hook = as?.name && webhooks && chans[target] && !reference ? await hookOf(parentOf(target)) : null
      const words = as?.name && !hook ? `**${as.name}:** ${text}` : text
      const parts = split(words, LONGEST)
      const ids = had?.ids ? [...had.ids] : []
      try {
        for (let i = ids.length; i < parts.length; i++) {
          const j = hook
            ? await call('POST', `/webhooks/${hook.id}/${hook.token}`, { hook: true, query: { wait: 'true', ...(target !== parentOf(target) ? { thread_id: target } : {}) }, body: { content: parts[i], username: clip(as.name, 80), ...(/^https:\/\/\S{1,500}$/.test(String(as.icon || '')) ? { avatar_url: as.icon } : {}), allowed_mentions: { parse: [] } }, waits: 1 })
            : await call('POST', `/channels/${target}/messages`, { body: { content: parts[i], allowed_mentions: { parse: [], replied_user: false }, ...(i === 0 && reference ? { message_reference: reference } : {}) }, waits: 1 })
          ids.push(j.id)
          remember(where, j.id, target)
        }
      } catch (e) {
        if (ids.length) { partial.set(key, { target, ids }); if (partial.size > 50) partial.delete(partial.keys().next().value) }
        // (A webhook deleted in Discord: made again next time.)
        if (hook && ['not_found', 'invalid_auth'].includes(e.code)) { delete kept.hooks[parentOf(target)]; try { save() } catch { /* next time */ } }
        throw e
      }
      partial.delete(key)
      const sent = files.length ? await attach(files.slice(0, 10), { hook, target, as }) : []
      return { ts: ids[0], channel: target, parts: ids, files: sent, ...(hook ? { hook: true } : {}) }
    })
    line = go.catch(() => {})
    return go
  }
  // A reply posted before, changed: each part edited, parts added or taken away as it's now longer
  // or shorter.
  async function edit(posted, text) {
    const target = posted?.channel
    const ids = [...(posted?.parts || (posted?.ts ? [posted.ts] : []))]
    if (!target || !ids.length) throw failure('Nothing posted to change', 'invalid_arguments')
    const parts = split(text, LONGEST)
    const out = []
    for (let i = 0; i < parts.length; i++) {
      if (ids[i]) { await call('PATCH', `/channels/${target}/messages/${ids[i]}`, { body: { content: parts[i], allowed_mentions: { parse: [] } } }); out.push(ids[i]) } else {
        const j = await call('POST', `/channels/${target}/messages`, { body: { content: parts[i], allowed_mentions: { parse: [] } } })
        out.push(j.id)
      }
    }
    for (const x of ids.slice(parts.length)) await call('DELETE', `/channels/${target}/messages/${x}`).catch(() => {})
    return { ts: out[0], channel: target, parts: out }
  }

  // A reaction on a question (👀 as it's taken, ✅ once answered), or taken off: on the message where
  // it is (a thread's, for one in a thread).
  async function react({ channel, ts, name, off = false, reply = null }) {
    const emoji = REACTIONS[name] || name
    const at = where.get(String(ts)) || (reply?.message === ts ? reply.channel : null) || channel
    await call(off ? 'DELETE' : 'PUT', `/channels/${at}/messages/${ts}/reactions/${encodeURIComponent(emoji)}/@me`, { waits: 1 })
  }
  // A word to one person only: in their direct messages with the bot (Discord's messages only they
  // see are for slash commands), where it says where it's from.
  async function whisper(reply, user, text) {
    const dm = await call('POST', '/users/@me/channels', { body: { recipient_id: String(user) } })
    const where = reply?.channel && chans[reply.thread || reply.channel] ? ` (about what you asked in #${chans[chans[reply.channel]?.parent || reply.channel]?.name || 'a channel'})` : ''
    const ids = []
    for (const part of split(`${text}${where}`, LONGEST)) ids.push((await call('POST', `/channels/${dm.id}/messages`, { body: { content: part, allowed_mentions: { parse: [] } } })).id)
    return { ts: ids[0], channel: dm.id }
  }
  // The text channels of the server it answers in, to pick from (where it answers without a
  // mention, where it posts on a schedule): [{ id, name, private }].
  async function channels() {
    const home = kept.guild?.id
    if (!home) return []
    return Object.values(chans).filter((c) => c.guild === home && TEXT.has(c.type)).map((c) => ({ id: c.id, name: c.name || c.id, private: false })).sort((a, b) => a.name.localeCompare(b.name))
  }
  // "Bridge AI is typing…" where the question was asked, for ten seconds.
  const typing = (reply) => call('POST', `/channels/${reply.thread && !reply.start ? reply.thread : reply.channel}/typing`, { waits: 0 }).then(() => true)

  // Your server's people, to pick askers from: neither bots, guests nor anyone still to pass its
  // screening (they're never answered). Listing them needs Server Members Intent: without it, the
  // people who've written to the bot, and why only those. Kept for ten minutes.
  let memo = { at: 0, list: null }
  async function people({ fresh = false } = {}) {
    if (!fresh && memo.list && Date.now() - memo.at < 10 * 60 * 1000) return memo.list
    const home = kept.guild?.id
    if (!home) return Object.assign([], { problem: kept.guilds?.length ? 'Pick the server it answers in first' : 'Add the bot to your server first, with the invite link' })
    const out = []
    try {
      let after = '0'
      for (;;) {
        const list = await call('GET', `/guilds/${home}/members`, { query: { limit: 1000, after } }) || []
        for (const m of list) {
          if (!m.user?.id || m.user.bot || m.pending || ((Number(m.flags) || 0) & IS_GUEST)) continue
          const name = nameOf(m.user, m)
          out.push({ id: m.user.id, name, detail: m.user.username && m.user.username !== name ? `@${m.user.username}` : null })
        }
        if (list.length < 1000 || out.length >= 5000) break
        after = list.at(-1).user.id
      }
    } catch (e) {
      if (!['not_in_channel', 'missing_permissions'].includes(e.code)) throw e
      const some = [...seen.entries()].map(([id, name]) => ({ id, name, detail: null })).sort((a, b) => a.name.localeCompare(b.name))
      return Object.assign(some, { problem: 'To pick from everyone in your server, turn on Server Members Intent: Developer Portal › your app › Bot › Privileged Gateway Intents. Until then, only people who\'ve written to the bot are listed.' })
    }
    memo = { at: Date.now(), list: out.sort((a, b) => a.name.localeCompare(b.name)) }
    return memo.list
  }
  // One person, as heard() gives them.
  const person = (uid) => personOf({ id: uid, username: seen.get(uid) || null }, null, null)

  // The computer slept (a timer far later than it should be): the connection is very likely dead,
  // so it's resumed at once.
  const watch = setInterval(() => {
    const now = Date.now()
    if (now - tick > SLEPT_MS && hear && st.state === 'connected') { drop(ws); ws = null; tries = 0; set({ state: 'reconnecting', why: 'The computer slept; connecting again' }); connect().catch((e) => later(e.message)) }
    tick = now
  }, 5000)
  watch.unref?.()

  function start(fn) {
    hear = fn
    if (!kept.token) { set({ state: 'no-tokens', why: null }); return }
    if (['connected', 'connecting', 'reconnecting'].includes(st.state) && (ws || retry)) return
    tries = 0
    connect().catch((e) => later(e.message))
  }
  // Stopped: the session ended (closed with 1000, so the bot shows offline at once).
  function stop() {
    markedNow()
    hear = null
    gen++
    stopTimers()
    const old = ws
    ws = null
    if (old) {
      try { old.removeAllListeners('close'); old.close(1000) } catch { /* gone */ }
      setTimeout(() => drop(old), 2000).unref?.() // (one that doesn't close by itself)
    }
    session = null
    seq = null
    set({ state: kept.token ? 'off' : 'no-tokens', why: null, nextTry: null })
  }
  // (team: the server it answers in, as Slack's workspace is, for its record.)
  const state = () => ({ ...st, bot: kept.bot || null, app: kept.app?.id ? { id: kept.app.id, name: kept.app.name || null } : null, guild: kept.guild || null, team: kept.guild ? { id: kept.guild.id, name: kept.guild.name } : null, guilds: kept.guilds || [], intents: intents(), tokens: kept.token ? { bot: masked(kept.token) } : null, invite: kept.app?.id ? invite(kept.app.id, webhooks ? SHARED_PERMISSIONS : PERMISSIONS) : null })

  // A new token: checked with Discord before it's kept (who the bot is, that it's a bot, its
  // privileged intents, the servers it's in), so a wrong one is said at once. Another bot's: where
  // it got to in the last one's conversations goes.
  async function setToken({ token, guild = null } = {}) {
    const t = String(token || '').trim().replace(/^Bot\s+/i, '')
    if (t.length < 20 || /\s/.test(t)) throw new Error('That doesn\'t look like a bot token: it\'s in the Developer Portal, your app › Bot › Reset Token')
    const { me, app } = await whoami(t).catch((e) => { throw new Error(`The bot token: ${e.message}`) })
    if (!me?.bot) throw new Error('That token isn\'t a bot\'s: copy it from your app › Bot in the Developer Portal')
    const servers = await call('GET', '/users/@me/guilds', { token: t }).catch(() => [])
    const other = !!kept.bot?.id && kept.bot.id !== me.id
    const base = other ? {} : kept
    const list = (servers || []).map((g) => ({ id: g.id, name: g.name }))
    const home = (guild && list.find((g) => g.id === String(guild))) || (base.guild && list.find((g) => g.id === base.guild.id)) || (list.length === 1 ? list[0] : null)
    kept = { ...base, token: t, bot: { id: me.id, name: me.global_name || me.username, username: me.username }, app: { id: app?.id || me.id, flags: app?.flags ?? null, name: app?.name || null }, guilds: list, guild: home, since: other || !base.since ? String(Date.now()) : base.since }
    save()
    memo = { at: 0, list: null }
    members.clear()
    const was = hear
    stop()
    if (was) start(was)
    return state()
  }
  // The server it answers in, of those it's in.
  async function setGuild(gid) {
    const g = (kept.guilds || []).find((x) => x.id === String(gid))
    if (!g) throw new Error('The bot isn\'t in that server')
    kept.guild = { ...g }
    save()
    memo = { at: 0, list: null }
    members.clear()
    return state()
  }
  function forget() {
    stop()
    clearTimeout(marking)
    marking = null
    kept = {}
    try { fs.rmSync(FILE, { force: true }) } catch { /* gone */ }
    memo = { at: 0, list: null }
    members.clear()
    set({ state: 'no-tokens', why: null })
  }

  // Test this connection's Discord part (conncheck.js): its token (who the bot is), and you there,
  // with your direct messages with the bot opening (nothing posted). Each { id, label, state, detail, fix }.
  async function check({ owner = null } = {}) {
    const out = []
    if (!kept.token) {
      out.push({ id: 'tokens', label: 'Tokens', state: 'fail', detail: 'No bot token yet', fix: 'Paste the bot token from the Discord Developer Portal (Bot › Reset Token)' })
      out.push({ id: 'owner', label: 'You here', state: 'skip', detail: 'Needs the token first', fix: null })
      return out
    }
    try {
      const { me } = await whoami()
      out.push({ id: 'tokens', label: 'Tokens', state: 'ok', detail: `@${me?.username || 'the bot'}${kept.guild?.name ? ` in ${kept.guild.name}` : ''}`, fix: null })
    } catch (e) {
      out.push({ id: 'tokens', label: 'Tokens', state: 'fail', detail: `The bot token: ${e.message}`, fix: 'Reset the token in the Developer Portal (Bot › Reset Token) and paste the new one' })
      out.push({ id: 'owner', label: 'You here', state: 'skip', detail: 'Needs a working token first', fix: null })
      return out
    }
    if (!owner?.id) out.push({ id: 'owner', label: 'You here', state: 'warn', detail: 'Nobody is linked as you here: your bots don\'t know it\'s you', fix: 'Make a code under You Here, then send it to the bot in a direct message' })
    else {
      try {
        await call('POST', '/users/@me/channels', { body: { recipient_id: String(owner.id) }, waits: 1 })
        out.push({ id: 'owner', label: 'You here', state: 'ok', detail: `${owner.name || owner.id}, and your direct messages with the bot open`, fix: null })
      } catch (e) { out.push({ id: 'owner', label: 'You here', state: 'fail', detail: `${owner.name || owner.id} is linked, but your direct messages with the bot don't open: ${e.message}`, fix: 'Share a server with the bot, and allow direct messages from its members' }) }
    }
    return out
  }

  return {
    id, label: 'Discord', platform: 'discord',
    caps: { react: true, edit: true, typing: true, threads: true, history: true },
    start, stop, state, post, edit, react, typing, whisper, context, people, channels, person, setToken, setGuild, forget, missed, check,
  }
}
