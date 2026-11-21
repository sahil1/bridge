// Back Up & Move (Settings › Back Up & Move): this computer's Bridge AI setup, carried to another
// computer when you change computers or the one it runs on is replaced. Two ways:
//   Back Up: one file, everything in it sealed with a passphrase you pick (scrypt makes the key from
//     it, with a salt of its own; AES-256-GCM seals it, with a nonce of its own and a full-length
//     tag, and the file's header is sealed in too, so a header changed shows). Nothing in the file
//     is readable without the passphrase: not a token, not a bot's instructions, not what it
//     remembers. Restore on the other computer: the file and the passphrase, what will be added,
//     and nothing applied until you say so. A wrong passphrase says so.
//   Move: straight to another of your computers, over the end-to-end encrypted link between them
//     (machines.js), with no passphrase. It shows there what's coming, and applies it once you say
//     so there (from that computer, or a phone paired with it and kept there: never from this one
//     through the link).
//
// What's in it: each bot (its settings, instructions and what it remembers: bots.js bundleOf, as a
// bot's own export, and what it keeps about each person it talks with, people.json, which its own
// export leaves out), each connection with its tokens (connections.js; the fields each connector
// keeps, TOKEN_FIELDS), your routines, the Chief of Staff's playbook, ledger and task list, each
// agent's user-level MCP servers (mcp.js), and the settings that mean the same on another computer
// (SETTINGS). What isn't: this computer's own (its name, its key, its relay and its keys, the
// devices paired or linked with it, your Bold Bridge sign-in, the agents' and model providers'
// sign-ins, its port, update channel and caches), meetings and recordings (often gigabytes: Files ›
// Send to… copies them), and each bot's record, its files and drafts waiting (they stay with the
// computer that made them).
//
// What comes is checked as it would be if it were set here by hand, and shown in full before it's
// applied, as a file could have been made by someone else: each bot through Settings' own checks
// (index.js bringBot: its folders inside your home folder and not Bridge AI's own, who may ask and
// you there by their ids), who may ask it, what it reads and you there shown, and, from a file, never
// answering without asking at first nor taking who you are there from it (drafts would go to
// whoever it names); each routine as one made here is (routines.js checkBrought),
// its command, folder, agent and where it posts shown; each MCP server as Settings › MCP Servers
// adds one (mcp.js), its whole command and its env's names shown, those that make a program run
// more than it's asked flagged. From a file, routines and MCP servers (both run things on this
// computer) are added only when you tick them.
//
// One app can't be connected from two computers at once: Slack's Socket Mode would hand each of its
// events to one of them, so each would see some questions and miss the rest. So nothing runs twice,
// and each connection says what paused it (pausedBy):
//   Move: one at a time from here (another one waiting is called off, and one that's been applied
//     has to be undone first). What comes is applied with its connections (and scheduled routines)
//     paused (in:<move>); this computer is asked over the link to pause the bots, connections and
//     scheduled routines it sent (move:<move>), only by the computer it went to, and only once;
//     and only once it says it has are they started there. One that can't be reached stays as it
//     is, and the other says so, with Try Again and Start. Start Here Again (undo) asks the
//     computer it went to to pause them there first (back:<move>), and is refused while it can't
//     be reached; then starts here only what the move paused.
//   Restore: its connections and scheduled routines arrive paused (restore), saying to stop the
//     bots on the computer the backup came from first, with Start in one click.
//
// What comes (a file opened, a move sent here) waits in memory only, until it's applied or let go,
// an hour at most: its tokens are never written anywhere but where they go. What happened (moves
// sent from here, those applied here) is in backup.json, which never holds a token. Nothing here
// logs a token, a passphrase or what a backup holds.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { dataFile, writeFileAtomic, ROOT, HOME, DATA } from './paths.js'
import * as store from './bots.js'
import { rootSays } from './botattach.js'
import * as conns from './connections.js'
import * as routines from './routines.js'
import * as settings from './settings.js'
import * as mcp from './mcp.js'
import * as machines from './machines.js'
import { placeEn } from '../shared/places.js'
import { available as accountsOn } from './account.js'

export const FILE_KIND = 'bridge-ai-backup' // the file
const KIND = 'bridge-ai-setup' // what's sealed in it, and what a move sends
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version } catch { return '0' } })()
const STATE = dataFile('backup.json')
const CHIEF_FILES = ['playbook.md', 'ledger.md', 'tasks.md']
const PEOPLE = 'people.json' // what a bot keeps about each person (frontdesk.js), carried as it is
const PEOPLE_MAX = 5 * 1024 * 1024
const PASS_MIN = 8
const WAIT_MS = 60 * 60 * 1000 // what came, waiting to be applied
const OPEN_MAX = 64 * 1024 * 1024 // a backup, unsealed, at most
const PLATFORM = { slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams' }
// The key from the passphrase: scrypt, N 2^17 (128 MB, half a second or so). Only a file that asks
// for these is opened, so one made to make this computer work far harder is turned away.
const KDF = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 }
const okKdf = (k) => k?.name === KDF.name && k.N === KDF.N && k.r === KDF.r && k.p === KDF.p
const SALT = 16
const NONCE = 12
const TAG = 16

// The settings that mean the same on another computer, by their key in config.json. Left out: where
// this one listens (port, host, allowedHosts), its runtime and herdr's session, its own name
// (deviceName), its agents' paths, its local model, the terminal app, its update channel and
// early-access code, the assistant's folder, whether outside apps may send to its agents through
// Bridge AI's MCP server (mcpServer: each computer's own say), sign-ins, and what's only kept for
// its own start.
const SETTINGS = ['name', 'location', 'defaultAgent', 'chief', 'mail', 'market', 'mortgage', 'news', 'quota', 'simple', 'moreModels', 'keepAgents', 'trials', 'alertSounds', 'notify', 'voice', 'studio', 'consult', 'resumeWork', 'filesAssist', 'modelJobs', 'jobModels', 'llmModel', 'dictation', 'meetings', 'calendar', 'commands', 'crashReports', 'counts']
// (Meetings' folder and the Chief of Staff's are folders of this computer's. And a beta feature that
// lets another device see or use this screen is turned on only by someone at this computer:
// remote-screen stays as it is.)
const PER_COMPUTER_TRIALS = ['remote-screen']
const settingsOf = (all) => {
  const out = {}
  for (const k of SETTINGS) if (all?.[k] !== undefined) out[k] = all[k]
  if (out.meetings && typeof out.meetings === 'object') { const { folder, ...rest } = out.meetings; out.meetings = rest } // eslint-disable-line no-unused-vars
  if (out.chief && typeof out.chief === 'object') { const { path: p, ...rest } = out.chief; out.chief = rest } // eslint-disable-line no-unused-vars
  if (out.trials && typeof out.trials === 'object') { out.trials = Object.fromEntries(Object.entries(out.trials).filter(([k]) => !PER_COMPUTER_TRIALS.includes(k))); if (!Object.keys(out.trials).length) delete out.trials }
  return out
}
// A connection's tokens and what its connector keeps with them (slackbot.js, discordbot.js,
// teamsbot.js), by an allow-list: Teams' port is this computer's, and anything else is left out.
const TOKEN_FIELDS = {
  slack: ['appToken', 'botToken', 'team', 'bot', 'scopes', 'appId', 'since', 'seen', 'threads'],
  discord: ['token', 'bot', 'app', 'guilds', 'guild', 'since', 'dms', 'seen', 'threads', 'hooks'],
  teams: ['appId', 'password', 'tenantId', 'single', 'bot', 'teamsAppId', 'publicUrl', 'channels', 'conversations', 'package'],
}
// You on that platform, as Settings takes it (index.js, a connection's owner): Slack's id, or the
// platform's own before it.
const ownerOk = (platform, o) => !!o && (platform === 'slack' ? /^[UW][A-Z0-9]{2,20}$/.test(String(o.id || '')) : store.PERSON_ID.test(String(o.id || '')) && String(o.id).startsWith(`${platform}:`))
const ownerOf = (platform, o) => (ownerOk(platform, o) ? { id: String(o.id), name: clean(o.name, 80) || null } : null)
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]))
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const fail = (message, status = 400, code = undefined) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const newId = () => crypto.randomBytes(9).toString('base64url')
const expand = (p) => path.resolve(String(p || '').replace(/^~(?=$|[\\/])/, HOME))
const b64 = (s, n) => { const b = Buffer.from(String(s || ''), 'base64'); return b.length === n ? b : null }

// ---------- What happened, kept ----------
// { moves: [{ id, to, toName, at, state, bots, connections, routines, paused: { bots, connections,
// routines }, pausedAt, error }], received: [{ move, machine, from, at, bots, connections, routines,
// handoff, error, started }], last: { kind, from, at, connections, routines, handoff, error, machine,
// move } }
let state = readJson(STATE) || {}
state.moves = Array.isArray(state.moves) ? state.moves : []
state.received = Array.isArray(state.received) ? state.received : []
const saveState = () => { try { writeFileAtomic(STATE, JSON.stringify(state, null, 2), { mode: 0o600 }) } catch (e) { console.log(`Back Up & Move couldn't keep what happened: ${e.message}`) } }

// ---------- What this computer has ----------
// h: what index.js gives (memoryOf, computer, installed, chiefDir, bring, pauseBot, unpauseBot,
// saveSettings, teamsPort, synced).
let h = {}
export function use(o) { h = { ...h, ...o } }
const chiefState = () => path.join(h.chiefDir || dataFile('chief'), 'state')
const peopleOf = (bot) => path.join(store.DIR, bot, PEOPLE)

// Everything that goes, as it is now: nothing sealed yet.
export async function collect() {
  const bots = store.live().map((b) => {
    let people = null
    try { const t = fs.readFileSync(peopleOf(b.id), 'utf8'); if (t.length <= PEOPLE_MAX) people = t } catch { /* none */ }
    return { id: b.id, paused: b.paused, bundle: store.bundleOf(b.id, h.memoryOf?.(b.id) || []), ...(people != null ? { people } : {}) }
  })
  const ids = new Set(bots.map((b) => b.id))
  const connections = conns.list().filter((c) => !c.bot || ids.has(c.bot)).map((c) => ({
    id: c.id, platform: c.platform, name: c.name, shared: c.shared, bot: c.bot, owner: c.owner, defaults: c.defaults.filter((d) => ids.has(d.bot)), perBot: c.perBot, chief: ids.has(c.chief) ? c.chief : null, ...(c.paused ? { paused: true } : {}),
    tokens: pick(readJson(conns.tokensOf(c)) || {}, TOKEN_FIELDS[c.platform] || []),
  }))
  const chief = {}
  for (const f of CHIEF_FILES) { try { chief[f] = fs.readFileSync(path.join(chiefState(), f), 'utf8') } catch { /* not made yet */ } }
  return {
    kind: KIND, v: 1, madeAt: new Date().toISOString(), from: h.computer?.() || 'another computer', app: VERSION,
    bots, connections, routines: routines.readDefs(), chief, mcp: await mcp.userServersRaw(h.installed || (async () => [])), settings: settingsOf(settings.readUser()),
  }
}

// ---------- Sealed with a passphrase ----------
const scrypt = (pass, salt, k) => new Promise((resolve, reject) => crypto.scrypt(String(pass).normalize('NFC'), salt, 32, { N: k.N, r: k.r, p: k.p, maxmem: 128 * k.N * k.r * k.p + 32 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))))
// What's sealed in with it: the header, in this order, so one changed doesn't open.
const headerOf = (f) => Buffer.from(JSON.stringify({ kind: f.kind, v: f.v, madeAt: f.madeAt, from: f.from, app: f.app, kdf: f.kdf }))
export function checkPass(p) {
  if (typeof p !== 'string' || [...p].length < PASS_MIN) throw fail(`Pick a passphrase of at least ${PASS_MIN} characters`, 400, 'passphrase-short')
  if (p.length > 1024) throw fail('That passphrase is too long', 400, 'passphrase-short')
}
export async function seal(payload, passphrase) {
  checkPass(passphrase)
  const salt = crypto.randomBytes(SALT)
  const nonce = crypto.randomBytes(NONCE)
  const f = { kind: FILE_KIND, v: 1, madeAt: payload.madeAt, from: clean(payload.from, 80), app: VERSION, kdf: { ...KDF, salt: salt.toString('base64') } }
  const key = await scrypt(passphrase, salt, f.kdf)
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG })
  c.setAAD(headerOf(f))
  const sealed = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(payload)))), c.final()])
  return { ...f, cipher: { name: 'aes-256-gcm', nonce: nonce.toString('base64'), tag: c.getAuthTag().toString('base64') }, sealed: sealed.toString('base64') }
}
// A file back to what it holds: a wrong passphrase (or a file changed since) says so. Only what this
// app writes is opened: its scrypt, a salt of 16 bytes, a nonce of 12 and a tag of 16.
export async function unseal(file, passphrase) {
  if (!file || typeof file !== 'object' || file.kind !== FILE_KIND) throw fail('That isn\'t a Bridge AI backup', 400, 'not-backup')
  if (file.v !== 1) throw fail('That backup was made by a newer Bridge AI: update this one first', 400, 'newer')
  const salt = b64(file.kdf?.salt, SALT)
  const nonce = b64(file.cipher?.nonce, NONCE)
  const tag = b64(file.cipher?.tag, TAG)
  if (!okKdf(file.kdf) || !salt || file.cipher?.name !== 'aes-256-gcm' || !nonce || !tag || typeof file.sealed !== 'string') throw fail('That backup is damaged', 400, 'damaged')
  if (typeof passphrase !== 'string' || !passphrase) throw fail('Type the passphrase it was made with', 400, 'passphrase')
  const key = await scrypt(passphrase, salt, file.kdf)
  let raw
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG })
    d.setAAD(headerOf(file))
    d.setAuthTag(tag)
    raw = Buffer.concat([d.update(Buffer.from(file.sealed, 'base64')), d.final()])
  } catch { throw fail('That passphrase doesn\'t open this backup', 403, 'passphrase') }
  let x
  try { x = JSON.parse(zlib.gunzipSync(raw, { maxOutputLength: OPEN_MAX }).toString('utf8')) } catch { throw fail('That backup is damaged', 400, 'damaged') }
  return checked(x)
}
const checked = (x) => {
  if (!x || typeof x !== 'object' || x.kind !== KIND) throw fail('That isn\'t a Bridge AI setup', 400, 'not-backup')
  for (const k of ['bots', 'connections', 'routines', 'mcp']) if (!Array.isArray(x[k])) x[k] = []
  if (!x.chief || typeof x.chief !== 'object') x.chief = {}
  if (!x.settings || typeof x.settings !== 'object') x.settings = {}
  return x
}

// ---------- What would be added here ----------
// A folder a bot would read, as Settings would take it (the whole check is made as it's applied):
// null, or why not.
function folderSays(p) {
  const full = expand(p)
  if (!fs.existsSync(full)) return 'not on this computer'
  if (full === path.resolve(HOME)) return 'your whole home folder'
  if (full === DATA || full.startsWith(DATA + path.sep) || DATA.startsWith(full + path.sep)) return 'Bridge AI\'s own folder'
  if (!full.startsWith(path.resolve(HOME) + path.sep)) return 'outside your home folder'
  // (Where apps keep their settings and keys, by its real path: Settings won't take one either.)
  let real = full
  try { real = fs.realpathSync(full) } catch { /* as it's named */ }
  const where = rootSays(real)
  return where ? `${where}, where apps keep their settings and keys` : null
}
const personOf = (p) => (p?.id ? `${clean(p.name, 80) || p.id}${p.name ? ` (${String(p.id).slice(0, 40)})` : ''}` : null)
// Each bot by its name, with a number after it when that's taken here (as a bot's own import), what
// it would read (and which of those it won't, and why), who may ask it and you there as the file
// has them, and whether it answers without asking (from a file, it won't at first); each
// connection, with you there, or why not (a platform's shared one, where there's one here already:
// the bots use the one here); each routine, renamed the same way, with its command, folder, agent
// and where it posts, or why it can't be; the Chief of Staff's files, and which differ from the ones
// here (those are kept beside them); each MCP server with its whole command and its env's names
// (those that make a program run more flagged), or why not; the settings that would change.
// kind: 'file' or 'move'; from: the computer it's from, as the link names it for a move.
export async function planOf(x, { kind = 'file', from = null } = {}) {
  const taken = new Set(store.list().map((b) => b.name.toLowerCase()))
  const bots = x.bots.map((b) => {
    const want = clean(b.bundle?.name, store.NAME_MAX) || 'Imported bot'
    let as = want
    for (let i = 2; taken.has(as.toLowerCase()) && i < 100; i++) as = `${want.slice(0, store.NAME_MAX - 4)} (${i})`
    taken.add(as.toLowerCase())
    const st = b.bundle?.settings || {}
    const reads = (Array.isArray(st.readsFrom) ? st.readsFrom.map(String) : []).slice(0, 50).map((p) => ({ path: clean(p, 300), refused: folderSays(p) }))
    const askers = (Array.isArray(st.askers) ? st.askers : []).slice(0, 200).map(personOf).filter(Boolean)
    const owners = [personOf(st.owner), ...['discord', 'teams'].map((k) => personOf(st.owners?.[k]))].filter(Boolean)
    // (From a file, who you are there isn't taken: drafts would go to whoever it names. Said instead.)
    // (And what would let it act for you or say more than it's asked, as the file asks: from a file,
    // held here until you turn it on, index.js bringBot.)
    const asks = { answerers: (Array.isArray(st.answerers) ? st.answerers : st.agent ? [`agent:${st.agent}`] : []).map((x) => clean(x, 120)).slice(0, 12), changes: ['suggest', 'pr'].includes(st.changes) ? st.changes : 'none', repo: st.repo ? clean(st.repo, 300) : null, mcp: (Array.isArray(st.mcp) ? st.mcp : []).map((n) => clean(n, 64)).slice(0, 20), agentCopies: st.agentCopies === true, agentsStatus: st.agentsStatus === true, memory: ['auto', 'off'].includes(st.memory) ? st.memory : 'approve' }
    return { key: b.id, name: want, as, renamed: as !== want, reads, who: st.who === 'channels' ? 'channels' : 'named', askers, owners: kind === 'move' ? owners : [], ownersLeft: kind === 'file' ? owners : [], auto: st.auto === true, autoHere: st.auto === true && kind === 'move', asks, held: kind === 'file', people: typeof b.people === 'string' }
  })
  const botName = (id) => bots.find((b) => b.key === id)?.as || null
  const connections = x.connections.map((c) => {
    const base = { key: c.id, name: clean(c.name, 35), platform: c.platform, shared: !c.bot, bot: c.bot ? botName(c.bot) : null, tokens: Object.keys(c.tokens || {}).length > 0, owner: kind === 'move' && ownerOk(c.platform, c.owner) ? personOf(c.owner) : null }
    if (!PLATFORM[c.platform]) return { ...base, skip: 'not a platform Bridge AI knows' }
    if (c.bot && !botName(c.bot)) return { ...base, skip: 'its bot isn\'t in it' }
    if (!c.bot && conns.sharedOf(c.platform)) return { ...base, skip: `there's a shared ${PLATFORM[c.platform]} connection here already, which its bots use` }
    return base
  })
  const names = new Set(routines.readDefs().map((d) => d.name.toLowerCase()))
  const brought = Object.fromEntries(x.bots.map((b) => [b.id, 'b0']))
  const rs = x.routines.filter((r) => r && typeof r === 'object').map((r) => {
    const { def, why } = routines.checkBrought(r, { bots: brought })
    const want = clean(r.name, 120) || 'A routine'
    let as = want
    if (def) { for (let i = 2; names.has(as.toLowerCase()) && i < 100; i++) as = `${want} (${i})`; names.add(as.toLowerCase()) }
    const to = r.to === 'bot' ? { bot: botName(r.bot), channel: clean(r.channel?.name || r.channel?.id, 80) } : r.to === 'chief' ? { chief: true } : null
    return { key: r.id, name: want, as, renamed: as !== want, command: String(r.command || '').slice(0, 4000), folder: def?.cwd || (r.to === 'bot' || r.to === 'chief' ? null : clean(r.cwd, 300) || null), agent: def?.kind || null, to, schedule: clean(r.schedule, 200) || null, scheduled: !!def && !!routines.scheduleOf(def) && !!def.auto, ...(why ? { skip: why } : {}) }
  })
  const chief = Object.entries(x.chief).filter(([f, t]) => CHIEF_FILES.includes(f) && typeof t === 'string').map(([f, t]) => {
    let here = null
    try { here = fs.readFileSync(path.join(chiefState(), f), 'utf8') } catch { /* none here */ }
    return { file: f, differs: here != null && here !== t }
  })
  const agents = await mcp.agentsHere(h.installed || (async () => []))
  const servers = x.mcp.map((s) => {
    const a = agents.find((y) => y.kind === s.kind)
    // (What it runs, or where it's reached, in full: it runs whenever that agent starts.)
    const v = mcp.viewRaw(s.kind, s.name, s.raw)
    const base = { name: clean(s.name, 64), kind: s.kind, agent: a?.label || clean(s.kind, 40), ...(v.error ? {} : { command: v.command ? [v.command, ...(v.args || [])].join(' ') : null, url: v.url, envKeys: v.envKeys, risky: v.risky }) }
    return { ...base, ...(v.error ? { skip: v.error } : !a ? { skip: 'that agent isn\'t on this computer' } : mcp.hasServer(s.kind, s.name) ? { skip: 'it has one by that name already' } : {}) }
  })
  const now = settings.readUser()
  const p = settingsOf(x.settings)
  const keys = Object.keys(p)
  const said = (v) => { const t = JSON.stringify(v); return t.length > 300 ? `${t.slice(0, 299)}…` : t }
  return {
    from: clean(from || x.from, 80), madeAt: x.madeAt || null, app: x.app || null, kind,
    // (From a file, what runs things on this computer, and its settings, are added only when you tick them.)
    optIn: kind === 'file' ? ['routines', 'mcp', 'settings'] : [],
    bots, connections, routines: rs, chief, mcp: servers,
    settings: { keys, changes: keys.filter((k) => JSON.stringify(now[k]) !== JSON.stringify(p[k])), values: Object.fromEntries(keys.map((k) => [k, said(p[k])])) },
  }
}

// ---------- Applied here ----------
// parts: which of it ({ bots, connections, routines, chief, mcp, settings }): each on unless false,
// but from a file routines, MCP servers and settings only when true. kind: 'file' or 'move'. why: what a
// connection brought here says while it's paused; pausedBy, what paused it. req: the request it's
// applied by (a bot's folders are checked as Settings checks them, from where it's asked).
export async function apply(x, { parts = {}, why = 'Paused', pausedBy = 'restore', kind = 'file', req = null } = {}) {
  const on = (k) => (kind === 'file' && ['routines', 'mcp', 'settings'].includes(k) ? parts[k] === true : parts[k] !== false)
  const out = { bots: [], connections: [], routines: [], chief: [], mcp: [], settings: [], problems: [] }
  // (Settings first: Bots, a beta feature, is on here once its setting is. Then MCP servers, so a
  // bot that uses one finds it.)
  if (on('settings')) {
    const p = settingsOf(x.settings)
    if (Object.keys(p).length) { try { h.saveSettings(p); out.settings = Object.keys(p) } catch (e) { out.problems.push(`The settings couldn't be saved: ${e.message}`) } }
  }
  if (on('mcp')) {
    for (const s of x.mcp) {
      const r = await mcp.addRaw(h.installed || (async () => []), s)
      out.mcp.push({ name: clean(s.name, 64), kind: s.kind, ok: r.ok, ...(r.ok ? {} : { error: r.error }) })
    }
  }
  const map = {}
  if (on('bots')) {
    for (const b of x.bots) {
      try {
        const r = await h.bring(b.bundle, { req, paused: b.paused === true, fromFile: kind !== 'move', why: x.via })
        map[b.id] = r.bot.id
        const people = typeof b.people === 'string' && b.people.length <= PEOPLE_MAX ? peopleChecked(b.people) : null
        if (people) { try { writeFileAtomic(peopleOf(r.bot.id), JSON.stringify(people, null, 1), { mode: 0o600 }) } catch (e) { out.problems.push(`What ${r.bot.name} keeps about people couldn't be written: ${e.message}`) } }
        out.bots.push({ from: b.id, id: r.bot.id, name: r.bot.name, renamed: r.renamed })
        out.problems.push(...(r.problems || []))
      } catch (e) { out.problems.push(`${clean(b.bundle?.name, 40) || 'A bot'} couldn't be added: ${e.message}`) }
    }
  }
  if (on('connections')) {
    for (const c of x.connections) {
      if (!PLATFORM[c.platform] || (c.bot && !map[c.bot]) || (!c.bot && conns.sharedOf(c.platform))) continue
      try {
        // (One paused where it came from stays paused here until you Start it: it isn't the move's to start.)
        const was = c.paused === true && kind === 'move'
        const made = conns.create({ platform: c.platform, name: c.name, shared: !c.bot, bot: c.bot ? map[c.bot] : null, owner: kind === 'move' ? ownerOf(c.platform, c.owner) : null, teamsPort: c.platform === 'teams' ? h.teamsPort?.() ?? null : null, paused: true, pausedWhy: was ? `Paused on ${clean(x.from, 80)} when it came: Start it here once it isn't connected anywhere else` : why, pausedBy: was ? 'restore' : pausedBy })
        // (Its tokens before anything can start it: it's paused, and nothing waits in between.)
        writeFileAtomic(conns.tokensOf(made), JSON.stringify(pick(c.tokens || {}, TOKEN_FIELDS[c.platform] || []), null, 2), { mode: 0o600 })
        if (!c.bot) conns.save(made.id, { perBot: c.perBot === true, defaults: (c.defaults || []).map((d) => (map[d.bot] ? { ...d, bot: map[d.bot] } : null)).filter(Boolean), chief: map[c.chief ?? c.unsure] || null })
        if (kind === 'move' && c.owner && !ownerOk(c.platform, c.owner)) out.problems.push(`You in ${PLATFORM[c.platform]} for ${clean(c.name, 35)} was left out: it isn't someone there`)
        out.connections.push({ from: c.id, id: made.id, name: made.name, platform: made.platform, shared: made.shared, ...(was ? { wasPaused: true } : {}) })
      } catch (e) { out.problems.push(`The ${PLATFORM[c.platform]} connection ${clean(c.name, 35)} couldn't be added: ${e.message}`) }
    }
  }
  if (on('routines') && x.routines.length) {
    try {
      const r = routines.bring(x.routines, { paused: true, bots: on('bots') ? map : {} })
      out.routines = r.filter((y) => !y.skipped)
      for (const y of r.filter((z) => z.skipped)) out.problems.push(`The routine ${clean(y.name, 60)} wasn't added: ${y.skipped}`)
    } catch (e) { out.problems.push(`The routines couldn't be added: ${e.message}`) }
  }
  if (on('chief')) {
    for (const [f, text] of Object.entries(x.chief)) {
      if (!CHIEF_FILES.includes(f) || typeof text !== 'string') continue
      try {
        fs.mkdirSync(chiefState(), { recursive: true })
        const at = path.join(chiefState(), f)
        let had = null
        try { had = fs.readFileSync(at, 'utf8') } catch { /* none */ }
        if (had === text) continue
        // (The one here kept beside it, so nothing of it is lost.)
        if (had != null) writeFileAtomic(path.join(chiefState(), f.replace(/\.md$/, '.before-restore.md')), had)
        writeFileAtomic(at, text)
        out.chief.push(f)
      } catch (e) { out.problems.push(`The Chief of Staff's ${f} couldn't be written: ${e.message}`) }
    }
  }
  h.synced?.()
  return out
}

// What a bot keeps about each person (people.json, botcontext.js), as it keeps it: { v: 1, people:
// { <person id>: { name, at, kept: [exchange], proposed: [exchange] } } }, an exchange { q, conv, at,
// where: { kind, id, name, private }, asked, answered }, each cut to what it keeps; anything else in
// it, or past its bounds (500 people, 12 exchanges a person), left out. null when nothing's left.
const cut = (s, n) => clean(s, n) || null
function peopleChecked(text) {
  let j
  try { j = JSON.parse(text) } catch { return null }
  const people = {}
  const exchange = (x) => (x && typeof x === 'object' ? {
    q: cut(x.q, 80) || '', conv: cut(x.conv, 200) || '', at: cut(x.at, 40), asked: cut(x.asked, 280) || '', answered: cut(x.answered, 400) || '',
    // (Where it was said decides where it's given again: one that doesn't say, or isn't plainly not
    // private, is taken as private, given only in their direct messages.)
    where: x.where && typeof x.where === 'object' && ['dm', 'channel'].includes(x.where.kind)
      ? { kind: x.where.kind, id: cut(x.where.id, 300), name: cut(x.where.name, 80), ...(x.where.within ? { within: cut(x.where.within, 80) } : {}), private: x.where.private !== false }
      : { kind: 'dm', id: null, name: null, private: true },
  } : null)
  for (const [id, p] of Object.entries(j?.people && typeof j.people === 'object' ? j.people : {}).slice(0, 500)) {
    if (!store.PERSON_ID.test(id) || !p || typeof p !== 'object') continue
    const list = (v) => (Array.isArray(v) ? v : []).slice(-12).map(exchange).filter((x) => x && (x.asked || x.answered))
    people[id] = { name: cut(p.name, 80), at: cut(p.at, 40), kept: list(p.kept), proposed: list(p.proposed) }
  }
  return Object.keys(people).length ? { v: 1, people } : null
}

// ---------- Started (one click), and paused ----------
// A connection paused because it moved to another computer (move:) or was taken back by the one it
// came from (back:) starts again only as a move does, never with Start.
const held = (c) => /^(move|back):/.test(String(c.pausedBy || ''))
// The connections brought here, started: each connects now.
export function start({ connections = null, routines: rs = null } = {}) {
  const want = connections ? new Set(connections) : null
  const started = []
  for (const c of conns.list()) if (c.paused && !held(c) && (!want || want.has(c.id))) { conns.save(c.id, { paused: false, pausedWhy: null, pausedBy: null }); started.push(c.id) }
  const ids = rs || state.last?.routines || []
  const resumed = routines.setPaused(ids, false)
  if (state.last && (!want || (state.last.connections || []).every((id) => want.has(id)))) { state.last.started = new Date().toISOString(); saveState() }
  h.synced?.()
  return { connections: started, routines: resumed }
}

// ---------- Pending: what came, waiting for you ----------
const pending = new Map() // id -> { id, kind: 'file' | 'move', x, from, at, machine, move, timer }
const letGo = (id) => { const p = pending.get(id); if (p) { clearTimeout(p.timer); pending.delete(id) } }
function hold(p) {
  // (A move sent again from the same computer replaces the one before it.)
  if (p.kind === 'move') for (const [id, q] of pending) if (q.kind === 'move' && q.machine === p.machine) letGo(id)
  while (pending.size >= 8) letGo(pending.keys().next().value)
  const id = newId()
  // (Gone at the hour, whether or not anything asks about it.)
  const timer = setTimeout(() => pending.delete(id), WAIT_MS)
  timer.unref?.()
  pending.set(id, { ...p, id, at: Date.now(), timer })
  return id
}
const pendingOf = (id) => { const p = pending.get(String(id || '')); if (!p) throw fail('That isn\'t waiting any more: open it again', 404, 'gone'); return p }

// ---------- Moves ----------
const moveOf = (id) => state.moves.find((m) => m.id === id) || null
const viewMove = (m) => ({ id: m.id, to: m.to, toName: m.toName, at: m.at, state: m.state, pausedAt: m.pausedAt || null, error: m.error || null, bots: (m.bots || []).length, connections: (m.connections || []).length, routines: (m.routines || []).length })

// To another of your computers, over the link: what goes, and what it can pause here once it's
// applied there. One at a time: a move applied there is undone first (Start Here Again), and one
// still waiting there is called off (it's told so, and couldn't pause anything here now).
// (One after another, so two asked at once can't both be sent: the second calls the first off.)
let moving = Promise.resolve()
export function moveTo(machineId) {
  const go = moving.then(() => moveNow(machineId))
  moving = go.catch(() => {})
  return go
}
async function moveNow(machineId) {
  const m = machines.list().find((x) => x.id === machineId && x.state === 'linked')
  if (!m) throw fail('That computer isn\'t linked to this one', 404)
  const done = state.moves.find((y) => y.state === 'moved')
  if (done) throw fail(`This setup moved to ${done.toName} already: Start Here Again first, which has ${done.toName} pause it there, then move it`, 409, 'moved')
  if (!m.online) throw fail(`${m.name} is offline: open Bridge AI there, then Move again`, 409, 'offline')
  for (const y of state.moves.filter((z) => z.state === 'sending' || z.state === 'sent')) {
    y.state = 'cancelled'
    machines.callOn(y.to, 'POST', '/api/backup/withdrawn', { id: y.id }, 15000).catch(() => {})
  }
  const x = await collect()
  const id = newId()
  const rec = {
    id, to: m.id, toName: m.name, at: new Date().toISOString(), state: 'sending',
    bots: x.bots.map((b) => b.id), connections: x.connections.map((c) => c.id), live: x.connections.filter((c) => !c.paused).map((c) => c.id),
    routines: x.routines.filter((r) => routines.scheduleOf(r) && r.auto && !r.paused).map((r) => r.id),
  }
  state.moves = [rec, ...state.moves].slice(0, 50)
  saveState()
  try {
    await machines.callOn(m.id, 'POST', '/api/backup/incoming', { id, payload: x }, 120000)
    if (rec.state === 'sending') rec.state = 'sent'
    rec.error = null
  } catch (e) {
    rec.state = 'failed'
    rec.error = /\b404\b|Not found/i.test(e.message) ? `Update Bridge AI on ${m.name} to move to it` : e.message
  }
  saveState()
  if (rec.state === 'failed') throw fail(rec.error, 502)
  return viewMove(rec)
}
// Here: a move from another of your computers came (m: that one, as machines.js has it).
export function incoming(m, body = {}) {
  const x = checked(body.payload)
  const id = hold({ kind: 'move', x: { ...x, via: `Moved from ${m.name}` }, from: m.name, machine: m.id, move: String(body.id || '').slice(0, 40) })
  return { id, from: m.name }
}
// There: a move to here was called off before it was applied.
export function withdrawn(m, body = {}) {
  for (const [id, p] of pending) if (p.kind === 'move' && p.machine === m.id && p.move === String(body.id || '')) letGo(id)
  return { ok: true }
}
// There: the move was applied, so its bots, connections and scheduled routines here are paused,
// each marked as paused by it (and kept, those it paused, to start again if it's undone). Only the
// computer it went to says this, once, and only for the move that's waiting.
export function moved(m, body = {}) {
  const rec = moveOf(String(body.id || ''))
  if (!rec || rec.to !== m.id) throw fail('No such move to that computer', 404)
  if (rec.state === 'moved') return { ok: true, already: true, ...viewMove(rec) }
  const other = state.moves.find((y) => y.state === 'moved' && y.id !== rec.id)
  if (other) throw fail(`This setup moved to ${other.toName} already`, 409, 'moved')
  // (Given back to the computer it came from since it was sent: it answers there, not here to pass on.)
  if ((rec.live || rec.connections || []).some((id) => /^back:/.test(String(conns.get(id)?.pausedBy || '')))) throw fail(`${h.computer?.() || 'That computer'} gave it back to the computer it came from, where it answers now`, 409, 'given-back')
  if (rec.state !== 'sent') throw fail(`That move was ${rec.state === 'cancelled' ? 'called off' : rec.state} on ${h.computer?.() || 'that computer'}`, 409, 'not-waiting')
  const why = `Moved to ${rec.toName}: it answers there now`
  const paused = { bots: [], connections: [], routines: [] }
  for (const id of rec.connections || []) { const c = conns.get(id); if (c && !c.paused) { conns.save(id, { paused: true, pausedWhy: why, pausedBy: `move:${rec.id}` }); paused.connections.push(id) } }
  for (const id of rec.bots || []) { try { if (store.get(id) && !store.get(id).paused) { h.pauseBot?.(id, why); paused.bots.push(id) } } catch { /* gone since */ } }
  paused.routines = routines.setPaused(rec.routines || [], true)
  Object.assign(rec, { state: 'moved', pausedAt: new Date().toISOString(), error: null, paused })
  saveState()
  h.synced?.()
  return { ok: true, ...viewMove(rec) }
}
export function declined(m, body = {}) {
  const rec = moveOf(String(body.id || ''))
  if (!rec || rec.to !== m.id) throw fail('No such move to that computer', 404)
  if (rec.state === 'sent') { rec.state = 'declined'; saveState() }
  return { ok: true }
}
// Moved, then started here again (it's to answer here after all): the computer it went to is asked
// to pause it there first, and while it can't be reached nothing starts here. Then only what the
// move paused starts again.
export async function undo(id) {
  const rec = moveOf(String(id || ''))
  if (!rec || rec.state !== 'moved') throw fail('That move isn\'t one to undo', 404)
  try { await machines.callOn(rec.to, 'POST', '/api/backup/return', { id: rec.id }, 30000) } catch (e) {
    // (Turned down there: said as it says it. Not reached: said so.)
    if (e.said) throw fail(e.message, 409, e.said)
    throw fail(`${rec.toName} couldn't be reached to pause it there (${e.message}), so nothing starts here: open Bridge AI there, then Start Here Again`, 409, 'unreachable')
  }
  const p = rec.paused || {}
  for (const c of p.connections || []) { const x = conns.get(c); if (x?.paused && x.pausedBy === `move:${rec.id}`) conns.save(c, { paused: false, pausedWhy: null, pausedBy: null }) }
  for (const b of p.bots || []) { try { if (store.get(b)?.paused) h.unpauseBot?.(b) } catch { /* gone */ } }
  routines.setPaused(p.routines || [], false)
  rec.state = 'undone'
  saveState()
  h.synced?.()
  return viewMove(rec)
}
// Here: the computer a move came from is starting it there again, so what came with it is paused
// here (its connections marked back:<move>, to start again only with another move).
export function giveBack(m, body = {}) {
  const r = state.received.find((y) => y.move === String(body.id || '') && y.machine === m.id)
  if (!r) throw fail('Nothing here came with that move', 404)
  // (Moved on from here to another computer: it answers there, so this one can't give it back. That
  // one is to give it back here first: Start Here Again, here.)
  const on = (r.connections || []).map((id) => /^move:(.+)$/.exec(String(conns.get(id)?.pausedBy || ''))?.[1]).find(Boolean)
  const onward = on && moveOf(on)
  if (onward?.state === 'moved') throw fail(`${h.computer?.() || 'That computer'} moved it on to ${onward.toName}, where it answers now: Start Here Again on ${h.computer?.() || 'it'} first, then here`, 409, 'moved-on')
  // (A move of it on from here still waiting there is called off, and that computer told, so it can't
  // be applied there now it's given back.)
  const mine = new Set(r.connections || [])
  for (const y of state.moves.filter((z) => (z.state === 'sending' || z.state === 'sent') && (z.connections || []).some((id) => mine.has(id)))) {
    y.state = 'cancelled'
    machines.callOn(y.to, 'POST', '/api/backup/withdrawn', { id: y.id }, 15000).catch(() => {})
  }
  const why = `${r.from} took it back: it answers there now`
  for (const id of r.connections || []) { const c = conns.get(id); if (c && !(c.paused && /^back:/.test(c.pausedBy || ''))) conns.save(id, { paused: true, pausedWhy: why, pausedBy: `back:${r.move}` }) }
  for (const id of r.bots || []) { try { if (store.get(id) && !store.get(id).paused) h.pauseBot?.(id, why) } catch { /* gone */ } }
  routines.setPaused(r.routines || [], true)
  r.returned = new Date().toISOString()
  saveState()
  h.synced?.()
  return { ok: true }
}

// The computer it came from, asked to pause what it sent: then what came is started here. Not
// reached (or it says no): it stays paused, saying so.
async function handoff(r) {
  if (!r?.machine || !r.move) return r
  try {
    await machines.callOn(r.machine, 'POST', '/api/backup/moved', { id: r.move }, 30000)
    Object.assign(r, { handoff: 'done', error: null })
    for (const id of r.connections || []) { const c = conns.get(id); if (c?.paused && c.pausedBy === `in:${r.move}`) conns.save(id, { paused: false, pausedWhy: null, pausedBy: null }) }
    routines.setPaused(r.routines || [], false)
  } catch (e) {
    Object.assign(r, { handoff: 'failed', error: e.message })
    const why = `Moved from ${r.from}, which couldn't be reached to stop its bots there: stop them on ${r.from}, then Start here`
    for (const id of r.connections || []) if (conns.get(id)?.paused) conns.save(id, { pausedWhy: why })
  }
  saveState()
  h.synced?.()
  return r
}

// ---------- Routes ----------
// x: { here(req): asked from this computer, machineOf(req): the linked computer asking, or null;
// viaMachine(req), kept(req): not a device paired a moment ago that hasn't been kept yet, deviceOf,
// notify(o) }. Each answers with why it couldn't, and its status and code (not-kept: with this
// computer's name, for the device to say where it's kept).
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)) } catch (e) { res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message, ...(typeof e.code === 'string' ? { code: e.code } : {}), ...(e.computer ? { computer: e.computer } : {}) }) }
}
export function routes(app, x) {
  const hereOnly = (req, what) => { if (!x.here(req)) throw fail(`${what} on this computer itself`, 403, 'here') }
  // (From this computer, or a phone paired with it and kept there: never another computer's link.)
  const mine = (req) => {
    if (x.viaMachine(req)) throw fail('Another computer can\'t do that here', 403, 'machine')
    if (!x.kept(req)) throw Object.assign(fail(`Keep ${x.deviceOf?.(req) || 'that device'} in Bridge AI on ${h.computer?.() || 'this computer'} first`, 403, 'not-kept'), { computer: h.computer?.() || null })
  }
  const fromMachine = (req) => { const m = x.machineOf(req); if (!m) throw fail('Only another of your computers sends this', 403); return m }
  const pausedNow = () => conns.list().filter((c) => c.paused).map((c) => {
    const by = String(c.pausedBy || '')
    const mv = /^move:(.+)$/.exec(by)?.[1]
    const rec = mv ? moveOf(mv) : null
    return { id: c.id, name: c.name, platform: c.platform, shared: c.shared, why: c.pausedWhy, by: by.split(':')[0] || null, ...(rec ? { movedTo: rec.toName, move: rec.id } : {}), ...(by.startsWith('back:') ? { takenBack: true } : {}) }
  })

  app.get('/api/backup', wrap((req) => {
    mine(req)
    const defs = routines.readDefs()
    return {
      computer: h.computer?.() || null, here: !!x.here(req), passMin: PASS_MIN,
      linked: machines.list().filter((m) => m.state === 'linked').map((m) => ({ id: m.id, name: m.name, online: m.online })),
      incoming: [...pending.values()].filter((p) => p.kind === 'move').map((p) => ({ id: p.id, from: p.from, at: new Date(p.at).toISOString(), madeAt: p.x.madeAt || null })),
      moves: state.moves.slice(0, 10).map(viewMove),
      last: state.last ? { kind: state.last.kind, from: state.last.from, at: state.last.at, handoff: state.last.handoff || null, error: state.last.error || null, started: state.last.started || null } : null,
      paused: { connections: pausedNow(), routines: defs.filter((d) => d.paused && (state.last?.routines || []).includes(d.id)).map((d) => ({ id: d.id, name: d.name })) },
    }
  }))
  // One file, sealed with your passphrase: made only here (it's to save on this computer).
  app.post('/api/backup/file', async (req, res) => {
    try {
      hereOnly(req, 'Back up to a file')
      checkPass(req.body?.passphrase)
      const file = await seal(await collect(), req.body.passphrase)
      const name = `${clean(file.from, 60).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'Bridge-AI'}-${file.madeAt.slice(0, 10)}.bridge-backup`
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('content-disposition', `attachment; filename="${name}"`)
      res.send(JSON.stringify(file, null, 2))
    } catch (e) { res.status(e.status || 502).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }) }
  })
  // A file and its passphrase: what it holds, waiting to be applied (or let go).
  app.post('/api/backup/open', wrap(async (req) => {
    hereOnly(req, 'Restore from a file')
    let file = req.body?.file
    if (typeof file === 'string') { try { file = JSON.parse(file) } catch { throw fail('That isn\'t a Bridge AI backup', 400, 'not-backup') } }
    const got = await unseal(file, req.body?.passphrase)
    const from = clean(got.from, 80)
    const id = hold({ kind: 'file', x: { ...got, via: `Restored from a backup of ${from}: stop its bots on ${from} first (an app can't be connected from two computers at once), then Start` }, from })
    return { id, plan: await planOf(got, { kind: 'file' }) }
  }))
  // What a move that came would add (named as the link names the computer it's from).
  app.get('/api/backup/pending/:id', wrap(async (req) => { mine(req); const p = pendingOf(req.params.id); return { id: p.id, kind: p.kind, from: p.from, plan: await planOf(p.x, { kind: p.kind, from: p.from }) } }))
  // Applied, as you said: a file's from here only; a move's from here or a phone paired with this
  // computer, never through another computer's link (so the one it came from can't say yes for you).
  app.post('/api/backup/apply', wrap(async (req) => {
    const p = pendingOf(req.body?.id)
    if (p.kind === 'file') hereOnly(req, 'Restore from a file')
    mine(req)
    letGo(p.id)
    const move = p.kind === 'move'
    const why = move ? `Moved from ${p.from}: waiting for ${p.from} to stop its bots` : p.x.via
    const r = await apply(p.x, { parts: req.body?.parts || {}, why, pausedBy: move ? `in:${p.move}` : 'restore', kind: p.kind, req })
    const got = { from: p.from, at: new Date().toISOString(), bots: r.bots.map((b) => b.id), connections: r.connections.filter((c) => !c.wasPaused).map((c) => c.id), routines: r.routines.filter((y) => y.paused).map((y) => y.id) }
    state.last = { kind: p.kind, ...got, ...(move ? { machine: p.machine, move: p.move, handoff: 'asking' } : {}) }
    if (move) state.received = [{ move: p.move, machine: p.machine, ...got }, ...state.received.filter((y) => y.move !== p.move)].slice(0, 20)
    saveState()
    const last = move ? await handoff(state.last) : state.last
    return { ...r, handoff: last.handoff || null, error: last.error || null, paused: pausedNow() }
  }))
  app.post('/api/backup/discard', wrap(async (req) => {
    const p = pending.get(String(req.body?.id || ''))
    if (!p) return { ok: true }
    if (p.kind === 'file') hereOnly(req, 'Restore from a file')
    mine(req)
    letGo(p.id)
    if (p.kind === 'move') machines.callOn(p.machine, 'POST', '/api/backup/declined', { id: p.move }, 15000).catch(() => {})
    return { ok: true }
  }))
  // The computer a move came from, asked again to stop its bots; or what came, started anyway.
  app.post('/api/backup/handoff', wrap(async (req) => { mine(req); const l = await handoff(state.last); return { handoff: l?.handoff || null, error: l?.error || null, paused: pausedNow() } }))
  app.post('/api/backup/start', wrap((req) => {
    mine(req)
    const ids = Array.isArray(req.body?.connections) ? req.body.connections.map(String) : null
    return { ...start({ connections: ids }), paused: pausedNow() }
  }))
  // To another of your computers.
  app.post('/api/backup/move', wrap(async (req) => { mine(req); return moveTo(String(req.body?.to || '')) }))
  app.post('/api/backup/moves/:id/undo', wrap(async (req) => { mine(req); return undo(req.params.id) }))
  // Another of your computers: a move for this one, called off there, applied there, turned down
  // there, or taken back there.
  app.post('/api/backup/incoming', wrap((req) => {
    const m = fromMachine(req)
    const r = incoming(m, req.body || {})
    x.notify?.({ kind: 'machine', title: `${m.name} is moving its Bridge AI setup here`, body: `See what comes in ${placeEn('backup', { accounts: accountsOn() })}, and apply it there.`, url: '/#settings/backup', tag: `backup-${r.id}` })
    return r
  }))
  app.post('/api/backup/withdrawn', wrap((req) => withdrawn(fromMachine(req), req.body || {})))
  app.post('/api/backup/moved', wrap((req) => moved(fromMachine(req), req.body || {})))
  app.post('/api/backup/declined', wrap((req) => declined(fromMachine(req), req.body || {})))
  app.post('/api/backup/return', wrap((req) => giveBack(fromMachine(req), req.body || {})))
}
