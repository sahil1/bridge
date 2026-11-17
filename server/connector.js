// A bot's way in and out of a chat service (Bots, a beta feature), the same shape for each: Slack
// (slackbot.js), Discord (discordbot.js) and Microsoft Teams (teamsbot.js). The front desk
// (frontdesk.js) talks to one channel per bot; combine() below makes one channel of several, so a
// bot can answer in Slack, Discord and Teams at once without the desk telling them apart, except
// where it should: who asked, and where (each message says its platform).
//
// A connector is an object:
//   id, label, platform     the bot's id, 'Discord', 'discord'
//   caps                    what the service lets a bot do: { react, edit, typing, threads, history }
//   start(hear)             connect, and stay connected; hear(m) for each message put to the bot
//                           (heard() below says what m is); hear.change(m) for an edit or deletion
//                           in a thread it follows ({ kind, channel, ts, thread, from, text, before })
//   stop()
//   state()                 { state: 'off' | 'no-tokens' | 'connecting' | 'connected' |
//                           'reconnecting' | 'error', why, since, ... } for Settings
//   post(reply, text)       a reply where the question was asked: { ts, channel, parts }; throws
//                           an Error with a code (below) and, for 'ratelimited', retryAfter (seconds)
//   edit(posted, text)      a reply posted before (what post() gave), changed
//   react({ channel, ts, name, off })   a reaction (by its Slack name: eyes, white_check_mark,
//                           hourglass_flowing_sand) on a message, or off it; where a service has no
//                           reactions for bots (Teams), what stands for one, or nothing, said so
//   typing(reply)           "working on it", where the service shows that
//   context({ channel, thread, ts, since, dm })   the conversation it was asked in, as context:
//                           { kind: 'thread' | 'channel' | 'dm', messages: [{ ts, person, text, you }],
//                           pins, problem }
//   people()                who can be picked to ask: [{ id, name, detail }]
//   person(id)              one person, as heard() gives them
//   forget()                its secrets and what it kept, gone
//
// Errors a connector throws carry a code the desk acts on: those it tries again (TRY_AGAIN) and
// the rest, which it doesn't (a token turned down, a channel gone).
//
// Who asked is always one shape, so the desk's rule for who may ask is the same everywhere and
// fails closed: someone the service couldn't say who they are is unknown, and refused, like a guest
// or someone from another organization. A connector sets guest, external and unknown from what the
// service says (Slack: is_restricted, another team; Discord: a member still to pass the server's
// screening, someone not in its server; Teams: a guest account, another organization's tenant), and
// person() below makes sure what it gives can't be read as more than it is.

export const PLATFORMS = { slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams' }
// The errors the desk tries again, later (frontdesk.js TRY_AGAIN has the same).
export const TRY_AGAIN = new Set(['ratelimited', 'offline', 'http_500', 'http_502', 'http_503', 'http_504', 'internal_error', 'fatal_error', 'service_unavailable', 'request_timeout'])
// Reactions by their Slack names (what the desk asks for), as the others write them.
export const REACTIONS = { eyes: '👀', white_check_mark: '✅', hourglass_flowing_sand: '⏳', x: '❌', thumbsup: '👍' }

const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
export const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.() })
// An error with a code, for the desk (and how long to wait, for a rate limit).
export const failure = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra })
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
//   { platform, ts, channel, thread, mention, dm, from, text, place: { kind: 'dm' | 'channel', id,
//     name }, at, late, reply, attachments: [{ id, name, type, size }] }
// ts and channel make it unique (one heard twice is one); thread the thread it's a reply in (null
// at the top); reply what post() needs to answer it where it was; attachments named only, never
// fetched here.
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
    mention: m.mention === true, dm,
    from: person(m.from),
    text: String(m.text ?? ''),
    place: { kind: dm ? 'dm' : 'channel', id: String(m.place?.id || channel), name: m.place?.name ? clip(m.place.name, 120) : null, ...(m.place?.within ? { within: clip(m.place.within, 120) } : {}) },
    at, late: m.late === true,
    reply: m.reply && typeof m.reply === 'object' ? m.reply : null,
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

// ---------- Several connectors as one channel ----------
// One bot answering in more than one place: a channel of the desk made of a connector for each
// (any of slack, discord, teams). The desk sees one channel. Ids are kept apart by platform: a
// Slack conversation's and person's ids as Slack gives them (so a bot's record from before stays
// as it was), a Discord or Teams one's with its platform before it (discord:123, teams:19:…), and
// each message, reply and connection event says its platform.
// make: { slack: (cb) => connector, ... }, each given its own callbacks:
//   say(e)                  what happened to its connection (e.platform added)
//   threads()               the threads it's answering in on that platform
//   follows(channel, thread)
const OWN = (p) => (p === 'slack' ? null : `${p}:`)
export const idOf = (platform, id) => (id == null ? id : OWN(platform) ? `${OWN(platform)}${id}` : String(id))
export const platformOf = (id) => { const m = /^(discord|teams):/.exec(String(id ?? '')); return m ? m[1] : 'slack' }
export const bare = (id) => String(id ?? '').replace(/^(discord|teams):/, '')

export function combine({ id = 'bot', say = () => {}, threads = () => [], follows = () => false } = {}, make = {}) {
  const parts = {}
  for (const [p, mk] of Object.entries(make)) {
    if (!PLATFORMS[p] || typeof mk !== 'function') continue
    parts[p] = mk({
      say: (e) => say({ ...e, platform: p }),
      threads: async () => (await Promise.resolve(threads()).catch(() => [])).filter((t) => platformOf(t.channel) === p).map((t) => ({ ...t, channel: bare(t.channel) })),
      follows: (channel, thread) => follows(idOf(p, channel), thread),
    })
  }
  const of = (channel) => { const p = platformOf(channel); const c = parts[p]; if (!c) throw failure(`This bot isn't connected to ${PLATFORMS[p]}`, 'channel_not_found'); return c }
  const inbound = (p, m) => {
    const x = heard(m, p)
    if (!x) return null
    return { ...x, channel: idOf(p, x.channel), from: { ...x.from, id: idOf(p, x.from.id) }, place: { ...x.place, id: idOf(p, x.place.id), platform: p }, reply: x.reply ? { ...x.reply, platform: p } : null }
  }
  let hear = null
  return {
    id, label: Object.keys(parts).map((p) => PLATFORMS[p]).join(', ') || 'None', platforms: Object.keys(parts), parts,
    start(fn) {
      hear = fn
      for (const [p, c] of Object.entries(parts)) {
        const each = Object.assign((m) => { const x = inbound(p, m); return x && hear ? hear(x) : undefined }, {
          change: (m) => (hear?.change && m ? hear.change({ ...m, channel: idOf(p, m.channel), from: m.from ? { ...m.from, id: idOf(p, m.from.id) } : null, platform: p }) : undefined),
        })
        c.start(each)
      }
    },
    stop() { hear = null; for (const c of Object.values(parts)) c.stop() },
    // The first platform's state at the top (as the desk and Settings read one channel's), and each one's.
    state() {
      const each = Object.fromEntries(Object.entries(parts).map(([p, c]) => [p, c.state()]))
      const first = Object.values(each)[0] || { state: 'off' }
      return { ...first, platforms: each }
    },
    // (What was posted says where, so an edit of it goes back the same way.)
    async post(reply, text) {
      const p = reply?.platform || 'slack'
      const r = await of(idOf(p, reply?.channel)).post(reply, text)
      return r && typeof r === 'object' ? { ...r, platform: p } : r
    },
    edit: (posted, text) => of(idOf(posted?.platform || 'slack', posted?.channel)).edit?.(posted, text),
    react: ({ channel, ...rest }) => of(channel).react({ channel: bare(channel), ...rest }),
    typing: (reply) => of(idOf(reply?.platform || 'slack', reply?.channel)).typing?.(reply),
    context: ({ channel, ...rest }) => of(channel).context({ channel: bare(channel), ...rest }),
    // Everyone who can be picked, on each platform; a platform that couldn't list them says why
    // (out.problems), and so does one that could list only some (a list's own problem).
    async people(o) {
      const out = []
      const problems = []
      for (const [p, c] of Object.entries(parts)) {
        try {
          const list = await c.people(o)
          for (const x of list) out.push({ ...x, id: idOf(p, x.id), platform: p })
          if (list.problem) problems.push({ platform: p, problem: list.problem })
        } catch (e) { problems.push({ platform: p, problem: e.message }) }
      }
      return Object.assign(out, { problems })
    },
    person: (pid) => of(pid).person?.(bare(pid)),
    forget() { for (const c of Object.values(parts)) c.forget?.() },
  }
}
