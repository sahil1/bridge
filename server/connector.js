// A bot's way in and out of a chat service (Bots, a beta feature): Slack (slackbot.js), Discord
// (discordbot.js) and Microsoft Teams (teamsbot.js), each one app, a connection (connections.js),
// that may reach several bots (connhub.js says which bot a question is for). The front desk
// (frontdesk.js) talks to one channel per bot, the object its header describes (post, react, status, whisper, askOwner and
// settle, context, download, people, channels, and hear with change, act and draft); combine() below
// makes that one channel of a connector for each place the bot answers, so a bot can answer in
// Slack, Discord and Teams at once and the desk tells them apart only where it should: who asked,
// where, and what each platform can do (capsOf).
//
// Discord's and Teams' connectors do what Slack's does, less what's Slack's own: no buttons in your
// direct messages (askOwner, settle), no "working" status and Stop, no streaming, no files in, no
// /command, shortcut or Home tab; files out are Discord's attachments, and none in Teams (botfiles.js
// says so in the reply). Each has:
//   id, label, platform     the bot's id, 'Discord', 'discord'
//   caps                    what the service lets a bot do: { react, edit, typing, threads, history }
//   start(hear)             connect, and stay connected; hear(m) for each message put to the bot
//                           (heard() below says what m is); hear.change(m) for an edit or deletion
//   stop(), state(), forget()
//   post(reply, text, { files })   a reply where the question was asked, or at the top of a channel
//                           (a scheduled post): { ts, channel, parts, files }; throws an Error with
//                           a code (below) and, for 'ratelimited', retryAfter (seconds). files
//                           (Discord's): attached after the words, each one that couldn't go said
//                           in files[] ({ name, size, ok, error }), not thrown
//   edit(posted, text)      a reply posted before (what post() gave), changed
//   react({ channel, ts, name, off })   a reaction by its Slack name (eyes, white_check_mark,
//                           hourglass_flowing_sand), or off it; Teams has none for bots: { skipped }
//   typing(reply), whisper(reply, user, text)   "typing…"; a word to that person only (their
//                           direct messages with the bot)
//   context({ channel, thread, ts, since, dm }), people(), channels(), person(id)
//
// Errors carry a code the desk acts on: those it tries again (TRY_AGAIN) and the rest, which it
// doesn't (a token turned down, a channel gone).
//
// Who asked is always one shape, so the desk's rule for who may ask is the same everywhere and
// fails closed: someone the service couldn't say who they are is unknown, and refused, like a guest
// or someone from another organization. A connector sets guest, external and unknown from what the
// service says (Slack: is_restricted, another team; Discord: a member still to pass the server's
// screening, someone not in its server; Teams: a guest account, another organization's tenant), and
// person() below makes sure what it gives can't be read as more than it is.

import { makeSlack, SCOPES as SLACK_SCOPES, SHARED_SCOPES } from './slackbot.js'
import { makeDiscord } from './discordbot.js'
import { makeTeams } from './teamsbot.js'

// ---------- The platforms, in one place ----------
// Each platform a connection can be on, and everything about it that isn't its connector's own: its
// name, the prefix its ids carry in the desk's records (Slack's none, so a bot's record from before
// is as it was), what a person's and a place's id look like there (bare, as the platform gives
// them), which of its places are public by their id alone (a Discord or Teams channel is public to
// its server or team unless it says it's private), what it can do besides answering in place, and
// how its connector is made (make(c, cb, o): c the connection, cb the hub's callbacks, o.file where
// its tokens are kept, o.port a Teams listener's). A new platform (Telegram, next) is an entry here
// and its connector: the ids, names and checks elsewhere come from this. COMING: one listed as on its
// way, with nothing to set up yet.
export const REGISTRY = {
  slack: {
    label: 'Slack', prefix: '', person: /^[UW][A-Z0-9]{2,20}$/, place: /^[CGD][A-Z0-9]{2,20}$/,
    publicId: (id) => /^C/.test(id), dmId: (id) => /^D/.test(id),
    caps: { files: true, stream: true, status: true, owner: true, react: true, link: true },
    make: (c, cb, o) => makeSlack({ id: c.id, file: o.file, ...cb, wanted: c.shared ? SHARED_SCOPES : SLACK_SCOPES }),
  },
  discord: {
    label: 'Discord', prefix: 'discord:', person: /^\d{1,25}$/, place: /^\d{1,25}$/,
    publicId: () => true, dmId: () => false,
    caps: { files: true, stream: false, status: false, owner: false, react: true, link: true },
    make: (c, cb, o) => makeDiscord({ id: c.id, file: o.file, ...cb, webhooks: c.shared }),
  },
  teams: {
    label: 'Microsoft Teams', prefix: 'teams:', person: /^[\w-]{6,64}$/, place: /^[^\s"<>]{3,300}$/,
    publicId: () => true, dmId: () => false,
    caps: { files: false, stream: false, status: false, owner: false, react: false, link: true },
    make: (c, cb, o) => makeTeams({ id: c.id, file: o.file, ...cb, defaultPort: o.port }),
  },
}
export const COMING = { telegram: 'Telegram' }
const KINDS = Object.keys(REGISTRY)
export const PLATFORMS = Object.fromEntries(KINDS.map((p) => [p, REGISTRY[p].label]))
// What each can do besides answering in place: Slack's own features are Slack's only.
export const CAPS = Object.fromEntries(KINDS.map((p) => [p, REGISTRY[p].caps]))
// A person's or a place's id as the desk keeps it, on any platform: its prefix, then its own id.
const body = (re) => re.source.replace(/^\^/, '').replace(/\$$/, '')
const anyOf = (k) => new RegExp(`^(${KINDS.map((p) => `${REGISTRY[p].prefix}${body(REGISTRY[p][k])}`).join('|')})$`)
export const PERSON_ID = anyOf('person')
export const CHANNEL_ID = anyOf('place')
// Whether an id kept by the desk is a person's or a place's (platform: on that one only).
export const personOk = (id, platform = null) => PERSON_ID.test(String(id ?? '')) && (!platform || platformOf(id) === platform)
export const placeOk = (id, platform = null) => CHANNEL_ID.test(String(id ?? '')) && (!platform || platformOf(id) === platform)
// A place everyone there can read: a channel not said to be private, of a kind public by its id.
export const isPublic = (place) => place?.kind === 'channel' && place.private !== true && !!REGISTRY[platformOf(place.id)]?.publicId(bare(place.id))
// A connection's connector, as its platform makes it (connections.js has the connection).
export function makeConnector(c, cb, o = {}) {
  const r = REGISTRY[c?.platform]
  if (!r) throw failure(`Bridge AI can't connect to ${COMING[c?.platform] || c?.platform || 'that'} yet`, 'not_supported')
  return r.make(c, cb, o)
}
// The errors the desk tries again, later (frontdesk.js TRY_AGAIN has the same).
export const TRY_AGAIN = new Set(['ratelimited', 'offline', 'http_500', 'http_502', 'http_503', 'http_504', 'internal_error', 'fatal_error', 'service_unavailable', 'request_timeout'])
// Reactions by their Slack names (what the desk asks for), as the others write them.
export const REACTIONS = { eyes: '👀', white_check_mark: '✅', hourglass_flowing_sand: '⏳', x: '❌', thumbsup: '👍' }

const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
export const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.() })
// An error with a code, for the desk (and how long to wait, for a rate limit).
export const failure = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra })
// Why a platform couldn't be reached at all (a request that never got an answer), in words a person
// reads on a card: never the network library's own codes (ENOTFOUND, UND_ERR_SOCKET…).
export function unreached(e) {
  const c = String(e?.cause?.code || e?.code || '')
  if (e?.name === 'TimeoutError' || e?.cause?.name === 'TimeoutError' || /TIMEOUT|ETIMEDOUT/.test(c)) return 'it didn\'t answer in time'
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN/.test(c)) return 'this computer seems to be offline'
  if (/ECONNREFUSED|ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED/.test(c)) return 'the connection was cut off'
  if (/CERT|SSL|TLS/i.test(c)) return 'the connection wasn\'t secure (a proxy or firewall may be in the way)'
  return 'the network didn\'t let it through'
}
// What to do when it couldn't be reached: nothing about tokens, which weren't checked.
export const UNREACHED_FIX = 'Check this computer\'s internet connection, then test again: its tokens couldn\'t be checked until then'
// A secret shown: its last four, never the rest.
export const masked = (t, kind = '') => (t ? `${kind}…${String(t).slice(-4)}` : null)

// Who asked, as the desk takes them: { id, name, guest, external, unknown, why }. Anything less
// than an id the service gave is unknown, and so is anything said to be unknown; guest and
// external are true only when said, and never make someone less refused.
export function person(p) {
  const id = p && p.id != null && String(p.id).trim() ? String(p.id).trim() : null
  const out = { id, name: p?.name ? clip(p.name, 80) : null, guest: p?.guest === true, external: p?.external === true, unknown: !id || p?.unknown === true }
  if (out.unknown) out.why = clip(p?.why || (id ? 'The service couldn\'t say who they are' : 'The message didn\'t say who sent it'), 300)
  else if (p?.why) out.why = clip(p.why, 300)
  return out
}

// A message put to the bot, as the desk takes it, or null when it's malformed (no id, no place):
//   { platform, ts, channel, thread, mention, dm, via, from, text, place: { kind: 'dm' | 'channel',
//     id, name, within, private }, at, late, reply, top, attachments: [{ id, name, type, size }] }
// ts and channel make it unique (one heard twice is one); thread the thread it's a reply in (null
// at the top); via 'listen' for a channel it answers in without a mention; reply what post() needs
// to answer it where it was (in a thread of its own, for one at the top of a channel); top, for one
// at the top of a channel, what post() needs to answer it in the channel itself instead (Answer In,
// bots.js); attachments named only, never fetched here.
export function heard(m, platform) {
  if (!m || typeof m !== 'object') return null
  const ts = m.ts != null ? String(m.ts) : ''
  const channel = m.channel != null ? String(m.channel) : ''
  if (!ts || !channel) return null
  const at = Number.isFinite(Date.parse(m.at)) ? new Date(Date.parse(m.at)).toISOString() : new Date().toISOString()
  const dm = m.dm === true
  return {
    platform: platform || m.platform || null,
    ts, channel, thread: m.thread != null && String(m.thread) ? String(m.thread) : null,
    mention: m.mention === true, dm, ...(m.via === 'listen' ? { via: 'listen' } : {}),
    // (Which bot a shared connection gave it to, and why: connhub.js.)
    ...(m.routed && typeof m.routed === 'object' ? { routed: { by: String(m.routed.by || ''), connection: clip(m.routed.connection, 40), ...(m.routed.command ? { command: clip(m.routed.command, 40) } : {}), ...(m.routed.detail ? { detail: clip(m.routed.detail, 120) } : {}) } } : {}),
    from: person(m.from),
    text: String(m.text ?? ''),
    place: { kind: dm ? 'dm' : 'channel', id: String(m.place?.id || channel), name: m.place?.name ? clip(m.place.name, 120) : null, ...(m.place?.within ? { within: clip(m.place.within, 120) } : {}), ...(m.place?.private ? { private: true } : {}) },
    at, late: m.late === true,
    reply: m.reply && typeof m.reply === 'object' ? m.reply : null,
    ...(m.top && typeof m.top === 'object' && !dm ? { top: m.top } : {}),
    attachments: Array.isArray(m.attachments) ? m.attachments.slice(0, 20).map((a) => ({ id: a?.id != null ? String(a.id) : null, name: clip(a?.name || 'file', 200), type: a?.type ? String(a.type).slice(0, 100) : null, size: Number.isFinite(a?.size) ? a.size : null })) : [],
  }
}

// A reply too long for one message (Discord's 2,000 characters), in parts: split where a paragraph,
// then a line, then a sentence, then a word ends, and a code block cut in two closed and opened
// again so each part shows as it should.
export function split(text, max) {
  const out = []
  let rest = String(text ?? '')
  let open = null // a code block's opening fence, carried into the next part
  while (rest.length) {
    const head = open ? `${open}\n` : ''
    const room = max - head.length - 4 // (room for a closing fence)
    if (head.length + rest.length <= max) { out.push(head + rest); break }
    let cut = -1
    for (const re of [/\n\s*\n/g, /\n/g, /[.!?](?=\s)/g, /\s/g]) {
      let m
      re.lastIndex = 0
      while ((m = re.exec(rest)) && m.index < room) cut = m.index + (m[0].trim() ? m[0].length : 0)
      if (cut > room / 3) break
      cut = -1
    }
    if (cut <= 0) cut = room
    let part = head + rest.slice(0, cut).trimEnd()
    rest = rest.slice(cut).replace(/^\s*\n/, '').replace(/^ +/, '')
    const fences = part.match(/^```.*$/gm) || []
    if (fences.length % 2 === 1) { open = fences.at(-1).trim(); part += '\n```' } else open = null
    out.push(part)
  }
  return out.length ? out : ['']
}

// Which of two message ids is later: Slack's (seconds.micro), Discord's (64-bit integers, too big
// for a Number) and Teams' (milliseconds, or not numbers at all, which are never later).
export function laterTs(a, b) {
  const x = String(a ?? '')
  const y = String(b ?? '')
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return BigInt(x) > BigInt(y)
  const nx = Number(x)
  const ny = Number(y || 0)
  return Number.isFinite(nx) && Number.isFinite(ny) && nx > ny
}

// ---------- Several connectors as one channel ----------
// One bot answering in more than one place: the desk's channel, made of a connector for each (any
// of slack, discord, teams). Slack's ids are as Slack gives them, so a bot's record from before is
// as it was, and Slack's messages pass through untouched; a Discord or Teams conversation's and
// person's ids have the platform before them (discord:123, teams:19:…), and each of their messages,
// replies and connection events says its platform. What's Slack's own (your direct messages'
// buttons, files, its Home tab) goes to Slack only.
// cb: { id, say, threads, follows, listens }, the desk's (with ids as the desk keeps them).
// make: { slack: (cb) => connector, discord: …, teams: … }, each given its own callbacks, with its
// own ids.
const OWN = (p) => REGISTRY[p]?.prefix || null
const PREFIX = new RegExp(`^(${KINDS.filter((p) => REGISTRY[p].prefix).join('|')}):`)
export const idOf = (platform, id) => (id == null ? id : OWN(platform) && !String(id).startsWith(OWN(platform)) ? `${OWN(platform)}${id}` : String(id))
export const platformOf = (id) => { const m = PREFIX.exec(String(id ?? '')); return m ? m[1] : 'slack' }
export const bare = (id) => String(id ?? '').replace(PREFIX, '')
// The platform of a person or place kept by the desk, as words.
export const platformName = (id) => PLATFORMS[platformOf(id)]

export function combine({ id = 'bot', say = () => {}, threads = () => [], follows = () => false, listens = () => false } = {}, make = {}) {
  const parts = {}
  for (const p of KINDS) {
    const mk = make[p]
    if (typeof mk !== 'function') continue
    parts[p] = mk({
      say: (e) => say(p === 'slack' ? e : { ...e, platform: p }),
      threads: async () => (await Promise.resolve(threads()).catch(() => [])).filter((t) => platformOf(t.channel) === p).map((t) => ({ ...t, channel: bare(t.channel) })),
      follows: (channel, thread) => follows(idOf(p, channel), thread),
      listens: (channel) => listens(idOf(p, channel)),
    })
  }
  const of = (p) => { const c = parts[p]; if (!c) throw failure(`This bot isn't set up for ${PLATFORMS[p] || p}`, 'channel_not_found'); return c }
  const where = (reply) => reply?.platform || platformOf(reply?.channel)
  const own = (reply) => (reply ? { ...reply, channel: bare(reply.channel) } : reply)
  // A Discord or Teams message, its ids made the desk's; Slack's as they are.
  const inbound = (p, m) => {
    if (p === 'slack') return m ? { ...m, platform: 'slack' } : m
    const x = heard(m, p)
    if (!x) return null
    const { attachments, ...rest } = x // (files are Slack's only: named in the record, never read)
    return {
      ...rest, channel: idOf(p, x.channel), from: { ...x.from, id: idOf(p, x.from.id) }, ...(Array.isArray(x.mentions) ? { mentions: x.mentions.map((u) => ({ ...u, id: idOf(p, u.id) })) } : {}),
      place: { ...x.place, id: idOf(p, x.place.id), platform: p }, reply: x.reply ? { ...x.reply, platform: p } : null, ...(x.top ? { top: { ...x.top, platform: p } } : {}),
      ...(attachments.length ? { attached: attachments.map((a) => a.name) } : {}),
    }
  }
  let hear = null
  const connectedOf = (p) => parts[p]?.state().state === 'connected'
  const order = ['connected', 'connecting', 'reconnecting', 'error', 'no-tokens', 'off']
  return {
    id, label: Object.keys(parts).map((p) => PLATFORMS[p]).join(', ') || 'None', platforms: Object.keys(parts), parts,
    start(fn) {
      hear = fn
      for (const [p, c] of Object.entries(parts)) {
        const each = Object.assign((m) => { const x = inbound(p, m); return x && hear ? hear(x) : undefined }, {
          change: (m) => (hear?.change && m ? hear.change(p === 'slack' ? m : { ...m, channel: idOf(p, m.channel), from: m.from ? { ...m.from, id: idOf(p, m.from.id) } : null, platform: p }) : undefined),
          ...(p === 'slack' ? { act: (a) => hear?.act?.(a), draft: (q) => hear?.draft?.(q) } : {}),
        })
        c.start(each)
      }
    },
    stop(o) { hear = null; for (const c of Object.values(parts)) c.stop(o) },
    // Slack's state at the top (as the desk and Settings read it: its team, scopes and tokens), its
    // state the best of any platform's (connected if any is), and each one's.
    state() {
      const each = Object.fromEntries(Object.entries(parts).map(([p, c]) => [p, c.state()]))
      const top = each.slack || Object.values(each)[0] || { state: 'off' }
      const best = Object.entries(each).sort(([, a], [, b]) => order.indexOf(a.state) - order.indexOf(b.state))[0]?.[1] || top
      // (One that can't go on until something's fixed is said even while another is connected.)
      const stuck = Object.entries(each).find(([, s]) => s.state === 'error')
      return { ...top, state: best.state, why: best.state === top.state ? top.why : best.why, platforms: each, ...(stuck && best.state === 'connected' ? { stuck: { platform: stuck[0], why: stuck[1].why } } : {}) }
    },
    connected: (p = null) => (p ? connectedOf(p) : Object.keys(parts).some(connectedOf)),
    // What the platform a conversation's in can do.
    capsOf: (channel) => CAPS[platformOf(channel)] || CAPS.slack,
    async post(reply, text, o = {}) {
      const p = where(reply)
      const r = await of(p).post(own(reply), text, p === 'slack' ? o : p === 'discord' && o.files?.length ? { files: o.files } : {})
      return r && typeof r === 'object' ? { files: [], ...r, platform: p } : r
    },
    edit: (posted, text) => of(where(posted)).edit?.(own(posted), text),
    react: ({ channel, ...rest }) => of(platformOf(channel)).react({ channel: bare(channel), ...rest }),
    // Slack's "working" status and Stop; nothing elsewhere (null: not shown, nothing to record).
    status: async (reply, onOff) => { const p = where(reply); return p === 'slack' && parts.slack?.status ? parts.slack.status(own(reply), onOff) : null },
    whisper: (reply, user, text) => { const p = where(reply); const c = of(p); if (!c.whisper) throw failure(`${PLATFORMS[p]} has no way to tell one person only`, 'not_supported'); return c.whisper(own(reply), bare(user), text) },
    typing: (reply) => of(where(reply)).typing?.(own(reply)),
    // (The people its messages mention, by the desk's ids, as a question's are.)
    context: async ({ channel, ...rest }) => {
      const p = platformOf(channel)
      const r = await of(p).context({ channel: bare(channel), ...rest })
      if (p === 'slack' || !r) return r
      const ids = (m) => (Array.isArray(m?.mentions) ? { ...m, mentions: m.mentions.map((u) => ({ ...u, id: idOf(p, u.id) })) } : m)
      return { ...r, messages: (r.messages || []).map(ids), pins: (r.pins || []).map(ids) }
    },
    // Who's in a channel, where the platform says ([{ id, guest, external, unknown, bot }]); null
    // where it can't (only Slack's say).
    members: async (channel) => { const p = platformOf(channel); const c = parts[p]; if (!c?.members) return null; const list = await c.members(bare(channel)); return list ? list.map((m) => ({ ...m, id: idOf(p, m.id) })) : null },
    // People's emails (ids, as members gives them), where the platform says (Slack, with
    // users:read.email): { can, emails: { id: email | null } }; null where it can't.
    emails: async (ids, channel) => {
      const p = platformOf(channel)
      const c = parts[p]
      if (!c?.emails) return null
      const r = await c.emails((ids || []).map(bare))
      return r ? { can: !!r.can, emails: Object.fromEntries(Object.entries(r.emails || {}).map(([k, v]) => [idOf(p, k), v])) } : null
    },
    // Slack's own: your direct messages' buttons, files attached.
    ...(parts.slack ? {
      askOwner: (owner, item) => parts.slack.askOwner(owner, item),
      settle: (handle, outcome) => parts.slack.settle(handle, outcome),
      download: (f) => parts.slack.download(f),
      setTokens: (t) => parts.slack.setTokens(t),
      dm: (...a) => parts.slack.dm(...a),
      missed: (...a) => parts.slack.missed(...a),
      masked: (...a) => parts.slack.masked(...a),
    } : {}),
    // Everyone who can be picked, on each platform; a platform that couldn't list them says why
    // (out.problems), and so does one that could list only some (a list's own problem).
    async people(o) {
      const out = []
      const problems = []
      for (const [p, c] of Object.entries(parts)) {
        if (c.state().state === 'no-tokens') continue
        try {
          const list = await c.people(o)
          for (const x of list) out.push({ ...x, id: idOf(p, x.id), platform: p })
          if (list.problem) problems.push({ platform: p, problem: list.problem })
        } catch (e) { problems.push({ platform: p, problem: e.message }) }
      }
      return Object.assign(out, { problems })
    },
    // The conversations it's in, on each platform that's connected: [{ id, name, private, platform }].
    async channels() {
      const out = []
      for (const [p, c] of Object.entries(parts)) {
        if (!c.channels || !connectedOf(p)) continue
        for (const x of await c.channels().catch(() => [])) out.push({ ...x, id: idOf(p, x.id), platform: p })
      }
      return out
    },
    person: (pid) => of(platformOf(pid)).person?.(bare(pid)),
    forget() { for (const c of Object.values(parts)) c.forget?.() },
  }
}
