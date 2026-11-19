// Connections (Bots, a beta feature): each one app on Slack, Discord or Microsoft Teams that bots are
// reached through, with the name you give it ("maya_bot"), its tokens and its workspace or server.
// A bot is reached through one connection on each platform at most: that platform's shared
// connection, used by every bot that has none of its own, or a connection of its own (a dedicated
// app, for a separate identity: a public support bot, say). So the app is made once, and each new
// bot is reached through it with nothing to set up there; connhub.js says which bot a question on a
// shared connection is for, and each bot's rules apply after that, as they always did.
//
// Each connection in its own folder in the data folder, readable by you only:
//   connections/<id>/connection.json   its settings: { name, platform, shared, bot (a connection of
//                                      one bot's own: that bot), owner (you there), defaults (the
//                                      channels each go to one bot: [{ id, name, bot }]), perBot
//                                      (a slash command for each bot, besides its own), teamsPort,
//                                      migratedFrom, createdAt, paused (not connected until Start:
//                                      one brought from another computer, or moved to one, as an
//                                      app can't be connected from two at once; pausedWhy says so) }
//   connections/<id>/slack.json        its tokens, as the platform's connector keeps them
//   connections/<id>/discord.json      (slackbot.js, discordbot.js, teamsbot.js): never in
//   connections/<id>/teams.json        config.json, never given to a model, nor shown back in full
//   connections/<id>/routing.jsonl     which bot each question went to, and why; and its connection
//   connections/<id>/state.json        the bot each person used last in a direct message
//
// Bots made before connections had each their own app, its tokens in bots/<id>/: each becomes a
// connection of that bot's own (migrate), named as the bot, so nothing about it changes. Move to the
// shared connection takes a bot off its own (its app can be deleted in Slack afterwards).
import fs from 'node:fs'
import path from 'node:path'
import { dataFile, writeFileAtomic } from './paths.js'

export const DIR = dataFile('connections')
const ID = /^c\d{1,4}$/
export const NAME_MAX = 35 // Slack's longest app name
export const PLATFORMS = ['slack', 'discord', 'teams']
const ROUTED_MAX = 1000 // routing decisions kept, the latest
const clean = (s, n) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
export const fileOf = (id, name) => path.join(DIR, id, name)
export const tokensOf = (c) => fileOf(c.id, `${c.platform}.json`)
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const place = (x) => (x && /^([CGD][A-Z0-9]{2,20}|discord:\d{1,25}|teams:[^\s"<>]{3,300})$/.test(String(x.id || '')) && /^b\d{1,4}$/.test(String(x.bot || '')) ? { id: String(x.id), name: clean(x.name, 80) || null, bot: String(x.bot) } : null)
const person = (p) => (p && /^([UW][A-Z0-9]{2,20}|discord:\d{1,25}|teams:[\w-]{6,64})$/.test(String(p.id || '')) ? { id: String(p.id), name: clean(p.name, 80) || null } : null)

// A connection as kept, with every setting there.
function shape(id, j) {
  const c = { ...(j || {}), id }
  c.platform = PLATFORMS.includes(c.platform) ? c.platform : 'slack'
  c.name = clean(c.name, NAME_MAX) || 'Bridge AI'
  c.bot = /^b\d{1,4}$/.test(String(c.bot || '')) ? String(c.bot) : null
  c.shared = !c.bot && c.shared !== false
  c.owner = person(c.owner)
  c.defaults = (Array.isArray(c.defaults) ? c.defaults : []).map(place).filter(Boolean).slice(0, 200)
  c.perBot = c.perBot === true
  c.teamsPort = Number.isInteger(c.teamsPort) ? c.teamsPort : null
  c.paused = c.paused === true
  c.pausedWhy = c.paused ? clean(c.pausedWhy, 300) || null : null
  return c
}
// (Read again at most once a second: a question asks which connection a bot is on many times.)
let memo = null
export function list() {
  if (memo && Date.now() - memo.at < 1000) return memo.list
  let ids = []
  try { ids = fs.readdirSync(DIR).filter((x) => ID.test(x) && fs.existsSync(fileOf(x, 'connection.json'))) } catch { /* none yet */ }
  const out = ids.map((id) => shape(id, read(fileOf(id, 'connection.json')))).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id, 'en', { numeric: true }))
  memo = { at: Date.now(), list: out }
  return out
}
export const get = (id) => (ID.test(String(id)) ? list().find((c) => c.id === id) || null : null)
function write(c) {
  memo = null
  fs.mkdirSync(path.join(DIR, c.id), { recursive: true, mode: 0o700 })
  const { id, ...rest } = c // eslint-disable-line no-unused-vars
  writeFileAtomic(fileOf(c.id, 'connection.json'), JSON.stringify(rest, null, 2), { mode: 0o600 })
}
const nextId = () => { const have = new Set(list().map((c) => c.id)); let n = 1; while (have.has(`c${n}`) || fs.existsSync(path.join(DIR, `c${n}`))) n++; return `c${n}` }

// The platform's shared connection, or null.
export const sharedOf = (platform) => list().find((c) => c.shared && c.platform === platform) || null
// A bot's own connection there, or null.
export const ownOf = (bot, platform) => list().find((c) => c.bot === bot && c.platform === platform) || null
// The connection a bot is reached through there: its own, else the shared one (or none).
export const of = (bot, platform) => ownOf(bot, platform) || sharedOf(platform)
// The bots a connection reaches, of those given: its own bot's, or every one without its own there.
export const botsOn = (c, bots) => (c.bot ? bots.filter((b) => b.id === c.bot) : bots.filter((b) => !ownOf(b.id, c.platform)))

// A shared connection's name to start from: your first name's, as "maya_bot" for Maya.
export const suggestName = (you = '') => `${String(you || '').trim().split(/\s+/)[0].toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '') || 'my'}_bot`

// A new connection: a platform's shared one (one a platform), or a bot's own.
export function create({ platform, name, shared = true, bot = null, owner = null, teamsPort = null, migratedFrom = null, paused = false, pausedWhy = null } = {}) {
  if (!PLATFORMS.includes(platform)) throw new Error('Pick Slack, Discord or Microsoft Teams')
  const n = clean(name, NAME_MAX)
  if (!n) throw new Error('Give it a name: it\'s the app\'s name there')
  if (!bot && shared && sharedOf(platform)) throw Object.assign(new Error(`There's a shared ${platform === 'teams' ? 'Microsoft Teams' : platform === 'discord' ? 'Discord' : 'Slack'} connection already`), { status: 409 })
  if (bot && ownOf(bot, platform)) throw Object.assign(new Error('That bot has a connection of its own there already'), { status: 409 })
  const c = shape(nextId(), { name: n, platform, shared: !bot, bot, owner, teamsPort, migratedFrom, paused, pausedWhy, createdAt: new Date().toISOString() })
  write(c)
  return c
}
// Its settings changed (its name, you there, the channels' bots, per-bot commands).
export function save(id, patch) {
  const before = get(id)
  if (!before) throw Object.assign(new Error('No such connection'), { status: 404 })
  const after = shape(id, { ...before, ...patch, platform: before.platform, bot: before.bot, shared: before.shared })
  write(after)
  return { before, after }
}
// Gone, tokens and all (the app stays on the platform until you delete it there).
export function remove(id) {
  if (!ID.test(String(id))) throw new Error('No such connection')
  memo = null
  fs.rmSync(path.join(DIR, id), { recursive: true, force: true })
}

// ---------- What it routed, and the person's last bot ----------
// Each decision a line: { at, bot, name, why, where, who }, and its connection's events. Never the
// question's words.
export function note(id, e) {
  if (!get(id)) return
  const f = fileOf(id, 'routing.jsonl')
  try {
    fs.appendFileSync(f, `${JSON.stringify({ at: new Date().toISOString(), ...e })}\n`, { mode: 0o600 })
    const st = fs.statSync(f)
    if (st.size > 400 * 1024) { const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-ROUTED_MAX); writeFileAtomic(f, `${lines.join('\n')}\n`, { mode: 0o600 }) }
  } catch { /* the next one */ }
}
export function routed(id, n = 200) {
  try { return fs.readFileSync(fileOf(id, 'routing.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse() } catch { return [] }
}
const stateOf = (id) => read(fileOf(id, 'state.json')) || {}
export const lastBot = (id, person) => stateOf(id).dm?.[person] || null
export function setLast(id, person, bot) {
  if (!get(id) || !person) return
  const s = stateOf(id)
  s.dm = { ...(s.dm || {}), [person]: bot }
  const keys = Object.keys(s.dm)
  if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete s.dm[k]
  try { writeFileAtomic(fileOf(id, 'state.json'), JSON.stringify(s), { mode: 0o600 }) } catch { /* next time */ }
}

// ---------- Bots made before connections ----------
// Each bot's own app (its tokens in bots/<id>/), made a connection of its own: named as the bot,
// you there as the bot had you, Teams on the port it listened on. Once: the tokens move. bots: every
// bot, its folder; portOf(id): the Teams port a bot had. [{ bot, connection }] back.
export function migrate(bots, { dirOf, portOf = () => null } = {}) {
  const out = []
  for (const b of bots) {
    for (const p of PLATFORMS) {
      const was = path.join(dirOf(b.id), `${p}.json`)
      if (!fs.existsSync(was) || ownOf(b.id, p)) continue
      const owner = p === 'slack' ? b.owner : b.owners?.[p] || null
      const c = create({ platform: p, name: b.name, bot: b.id, owner, teamsPort: p === 'teams' ? portOf(b.id) : null, migratedFrom: b.id })
      try { fs.renameSync(was, tokensOf(c)); fs.chmodSync(tokensOf(c), 0o600) } catch (e) { console.log(`Bots: ${b.name}'s ${p} tokens couldn't be moved: ${e.message}`); remove(c.id); continue }
      out.push({ bot: b.id, connection: c })
    }
  }
  return out
}
