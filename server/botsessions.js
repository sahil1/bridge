// Bots' sessions (Bots, a beta feature): each conversation a bot is in (a Slack thread, a direct
// message, a channel's run of questions) is a live Claude Code session of its own, in the bot's
// folder, that remembers the conversation and goes on from it: the first question starts it, as an
// answer always started (frontdesk.js answer), and each next message is typed into it as its next
// turn (frontdesk.js turnInto), marked off as someone else's words, as a question always was.
// Codex and a model answering stay one run a message: a session needs Claude Code.
//
// Kept in front-desk/sessions.json, one record a session: { id, bot, convs (the conversations it's
// in: a direct message is one session for 8 hours, DM_FRESH_MS, or until !new), channel, place,
// reply, dm, person, people (who has spoken in it), tier, kind, helper and paneId (its agent),
// claudeSession (its conversation, to go on from with --resume), cwd, access, route, sig (what it
// was started with: folders, tools, commands), tree (its copy of a repository), stage (its copy of
// the folders it changes files in: stage.json beside it), mcpDir, bash, state: live | idle | closed,
// startedAt, lastAt, turns, ran, totals, ended }. And a folder for each, front-desk/sessions/<id>/:
// files/turn-N/ (the files attached to each turn), turns/ (a turn too long to type, written for its
// agent to read), stage.json. Its settings, MCP config, guard log and requests are its run folder's
// (botmcp.js runFolder: front-desk/mcp/<id>/), which its agent can't read.
//
// What must hold (frontdesk.js holds it):
//   Its tier never widens. A session is started, and started again, with what may be done for
//   everyone who has spoken in it (tier: you, people you named, anyone who may ask): the lowest of
//   them. Someone with less joining narrows it, and it's started again (--resume) with less; it's
//   never started with more than it had, so words someone put in it earlier can't use what a later
//   person may do.
//   Started again (its pane closed for being idle, IDLE_MS; Bridge AI started again; settings
//   changed), it's started exactly as it was, from its own files (agents.js mcpOf reads its settings
//   file: a run folder that's gone starts it with less, never more), and what it was started with is
//   looked at before a turn is typed in (the pane's access; its sig).
//   At most LIVE_MAX panes at once (the least recently used idle one closed first); one idle
//   IDLE_MS is closed, and stays resumable for KEEP_MS (7 days), then it's put away. Only a turn at
//   work counts toward a bot's at-once and the desk's limits.
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataFile, writeFileAtomic, HOME } from './paths.js'
import * as store from './bots.js'
import * as conns from './connections.js'
import * as botwrite from './botwrite.js'
import { COMMANDS, COMMANDS_OFF } from './agents.js'

export const DIR = dataFile('front-desk', 'sessions')
const FILE = dataFile('front-desk', 'sessions.json')
const num = (v, d) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : d)
export const IDLE_MS = num(process.env.BRIDGE_SESSION_IDLE_MS, 30 * 60000)
export const KEEP_MS = num(process.env.BRIDGE_SESSION_KEEP_MS, 7 * 86400000)
export const DM_FRESH_MS = num(process.env.BRIDGE_SESSION_DM_MS, 8 * 3600000)
export const LIVE_MAX = num(process.env.BRIDGE_SESSION_LIVE_MAX, 6)
export const TYPED_MAX = 2048 // a turn longer than this goes in a file its agent is pointed to
const KEPT = 500 // sessions remembered, the latest; the ones still going are always kept
const SID = /^s\d{1,7}$/
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
export const dirOf = (sid) => (SID.test(String(sid)) ? path.join(DIR, String(sid)) : null)
// A session's own temporary folder (CLAUDE_CODE_TMPDIR and TMPDIR: Claude Code's own files and its
// commands' go in it, code.claude.com/docs/en/env-vars), apart from its folder, which its commands
// may only read; nobody else's temporary files are readable to it (botmcp.js sandboxOf). Gone with it.
export const TMP = dataFile('front-desk', 'tmp')
export const tmpOf = (sid) => (SID.test(String(sid)) ? path.join(TMP, String(sid)) : null)
// What a session's agent starts with besides what it keeps of yours (botenv.js): its temporary
// folder; git's settings of its own, its name as the author and nothing of yours (your ~/.gitconfig,
// its includes and credential helpers, the system's: GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM), in its
// folder, readable to it and not written; and its session's mark (BRIDGE_SESSION_MARK, not a secret),
// by which what its commands leave running is found again (stopShells).
export function envOf(sid, { name = 'A bot', mark = null } = {}) {
  const dir = dirOf(sid)
  const tmp = tmpOf(sid)
  if (!dir || !tmp) return {}
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(tmp, { recursive: true, mode: 0o700 })
  const who = String(name).replace(/[^\w .'-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'A bot'
  const gitconfig = path.join(dir, 'gitconfig')
  fs.writeFileSync(gitconfig, `[user]\n\tname = ${who} (Bridge AI)\n\temail = bot@bridge-ai.invalid\n[credential]\n\thelper =\n[core]\n\thooksPath = ${path.join(dir, 'no-hooks').replace(/\\/g, '/')}\n`, { mode: 0o600 }) // private-ok: a placeholder address (.invalid) for a bot's commits, nobody's
  return { CLAUDE_CODE_TMPDIR: tmp, TMPDIR: tmp, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', ...(/^[0-9a-f]{16,64}$/.test(String(mark || '')) ? { BRIDGE_SESSION_MARK: mark } : {}) }
}
// Its agent's commands still running (a background job, a detached one, one a stopped turn left):
// ended, with everything they started, when its turn ends, before Bridge AI works in its copy, and on
// Stop. Found three ways, as each alone can be got around: below its agent's process, the shells
// (Claude Code runs each command in one, its sandbox around it), never its MCP servers (their command
// lines, from its config.json: mcp); anywhere else, a process with its session's mark in its
// environment (BRIDGE_SESSION_MARK, envOf, which all it starts inherits unless one clears it) or
// working in its copy (roots: its current folder there). Never its agent (pid, or the one started on
// its conversation: claude), what started it (its pane's shell), nor Bridge AI. Best effort: off
// Windows (where a bot runs no commands), from the system's process list (macOS: ps, whose -E gives a
// process's environment to its own user, and lsof for where each works; Linux: /proc). Its copy is
// put out of its commands' reach besides (botwrite.js hold), so one that's missed can't write there.
const SHELL = /(^|\/)-?(sh|bash|zsh|dash|ksh|fish|sandbox-exec|bwrap)$/
const run = (bin, args) => new Promise((resolve) => execFile(bin, args, { timeout: 10000, maxBuffer: 32 * 1024 * 1024 }, (err, so) => resolve(err && !so ? '' : String(so || ''))))
async function processes() {
  const all = new Map()
  if (process.platform === 'linux') {
    let ids = []
    try { ids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)) } catch { return all }
    const rd = (p, f) => { try { return fs.readFileSync(`/proc/${p}/${f}`, 'utf8') } catch { return null } }
    for (const p of ids) {
      const stat = rd(p, 'stat')
      if (!stat) continue
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      let cwd = null
      try { cwd = fs.readlinkSync(`/proc/${p}/cwd`) } catch { cwd = null }
      all.set(Number(p), { pid: Number(p), ppid, comm: String(rd(p, 'comm') || '').trim(), args: String(rd(p, 'cmdline') || '').split('\0').join(' ').trim(), env: rd(p, 'environ')?.split('\0') || [], cwd })
    }
    return all
  }
  for (const line of (await run('/bin/ps', ['-A', '-o', 'pid=,ppid=,comm='])).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) all.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3].trim(), args: '', env: [], cwd: null })
  }
  // (Its command line; then with its environment after it, as ps -E gives it.)
  for (const line of (await run('/bin/ps', ['-A', '-ww', '-o', 'pid=,command='])).split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    const x = m && all.get(Number(m[1]))
    if (x) x.args = m[2]
  }
  for (const line of (await run('/bin/ps', ['-A', '-ww', '-E', '-o', 'pid=,command='])).split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    const x = m && all.get(Number(m[1]))
    if (x) x.env = (m[2].startsWith(x.args) ? m[2].slice(x.args.length) : m[2]).split(' ').filter(Boolean)
  }
  let at = null
  for (const line of (await run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fpn', '-u', String(process.getuid?.() ?? '')])).split('\n')) {
    if (line[0] === 'p') at = all.get(Number(line.slice(1))) || null
    else if (line[0] === 'n' && at) at.cwd = line.slice(1)
  }
  return all
}
export async function stopShells({ pid = null, claude = null, mark = null, mcp = [], roots = [] } = {}) {
  if (process.platform === 'win32' || (!pid && !claude)) return 0
  const all = await processes()
  const kids = new Map()
  for (const x of all.values()) { if (!kids.has(x.ppid)) kids.set(x.ppid, []); kids.get(x.ppid).push(x.pid) }
  const under = (p, acc = new Set()) => { for (const k of kids.get(p) || []) if (!acc.has(k)) { acc.add(k); under(k, acc) } return acc }
  const up = (p, acc = new Set()) => { for (let x = all.get(p); x && x.pid > 1 && !acc.has(x.pid); x = all.get(x.ppid)) acc.add(x.pid); return acc }
  // (Its agent: the process given, and the one started on its conversation.)
  const agents = [...all.values()].filter((x) => x.pid === Number(pid) || (claude && x.args.includes(String(claude)) && !SHELL.test(x.comm))).map((x) => x.pid)
  if (!agents.length) return 0
  const kept = new Set([process.pid, ...up(process.pid)])
  for (const a of agents) for (const p of up(a)) kept.add(p)
  // (Its MCP servers, started by its agent: by their command lines.)
  const sigs = (mcp || []).map((m) => [m.command, ...(m.args || [])].filter(Boolean).map(String)).filter((x) => x.length)
  const isMcp = (x) => sigs.some((s) => (s.length > 1 ? x.args.includes(s.slice(1).join(' ')) : x.args.split(' ')[0].endsWith(s[0])))
  const mine = new Set()
  for (const a of agents) for (const p of under(a)) mine.add(p)
  for (const a of agents) for (const k of kids.get(a) || []) { const x = all.get(k); if (x && isMcp(x)) { kept.add(k); for (const p of under(k)) kept.add(p) } }
  const doomed = new Set()
  const doom = (p) => { if (kept.has(p)) return; doomed.add(p); for (const k of under(p)) if (!kept.has(k)) doomed.add(k) }
  for (const p of mine) if (SHELL.test(all.get(p)?.comm || '')) doom(p)
  const real = (r) => { try { return fs.realpathSync(r) } catch { return r } }
  const tops = [...new Set((roots || []).filter(Boolean).flatMap((r) => [path.resolve(String(r)), real(path.resolve(String(r)))]))]
  const inside = (d) => !!d && tops.some((t) => d === t || d.startsWith(t + path.sep))
  const marked = mark ? `BRIDGE_SESSION_MARK=${mark}` : null
  for (const x of all.values()) {
    if (mine.has(x.pid) || kept.has(x.pid) || agents.includes(x.pid)) continue
    if ((marked && x.env.includes(marked)) || inside(x.cwd)) doom(x.pid)
  }
  for (const p of doomed) { try { process.kill(p, 'SIGKILL') } catch { /* gone */ } }
  return doomed.size
}

// A session's MCP servers as its agent starts them (its config.json, botmcp.js runFolder): their
// command lines, so stopShells leaves them be.
export function serversOf(mcpDir) {
  if (!mcpDir) return []
  try {
    const j = JSON.parse(fs.readFileSync(path.join(mcpDir, 'config.json'), 'utf8'))
    return Object.values(j.mcpServers || {}).filter((x) => x?.command).map((x) => ({ command: String(x.command), args: (Array.isArray(x.args) ? x.args : []).map(String) }))
  } catch { return [] }
}

// Temporary folders of sessions that aren't going on: gone (keep: the ids of those that are).
export function sweepTmp({ keep = new Set() } = {}) {
  let names = []
  try { names = fs.readdirSync(TMP) } catch { return }
  for (const n of names) if (!keep.has(n)) { try { fs.rmSync(path.join(TMP, n), { recursive: true, force: true }) } catch { /* in use */ } }
}

export function makeStore() {
  let data = { next: 1, sessions: [] }
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (Array.isArray(j.sessions)) data = { next: Number(j.next) || 1, sessions: j.sessions.filter((s) => SID.test(String(s?.id))) } } catch { /* none yet */ }
  const save = () => {
    const going = data.sessions.filter((s) => s.state !== 'closed')
    data.sessions = [...going, ...data.sessions.filter((s) => s.state === 'closed').slice(0, Math.max(0, KEPT - going.length))].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomic(FILE, JSON.stringify(data), { mode: 0o600 }) } catch (e) { console.log(`Bots couldn't keep their sessions: ${e.message}`) }
  }
  const get = (sid) => data.sessions.find((s) => s.id === String(sid)) || null
  return {
    all: () => data.sessions,
    get,
    // The session a conversation is in, still going.
    byConv: (bot, conv) => data.sessions.find((s) => s.bot === bot && s.state !== 'closed' && (s.convs || []).includes(conv)) || null,
    // A direct message's: the latest with that person there, within DM_FRESH_MS of its last word.
    forDm: (bot, channel, person) => data.sessions.find((s) => s.bot === bot && s.state !== 'closed' && s.dm && s.channel === channel && s.person === person && Date.now() - Date.parse(s.lastAt || 0) < DM_FRESH_MS) || null,
    // A new one, its folder made: started (state 'starting') until its first turn is under way.
    add(o) {
      const s = { id: `s${data.next++}`, convs: [], people: [], turns: 0, ran: 0, totals: { files: 0, deletes: 0 }, state: 'starting', startedAt: new Date().toISOString(), lastAt: new Date().toISOString(), ...o }
      fs.mkdirSync(path.join(dirOf(s.id), 'files'), { recursive: true, mode: 0o700 })
      fs.mkdirSync(path.join(dirOf(s.id), 'turns'), { recursive: true, mode: 0o700 })
      data.sessions.unshift(s)
      save()
      return s
    },
    patch(sid, p) { const s = get(sid); if (!s) return null; Object.assign(s, p); save(); return s },
    drop(sid) { data.sessions = data.sessions.filter((s) => s.id !== sid); save(); try { fs.rmSync(dirOf(sid), { recursive: true, force: true }) } catch { /* in use */ } },
    save,
  }
}

// Its copy of the folders it changes files in (botwrite.js stage), kept beside it: { dir, parts, at,
// pending: the change of its waiting for you }, or null.
export const stageFile = (sid) => path.join(dirOf(sid), 'stage.json')
export function readStage(sid) { try { return JSON.parse(fs.readFileSync(stageFile(sid), 'utf8')) } catch { return null } }
export function writeStage(sid, st) { if (st) writeFileAtomic(stageFile(sid), JSON.stringify(st), { mode: 0o600 }); else fs.rmSync(stageFile(sid), { force: true }) }

// What its agent asked of Bridge AI in a turn (sessionmcp.js): each line its own server wrote, with
// the session's key, taken; the rest (none should be) left out, and the file started again.
// [{ t: 'push' | 'hand' | 'ask', ... }]
export async function takeRequests(dir) {
  if (!dir) return []
  const file = path.join(dir, 'requests.jsonl')
  let key = ''
  try { key = fs.readFileSync(path.join(dir, 'requests.key'), 'utf8').trim() } catch { return [] }
  if (!/^[0-9a-f]{64}$/.test(key)) return []
  const text = await fs.promises.readFile(file, 'utf8').catch(() => '')
  await fs.promises.writeFile(file, '', { mode: 0o600 }).catch(() => {})
  const out = []
  for (const l of text.split('\n').filter(Boolean).slice(0, 50)) {
    let j
    try { j = JSON.parse(l) } catch { continue }
    const { mac, ...rest } = j || {}
    const want = crypto.createHmac('sha256', key).update(JSON.stringify(rest)).digest('hex')
    if (typeof mac === 'string' && mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want)) && ['push', 'hand', 'ask', 'share'].includes(rest.t)) out.push(rest)
  }
  return out
}
// Its guard's key (botmcp.js runFolder), for its log to be read each turn.
export function guardOf(dir) {
  if (!dir) return null
  try { const key = fs.readFileSync(path.join(dir, 'guard.key'), 'utf8').trim(); return /^[0-9a-f]{64}$/.test(key) ? { key, log: path.join(dir, 'guard.log') } : null } catch { return null }
}

// ---------- Its routes ----------
// Sessions (Bots' Sessions, on a computer and the phone): every session across bots, one session with
// its turns and its pane, and what you do with one: open it (its pane started again where it left
// off, to watch), step in (type into it), stop what it's doing (Esc, the session kept), end it. A test
// session (Start a test session: Try It as a session). A push it asked for, approved or denied. A
// new bot from a purpose and a folder (quick). And a bot's commands (bash, domains), checked and
// kept before the rest of its settings are (index.js), as the rest are.
// rt: the runtime (keys); connect(id): a bot's channel made, for a new bot; view(b): a bot as
// Settings shows it; you(): your name.
export function makeBotSessions({ desk, rt, guard, wrap, connect = () => {}, resolve, view = (b) => b, you = () => 'the owner', changed = () => {} }) {
  desk.useRuntime?.({ keys: (paneId, k) => rt.keys(paneId, k), pidOf: (paneId) => rt.pidOf?.(paneId) || null })
  const bad = (msg, status = 400) => Object.assign(new Error(msg), { status })
  return {
    routes(app) {
      app.get('/api/bots/sessions', guard, wrap(async (req) => ({ sessions: await desk.sessions.list({ bot: req.query.bot ? String(req.query.bot) : null, state: req.query.state ? String(req.query.state) : null }) })))
      app.get('/api/bots/sessions/:sid', guard, wrap(async (req) => {
        const v = await desk.sessions.view(String(req.params.sid))
        if (!v) throw bad('No such session', 404)
        return v
      }))
      app.post('/api/bots/sessions/:sid/open', guard, wrap(async (req) => desk.sessions.open(String(req.params.sid))))
      app.post('/api/bots/sessions/:sid/steer', guard, wrap(async (req) => desk.sessions.steer(String(req.params.sid), String(req.body?.text || ''))))
      app.post('/api/bots/sessions/:sid/stop', guard, wrap(async (req) => desk.sessions.stop(String(req.params.sid))))
      app.post('/api/bots/sessions/:sid/end', guard, wrap(async (req) => desk.sessions.end(String(req.params.sid))))
      // Start a test session (or its next turn: sid), as you or someone who may ask.
      app.post('/api/bots/:id/sessions', guard, wrap(async (req) => {
        const r = await desk.tryIt(String(req.params.id), { text: req.body?.text, as: req.body?.as || null, sid: req.body?.sid ? String(req.body.sid) : null })
        // (Its session, once its first turn has started one: null when it's answered without one.)
        return { ...r, sid: r.sid || (await desk.sessions.soon(String(req.params.id), r.q, r.conv))?.id || null }
      }))
      // A Share Link it asked for someone else: approve (named by its own code) or deny.
      app.post('/api/bots/questions/:id/share', guard, wrap(async (req) => desk.shareAct(String(req.params.id), String(req.body?.act || ''), { code: req.body?.code ? String(req.body.code) : null, by: you(), via: 'app' })))
      // A push it asked for: approve (named by the commit you were shown, hash) or deny.
      app.post('/api/bots/questions/:id/push', guard, wrap(async (req) => desk.pushAct(String(req.params.id), String(req.body?.act || ''), { hash: req.body?.hash ? String(req.body.hash) : null, by: you(), via: 'app' })))
      // A new bot from what it's for and a folder: on the shared connection, reading and changing
      // files in that folder (changes waiting for you as any do), answering in a thread, Claude Code
      // answering; everything else as a new bot has it.
      app.post('/api/bots/quick', guard, wrap(async (req) => {
        const purpose = String(req.body?.purpose || '').replace(/\r\n/g, '\n').trim().slice(0, 4000)
        if (!purpose) throw bad('Say what it\'s for')
        if (!req.body?.folder) throw bad('Pick its folder')
        let folder
        let real
        try { folder = await resolve(String(req.body.folder)); real = await fs.promises.realpath(folder) } catch (e) { throw bad(e.message) }
        const home = await fs.promises.realpath(HOME).catch(() => null)
        const rel = home ? path.relative(home, real) : ''
        if (!home || !rel || rel.startsWith('..') || path.isAbsolute(rel)) throw bad('Pick a folder inside your home folder')
        const why = botwrite.runsFrom(rel)
        if (why) throw bad(`${folder}: ${why}`)
        let c = null
        if (req.body?.connection) {
          c = conns.get(String(req.body.connection))
          if (!c) throw bad('No such connection', 404)
          if (c.bot) throw bad(`${c.name} is another bot's own connection: pick a shared one`)
        }
        const name = store.freeName(req.body?.name ? clean(req.body.name, store.NAME_MAX) : nameFor(purpose))
        const b = store.create({ name, description: clean(purpose.split('\n')[0], store.DESCRIPTION_MAX) }, you())
        const shown = folder.startsWith(`${HOME}${path.sep}`) ? `~${folder.slice(HOME.length)}` : folder
        store.save(b.id, { readsFrom: [shown], writesTo: [shown], changes: 'edit', answerIn: 'thread', who: 'named' })
        store.writeInstructions(b.id, [`# ${name}`, '', purpose, '', `Keep answers short and plain, and name the files an answer comes from. If nothing in ${shown} answers it, say so rather than guess. Change files only when you're asked to, and say what you changed.`, ''].join('\n'))
        desk.record(b.id, 'settings.changed', { setting: 'created', old: null, new: { how: 'quick', folder: shown, ...(c ? { connection: c.name } : {}) }, by: you() })
        connect(b.id)
        desk.sync()
        changed()
        return view(store.get(b.id))
      }))
      // Its commands (bash: off or sandboxed) and the domains they may reach, and When You Ask: Full
      // Access (fullAccess, true or false), checked, kept and in its record; then the rest of its
      // settings, as they always were.
      app.post('/api/bots/:id/settings', guard, (req, res, next) => {
        const x = req.body || {}
        if (x.bash === undefined && x.domains === undefined && x.fullAccess === undefined) return next()
        try {
          const b = store.get(String(req.params.id))
          if (!b) throw bad('No such bot', 404)
          const patch = {}
          if (x.bash !== undefined) {
            if (!store.BASH.includes(x.bash)) throw bad('Commands are off or sandboxed')
            // (None in this version: agents.js COMMANDS. One kept from before stays as it was, and does nothing.)
            if (x.bash === 'sandboxed' && !COMMANDS) throw bad(COMMANDS_OFF)
            patch.bash = x.bash
          }
          if (x.domains !== undefined) {
            const list = Array.isArray(x.domains) ? x.domains : String(x.domains || '').split(/[\s,]+/)
            const out = []
            for (const d of list.map(String).filter((y) => y.trim())) {
              const v = store.domainOf(d)
              if (!v) throw bad(`${clean(d, 80)} isn't a domain (example.com, or *.example.com)`)
              if (store.githubLike(v)) throw bad(`A bot's commands never reach GitHub (${v}): a push or a pull request goes through Bridge AI, once you approve it`)
              out.push(v)
            }
            if (out.length > store.DOMAINS_MAX) throw bad(`At most ${store.DOMAINS_MAX} domains`)
            patch.domains = [...new Set(out)]
          }
          if (x.fullAccess !== undefined) {
            if (typeof x.fullAccess !== 'boolean') throw bad('Full Access is on or off')
            patch.fullAccess = x.fullAccess
          }
          const { before, after } = store.save(b.id, patch)
          for (const k of Object.keys(patch)) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) desk.record(b.id, 'settings.changed', { setting: k, old: before[k], new: after[k], by: you() })
          delete x.bash
          delete x.domains
          delete x.fullAccess
          next()
        } catch (e) { res.status(e.status || 400).json({ error: e.message }) }
      })
    },
  }
}
// A name from what it's for: its first word that says something ("Hiring Bot" from "Answer hiring
// questions about…"), else New Bot.
const PLAIN = new Set('a an the and or of for to in on at by with about from my our your their its this that these those answer answers answering help helps helping questions question people team me us we you i is are be do does'.split(' '))
function nameFor(purpose) {
  const words = String(purpose).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !PLAIN.has(w)).slice(0, 1)
  return words.length ? `${words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')} Bot` : 'New Bot'
}
