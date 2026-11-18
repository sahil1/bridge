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
// and rules.json. The folder goes once the run has ended (frontdesk.js), and any left from before
// Bridge AI started again a day later.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataFile, writeFileAtomic, HOME } from './paths.js'
import { loginPath } from './agents.js'
import { claudeServers, claudeServerView } from './mcp.js'

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
// for the record: { dir, servers: [{ name, all, tools, problem }], missing }.
export async function runFolder(bot, { all = false, key }) {
  const want = bot.mcp || []
  if (!want.length) return null
  const have = claudeServers()
  const picked = want.filter((n) => have[n])
  const missing = want.filter((n) => !have[n])
  if (!picked.length) return { dir: null, servers: [], missing }
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
  writeFileAtomic(path.join(dir, 'config.json'), JSON.stringify({ mcpServers: Object.fromEntries(picked.map((n) => [n, have[n]])) }, null, 2), { mode: 0o600 })
  writeFileAtomic(path.join(dir, 'rules.json'), JSON.stringify({ allow, deny }, null, 2), { mode: 0o600 })
  return { dir, servers: said, missing }
}
// A run's folder gone (it ended), or every one older than a day (left from before a restart).
export function drop(dir) { if (dir && path.resolve(dir).startsWith(RUNS + path.sep)) fs.rmSync(dir, { recursive: true, force: true }) }
export function sweep() {
  try { for (const d of fs.readdirSync(RUNS)) { const p = path.join(RUNS, d); if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.rmSync(p, { recursive: true, force: true }) } } catch { /* none */ }
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
