// Back Up & Move (Settings › Back Up & Move): this computer's Bridge AI setup, carried to another
// computer when you change computers or the one it runs on is replaced. Two ways:
//   Back Up: one file, everything in it sealed with a passphrase you pick (scrypt makes the key from
//     it, with a salt of its own; AES-256-GCM seals it, with a nonce of its own, and the file's
//     header is sealed in too, so a header changed shows). Nothing in the file is readable without
//     the passphrase: not a token, not a bot's instructions, not what it remembers. Restore on the
//     other computer: the file and the passphrase, what will be added, and nothing applied until
//     you say so. A wrong passphrase says so.
//   Move: straight to another of your computers, over the end-to-end encrypted link between them
//     (machines.js), with no passphrase. It shows there what's coming, and applies it once you say
//     so there (from that computer, or a phone paired with it: never from this one through the link).
//
// What's in it: each bot (its settings, instructions and what it remembers: bots.js bundleOf, as a
// bot's own export), each connection with its tokens (connections.js; the fields each connector
// keeps, TOKEN_FIELDS), your routines, the Chief of Staff's playbook, ledger and task list, each
// agent's user-level MCP servers (mcp.js), and the settings that mean the same on another computer
// (SETTINGS). What isn't: this computer's own (its name, its key, its relay and its keys, the
// devices paired or linked with it, your Bold Bridge sign-in, the agents' and model providers'
// sign-ins, its port, update channel and caches), meetings and recordings (often gigabytes: Files ›
// Send to… copies them), and each bot's record, its files and drafts waiting (they stay with the
// computer that made them).
//
// One app can't be connected from two computers at once: Slack's Socket Mode would hand each of its
// events to one of them, so each would see some questions and miss the rest. So nothing runs twice:
//   Move: what comes is applied with its connections (and scheduled routines) paused; this computer
//     is asked over the link to pause the bots, connections and scheduled routines it sent, and only
//     once it says it has are they started there. One that can't be reached stays as it is, and the
//     other says so, with Try Again and Start.
//   Restore: its connections and scheduled routines arrive paused, saying to stop the bots on the
//     computer the backup came from first, with Start in one click.
//
// What comes (a file opened, a move sent here) waits in memory only, until it's applied or let go,
// an hour at most: its tokens are never written anywhere but where they go. What happened (moves sent
// from here, the last one applied here) is in backup.json, which never holds a token. Nothing here
// logs a token, a passphrase or what a backup holds.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { dataFile, writeFileAtomic, ROOT, HOME } from './paths.js'
import * as store from './bots.js'
import * as conns from './connections.js'
import * as routines from './routines.js'
import * as settings from './settings.js'
import * as mcp from './mcp.js'
import * as machines from './machines.js'

export const FILE_KIND = 'bridge-ai-backup' // the file
const KIND = 'bridge-ai-setup' // what's sealed in it, and what a move sends
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version } catch { return '0' } })()
const STATE = dataFile('backup.json')
const CHIEF = dataFile('chief', 'state')
const CHIEF_FILES = ['playbook.md', 'ledger.md', 'tasks.md']
const PASS_MIN = 8
const WAIT_MS = 60 * 60 * 1000 // what came, waiting to be applied
const PLATFORM = { slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams' }
// The key from the passphrase: scrypt, N 2^17 (128 MB, half a second or so). A file asks for its
// own, within these bounds, so one made to make this computer work forever is turned away.
const KDF = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 }
const okKdf = (k) => k?.name === 'scrypt' && Number.isInteger(k.N) && k.N >= 2 ** 14 && k.N <= 2 ** 20 && (k.N & (k.N - 1)) === 0 && Number.isInteger(k.r) && k.r >= 1 && k.r <= 16 && Number.isInteger(k.p) && k.p >= 1 && k.p <= 4

// The settings that mean the same on another computer, by their key in config.json. Left out: where
// this one listens (port, host, allowedHosts), its runtime and herdr's session, its own name
// (deviceName), its agents' paths, its local model, the terminal app, its update channel and
// early-access code, the assistant's folder, whether outside apps may send to its agents through
// Bridge AI's MCP server (mcpServer: each computer's own say), sign-ins, and what's only kept for
// its own start.
const SETTINGS = ['name', 'location', 'defaultAgent', 'chief', 'mail', 'market', 'mortgage', 'news', 'quota', 'simple', 'moreModels', 'keepAgents', 'trials', 'alertSounds', 'notify', 'voice', 'studio', 'consult', 'resumeWork', 'filesAssist', 'modelJobs', 'llmModel', 'dictation', 'meetings', 'calendar', 'commands', 'crashReports', 'counts']
// (Meetings' folder is a folder of this computer's. And a beta feature that lets another device see
// or use this screen is turned on only by someone at this computer: remote-screen stays as it is.)
const PER_COMPUTER_TRIALS = ['remote-screen']
const settingsOf = (all) => {
  const out = {}
  for (const k of SETTINGS) if (all?.[k] !== undefined) out[k] = all[k]
  if (out.meetings && typeof out.meetings === 'object') { const { folder, ...rest } = out.meetings; out.meetings = rest } // eslint-disable-line no-unused-vars
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
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]))
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const fail = (message, status = 400, code = undefined) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const newId = () => crypto.randomBytes(9).toString('base64url')
const expand = (p) => path.resolve(String(p || '').replace(/^~(?=$|[\\/])/, HOME))

// ---------- What happened, kept ----------
// { moves: [{ id, to, toName, at, state, bots, connections, routines, pausedAt, error }], last: {
// kind, from, at, connections, routines, handoff, error, machine, move } }
let state = readJson(STATE) || {}
state.moves = Array.isArray(state.moves) ? state.moves : []
const saveState = () => { try { writeFileAtomic(STATE, JSON.stringify(state, null, 2), { mode: 0o600 }) } catch (e) { console.log(`Back Up & Move couldn't keep what happened: ${e.message}`) } }

// ---------- What this computer has ----------
// h: what index.js gives (memoryOf, computer, installed).
let h = {}
export function use(o) { h = { ...h, ...o } }

// Everything that goes, as it is now: nothing sealed yet.
export async function collect() {
  const bots = store.live().map((b) => ({ id: b.id, paused: b.paused, bundle: store.bundleOf(b.id, h.memoryOf?.(b.id) || []) }))
  const ids = new Set(bots.map((b) => b.id))
  const connections = conns.list().filter((c) => !c.bot || ids.has(c.bot)).map((c) => ({
    id: c.id, platform: c.platform, name: c.name, shared: c.shared, bot: c.bot, owner: c.owner, defaults: c.defaults.filter((d) => ids.has(d.bot)), perBot: c.perBot,
    tokens: pick(readJson(conns.tokensOf(c)) || {}, TOKEN_FIELDS[c.platform] || []),
  }))
  const chief = {}
  for (const f of CHIEF_FILES) { try { chief[f] = fs.readFileSync(path.join(CHIEF, f), 'utf8') } catch { /* not made yet */ } }
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
  const salt = crypto.randomBytes(16)
  const nonce = crypto.randomBytes(12)
  const f = { kind: FILE_KIND, v: 1, madeAt: payload.madeAt, from: clean(payload.from, 80), app: VERSION, kdf: { ...KDF, salt: salt.toString('base64') } }
  const key = await scrypt(passphrase, salt, f.kdf)
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce)
  c.setAAD(headerOf(f))
  const sealed = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(payload)))), c.final()])
  return { ...f, cipher: { name: 'aes-256-gcm', nonce: nonce.toString('base64'), tag: c.getAuthTag().toString('base64') }, sealed: sealed.toString('base64') }
}
// A file back to what it holds: a wrong passphrase (or a file changed since) says so.
export async function unseal(file, passphrase) {
  if (!file || typeof file !== 'object' || file.kind !== FILE_KIND) throw fail('That isn\'t a Bridge AI backup', 400, 'not-backup')
  if (file.v !== 1) throw fail('That backup was made by a newer Bridge AI: update this one first', 400, 'newer')
  if (!okKdf(file.kdf) || file.cipher?.name !== 'aes-256-gcm' || typeof file.sealed !== 'string') throw fail('That backup is damaged', 400, 'damaged')
  if (typeof passphrase !== 'string' || !passphrase) throw fail('Type the passphrase it was made with', 400, 'passphrase')
  const key = await scrypt(passphrase, Buffer.from(String(file.kdf.salt || ''), 'base64'), file.kdf)
  let raw
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(file.cipher.nonce || ''), 'base64'))
    d.setAAD(headerOf(file))
    d.setAuthTag(Buffer.from(String(file.cipher.tag || ''), 'base64'))
    raw = Buffer.concat([d.update(Buffer.from(file.sealed, 'base64')), d.final()])
  } catch { throw fail('That passphrase doesn\'t open this backup', 403, 'passphrase') }
  let x
  try { x = JSON.parse(zlib.gunzipSync(raw, { maxOutputLength: 512 * 1024 * 1024 }).toString('utf8')) } catch { throw fail('That backup is damaged', 400, 'damaged') }
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
// Each bot by its name, with a number after it when that's taken here (as a bot's own import:
// bots.js fromBundle), and the folders it reads that aren't on this computer; each connection, or
// why not (a platform's shared one, where there's one here already: the bots use the one here);
// each routine, renamed the same way; the Chief of Staff's files, and which differ from the ones
// here (those are kept beside them); each MCP server, or why not; the settings that would change.
export async function planOf(x) {
  const taken = new Set(store.list().map((b) => b.name.toLowerCase()))
  const bots = x.bots.map((b) => {
    const want = clean(b.bundle?.name, store.NAME_MAX) || 'Imported bot'
    let as = want
    for (let i = 2; taken.has(as.toLowerCase()) && i < 100; i++) as = `${want.slice(0, store.NAME_MAX - 4)} (${i})`
    taken.add(as.toLowerCase())
    const reads = Array.isArray(b.bundle?.settings?.readsFrom) ? b.bundle.settings.readsFrom.map(String) : []
    return { key: b.id, name: want, as, renamed: as !== want, missing: reads.filter((p) => !fs.existsSync(expand(p))) }
  })
  const botName = (id) => bots.find((b) => b.key === id)?.as || null
  const connections = x.connections.map((c) => {
    const base = { key: c.id, name: clean(c.name, 35), platform: c.platform, shared: !c.bot, bot: c.bot ? botName(c.bot) : null, tokens: Object.keys(c.tokens || {}).length > 0 }
    if (!PLATFORM[c.platform]) return { ...base, skip: 'not a platform Bridge AI knows' }
    if (c.bot && !botName(c.bot)) return { ...base, skip: 'its bot isn\'t in it' }
    if (!c.bot && conns.sharedOf(c.platform)) return { ...base, skip: `there's a shared ${PLATFORM[c.platform]} connection here already, which its bots use` }
    return base
  })
  const names = new Set(routines.readDefs().map((d) => d.name.toLowerCase()))
  const rs = x.routines.filter((r) => r && String(r.name || '').trim()).map((r) => {
    const want = String(r.name).slice(0, 120)
    let as = want
    for (let i = 2; names.has(as.toLowerCase()) && i < 100; i++) as = `${want} (${i})`
    names.add(as.toLowerCase())
    const scheduled = !!routines.scheduleOf(r) && !!r.auto && !r.paused
    return { key: r.id, name: want, as, renamed: as !== want, scheduled, ...(r.to === 'bot' && !botName(r.bot) ? { skip: 'its bot isn\'t in it' } : {}) }
  })
  const chief = Object.entries(x.chief).filter(([f, t]) => CHIEF_FILES.includes(f) && typeof t === 'string').map(([f, t]) => {
    let here = null
    try { here = fs.readFileSync(path.join(CHIEF, f), 'utf8') } catch { /* none here */ }
    return { file: f, differs: here != null && here !== t }
  })
  const agents = await mcp.agentsHere(h.installed || (async () => []))
  const servers = x.mcp.map((s) => {
    const a = agents.find((y) => y.kind === s.kind)
    // (What it runs, or where it's reached, shown before it's added: it runs whenever that agent starts.)
    const v = mcp.viewRaw(s.kind, s.name, s.raw)
    const how = v?.command ? { runs: [v.command, ...(v.args || [])].join(' ').slice(0, 200) } : v?.url ? { at: String(v.url).slice(0, 200) } : {}
    return { name: s.name, kind: s.kind, agent: a?.label || s.kind, ...how, ...(!a ? { skip: 'that agent isn\'t on this computer' } : mcp.hasServer(s.kind, s.name) ? { skip: 'it has one by that name already' } : {}) }
  })
  const now = settings.readUser()
  const keys = Object.keys(settingsOf(x.settings))
  return {
    from: clean(x.from, 80), madeAt: x.madeAt || null, app: x.app || null,
    bots, connections, routines: rs, chief, mcp: servers,
    settings: { keys, changes: keys.filter((k) => JSON.stringify(now[k]) !== JSON.stringify(x.settings[k])) },
  }
}

// ---------- Applied here ----------
// parts: which of it ({ bots, connections, routines, chief, mcp, settings }, each on unless false).
// why: what a connection brought here says while it's paused. Its connections and scheduled
// routines arrive paused, always. h.bring(bundle, { paused, why }): a bot made from its bundle
// ({ bot, renamed }), connected and its memory kept (index.js); h.saveSettings(patch); h.teamsPort();
// h.synced(): connections started or stopped as they now are.
export async function apply(x, { parts = {}, why = 'Paused' } = {}) {
  const on = (k) => parts[k] !== false
  const out = { bots: [], connections: [], routines: [], chief: [], mcp: [], settings: [], problems: [] }
  // (Settings first: Bots, a beta feature, is on here once its setting is.)
  if (on('settings')) {
    const p = settingsOf(x.settings)
    if (Object.keys(p).length) { try { h.saveSettings(p); out.settings = Object.keys(p) } catch (e) { out.problems.push(`The settings couldn't be saved: ${e.message}`) } }
  }
  const map = {}
  if (on('bots')) {
    for (const b of x.bots) {
      try {
        const r = h.bring(b.bundle, { paused: b.paused === true, why: x.via })
        map[b.id] = r.bot.id
        out.bots.push({ from: b.id, id: r.bot.id, name: r.bot.name, renamed: r.renamed })
      } catch (e) { out.problems.push(`${clean(b.bundle?.name, 40) || 'A bot'} couldn't be added: ${e.message}`) }
    }
  }
  if (on('connections')) {
    for (const c of x.connections) {
      if (!PLATFORM[c.platform] || (c.bot && !map[c.bot]) || (!c.bot && conns.sharedOf(c.platform))) continue
      try {
        const made = conns.create({ platform: c.platform, name: c.name, shared: !c.bot, bot: c.bot ? map[c.bot] : null, owner: c.owner || null, teamsPort: c.platform === 'teams' ? h.teamsPort?.() ?? null : null, paused: true, pausedWhy: why })
        // (Its tokens before anything can start it: it's paused, and nothing waits in between.)
        writeFileAtomic(conns.tokensOf(made), JSON.stringify(pick(c.tokens || {}, TOKEN_FIELDS[c.platform] || []), null, 2), { mode: 0o600 })
        if (!c.bot) conns.save(made.id, { perBot: c.perBot === true, defaults: (c.defaults || []).map((d) => (map[d.bot] ? { ...d, bot: map[d.bot] } : null)).filter(Boolean) })
        out.connections.push({ from: c.id, id: made.id, name: made.name, platform: made.platform, shared: made.shared })
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
        fs.mkdirSync(CHIEF, { recursive: true })
        const at = path.join(CHIEF, f)
        let had = null
        try { had = fs.readFileSync(at, 'utf8') } catch { /* none */ }
        if (had === text) continue
        // (The one here kept beside it, so nothing of it is lost.)
        if (had != null) writeFileAtomic(path.join(CHIEF, f.replace(/\.md$/, '.before-restore.md')), had)
        writeFileAtomic(at, text)
        out.chief.push(f)
      } catch (e) { out.problems.push(`The Chief of Staff's ${f} couldn't be written: ${e.message}`) }
    }
  }
  if (on('mcp')) {
    for (const s of x.mcp) {
      const r = await mcp.addRaw(h.installed || (async () => []), s)
      out.mcp.push({ name: s.name, kind: s.kind, ok: r.ok, ...(r.ok ? {} : { error: r.error }) })
    }
  }
  h.synced?.()
  return out
}

// ---------- Started (one click), and paused ----------
// The connections paused here because they moved to another computer: those start again only with
// that move undone (undo), bots and all, never with Start.
const movedAway = () => new Map(state.moves.filter((m) => m.state === 'moved').flatMap((m) => (m.connections || []).map((id) => [id, m])))
// A connection brought here, started: it connects now.
export function start({ connections = null, routines: rs = null } = {}) {
  const want = connections ? new Set(connections) : null
  const away = movedAway()
  const started = []
  for (const c of conns.list()) if (c.paused && !away.has(c.id) && (!want || want.has(c.id))) { conns.save(c.id, { paused: false, pausedWhy: null }); started.push(c.id) }
  const ids = rs || state.last?.routines || []
  const resumed = routines.setPaused(ids, false)
  if (state.last && (!want || (state.last.connections || []).every((id) => want.has(id)))) { state.last.started = new Date().toISOString(); saveState() }
  h.synced?.()
  return { connections: started, routines: resumed }
}

// ---------- Pending: what came, waiting for you ----------
const pending = new Map() // id -> { id, kind: 'file' | 'move', x, from, at, machine, move }
const sweep = () => { for (const [id, p] of pending) if (Date.now() - p.at > WAIT_MS) pending.delete(id) }
function hold(p) {
  sweep()
  // (A move sent again from the same computer replaces the one before it.)
  if (p.kind === 'move') for (const [id, q] of pending) if (q.kind === 'move' && q.machine === p.machine) pending.delete(id)
  while (pending.size >= 8) pending.delete(pending.keys().next().value)
  const id = newId()
  pending.set(id, { ...p, id, at: Date.now() })
  return id
}
const pendingOf = (id) => { sweep(); const p = pending.get(String(id || '')); if (!p) throw fail('That isn\'t waiting any more: open it again', 404, 'gone'); return p }

// ---------- Moves ----------
const moveOf = (id) => state.moves.find((m) => m.id === id) || null
const viewMove = (m) => ({ id: m.id, to: m.to, toName: m.toName, at: m.at, state: m.state, pausedAt: m.pausedAt || null, error: m.error || null, bots: (m.bots || []).length, connections: (m.connections || []).length, routines: (m.routines || []).length })

// To another of your computers, over the link: what goes, and what it can pause here once it's
// applied there.
export async function moveTo(machineId) {
  const m = machines.list().find((x) => x.id === machineId && x.state === 'linked')
  if (!m) throw fail('That computer isn\'t linked to this one', 404)
  if (!m.online) throw fail(`${m.name} is offline: open Bridge AI there, then Move again`, 409, 'offline')
  const x = await collect()
  const id = newId()
  const rec = {
    id, to: m.id, toName: m.name, at: new Date().toISOString(), state: 'sending',
    bots: x.bots.map((b) => b.id), connections: x.connections.map((c) => c.id),
    routines: x.routines.filter((r) => routines.scheduleOf(r) && r.auto && !r.paused).map((r) => r.id),
  }
  state.moves = [rec, ...state.moves.filter((y) => y.state !== 'sending' || y.to !== m.id)].slice(0, 20)
  saveState()
  try {
    await machines.callOn(m.id, 'POST', '/api/backup/incoming', { id, payload: x }, 120000)
    rec.state = 'sent'
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
// There: the move was applied, so its bots, connections and scheduled routines here are paused.
// h.pauseBot(id, why): a bot paused, in its record. Only the computer it went to says this.
export function moved(m, body = {}) {
  const rec = moveOf(String(body.id || ''))
  if (!rec || rec.to !== m.id) throw fail('No such move to that computer', 404)
  if (rec.state === 'moved') return { ok: true, already: true, ...viewMove(rec) }
  const why = `Moved to ${rec.toName}: it answers there now`
  for (const id of rec.connections || []) if (conns.get(id)) conns.save(id, { paused: true, pausedWhy: why })
  for (const id of rec.bots || []) { try { if (store.get(id) && !store.get(id).paused) h.pauseBot?.(id, why) } catch { /* gone since */ } }
  routines.setPaused(rec.routines || [], true)
  Object.assign(rec, { state: 'moved', pausedAt: new Date().toISOString(), error: null })
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
// Moved, then started here again (it's to answer here after all): its bots, connections and
// scheduled routines as they were.
export function undo(id) {
  const rec = moveOf(String(id || ''))
  if (!rec || rec.state !== 'moved') throw fail('That move isn\'t one to undo', 404)
  for (const c of rec.connections || []) if (conns.get(c)?.paused) conns.save(c, { paused: false, pausedWhy: null })
  for (const b of rec.bots || []) { try { if (store.get(b)?.paused) h.unpauseBot?.(b) } catch { /* gone */ } }
  routines.setPaused(rec.routines || [], false)
  rec.state = 'undone'
  saveState()
  h.synced?.()
  return viewMove(rec)
}

// The computer it came from, asked to pause what it sent: then what came is started here. Not
// reached: it stays paused, saying so.
async function handoff() {
  const l = state.last
  if (!l?.machine || !l.move) return l
  try {
    await machines.callOn(l.machine, 'POST', '/api/backup/moved', { id: l.move }, 30000)
    Object.assign(l, { handoff: 'done', error: null })
    for (const id of l.connections || []) if (conns.get(id)?.paused) conns.save(id, { paused: false, pausedWhy: null })
    routines.setPaused(l.routines || [], false)
  } catch (e) {
    Object.assign(l, { handoff: 'failed', error: e.message })
    const why = `Moved from ${l.from}, which couldn't be reached to stop its bots there: stop them on ${l.from}, then Start here`
    for (const id of l.connections || []) if (conns.get(id)?.paused) conns.save(id, { pausedWhy: why })
  }
  saveState()
  h.synced?.()
  return l
}

// ---------- Routes ----------
// x: { here(req): asked from this computer, machineOf(req): the linked computer asking, or null;
// viaMachine(req), notify(o) }. Each answers with why it couldn't, and its status and code.
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)) } catch (e) { res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message, ...(typeof e.code === 'string' ? { code: e.code } : {}) }) }
}
export function routes(app, x) {
  const hereOnly = (req, what) => { if (!x.here(req)) throw fail(`${what} on this computer itself`, 403, 'here') }
  const notAfar = (req) => { if (x.viaMachine(req)) throw fail('Another computer can\'t do that here', 403, 'machine') }
  const fromMachine = (req) => { const m = x.machineOf(req); if (!m) throw fail('Only another of your computers sends this', 403); return m }
  const pausedNow = () => { const away = movedAway(); return conns.list().filter((c) => c.paused).map((c) => ({ id: c.id, name: c.name, platform: c.platform, shared: c.shared, why: c.pausedWhy, ...(away.has(c.id) ? { movedTo: away.get(c.id).toName, move: away.get(c.id).id } : {}) })) }

  app.get('/api/backup', wrap((req) => {
    sweep()
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
    return { id, plan: await planOf(got) }
  }))
  // What a move that came would add.
  app.get('/api/backup/pending/:id', wrap(async (req) => { const p = pendingOf(req.params.id); return { id: p.id, kind: p.kind, from: p.from, plan: await planOf(p.x) } }))
  // Applied, as you said: a file's from here only; a move's from here or a phone paired with this
  // computer, never through another computer's link (so the one it came from can't say yes for you).
  app.post('/api/backup/apply', wrap(async (req) => {
    const p = pendingOf(req.body?.id)
    if (p.kind === 'file') hereOnly(req, 'Restore from a file')
    else notAfar(req)
    pending.delete(p.id)
    const why = p.kind === 'move' ? `Moved from ${p.from}: waiting for ${p.from} to stop its bots` : p.x.via
    const r = await apply(p.x, { parts: req.body?.parts || {}, why })
    state.last = { kind: p.kind, from: p.from, at: new Date().toISOString(), connections: r.connections.map((c) => c.id), routines: r.routines.filter((y) => y.paused).map((y) => y.id), ...(p.kind === 'move' ? { machine: p.machine, move: p.move, handoff: 'asking' } : {}) }
    saveState()
    const last = p.kind === 'move' ? await handoff() : state.last
    return { ...r, handoff: last.handoff || null, error: last.error || null, paused: pausedNow() }
  }))
  app.post('/api/backup/discard', wrap(async (req) => {
    const p = pending.get(String(req.body?.id || ''))
    if (!p) return { ok: true }
    if (p.kind === 'file') hereOnly(req, 'Restore from a file')
    else notAfar(req)
    pending.delete(p.id)
    if (p.kind === 'move') machines.callOn(p.machine, 'POST', '/api/backup/declined', { id: p.move }, 15000).catch(() => {})
    return { ok: true }
  }))
  // The computer a move came from, asked again to stop its bots; or what came, started anyway.
  app.post('/api/backup/handoff', wrap(async (req) => { notAfar(req); const l = await handoff(); return { handoff: l?.handoff || null, error: l?.error || null, paused: pausedNow() } }))
  app.post('/api/backup/start', wrap((req) => {
    notAfar(req)
    const ids = Array.isArray(req.body?.connections) ? req.body.connections.map(String) : null
    return { ...start({ connections: ids }), paused: pausedNow() }
  }))
  // To another of your computers.
  app.post('/api/backup/move', wrap(async (req) => { notAfar(req); return moveTo(String(req.body?.to || '')) }))
  app.post('/api/backup/moves/:id/undo', wrap((req) => { notAfar(req); return undo(req.params.id) }))
  // Another of your computers: a move for this one, applied there, or turned down there.
  app.post('/api/backup/incoming', wrap((req) => {
    const m = fromMachine(req)
    const r = incoming(m, req.body || {})
    x.notify?.({ kind: 'machine', title: `${m.name} is moving its Bridge AI setup here`, body: 'See what comes in Settings › Back Up & Move, and apply it there.', url: '/#settings/backup', tag: `backup-${r.id}` })
    return r
  }))
  app.post('/api/backup/moved', wrap((req) => moved(fromMachine(req), req.body || {})))
  app.post('/api/backup/declined', wrap((req) => declined(fromMachine(req), req.body || {})))
}
