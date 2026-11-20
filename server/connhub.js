// Connections at work (Bots, a beta feature): one connector a connection (connections.js), however
// many bots it reaches, and which bot each question on a shared one is for. Each bot still has its
// channel of the desk (connector.js combine), made of a view for each platform here: the view
// follows the bot to whichever connection it's on now (its own, or the shared one), posts as that
// bot (its name, and its icon where the platform lets an app post as someone else), and hands the
// question on once it's been routed.
//
// On a connection of one bot's own, every question is that bot's, as before connections. On a shared
// one, in this order:
//   1. a command: one of the bots' own slash commands (perBot), or the connection's with a bot's name
//      first ("/maya_bot pricing what's the price?");
//   2. the channel's bot, where you gave it one (defaults);
//   3. a bot's name at the start ("pricing: …", "Pricing Desk, …");
//   4. a reply in a thread goes to the bot that answered there;
//   5. in a direct message, the bot that person used last, unless the words name another;
//   6. otherwise, its Chief (chief: the bot you made the connection's Chief, while it's on it), if
//      that person may ask it (who may ask, not muted, not paused): the Chief answers, hands the
//      thread to one of the others (hand_to) or asks one of them as that person (ask_bot), each
//      under that bot's own rules for them (frontdesk.js);
//   7. with no Chief they may ask: among the bots they may ask there, with none, the polite no (or
//      nothing, where every bot says nothing); with one, that one; with more, it asks them: "Pricing
//      Desk or Docs Helper?", with buttons in Slack, and in words elsewhere.
// No model picks a bot from a question's words any more: the Chief, a bot you set up, does that.
// A message that only listens (a channel a bot answers in without a mention) goes to a bot that
// listens there (the Chief, when it's one of them). Your "continue 10" or "stop" in a direct message, answering a bot whose run waits
// on you at its time limit, goes to that bot before any of these (frontdesk.js owes). Nothing in a
// question can pick a bot the asker may not ask: whatever it names, that bot's rules apply after
// routing, as they always did (who may ask, channels, limits, folders, what answers, MCP), so a
// question that names one it may not ask gets that bot's polite no. The routing settings change
// only in Settings (and on its Routing page). Each decision is in the connection's own record
// (which bot, and why: "#sales's default"), never the question's words; the question is in that
// bot's record. Try a Message (dry) takes a message you make up through the same steps
// (route) and only says where it would go, and, for a bot that changes files, whether a change asked
// for would be made, wait for you, be held before it starts, or be refused: nothing posted, answered
// or kept, and no bot run. A bot that only reads may hand a change to files on to a bot that makes
// them (frontdesk.js handOff): that bot's rules then apply to whoever asked, as routing's do.
//
// Before any of it, a direct message that's a code you made to link yourself there (connections.js
// takeLink) makes whoever sent it you there, and goes no further. And what a connector says that you
// should hear about (the app not in a channel it was asked to post in, another copy of Bridge AI on
// the same app) is in the connection's record and its bots', and, in Slack, said to you in your
// direct messages with it, once a day for each.
import { idOf, bare, failure, PLATFORMS as NAMES } from './connector.js'
import * as conns from './connections.js'
import { commandOf, shortcutOf } from './slackbot.js'
import { placeEn } from '../shared/places.js'

// The steps above, in order, as the Connections page shows them.
export const RULES = ['command', 'default', 'name', 'thread', 'last', 'chief']
const PICK_MS = 24 * 3600 * 1000 // a question waiting for its asker to pick a bot
const PICKS_MAX = 200
const TOLD_MS = 24 * 3600 * 1000 // a problem said to you once a day at most, for each place
// What a connector says that's said to you too (slackbot.js say).
const TELL = new Set(['not-in-channel', 'another-copy'])
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
const low = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Words too common to name a bot by on their own.
const PLAIN = new Set(['the', 'bot', 'and', 'for', 'ask', 'help', 'desk', 'team', 'our', 'your', 'my', 'bridge'])

// Which bot the start of a message names, and the rest of it: a bot's whole name, or its command's
// name, then anything; a word of its name (one no other bot's has) followed by : or ,; and, after a
// slash command, that word alone. { bot, rest } or null.
export function namedAt(text, bots, { slash = false } = {}) {
  const t = String(text || '').replace(/^\s*@/, '')
  const words = new Map()
  for (const b of bots) for (const w of low(b.name).split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 3 && !PLAIN.has(x))) words.set(w, words.has(w) && words.get(w) !== b.id ? null : b.id)
  let best = null
  const take = (bot, len, rest) => { if (!best || len > best.len) best = { bot, len, rest } }
  for (const b of bots) {
    for (const key of new Set([low(b.name), commandOf(b.name).slice(1), commandOf(b.name).slice(1).replace(/[-_]+/g, ' ')])) {
      if (!key) continue
      const m = new RegExp(`^${esc(key)}(?=$|[\\s:,!?.—–-])[\\s:,—–-]*`, 'i').exec(low(t))
      if (m) take(b.id, key.length, t.slice(m[0].length))
    }
  }
  for (const [w, id] of words) {
    if (!id) continue
    const m = new RegExp(`^${esc(w)}(?:\\s*[:,—–]\\s*${slash ? '|\\s+' : ''})`, 'i').exec(low(t))
    if (m) take(id, w.length, t.slice(m[0].length))
  }
  return best ? { bot: best.bot, rest: best.rest.trim() } : null
}
// A bot named anywhere in a message by its whole name (one only), or null.
export function namedIn(text, bots) {
  const t = low(text)
  const hits = bots.filter((b) => new RegExp(`(^|[^\\p{L}\\p{N}])@?${esc(low(b.name))}($|[^\\p{L}\\p{N}])`, 'u').test(t))
  return hits.length === 1 ? hits[0].id : null
}

// bots(): the bots that answer (bots.js live). desk: the front desk (frontdesk.js): mayAsk(bot,
// from, channel) why it wouldn't answer them there (null: it would), follows, lastIn, threads,
// listens, note, politeNo, info. make(c, cb): the connector for a connection ({ say, threads,
// follows, listens, info }). you(): your name. enabled(): Bots is on (a shared connection with
// tokens stays connected then, bots on it or not, so it's set up once, before any bot is).
export function makeHubs({ bots, desk, make, you = () => 'the owner', enabled = () => true }) {
  const hubs = new Map() // connection id -> { connector, started, picks, told }
  const joins = new Map() // `${bot}:${platform}` -> the bot's hear for that platform (combine's)
  const botOf = (id) => bots().find((b) => b.id === id) || null
  // The bots a connection reaches that are listening now.
  const on = (c) => conns.botsOn(c, bots()).filter((b) => joins.has(`${b.id}:${c.platform}`))
  const named = (id) => botOf(id)?.name || id

  function hubOf(c) {
    let h = hubs.get(c.id)
    if (h) return h
    const p = c.platform
    h = { id: c.id, started: false, picks: new Map(), told: new Map(), hinted: new Set(), connector: null }
    h.connector = make(c, {
      say: (e) => {
        const now = conns.get(c.id)
        if (!now) return
        conns.note(c.id, { event: e.what, ok: !!e.ok, why: e.why ? clip(e.why, 300) : null })
        for (const b of conns.botsOn(now, bots())) desk.note(b.id, p === 'slack' ? e : { ...e, platform: p })
        if (TELL.has(e.what) && !e.ok) tellOwner(now, `${e.what}:${e.channel || ''}`, e.why).catch(() => {})
      },
      threads: async () => {
        const now = conns.get(c.id)
        const out = []
        for (const b of now ? on(now) : []) for (const t of await Promise.resolve(desk.threads(b.id)).catch(() => [])) if ((t.channel.startsWith('discord:') ? 'discord' : t.channel.startsWith('teams:') ? 'teams' : 'slack') === p) out.push({ ...t, channel: bare(t.channel) })
        return out
      },
      follows: (channel, thread) => { const now = conns.get(c.id); return !!now && on(now).some((b) => desk.follows(b.id, idOf(p, channel), thread)) },
      listens: (channel) => { const now = conns.get(c.id); return !!now && on(now).some((b) => desk.listens(b.id, idOf(p, channel))) },
      info: () => infoOf(c.id),
    })
    hubs.set(c.id, h)
    return h
  }

  // What Slack's Home tab says: a bot's own app, as before; a shared one, each bot it reaches and
  // how to ask each.
  function infoOf(cid) {
    const c = conns.get(cid)
    if (!c) return {}
    if (c.bot) { const b = botOf(c.bot); return b ? { ...desk.info(b.id), command: commandOf(b.name), shortcut: shortcutOf(b.name) } : {} }
    const list = conns.botsOn(c, bots())
    const x = desk.info(list[0]?.id) || {}
    return {
      name: c.name, you: you(), computer: x.computer || null, paused: false, command: commandOf(c.name), shortcut: shortcutOf(c.name), shared: true,
      bots: list.map((b) => ({ name: b.name, description: b.description || '', paused: b.paused, command: c.perBot ? commandOf(b.name) : null, channels: c.defaults.filter((d) => d.bot === b.id).map((d) => d.name || d.id) })),
    }
  }

  // Each connection's connector running while a bot on it listens (a shared one's while Bots is on),
  // and stopped once none does. A paused one isn't (connections.js): it runs on another computer.
  function sync() {
    const all = conns.list()
    for (const c of all) {
      const h = hubOf(c)
      const any = !c.paused && (on(c).length > 0 || (c.shared && enabled()))
      if (any && !h.started) { h.started = true; h.connector.start(dispatch(c.id)) } else if (!any && h.started) { h.started = false; h.connector.stop() }
    }
    for (const [id, h] of hubs) if (!all.some((c) => c.id === id)) { if (h.started) h.connector.stop(); hubs.delete(id) }
  }
  // Connect again (tokens changed, an app updated): stopped and started.
  function restart(cid) {
    const h = hubs.get(cid)
    if (!h) return sync()
    if (h.started) { h.started = false; h.connector.stop({ quiet: true }) }
    sync()
  }
  // Made again as the connection is now (a bot's own made the shared one: its connector asks the
  // platform for more), its tokens where they were.
  function renew(cid) {
    const h = hubs.get(cid)
    if (h) { if (h.started) { h.started = false; h.connector.stop({ quiet: true }) } hubs.delete(cid) }
    sync()
  }
  // Gone: its connector stopped and its tokens forgotten.
  function drop(cid) {
    const h = hubs.get(cid)
    if (h) { if (h.started) h.connector.stop(); h.connector.forget?.(); hubs.delete(cid) }
  }

  // ---------- A question in ----------
  const dispatch = (cid) => Object.assign((m) => heard(cid, m), {
    change: (m) => { const c = conns.get(cid); if (c) for (const b of on(c)) joins.get(`${b.id}:${c.platform}`)?.change?.(m) },
    act: (a) => acted(cid, a),
    draft: (q) => { const c = conns.get(cid); const b = /^(b\d+)-q/.exec(String(q || ''))?.[1]; return c && b ? joins.get(`${b}:${c.platform}`)?.draft?.(q) : null },
  })
  // To that bot, with why, in the connection's record (and who asked, and where, never what).
  function deliver(c, m, bot, why, { text = null, detail = null } = {}) {
    const each = joins.get(`${bot}:${c.platform}`)
    if (!each) return undefined
    if (c.shared) {
      conns.note(c.id, { bot, name: named(bot), why, ...(detail ? { detail } : {}), where: m.dm ? 'dm' : m.place?.name || null, who: m.from?.name || null })
      if (m.dm && m.from?.id) conns.setLast(c.id, m.from.id, bot)
    }
    return each({ ...m, ...(text != null ? { text } : {}), ...(c.shared ? { routed: { by: why, connection: c.name, ...(c.platform === 'slack' ? { command: commandOf(c.name) } : {}), ...(detail ? { detail } : {}) } } : {}) })
  }
  // Which bot a question is for, and why, by the rules above: { to, why, detail, text } to hand it
  // to that bot (text: what it's asked, its name taken off); { help } to list the bots; { none,
  // silent } when they may ask none; { ask } to ask them which; null when it's for none. Nothing is
  // done here: heard() acts on it, and Try a Message (dry) only says it. thread: the bot that
  // answered in the thread it's a reply in, when that's given rather than looked up.
  async function route(c, m, { thread: given } = {}) {
    const list = on(c)
    if (!list.length) return null
    if (!c.shared) return { to: list[0].id, why: 'own' }
    const p = c.platform
    const channel = idOf(p, m.channel)
    const from = m.from ? { ...m.from, id: m.from.id ? idOf(p, m.from.id) : null } : null
    const text = String(m.text || '')
    const ids = list.map((b) => b.id)
    const chief = conns.chiefOf(c, list)
    // Only listening: a bot that answers there without a mention, the one that may hear them (the
    // Chief first, when it's one of them).
    if (m.via === 'listen') {
      const there = list.filter((b) => desk.listens(b.id, channel))
      const may = there.filter((b) => !desk.mayAsk(b.id, from, channel))
      const to = may.find((b) => b.id === chief)?.id || may[0]?.id || there[0]?.id
      return to ? { to, why: 'listen' } : null
    }
    // A reply in a thread without a mention: the bot that answered there, or no one.
    const thread = given !== undefined ? given : m.thread ? latestIn(list, channel, m.thread) : null
    if (!m.mention && !m.dm) return thread ? { to: thread, why: 'thread' } : null
    // Your answer in a direct message to a bot's run at its time limit ("continue 10"): to that bot.
    const owed = m.dm ? desk.owes?.(from, p, text) : null
    if (owed) return { to: ids.includes(owed) ? owed : list[0].id, why: 'limit' }
    // 1. A command.
    if (m.command && m.command !== commandOf(c.name)) {
      const b = list.find((x) => commandOf(x.name) === m.command)
      if (b) return { to: b.id, why: 'command', detail: m.command }
    }
    const head = namedAt(text, list, { slash: m.via === 'slash' })
    if (m.via === 'slash' && head) return { to: head.bot, why: 'command', text: head.rest, detail: commandOf(c.name) }
    // !help, naming no bot: the bots here, and how to ask each.
    if (!head && /^\s*!\s*help\s*$/i.test(text)) return { help: list }
    // 2. The channel's bot.
    const def = !m.dm ? c.defaults.find((d) => d.id === channel && ids.includes(d.bot)) : null
    if (def) return { to: def.bot, why: 'default', detail: def.name || null }
    // 3. A name at the start.
    if (head) return { to: head.bot, why: 'name', text: head.rest }
    // 4. The thread's bot.
    if (thread) return { to: thread, why: 'thread' }
    // 5. A direct message: the bot they used last, unless they name another.
    if (m.dm) {
      const said = namedIn(text, list)
      if (said) return { to: said, why: 'name' }
      const last = from?.id ? conns.lastBot(c.id, m.from.id) : null
      if (last && ids.includes(last)) return { to: last, why: 'last' }
    }
    // A command naming no bot, where it's not clear which: the bots here.
    if (/^\s*!/.test(text) && list.length > 1) return { help: list }
    // 6. The Chief, if they may ask it.
    const may = list.filter((b) => !desk.mayAsk(b.id, from, channel) && !b.paused)
    if (chief && may.some((b) => b.id === chief)) return { to: chief, why: 'chief' }
    // 7. Among those they may ask: none, the polite no; one, that one; more, ask them which.
    if (!may.length) return { none: desk.mayAsk(list[0].id, from, channel), silent: list.every((b) => b.others === 'silent') }
    if (may.length === 1) return { to: may[0].id, why: 'only' }
    return { ask: may, detail: chief ? 'not-chief' : 'no-chief' }
  }
  async function heard(cid, m) {
    const c = conns.get(cid)
    if (!c || !m) return
    if (m.dm && !m.via && await linked(c, m)) return
    const r = await route(c, m)
    if (!r) return
    if (r.to) {
      const out = deliver(c, m, r.to, r.why, { text: r.text ?? null, detail: r.detail ?? null })
      // (Not from a bot that says nothing to whom it turns away.)
      if (botOf(r.to)?.others !== 'silent') hint(c, m, desk.mayAsk(r.to, fromOf(c, m), null))
      return out
    }
    if (r.help) return help(c, m, r.help)
    if (r.ask) return choose(c, m, r.ask)
    conns.note(c.id, { bot: null, why: 'none', detail: r.none, where: m.dm ? 'dm' : m.place?.name || null, who: m.from?.name || null })
    if (r.silent) return undefined
    const no = say(c, m, desk.politeNo(r.none === 'muted' || r.none === 'paused' ? 'not-allowed' : r.none))
    hint(c, m, r.none)
    return no
  }
  // Who sent it, with their id as the desk keeps ids.
  const fromOf = (c, m) => (m.from ? { ...m.from, id: m.from.id ? idOf(c.platform, m.from.id) : null } : null)

  // ---------- You there ----------
  // A code you made to link yourself (connections.js takeLink), sent in a direct message: whoever
  // sent it is you there now, and it goes to no bot (nor does a wrong one: they're told why). The
  // message isn't in any bot's record, its sender and the outcome in the connection's. true when
  // it was taken as a code.
  async function linked(c, m) {
    const p = c.platform
    const r = conns.takeLink(c.id, m.text, fromOf(c, m))
    if (!r) return false
    const how = `Make a new one in Bridge AI, under You Here in ${placeEn('connections')}`
    if (r.ok) {
      conns.note(c.id, { event: 'settings', what: 'owner', old: r.before?.name || null, new: r.owner?.name || null, how: 'link code', ...(m.place?.name ? { where: m.place.name } : {}) })
      for (const b of conns.botsOn(c, bots())) desk.note(b.id, { what: 'linked', ok: true, why: `${r.owner?.name || 'You'} linked as ${you()} on ${NAMES[p]} with a code`, ...(p === 'slack' ? {} : { platform: p }) })
      await say(c, m, `Linked: you're ${you()} here now, so ${conns.botsOn(c, bots()).length === 1 ? 'your bot knows' : 'your bots know'} it's you. Ask away.`)
      return true
    }
    conns.note(c.id, { event: 'link', ok: false, why: r.why, who: m.from?.name || null })
    await say(c, m, r.why === 'expired' ? `That code has run out. ${how}.`
      : r.why === 'spent' ? `That's five wrong codes, so it's cancelled. ${how}.`
        : r.why === 'who' ? 'That code links only a full member here, not a guest or someone from another organization, so it\'s cancelled.'
          : 'That isn\'t the code Bridge AI shows: check it and send it again.')
    return true
  }
  // With nobody linked as you there yet, a member turned away in a direct message (not a guest, not
  // someone from another organization: only one who isn't on the list) is told, once, how you'd link
  // yourself: it's how you find out, when you message your own bot before linking.
  function hint(c, m, why) {
    if (c.owner || !m.dm || !m.from?.id || why !== 'not-allowed') return
    const h = hubOf(c)
    const id = idOf(c.platform, m.from.id)
    if (h.hinted.has(id)) return
    h.hinted.add(id)
    say(c, m, `If you're ${you()}: link yourself, so your bots know it's you. In Bridge AI, open ${placeEn('connections')}, make a code under You Here, and send it to me here.`).catch(() => {})
  }
  // A problem you should hear of, in your direct messages with the app (Slack's), once a day for
  // each kind and place; in the connection's record whatever happens.
  async function tellOwner(c, key, why) {
    const h = hubOf(c)
    if (!why || !c.owner?.id || c.platform !== 'slack' || !h.connector.dm) return
    if (Date.now() - (h.told.get(key) || 0) < TOLD_MS) return
    h.told.set(key, Date.now())
    try { await h.connector.dm(bare(c.owner.id), why) } catch (e) { conns.note(c.id, { event: 'post', ok: false, why: clip(`Couldn't tell you: ${e.message}`, 300) }) }
  }
  // The bot that answered in a thread, the latest when more than one did.
  function latestIn(list, channel, thread) {
    let best = null
    for (const b of list) {
      if (!desk.follows(b.id, channel, thread)) continue
      const at = desk.lastIn(b.id, channel, thread) || ''
      if (!best || at > best.at) best = { id: b.id, at }
    }
    return best?.id || null
  }

  // ---------- Try a Message ----------
  // A message you make up (Test this connection's, or one you type), taken through route() as one
  // from the platform would be, and only said: which bot would take it and by which rule, what that
  // bot would be asked, and whether its own rules would then let them ask it (whatever a message
  // names, the bot's who may ask, muted and paused still hold). Nothing is posted, answered or noted
  // (the connection's record, a bot's, who used which bot last), and no bot runs. Yours only, as the routing settings are: an /api
  // route, never anything a question reaches. from: who's asking ({ id, name } there, or { you }),
  // null for someone not named; channel: its id there, or a direct message (dm); thread: the bot
  // that answered in the thread it's a reply in; mention: whether it mentions the app.
  async function dry(cid, { text = '', channel = null, channelName = null, dm = false, from = null, mention = true, thread = null } = {}) {
    const c = conns.get(cid)
    if (!c) return null
    const p = c.platform
    const list = on(c)
    const one = (id) => ({ id, name: botOf(id)?.name || id })
    const chief = conns.chiefOf(c, list)
    const out = { connection: { id: c.id, name: c.name, platform: p, shared: c.shared }, connected: hubs.get(c.id)?.connector?.state?.().state === 'connected', bots: list.map((b) => one(b.id)), chief: chief ? one(chief) : null }
    let words = String(text || '').slice(0, 4000)
    // A slash command typed first: the connection's own, or a bot's own where there's one for each.
    let via = null
    let command = null
    const slash = p === 'slack' ? /^\s*(\/[\w-]{1,32})(?:\s+([\s\S]*))?$/.exec(words) : null
    if (slash) {
      command = slash[1].toLowerCase()
      if (command !== commandOf(c.name) && !(c.shared && c.perBot && list.some((b) => commandOf(b.name) === command))) return { ...out, rule: 'nothing', detail: 'no-command', command }
      via = 'slash'
      words = slash[2] || ''
    }
    // (Ids as the platform gives them, as a message from there has them.)
    if (from?.id) from = { ...from, id: bare(from.id) }
    const where = dm ? null : channel ? bare(channel) : null
    const quiet = !via && !dm && mention === false
    const listen = quiet && !thread && !!where && list.some((b) => desk.listens(b.id, idOf(p, where)))
    const m = { text: words, channel: where, dm: !!dm, mention: !quiet, from, ...(via ? { via, command } : listen ? { via: 'listen' } : {}), ...(thread ? { thread: 'try' } : {}), place: dm ? { kind: 'dm' } : { name: channelName || null } }
    const tb = thread && list.some((b) => b.id === thread) ? thread : null
    const r = await route(c, m, { thread: tb })
    const who = from ? { ...from, id: from.id ? idOf(p, from.id) : null } : null
    const chan = where ? idOf(p, where) : null
    // Those they may ask there, as step 6 has them.
    out.may = list.filter((b) => !desk.mayAsk(b.id, who, chan) && !b.paused).map((b) => one(b.id))
    if (!r) return { ...out, rule: 'nothing', detail: !list.length ? 'no-bots' : 'no-mention' }
    if (r.help) return { ...out, rule: 'help' }
    if (r.ask) return { ...out, rule: 'asked', detail: r.detail || null, asks: r.ask.map((b) => one(b.id)) }
    if (!r.to) return { ...out, rule: 'none', detail: r.none || null, silent: !!r.silent }
    const b = botOf(r.to)
    // (And a change to files asked for: whether that bot would make it without asking you, wait for
    // you, hold it before it starts, or refuse them; for a bot that only reads, the same for each bot
    // it hands changes to, under that bot's own rules for the same person.)
    return { ...out, rule: r.why, detail: r.detail || null, bot: one(r.to), asked: r.text ?? words, then: { may: desk.mayAsk(r.to, who, chan), paused: !!b?.paused, write: desk.writeVerdict?.(r.to, who, chan, r.text ?? words) || null } }
  }

  // Said where it was asked, as the connection.
  async function say(c, m, text) {
    try { await hubOf(c).connector.post(m.reply, text) } catch (e) { conns.note(c.id, { event: 'post', ok: false, why: clip(e.message, 300) }) }
  }
  // "Pricing Desk or Docs Helper?": buttons in Slack, words elsewhere; the question waits for its
  // asker to pick (a day at most), then goes to the bot picked.
  async function choose(c, m, may) {
    const h = hubOf(c)
    const names = may.map((b) => b.name)
    const which = names.length === 2 ? `${names[0]} or ${names[1]}?` : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}?`
    conns.note(c.id, { bot: null, why: 'asked', detail: may.map((b) => b.id).join(','), where: m.dm ? 'dm' : m.place?.name || null, who: m.from?.name || null })
    if (c.platform === 'slack' && h.connector.choose) {
      const key = `${c.id}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      for (const [k, x] of h.picks) if (Date.now() - x.at > PICK_MS || h.picks.size > PICKS_MAX) h.picks.delete(k)
      h.picks.set(key, { m, at: Date.now(), asker: m.from?.id || null, bots: may.map((b) => b.id) })
      try {
        const posted = await h.connector.choose(m.reply, { text: `${which} Pick who should answer this.`, key, options: may.map((b) => ({ id: b.id, label: b.name })) })
        h.picks.get(key).handle = posted
      } catch (e) { h.picks.delete(key); conns.note(c.id, { event: 'post', ok: false, why: clip(e.message, 300) }) }
      return
    }
    return say(c, m, `${which} Say which, with its name first, like "${names[0]}: …".`)
  }
  // !help: the bots here, and how to ask each.
  function help(c, m, list) {
    const cmd = c.platform === 'slack' ? commandOf(c.name) : null
    const lines = [`I'm ${c.name}, ${you()}'s way to these bots in Bridge AI:`]
    for (const b of list) {
      const chans = c.defaults.filter((d) => d.bot === b.id).map((d) => (c.platform === 'slack' || c.platform === 'discord' ? `#${d.name || d.id}` : d.name || d.id))
      lines.push(`• ${b.name}${b.description ? `: ${b.description.replace(/\.$/, '')}` : ''}. Ask with "${b.name}: your question"${cmd ? ` or ${cmd} ${low(b.name).split(/\s+/)[0]} your question` : ''}${c.perBot && cmd ? ` or ${commandOf(b.name)}` : ''}${chans.length ? `; it answers in ${chans.join(', ')}` : ''}.`)
    }
    lines.push('A reply in a thread goes to the bot that answered there. Put a bot\'s name first for its commands, like "' + `${list[0].name}: !status".`)
    conns.note(c.id, { bot: null, why: 'help', where: m.dm ? 'dm' : m.place?.name || null, who: m.from?.name || null })
    return say(c, m, lines.join('\n'))
  }

  // A button pressed: a bot picked goes to that bot (by whoever asked, only); a draft's or a
  // learning's to the bot whose it is; Stop to the bot answering there.
  async function acted(cid, a) {
    const c = conns.get(cid)
    if (!c) return { ok: false, error: 'That connection isn\'t here any more' }
    const p = c.platform
    const list = on(c)
    const to = (bot) => joins.get(`${bot}:${p}`)
    if (a.act === 'pick') {
      const h = hubOf(c)
      const x = h.picks.get(String(a.key || ''))
      if (!x) return { ok: false, error: 'That question isn\'t waiting any more: ask it again' }
      if (x.asker && a.user?.id !== x.asker) return { ok: false, error: 'Only whoever asked can pick' }
      if (!x.bots.includes(a.bot) || !list.some((b) => b.id === a.bot)) return { ok: false, error: 'That bot isn\'t here any more' }
      h.picks.delete(String(a.key))
      if (x.handle && h.connector.settle) h.connector.settle(x.handle, { outcome: `${named(a.bot)} is answering` }).catch?.(() => {})
      deliver(c, x.m, a.bot, 'picked')
      return { ok: true }
    }
    const bot = /^(b\d+)-q/.exec(String(a.q || ''))?.[1] || /^(b\d+)\//.exec(String(a.memory || ''))?.[1] || null
    if (bot) return to(bot)?.act ? to(bot).act(a) : { ok: false, error: 'That bot isn\'t here any more' }
    if (a.act === 'stop') {
      let last = { ok: true, said: 'Nothing was running there' }
      for (const b of list) {
        const r = await Promise.resolve(to(b.id)?.act?.(a)).catch((e) => ({ ok: false, error: e.message }))
        if (r && (r.ok === false || r.said !== 'Nothing was running there')) return r
        if (r) last = r
      }
      return last
    }
    return list[0] ? to(list[0].id)?.act?.(a) : { ok: false, error: 'No bot here' }
  }

  // ---------- A bot's view of its connection on one platform ----------
  // What the desk's channel takes (connector.js), on whichever connection the bot is on now: its own,
  // or the shared one. None there: not set up ('no-tokens'), as a bot with no app there always was.
  function view(bot, p) {
    const key = `${bot}:${p}`
    const conn = () => conns.of(bot, p)
    const con = () => { const c = conn(); return c ? hubOf(c).connector : null }
    const must = () => { const x = con(); if (!x) throw failure(`${named(bot)} isn't connected to ${NAMES[p]}`, 'channel_not_found'); return x }
    // As this bot, on a shared connection: its name (and icon), or its name first.
    const as = () => { const c = conn(); const b = botOf(bot); return c?.shared && b ? { name: b.name, icon: b.icon || null } : null }
    const pass = (name) => (...a) => { const x = must(); if (typeof x[name] !== 'function') throw failure(`${NAMES[p]} can't do that`, 'not_supported'); return x[name](...a) }
    return {
      id: bot, label: NAMES[p], platform: p,
      get caps() { return con()?.caps },
      start(each) { joins.set(key, each); sync() },
      stop() { joins.delete(key); sync() },
      state() {
        const c = conn()
        if (!c) return { state: 'no-tokens', why: null, connection: null }
        if (c.paused) return { ...hubOf(c).connector.state(), state: 'off', why: c.pausedWhy || `${c.name} is paused`, paused: true, connection: { id: c.id, name: c.name, shared: c.shared } }
        return { ...hubOf(c).connector.state(), connection: { id: c.id, name: c.name, shared: c.shared } }
      },
      async post(reply, text, o = {}) {
        const who = as()
        if (!who) return must().post(reply, text, o)
        if (p === 'teams') return must().post(reply, `**${who.name}:** ${text}`, o)
        return must().post(reply, text, { ...o, as: who })
      },
      edit: (posted, text) => { const who = as(); return must().edit(posted, who && p !== 'slack' && !posted?.hook ? `**${who.name}:** ${text}` : text) },
      react: pass('react'), status: pass('status'), whisper: pass('whisper'), typing: (r) => con()?.typing?.(r),
      // The conversation, as context: on a shared connection, what the app posted as another bot is
      // that bot's (by the name it was posted as, or its name first), not this one's.
      async context(args) {
        const r = await must().context(args)
        const who = as()
        if (!who || !r?.messages) return r
        const mine = (x) => x.person?.name === who.name || /^\*{1,2}([^*]+):\*{1,2}/.exec(String(x.text || ''))?.[1] === who.name
        const fix = (x) => (x.you && !mine(x) ? { ...x, you: false } : x)
        return { ...r, messages: r.messages.map(fix), pins: (r.pins || []).map(fix) }
      },
      askOwner: (owner, item) => must().askOwner(owner, as() ? { ...item, shared: true } : item),
      settle: pass('settle'), download: pass('download'), dm: pass('dm'), missed: pass('missed'),
      masked: (...a) => con()?.masked?.(...a),
      people: (o) => must().people(o), channels: () => must().channels(), person: (id) => con()?.person?.(id),
      // Who's in a channel, where the platform can say (Slack); null where it can't.
      members: async (channel) => (con()?.members ? con().members(channel) : null),
      // People's emails, where the platform can say (Slack, with users:read.email); null where it can't.
      emails: async (ids) => (con()?.emails ? con().emails(ids) : null),
      // Its own connection's tokens: set and forgotten here (a shared one's, in Connections).
      setTokens: pass('setTokens'), setToken: pass('setToken'), setGuild: pass('setGuild'), setCredentials: pass('setCredentials'), setEndpoint: pass('setEndpoint'), checkEndpoint: pass('checkEndpoint'), teamsApp: pass('teamsApp'),
      forget() { const c = conn(); if (c && !c.shared) hubOf(c).connector.forget?.() },
      get connection() { return conn() },
    }
  }

  // Bridge AI closing: every connector stopped (a Slack app's Home tab says it's offline).
  const stopAll = () => { for (const h of hubs.values()) if (h.started) { h.started = false; try { h.connector.stop() } catch { /* going anyway */ } } }
  return { view, sync, restart, renew, drop, stopAll, connectorOf: (cid) => { const c = conns.get(cid); return c ? hubOf(c).connector : null }, infoOf, started: (cid) => !!hubs.get(cid)?.started, onNow: (c) => on(c), dry }
}
