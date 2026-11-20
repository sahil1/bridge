// A bot's MCP servers (Bots, Settings › Bots › Set Up › MCP Servers): which of your own (Claude Code's,
// Settings › MCP Servers) its runs get, and which of their tools whoever asked may use.
//
// A server's tools are listed by asking it (the Model Context Protocol's initialize, then tools/list),
// as Claude Code would: a stdio one started with its own command, an HTTP one at its address. A tool
// that says it only reads (annotations.readOnlyHint: true) may be used for anyone who may ask; any
// other only when it's you asking, or someone you named under Who Can Ask (who may also ask for a
// change). A server whose tools can't be listed (it didn't start, an SSE one) has none that only read.
// Those are the run's rules, enforced by Claude Code: only these servers (--mcp-config with
// --strict-mcp-config), only the tools allowed (--allowedTools), the rest refused (dontAsk, and
// --disallowedTools where they're known). Never anything a bot's instructions or a question says.
//
// A run's servers go in a folder of the desk's, front-desk/mcp/<run>/ (agents.js mcpOf), readable by
// you only: config.json (the servers as Claude Code's config has them, with their env and headers)
// and rules.json. With them, a run with an outbox (botfiles.js) gets Bridge AI's own server for it,
// bridge_outbox (outboxmcp.js), its save_file allowed: the one way that run can put a file anywhere;
// and, for a bot with folders, its attach_file too, with the folders a file may be attached from in
// attach.json beside them (botattach.js). The folder goes once the run has ended (frontdesk.js), and
// any left from before Bridge AI started again a day later.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { dataFile, writeFileAtomic, HOME, DATA, ROOT, NODE, IS_WIN } from './paths.js'
import { loginPath, which, KEPT_SETTINGS, KEPT_MIN } from './agents.js'
import { claudeServers, claudeServerView } from './mcp.js'
import { launch } from './consult.js'
import { compare } from '../shared/version.js'
import { keptOut, SECRET_TERMS, SECRET_BROAD, BROAD_KINDS, SECRET_STEMS, SECRET_KINDS } from './botattach.js'
import { CREDENTIALS } from './botenv.js'
import os from 'node:os'

export const RUNS = dataFile('front-desk', 'mcp')
const LIST_MS = 15000 // a server that hasn't listed its tools by then can't be asked
const KEEP_MS = 5 * 60 * 1000 // a server's tools are asked again after this
const PROTOCOL = '2025-06-18'
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
// A name as Claude Code puts it in a tool's: mcp__<server>__<tool>, anything else an underscore.
const norm = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_')
export const toolName = (server, tool) => `mcp__${norm(server)}__${norm(tool)}`
export const serverRule = (server) => `mcp__${norm(server)}`
// ${VAR} and ${VAR:-default} in a config's values, from this computer's environment, as Claude Code
// fills them in.
const fill = (v) => String(v ?? '').replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, k, d) => process.env[k] ?? d ?? '')
const fillAll = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, v]) => [k, fill(v)]))
const transportOf = (raw) => (raw.command ? 'stdio' : /sse/i.test(String(raw.type || raw.transport || '')) ? 'sse' : 'http')

// ---------- Asking a server ----------
// JSON-RPC over the server's stdin and stdout, a message a line; talk(ask, notify): what's asked.
function overStdio(raw, talk) {
  return new Promise((resolve, reject) => {
    let child
    // (Its stdin closed first, so one run through cmd on Windows hears it's over too.)
    const done = (fn, x) => { clearTimeout(timer); try { child?.stdin?.end(); child?.kill() } catch { /* gone */ } fn(x) }
    const timer = setTimeout(() => done(reject, new Error(`it didn't answer within ${LIST_MS / 1000} s`)), LIST_MS)
    loginPath().then((PATH) => {
      try {
        // (On Windows a command that isn't a program of its own, npx say, is run through cmd, as
        // Claude Code's docs have its configs do.)
        const cmd = fill(raw.command)
        const args = (Array.isArray(raw.args) ? raw.args : []).map(fill)
        const viaCmd = process.platform === 'win32' && !/\.(exe|com)$/i.test(cmd)
        const q = (x) => (/[\s"&|<>^]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)
        child = viaCmd
          ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[cmd, ...args].map(q).join(' ')}"`], { cwd: HOME, env: { ...process.env, PATH, ...fillAll(raw.env) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: true })
          : spawn(cmd, args, { cwd: HOME, env: { ...process.env, PATH, ...fillAll(raw.env) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      } catch (e) { return done(reject, e) }
      child.on('error', (e) => done(reject, new Error(`it couldn't start: ${e.message}`)))
      child.on('exit', (code) => done(reject, new Error(`it stopped (${code ?? 'killed'}) before listing its tools`)))
      let buf = ''
      const waiting = new Map()
      child.stdout.on('data', (d) => {
        buf += d
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          let m = null
          try { m = JSON.parse(line) } catch { continue }
          if (m?.id != null && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) }
        }
      })
      const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`)
      let n = 0
      const ask = (method, params) => new Promise((ok, bad) => {
        const id = ++n
        waiting.set(id, (m) => (m.error ? bad(new Error(m.error.message || 'it said no')) : ok(m.result)))
        send({ jsonrpc: '2.0', id, method, params })
      })
      talk(ask, (method) => send({ jsonrpc: '2.0', method })).then((x) => done(resolve, x), (e) => done(reject, e))
    }, (e) => done(reject, e))
  })
}
// Streamable HTTP: each request a POST, answered as JSON or as server-sent events.
async function overHttp(raw, talk) {
  const url = fill(raw.url)
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...fillAll(raw.headers) }
  let session = null
  let n = 0
  const post = async (o) => {
    const r = await fetch(url, { method: 'POST', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(o), signal: AbortSignal.timeout(LIST_MS) })
    session = r.headers.get('mcp-session-id') || session
    if (!r.ok && r.status !== 202) throw new Error(`HTTP ${r.status}${r.status === 401 ? ': it needs a sign-in' : ''}`)
    if (o.id == null) return null
    const text = await r.text()
    const msgs = /event-stream/.test(r.headers.get('content-type') || '')
      ? text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5)) } catch { return null } })
      : [(() => { try { return JSON.parse(text) } catch { return null } })()]
    const m = msgs.find((x) => x?.id === o.id)
    if (!m) throw new Error('it sent back nothing to read')
    if (m.error) throw new Error(m.error.message || 'it said no')
    return m.result
  }
  return talk((method, params) => post({ jsonrpc: '2.0', id: ++n, method, params }), (method) => post({ jsonrpc: '2.0', method }))
}
const over = (raw, talk) => { const t = transportOf(raw); return t === 'stdio' ? overStdio(raw, talk) : t === 'http' ? overHttp(raw, talk) : Promise.reject(new Error('it\'s an SSE server, which isn\'t asked here')) }
const hello = async (ask, notify) => { await ask('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Bridge AI', version: '1' } }); notify('notifications/initialized') }
// The handshake, then every page of its tools: [{ name, title, description, schema, readOnly }].
async function listWith(ask, notify) {
  await hello(ask, notify)
  const tools = []
  let cursor
  for (let page = 0; page < 10; page++) {
    const r = await ask('tools/list', cursor ? { cursor } : {})
    for (const x of r?.tools || []) if (x?.name) tools.push({ name: String(x.name), title: clip(x.title || x.annotations?.title || '', 80) || null, description: clip(x.description || '', 400) || null, schema: x.inputSchema && typeof x.inputSchema === 'object' ? x.inputSchema : { type: 'object', properties: {} }, readOnly: x.annotations?.readOnlyHint === true })
    cursor = r?.nextCursor
    if (!cursor) break
  }
  return tools
}

// A server's tools, asked at most every few minutes (and again when its config changes): { tools, problem }.
const seen = new Map() // name -> { at, sig, p }
export function toolsOf(name, raw, { fresh = false } = {}) {
  const sig = JSON.stringify(raw)
  const hit = seen.get(name)
  if (!fresh && hit && hit.sig === sig && Date.now() - hit.at < KEEP_MS) return hit.p
  const p = over(raw, listWith).then((tools) => ({ tools, problem: null }), (e) => ({ tools: null, problem: clip(e.message, 200) }))
  seen.set(name, { at: Date.now(), sig, p })
  return p
}

// One of its tools called (a model answering for a bot: botanswer.js): what it said, as text.
export async function callTool(name, raw, tool, args) {
  const r = await over(raw, async (ask, notify) => { await hello(ask, notify); return ask('tools/call', { name: tool, arguments: args && typeof args === 'object' ? args : {} }) })
  const text = (r?.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n').slice(0, 60000)
  if (r?.isError) throw new Error(text || `${name}'s ${tool} said no`)
  return text || '(nothing)'
}

// ---------- For Settings ----------
// Your servers a bot can have (Claude Code's own), each with how it's reached and, when asked for,
// its tools and which of them only read: [{ name, transport, where, tools, problem }]. Never a secret.
export async function servers({ tools = false, fresh = false, only = null } = {}) {
  const all = claudeServers()
  return Promise.all(Object.entries(all).filter(([name]) => !only || only.includes(name)).map(async ([name, raw]) => {
    const v = claudeServerView(name, raw)
    const base = { name, transport: v.transport, where: v.transport === 'stdio' ? [v.command, ...v.args].filter(Boolean).join(' ') : v.url || null }
    if (!tools) return base
    const r = await toolsOf(name, raw, { fresh })
    return { ...base, tools: r.tools, problem: r.problem }
  }))
}
export const names = () => Object.keys(claudeServers())
// The ones a bot has, as Claude Code's config has them (for a model answering for it: botanswer.js).
export const configsOf = (bot) => { const have = claudeServers(); return Object.fromEntries((bot.mcp || []).filter((n) => have[n]).map((n) => [n, have[n]])) }

// ---------- For a run ----------
// The servers a bot has for a run, and its rules: all of each server's tools when everything may be
// used (you, or someone you named), else only the tools that say they only read. Written in a folder
// of its own (key: the question's and run's), whose path goes with the run's other folders. null when
// it has none (or none of them is in Claude Code's config any more). What it was given is said back
// for the record: { dir, servers: [{ name, all, tools, problem }], missing }. attach: { folders, cwd,
// config }, the folders its run reads that a file may be attached from (with an outbox), and whether
// data and config files may be; reads: the folders it reads, for its Read rules.
export const OUTBOX_SERVER = 'bridge_outbox'
// A run that changes files (write: { root, parts, files }: its copy, the names of its folders' copies
// in it, botwrite.js, or a copy of a repository with no parts, botchanges.js) has in its settings for
// Claude Code (settings.json, every run's, --settings: agents.js) its PreToolUse hook, botguard.mjs, that
// checks every path a tool that writes is given, with hooks on whatever your own settings say; and
// with files, Bridge AI's own bridge_files (filesmcp.js, delete_file and move_file in that copy
// alone). Both write each path they let through to the run's log (guard.log) with a key of the run's
// own, in a file beside it (guard.key, yours alone, in this folder, which the agent can't read; never
// on a command line or in its settings, which Claude Code may quote back to it): { guard: { key,
// log } } back, for Bridge AI to take only what they saw (botwrite.js guardCheck).
export const FILES_SERVER = 'bridge_files'
const sh = (s) => `'${String(s).replace(/'/g, '\'\\\'\'')}'`
// Whether a run's hook is given as a program and its arguments (Claude Code's exec form, below): on
// Windows. (BRIDGE_HOOK_EXEC=1 gives it so on any system, in a test's kit only: BRIDGE_FIX_DRYRUN.)
export const execHooks = () => IS_WIN || (process.env.BRIDGE_HOOK_EXEC === '1' && process.env.BRIDGE_FIX_DRYRUN === '1')
// The oldest Claude Code that runs a hook given so. From Claude Code's own changelog (CHANGELOG.md in
// github.com/anthropics/claude-code), 2.1.139: "Added hook `args: string[]` field (exec form) that
// spawns the command directly without a shell". One older than that doesn't run it as given, so the
// hook checks nothing and every file such a run changes is refused.
export const EXEC_HOOKS_MIN = '2.1.139'
// What a run that changes files needs where its hook is given so: that, or the oldest Claude Code
// that starts any run kept to its folders (agents.js KEPT_MIN), whichever is the higher, so you're
// told the one version that lets it run.
export const hookMin = () => (compare(KEPT_MIN.claude.version, EXEC_HOOKS_MIN) > 0 ? KEPT_MIN.claude.version : EXEC_HOOKS_MIN)
// The Claude Code here: its version ('2.1.312'), or null when it can't be told (none found, or it
// didn't say). claude --version, asked again only once the program found is another or has changed
// (an update), or an hour on.
let claudeMemo = null
export async function claudeVersion() {
  const PATH = await loginPath()
  const bin = await which('claude', PATH)
  if (!bin) return null
  const st = await fs.promises.stat(bin).catch(() => null)
  if (!st) return null
  const key = `${await fs.promises.realpath(bin).catch(() => bin)}\n${st.mtimeMs}\n${st.size}`
  if (claudeMemo?.key === key && Date.now() - claudeMemo.at < 3600000) return claudeMemo.version
  const out = await new Promise((resolve) => {
    const p = launch(bin, ['--version'], { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...process.env, PATH } }, (err, stdout) => resolve(err ? '' : String(stdout || '')))
    p.stdin?.on('error', () => {})
    p.stdin?.end()
  })
  const version = /(\d+\.\d+\.\d+)/.exec(out)?.[1] || null
  claudeMemo = { key, version, at: Date.now() }
  return version
}
// Whether a run that changes files can have its hook run as it's given here: null, or why not, a
// Claude Code too old for it ({ need, have }). One whose version can't be told isn't held back (a
// run whose hook didn't run is said once it's over: frontdesk.js).
export async function hookTooOld() {
  if (!execHooks()) return null
  const have = await claudeVersion()
  const need = hookMin()
  return have && compare(have, need) < 0 ? { need, have } : null
}
// A bot's session (frontdesk.js, botsessions.js) has more in its folder, made the same way each
// time it's started (its first turn, and again with --resume after an idle close or a narrower
// tier): session: { push: request_push, for a copy of a repository; roster: hand_to and ask_bot, for a
// connection's Chief (its own MCP server, sessionmcp.js); bash: { domains, cwd, dirs, writable } when
// it may run commands (Claude Code's sandbox, sandboxOf below, with its hook on Bash too); who: your
// name, for what its hook says when it refuses a push }.
export const SESSION_SERVER = 'bridge_session'
// Claude Code's sandbox for a session's commands, closed (agents.js sandboxClosed): it doesn't start
// without it, nothing is retried outside it, no network but the domains you listed (any other asked
// for is refused: dontAsk), and of your home folder (Bridge AI's own folder in it, your keys, other
// conversations) only its own folders readable, nothing hidden in them (best effort: a sandbox glob
// is a path pattern, not the Read rules); written only in its own copy (cwd, when it may write: a
// copy of the folders it changes or of a repository; never the folders it reads, the files attached
// or its turns, nor git's own file in a copy of a repository), else nowhere but the system's
// temporary folder. Lists merge with your own settings' (agents.js bashProblem: a bot has no
// commands where yours would widen these).
// Besides (code.claude.com/docs/en/settings-reference, sandbox): every variable that holds a key unset
// before each command (credentials.envVars, deny: botenv.js CREDENTIALS); GitHub refused whatever
// domains you allowed, a denied domain holding inside an allowed wildcard (network.deniedDomains), so
// nothing reaches it but a push you approved, made by Bridge AI (botchanges.js publish); Apple Events,
// the weaker nested sandbox and network isolation off, whatever your own settings say (switches your
// organization's settings turn on can't be turned off here: bashProblem refuses those); and the
// computer's temporary folders unreadable (other programs' files, other Claude Code sessions'
// output), its own (tmp: CLAUDE_CODE_TMPDIR, frontdesk.js) readable and written. Your home folder,
// with the other roots of people's files and drives, is unreadable by
// permissions.blockReadsOutsideWorkingDirectories in its settings (runFolder), which leaves its own
// folders and what Claude Code needs of ~/.claude readable.
export const GITHUB = ['github.com', '*.github.com', 'api.github.com', 'githubusercontent.com', '*.githubusercontent.com']
const TEMP_ROOTS = () => [os.tmpdir(), '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', ...(process.platform === 'darwin' ? ['/var/folders', '/private/var/folders'] : ['/dev/shm'])]
export function sandboxOf({ domains = [], cwd, dirs = [], writable = false, tmp = null }) {
  const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }
  const both = (list) => [...new Set(list.filter(Boolean).flatMap((x) => [path.resolve(String(x)), real(path.resolve(String(x)))]))]
  const mine = both([cwd, ...dirs])
  const temp = both(tmp ? [tmp] : [])
  return {
    enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true,
    allowAppleEvents: false, enableWeakerNestedSandbox: false, enableWeakerNetworkIsolation: false,
    network: { allowedDomains: [...new Set(domains.map(String))], deniedDomains: GITHUB, strictAllowlist: true, allowLocalBinding: false, allowAllUnixSockets: false },
    credentials: { envVars: CREDENTIALS.map((name) => ({ name, mode: 'deny' })) },
    filesystem: {
      disabled: false,
      denyRead: [...new Set([...both([HOME, DATA, ...TEMP_ROOTS()]), ...mine.map((d) => `${d}/**/.*`)])],
      allowRead: [...mine, ...temp],
      denyWrite: [...new Set([...both(dirs), ...(writable ? [] : both([cwd])), ...(cwd ? both([path.join(cwd, '.git')]) : [])])],
    },
  }
}
// full: a session for you alone with When You Ask: Full Access (frontdesk.js): { undo: the folder its
// hook keeps a copy of each file in before an edit, roots: the bot's folders }. Its settings are
// yours as they are (none of Bridge AI's limits for a run kept to its folders), with two hooks: one on
// commands that refuses a push or gh (a push waits for you: request_push), one before each edit that
// keeps the file as it was, for Undo (botundo.mjs). rules.json says full, so agents.js gives it the
// owner level; nothing else does.
export async function runFolder(bot, { all = false, key, outbox = null, write = null, attach = null, reads = [], own = [], session = null, full = null }) {
  const want = (bot.mcp || []).filter((n) => n !== OUTBOX_SERVER && n !== FILES_SERVER && n !== SESSION_SERVER)
  if (!want.length && !outbox && !write && !session) return null
  const have = claudeServers()
  const picked = want.filter((n) => have[n])
  const missing = want.filter((n) => !have[n])
  if (!picked.length && !outbox && !write && !session) return { dir: null, servers: [], missing }
  const allow = []
  const deny = []
  const said = []
  for (const name of picked) {
    if (all) { allow.push(serverRule(name)); said.push({ name, all: true, tools: null, problem: null }); continue }
    const r = await toolsOf(name, have[name])
    if (!r.tools) { deny.push(serverRule(name)); said.push({ name, all: false, tools: [], problem: r.problem }); continue }
    const ro = r.tools.filter((x) => x.readOnly)
    allow.push(...ro.map((x) => toolName(name, x.name)))
    deny.push(...r.tools.filter((x) => !x.readOnly).map((x) => toolName(name, x.name)))
    said.push({ name, all: false, tools: ro.map((x) => x.name), problem: null })
  }
  const dir = path.join(RUNS, String(key).replace(/[^\w.-]+/g, '-'))
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const servers = Object.fromEntries(picked.map((n) => [n, have[n]]))
  // (Its outbox's: this app's Node, on this run's outbox alone; the folders it may attach from in a
  // file of its own, readable by you only, never on its command line.)
  if (outbox) {
    const args = [path.join(ROOT, 'server', 'outboxmcp.js'), outbox]
    allow.push(toolName(OUTBOX_SERVER, 'save_file'))
    if (attach?.folders?.length) {
      const file = path.join(dir, 'attach.json')
      writeFileAtomic(file, JSON.stringify({ folders: attach.folders.map((f) => (f && typeof f === 'object' ? { path: String(f.path), real: f.real || null } : String(f))), cwd: attach.cwd || null, config: attach.config === true, keptOut: keptOut() }, null, 2), { mode: 0o600 })
      args.push(file)
      allow.push(toolName(OUTBOX_SERVER, 'attach_file'))
    }
    servers[OUTBOX_SERVER] = { type: 'stdio', command: NODE.bin, args, env: { ...NODE.env } }
  }
  // (A session's own server: what it asks of Bridge AI, each line written with a key of its own,
  // beside it here, where its agent can't read or write it: sessionmcp.js.)
  let requests = null
  if (session) {
    requests = { key: crypto.randomBytes(32).toString('hex'), file: path.join(dir, 'requests.jsonl') }
    const keyFile = path.join(dir, 'requests.key')
    fs.writeFileSync(requests.file, '', { mode: 0o600 })
    fs.writeFileSync(keyFile, requests.key, { mode: 0o600 })
    fs.chmodSync(keyFile, 0o600)
    const args = [path.join(ROOT, 'server', 'sessionmcp.js'), requests.file, keyFile]
    if (session.push) { args.push('--push'); allow.push(toolName(SESSION_SERVER, 'request_push')) }
    // (A Share Link to a file or folder of its, or one it made: share_link, made by Bridge AI, at once
    // for you, after your OK for anyone else: frontdesk.js shareFor.)
    if (session.share) { args.push('--share'); allow.push(toolName(SESSION_SERVER, 'share_link')) }
    if (session.roster?.length) {
      const file = path.join(dir, 'roster.json')
      writeFileAtomic(file, JSON.stringify(session.roster.map((b) => ({ id: String(b.id), name: String(b.name), description: String(b.description || ''), access: String(b.access || '') })), null, 2), { mode: 0o600 })
      args.push('--chief', file)
      allow.push(toolName(SESSION_SERVER, 'hand_to'), toolName(SESSION_SERVER, 'ask_bot'))
    }
    if (args.length > 3) servers[SESSION_SERVER] = { type: 'stdio', command: NODE.bin, args, env: { ...NODE.env } }
  }
  const bash = full ? null : session?.bash || null
  let hooks = null
  let guard = null
  let agentEnv = null
  if (full) {
    guard = { key: crypto.randomBytes(32).toString('hex'), log: path.join(dir, 'guard.log') }
    fs.writeFileSync(guard.log, '', { mode: 0o600 })
    const keyFile = path.join(dir, 'guard.key')
    fs.writeFileSync(keyFile, guard.key, { mode: 0o600 })
    fs.chmodSync(keyFile, 0o600)
    fs.mkdirSync(full.undo, { recursive: true, mode: 0o700 })
    const guardArgs = [path.join(ROOT, 'server', 'botguard.mjs'), '--bash-only', '--log', guard.log, '--key', keyFile, ...(session?.who ? ['--who', String(session.who).replace(/[\r\n]+/g, ' ').slice(0, 80)] : []), '--push', '--full']
    const undoArgs = [path.join(ROOT, 'server', 'botundo.mjs'), '--dir', full.undo, ...(full.roots || []).flatMap((r) => ['--root', String(r)])]
    const hookOf = (a) => (execHooks()
      ? { type: 'command', command: NODE.bin, args: a, timeout: 30 }
      : { type: 'command', command: `${Object.entries({ ...NODE.env }).map(([k, v]) => `${k}=${sh(v)} `).join('')}${sh(NODE.bin)} ${a.map(sh).join(' ')}`, timeout: 30 })
    if (execHooks() && Object.keys(NODE.env).length) agentEnv = { ...NODE.env }
    hooks = { disableAllHooks: false, hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [hookOf(guardArgs)] }, { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [hookOf(undoArgs)] }] } }
  } else if (write?.root || bash) {
    guard = { key: crypto.randomBytes(32).toString('hex'), log: path.join(dir, 'guard.log') }
    fs.writeFileSync(guard.log, '', { mode: 0o600 })
    const keyFile = path.join(dir, 'guard.key')
    fs.writeFileSync(keyFile, guard.key, { mode: 0o600 })
    fs.chmodSync(keyFile, 0o600)
    const args = [...(write?.root ? [write.root, ...(write.parts || []).flatMap((p) => ['--part', p])] : ['--bash-only']), '--log', guard.log, '--key', keyFile, ...(session?.who ? ['--who', String(session.who).replace(/[\r\n]+/g, ' ').slice(0, 80)] : []), ...(session?.push ? ['--push'] : [])]
    if (write?.files) {
      servers[FILES_SERVER] = { type: 'stdio', command: NODE.bin, args: [path.join(ROOT, 'server', 'filesmcp.js'), ...args], env: { ...NODE.env } }
      allow.push(toolName(FILES_SERVER, 'delete_file'), toolName(FILES_SERVER, 'move_file'))
    }
    // Its hook, as Claude Code runs one. On a Mac and Linux: a command for sh, each part quoted, with
    // the variables Node needs before it. On Windows, where Claude Code runs a command in Git Bash, or
    // in PowerShell when there's no Git Bash, each quoting its own way: the program and its arguments
    // as they are (args, which Claude Code starts with no shell at all, so nothing in a path is read
    // as anything but itself), and the variables Node needs in its agent's environment (agentEnv,
    // back: a hook has its agent's, and no other).
    const guardArgs = [path.join(ROOT, 'server', 'botguard.mjs'), ...args]
    const hook = execHooks()
      ? { type: 'command', command: NODE.bin, args: guardArgs, timeout: 30 }
      : { type: 'command', command: `${Object.entries({ ...NODE.env }).map(([k, v]) => `${k}=${sh(v)} `).join('')}${sh(NODE.bin)} ${guardArgs.map(sh).join(' ')}`, timeout: 30 }
    if (execHooks() && Object.keys(NODE.env).length) agentEnv = { ...NODE.env }
    hooks = { disableAllHooks: false, hooks: { PreToolUse: [{ matcher: `Edit|Write|MultiEdit|NotebookEdit${bash ? '|Bash' : ''}`, hooks: [hook] }] } }
  }
  // (Claude Code's settings for the run, in one file, as it takes one --settings: Bridge AI's for
  // every run kept to its folders, agents.js KEPT_SETTINGS; its Read rules, nothing hidden in the
  // folders it reads nor anything named as keys, passwords or credentials, kept off its own folders
  // (own: its copy, the files attached, its brief); and its hook when it changes files.)
  const readDeny = reads.length && !full ? readDenies(reads, { own }) : []
  const settings = path.join(dir, 'settings.json')
  if (full) {
    writeFileAtomic(settings, JSON.stringify({ ...(hooks || {}) }, null, 2), { mode: 0o600 })
    writeFileAtomic(path.join(dir, 'config.json'), JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 })
    writeFileAtomic(path.join(dir, 'rules.json'), JSON.stringify({ allow, deny: [], settings, full: true }, null, 2), { mode: 0o600 })
    return { dir, servers: said, missing, guard, ...(agentEnv ? { agentEnv } : {}), ...(requests ? { requests } : {}), full: true }
  }
  // (With commands: your home folder and the other roots of people's files unreadable to them, and to
  // its file tools outside its folders (blockReadsOutsideWorkingDirectories, Claude Code 2.1.257, as
  // old as commands need: agents.js BASH_MIN).)
  writeFileAtomic(settings, JSON.stringify({ ...KEPT_SETTINGS, permissions: { ...KEPT_SETTINGS.permissions, ...(readDeny.length ? { deny: readDeny } : {}), ...(bash ? { blockReadsOutsideWorkingDirectories: true } : {}) }, ...(hooks || {}), ...(bash ? { sandbox: sandboxOf(bash) } : {}) }, null, 2), { mode: 0o600 })
  writeFileAtomic(path.join(dir, 'config.json'), JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 })
  writeFileAtomic(path.join(dir, 'rules.json'), JSON.stringify({ allow, deny, settings, ...(bash ? { bash: true } : {}) }, null, 2), { mode: 0o600 })
  return { dir, servers: said, missing, ...(guard ? { guard } : {}), ...(agentEnv ? { agentEnv } : {}), ...(requests ? { requests } : {}), ...(bash ? { bash: true } : {}) }
}
// Claude Code's Read rules for a bot's run (gitignore-style patterns; // starts at the root), for each
// folder it reads, as named and as its real path: no hidden file, nor anything in a hidden folder,
// nor a name that says it holds keys, passwords or credentials, made from botattach.js's own lists
// (SECRET_TERMS between separators or a name's ends, SECRET_BROAD in a file's name with a kind that
// keeps data, SECRET_STEMS as a file's name before its kind, SECRET_KINDS), whatever their case, so
// it reads none of what attaching refuses, and a vault of notes or a folder of code called auth as
// it is. Read rules hold for Grep and Glob too, as far as Claude Code can.
const anyCase = (w) => w.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
const SEP = '[-_. ]'
const SECRET_GLOBS = [...new Set([
  ...SECRET_TERMS.map((t) => anyCase(t).replace(/[-_ ]/g, '[-_ ]')).flatMap((t) => [t, `${t}${SEP}*`, `*${SEP}${t}`, `*${SEP}${t}${SEP}*`]),
  // (A broad word only in a file's name with a kind that keeps data, as attaching has it: vault.json, not a
  // vault of notes; a stem only as a file's whole name before its kind, not an auth folder of code.)
  ...[...new Set(SECRET_BROAD.map((t) => (t.endsWith('s') && SECRET_BROAD.includes(t.slice(0, -1)) ? t.slice(0, -1) : t)))].flatMap((t) => BROAD_KINDS.map((k) => `*${anyCase(t)}*.${anyCase(k)}`)),
  ...SECRET_STEMS.map((t) => `${anyCase(t)}.*`),
  ...SECRET_KINDS.map((e) => `*.${anyCase(e)}`),
])]
// Kept off the run's own folders (own: its copy of the folders it changes files in or of a
// repository, the files attached, its brief, and every other folder it's given), each wholly readable
// to it even inside a folder it reads from: they're in Bridge AI's own folder, which is hidden
// (~/.bridge-ai), so a folder it reads that has that folder in it (one it was moved into with
// BRIDGE_HOME, say) has its rule for what's hidden made around them (hiddenAround).
const glob = (f) => `//${f.replace(/\\/g, '/').replace(/^\/+/, '')}`
const hiddenName = (n) => n.startsWith('.')
// (A name as a pattern: anything a pattern would take as more than itself matches one character.)
const lit = (n) => n.replace(/[*?[\]\\!{}]/g, '?')
const AROUND_MAX = 5000 // names in one folder on the way to its own, at most
// Within f, everything hidden (now, or made later where it can be said so) but the way to each of its
// own folders (ways: the names from f to each) and what's in them. null when a folder on the way
// can't be listed whole.
function hiddenAround(f, ways, inHidden = false) {
  if (ways.some((w) => !w.length)) return [] // one of its own: nothing in it is ruled out here
  const next = [...new Set(ways.map((w) => w[0]))]
  const out = []
  // (Outside anything hidden, with no hidden name on the way on: every hidden name here, made later too.)
  const open = !inHidden && !next.some(hiddenName)
  if (open) out.push(`${glob(f)}/.*`, `${glob(f)}/.*/**`)
  let names
  try { names = fs.readdirSync(f) } catch { return null }
  if (names.length > AROUND_MAX) return null
  for (const n of names) {
    if (next.includes(n)) continue
    const at = `${glob(f)}/${lit(n)}`
    // (One whose pattern would take a name on the way too is left: the run's own come first.)
    const same = new RegExp(`^${lit(n).split('?').map((x) => x.replace(/[.+^$()|]/g, '\\$&')).join('.')}$`)
    if (next.some((x) => same.test(x))) continue
    if (inHidden || hiddenName(n)) { if (!open) out.push(at, `${at}/**`) } else out.push(`${at}/**/.*`, `${at}/**/.*/**`)
  }
  for (const n of next) {
    const r = hiddenAround(path.join(f, n), ways.filter((w) => w[0] === n).map((w) => w.slice(1)), inHidden || hiddenName(n))
    if (!r) return null
    out.push(...r)
  }
  return out
}
export function readDenies(folders, { own = [] } = {}) {
  const out = []
  const real = (f) => { try { return fs.realpathSync(f) } catch { return f } }
  const both = (list) => [...new Set(list.filter(Boolean).flatMap((x) => [path.resolve(String(x)), real(path.resolve(String(x)))]))]
  const mine = both(own)
  for (const f of both(folders)) {
    const g = glob(f)
    // (The way from f to each of its own folders inside it, where a hidden name is on it.)
    const ways = mine.map((o) => path.relative(f, o)).filter((r) => r && !r.startsWith('..') && !path.isAbsolute(r)).map((r) => r.split(path.sep)).filter((w) => w.some(hiddenName))
    const around = ways.length ? hiddenAround(f, ways) : null
    out.push(...(around ? around.map((x) => `Read(${x})`) : [`Read(${g}/**/.*)`, `Read(${g}/**/.*/**)`]), ...SECRET_GLOBS.map((p) => `Read(${g}/**/${p})`))
  }
  return [...new Set(out)]
}
// A run's folder gone (it ended), or every one older than a day (left from before a restart).
export function drop(dir) { if (dir && path.resolve(dir).startsWith(RUNS + path.sep)) fs.rmSync(dir, { recursive: true, force: true }) }
// (keep: the folders of sessions that may start again, by name: they stay while a session may.)
export function sweep({ keep = new Set() } = {}) {
  try { for (const d of fs.readdirSync(RUNS)) { const p = path.join(RUNS, d); if (!keep.has(d) && Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.rmSync(p, { recursive: true, force: true }) } } catch { /* none */ }
}
// The MCP tools a run used, from what its agent did (its tool calls, mcp__<server>__<tool>):
// [{ server, tool, n }], by the servers it had.
export function usedOf(calls, servers = []) {
  const out = new Map()
  for (const c of calls || []) {
    const m = /^mcp__([A-Za-z0-9_-]+?)__(.+)$/.exec(String(c || ''))
    if (!m) continue
    const server = servers.find((s) => norm(s) === m[1]) || m[1]
    const k = `${server}\n${m[2]}`
    out.set(k, { server, tool: m[2], n: (out.get(k)?.n || 0) + 1 })
  }
  return [...out.values()]
}
