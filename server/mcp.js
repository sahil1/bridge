// MCP servers across agents: one list of the servers each agent CLI can call, and add/remove at
// user scope. Every CLI keeps its own config, so this module knows where each one lives:
//
//   claude    ~/.claude.json            mcpServers (user), projects[path].mcpServers (local),
//                                       <project>/.mcp.json (project)      write: `claude mcp add/remove --scope user`
//   codex     ~/.codex/config.toml      [mcp_servers.<name>]               write: `codex mcp add/remove`
//   grok      ~/.grok/config.toml       [mcp_servers.<name>]               write: `grok mcp add/remove --scope user`
//   gemini    ~/.gemini/settings.json   mcpServers (httpUrl = http, url = sse)       write: file edit
//   qwen      ~/.qwen/settings.json     mcpServers (same shape as Gemini)            write: file edit
//   cursor    ~/.cursor/mcp.json        mcpServers                                   write: file edit
//   copilot   ~/.copilot/mcp-config.json  mcpServers (type local|http|sse)           write: file edit
//   opencode  ~/.config/opencode/opencode.json(c)  mcp (type local|remote)          write: file edit
//   amp       ~/.config/amp/settings.json  "amp.mcpServers"                         write: file edit
//
// CLIs are used only where their `mcp add/remove` flags were checked against `--help`; otherwise
// the JSON file is edited safely (backup once to <file>.bridge-ai.bak, write a temp file, rename).
// Env values and header values are never returned or logged: only their names.
//
// Testing: BRIDGE_MCP_HOME=/some/folder replaces your home folder for every config path here, and
// CLIs are run with HOME (and CODEX_HOME) pointed at it, so nothing touches your real configs.
// BRIDGE_MCP_NO_CLI=1 forces the file-editing path even where a CLI exists.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { loginPath, adapter } from './agents.js'
import { MCP_CATALOG } from '../src/components/settings/mcpCatalog.js'

const TEST_HOME = process.env.BRIDGE_MCP_HOME ? path.resolve(process.env.BRIDGE_MCP_HOME) : null
const HOME = TEST_HOME || os.homedir()
const NO_CLI = process.env.BRIDGE_MCP_NO_CLI === '1'
const envDir = (name, fallback) => (!TEST_HOME && process.env[name]) || fallback
const XDG = () => envDir('XDG_CONFIG_HOME', path.join(HOME, '.config'))

const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

// ---------- Redaction ----------

const SECRET_FLAG = /^--?[A-Za-z0-9-]*(token|secret|password|passwd|api-?key|apikey|auth|credential)[A-Za-z0-9-]*$/i
function redactText(s) {
  return String(s)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, '$1$2:***@')
    .replace(/([?&#;][^=&\s#]*(?:key|token|secret|password|auth|sig|signature|code|session)[^=&\s#]*=)[^&\s#]+/gi, '$1***')
    .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 ***')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9_-]{10,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|glpat-[A-Za-z0-9_-]{10,}|sntrys_[A-Za-z0-9_]{10,}|lin_api_[A-Za-z0-9]{10,})/g, '***')
    .replace(/(\b[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PASS|KEY|AUTH|CREDENTIALS?)[A-Za-z0-9_]*\s*=\s*)("[^"]*"|'[^']*'|[^\s;&|]+)/gi, '$1***')
    .replace(/(--?[A-Za-z0-9-]*(?:token|secret|password|api-?key|apikey|auth)[A-Za-z0-9-]*=)\S+/gi, '$1***')
    .replace(/(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, '***')
}
function redactArgs(args) {
  return args.map((a, i) => (i > 0 && SECRET_FLAG.test(args[i - 1]) ? '***' : redactText(a)))
}
// Scrub a CLI's message of any env value we passed it, then of anything token-shaped.
function scrub(msg, secrets) {
  let s = String(msg || '')
  for (const v of secrets) if (v && v.length >= 3) s = s.split(v).join('***')
  return redactText(s).trim().slice(0, 600)
}

// ---------- Config files ----------

const fileLocks = new Map()
function withLock(file, fn) {
  const prev = fileLocks.get(file) || Promise.resolve()
  const next = prev.then(fn, fn)
  fileLocks.set(file, next.catch(() => {}))
  return next
}

// JSON with comments (OpenCode allows .jsonc): strip // and /* */ outside strings, then trailing commas.
function stripJsonComments(text) {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) { out += c; if (c === '\\') { out += text[++i] ?? '' } else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
function readConfig(file, format) {
  const text = readText(file)
  if (text == null || !text.trim()) return { text, data: {} }
  if (format === 'toml') return { text, data: parseToml(text) }
  return { text, data: JSON.parse(format === 'jsonc' ? stripJsonComments(text) : text) }
}

// Write next to the file, then rename over it, so a crash never leaves half a config. Keep the
// original once as <file>.bridge-ai.bak, and the original permissions (these files hold tokens).
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let mode = 0o600
  if (fs.existsSync(file)) {
    mode = fs.statSync(file).mode & 0o777
    const bak = `${file}.bridge-ai.bak`
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak)
  }
  const tmp = `${file}.bridge-ai-${process.pid}-${Date.now()}.tmp`
  fs.writeFileSync(tmp, text, { mode })
  fs.renameSync(tmp, file)
}

function jsonIndent(text) {
  const m = text && text.match(/^[{[]\s*\n([ \t]+)\S/)
  return m ? m[1] : 2
}

// Edit one map of servers in a JSON file (read, change, write), keeping every other key as it was.
function editJson(file, format, key, fn) {
  return withLock(file, () => {
    const { text, data } = readConfig(file, format)
    if (format === 'jsonc' && text && stripJsonComments(text) !== text) throw new Error(`${short(file)} has comments; edit it by hand so they aren't lost`)
    const root = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    const map = root[key] && typeof root[key] === 'object' ? root[key] : {}
    const changed = fn(map, root)
    if (changed === false) return
    root[key] = map
    const out = JSON.stringify(root, null, jsonIndent(text)) + (text == null || text.endsWith('\n') ? '\n' : '')
    writeAtomic(file, out)
  })
}

// TOML (Codex, Grok) when the CLI can't be used: append a section, or cut one out by its header
// lines. The result is parsed again before it's written, so a bad edit never lands.
function editToml(file, fn) {
  return withLock(file, () => {
    const text = readText(file) ?? ''
    const next = fn(text, text.trim() ? parseToml(text) : {})
    if (next == null || next === text) return
    parseToml(next)
    writeAtomic(file, next)
  })
}
function tomlRemoveServer(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const mine = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${esc}|"${esc}"|'${esc}')\\s*(?:\\]|\\.)`)
  const out = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) skipping = mine.test(line)
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

const short = (file) => (file.startsWith(HOME + path.sep) ? '~' + file.slice(HOME.length) : file)

// ---------- Per-agent formats ----------

const urlTransport = (url, fallback = 'http') => (/\/sse\/?(\?|$)/.test(url || '') ? 'sse' : fallback)
const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [])

// Standard `mcpServers` entries (Claude, Cursor, Copilot, Amp).
function readStd(e) {
  const t = String(e.type || e.transport || '').toLowerCase()
  const url = e.httpUrl || e.url || e.serverUrl
  const transport = e.command ? 'stdio' : t === 'sse' ? 'sse' : t === 'http' || t === 'streamable-http' || e.httpUrl ? 'http' : url ? urlTransport(url) : 'stdio'
  return { transport, command: e.command, args: e.args, url, envKeys: keys(e.env), headerKeys: keys(e.headers), disabled: e.disabled === true || e.enabled === false }
}
// Gemini and Qwen: httpUrl is streamable HTTP, url is SSE.
function readGemini(e) {
  const r = readStd(e)
  if (!e.command && !e.type) r.transport = e.httpUrl ? 'http' : 'sse'
  return r
}
function readToml(e) {
  const envKeys = [...keys(e.env), ...(Array.isArray(e.env_vars) ? e.env_vars.filter((v) => typeof v === 'string') : []), ...(e.bearer_token_env_var ? [e.bearer_token_env_var] : [])]
  const t = String(e.transport || e.type || '').toLowerCase()
  return { transport: e.command ? 'stdio' : t === 'sse' ? 'sse' : 'http', command: e.command, args: e.args, url: e.url, envKeys, headerKeys: [...keys(e.http_headers), ...keys(e.headers), ...keys(e.env_http_headers)], disabled: e.enabled === false }
}
function readOpencode(e) {
  const cmd = Array.isArray(e.command) ? e.command : e.command ? [e.command] : []
  return e.type === 'remote' || e.url
    ? { transport: urlTransport(e.url), url: e.url, envKeys: [], headerKeys: keys(e.headers), disabled: e.enabled === false }
    : { transport: 'stdio', command: cmd[0], args: cmd.slice(1), envKeys: keys(e.environment), disabled: e.enabled === false }
}

const withEnv = (s) => (Object.keys(s.env).length ? { env: s.env } : {})
const stdEntry = (s, { typed = true, localType = 'stdio' } = {}) => s.transport === 'stdio'
  ? { ...(typed ? { type: localType } : {}), command: s.command, args: s.args, ...withEnv(s) }
  : { ...(typed ? { type: s.transport } : {}), url: s.url }
const tomlEntry = (s) => (s.transport === 'stdio' ? { command: s.command, args: s.args, ...withEnv(s) } : { url: s.url })
const geminiEntry = (s) => (s.transport === 'stdio' ? stdEntry(s, { typed: false }) : s.transport === 'http' ? { httpUrl: s.url } : { url: s.url })
const envFlags = (s) => Object.entries(s.env).map(([k, v]) => `--env=${k}=${v}`)
const ALL = ['stdio', 'http', 'sse']

// The agents Bridge manages MCP servers for. `cli` builds the argv for the agent's own command
// (spawned without a shell). Env goes as --env=K=V: Claude's -e takes several values and would
// swallow the server name if written "-e K=V name".
const SPECS = {
  claude: {
    file: () => path.join(envDir('CLAUDE_CONFIG_DIR', HOME), '.claude.json'), format: 'json', key: 'mcpServers', read: readStd,
    transports: ALL, entry: (s) => stdEntry(s),
    // claude mcp add --scope user --transport <t> [--env=K=V...] <name> -- <command> [args...] | <name> <url>
    cli: {
      add: (s) => ['mcp', 'add', '--scope', 'user', '--transport', s.transport, ...envFlags(s), s.name, ...(s.transport === 'stdio' ? ['--', s.command, ...s.args] : [s.url])],
      remove: (name) => ['mcp', 'remove', '--scope', 'user', name],
    },
  },
  codex: {
    file: () => path.join(envDir('CODEX_HOME', path.join(HOME, '.codex')), 'config.toml'), format: 'toml', key: 'mcp_servers', read: readToml,
    transports: ['stdio', 'http'], entry: tomlEntry,
    // codex mcp add [--env=K=V...] <name> -- <command> [args...] | codex mcp add <name> --url <url>
    cli: {
      add: (s) => ['mcp', 'add', ...(s.transport === 'stdio' ? envFlags(s) : []), s.name, ...(s.transport === 'stdio' ? ['--', s.command, ...s.args] : ['--url', s.url])],
      remove: (name) => ['mcp', 'remove', name],
    },
    // `codex mcp add --url` starts an OAuth sign-in right away and waits for a browser, so HTTP
    // servers are appended to config.toml instead and signed in later with `codex mcp login`.
    cliAdds: (s) => s.transport === 'stdio',
    loginHint: (name) => `Added. Sign in with: codex mcp login ${name}`,
  },
  grok: {
    file: () => path.join(HOME, '.grok', 'config.toml'), format: 'toml', key: 'mcp_servers', read: readToml,
    transports: ALL, entry: (s) => (s.transport === 'sse' ? { url: s.url, type: 'sse' } : tomlEntry(s)),
    // grok mcp add --scope user --transport <t> [--env=K=V...] <name> -- <command> [args...] | <name> <url>
    cli: {
      add: (s) => ['mcp', 'add', '--scope', 'user', '--transport', s.transport, ...envFlags(s), s.name, ...(s.transport === 'stdio' ? ['--', s.command, ...s.args] : [s.url])],
      remove: (name) => ['mcp', 'remove', '--scope', 'user', name],
    },
  },
  gemini: { file: () => path.join(HOME, '.gemini', 'settings.json'), format: 'json', key: 'mcpServers', read: readGemini, transports: ALL, entry: geminiEntry },
  qwen: { file: () => path.join(HOME, '.qwen', 'settings.json'), format: 'json', key: 'mcpServers', read: readGemini, transports: ALL, entry: geminiEntry },
  cursor: {
    file: () => path.join(HOME, '.cursor', 'mcp.json'), format: 'json', key: 'mcpServers', read: readStd,
    transports: ALL, entry: (s) => (s.transport === 'stdio' ? stdEntry(s) : { url: s.url }),
  },
  copilot: {
    file: () => path.join(envDir('COPILOT_HOME', path.join(HOME, '.copilot')), 'mcp-config.json'), format: 'json', key: 'mcpServers', read: readStd,
    transports: ALL, entry: (s) => ({ ...stdEntry(s, { localType: 'local' }), tools: ['*'] }),
  },
  opencode: {
    file: () => {
      const dir = path.join(XDG(), 'opencode')
      const json = path.join(dir, 'opencode.json')
      const jsonc = path.join(dir, 'opencode.jsonc')
      return !fs.existsSync(json) && fs.existsSync(jsonc) ? jsonc : json
    },
    format: 'jsonc', key: 'mcp', read: readOpencode, transports: ALL,
    entry: (s) => (s.transport === 'stdio'
      ? { type: 'local', command: [s.command, ...s.args], enabled: true, ...(Object.keys(s.env).length ? { environment: s.env } : {}) }
      : { type: 'remote', url: s.url, enabled: true }),
    newFile: { $schema: 'https://opencode.ai/config.json' },
  },
  amp: {
    file: () => path.join(XDG(), 'amp', 'settings.json'), format: 'json', key: 'amp.mcpServers', read: readStd,
    transports: ALL, entry: (s) => (s.transport === 'stdio' ? stdEntry(s, { typed: false }) : { url: s.url }),
  },
}

// ---------- Reading ----------

function serverView(name, raw, read) {
  const n = read(raw && typeof raw === 'object' ? raw : {})
  const args = Array.isArray(n.args) ? n.args.map(String) : []
  const shownArgs = redactArgs(args)
  const url = n.url ? redactText(n.url) : undefined
  const command = n.command ? redactText(n.command) : undefined
  return {
    name, transport: n.transport, command, args: n.transport === 'stdio' ? shownArgs : [], url,
    envKeys: [...new Set(n.envKeys || [])], headerKeys: [...new Set(n.headerKeys || [])],
    disabled: !!n.disabled,
    redacted: shownArgs.some((a, i) => a !== args[i]) || url !== n.url || command !== n.command,
  }
}
const signature = (v) => JSON.stringify([v.transport, v.command || '', v.args, v.url || ''])

async function readAgent(kind, label) {
  const spec = SPECS[kind]
  const file = spec.file()
  const found = []
  let error = null
  try {
    const { data } = readConfig(file, spec.format)
    const map = data?.[spec.key]
    for (const [name, raw] of Object.entries(map && typeof map === 'object' ? map : {})) found.push({ view: serverView(name, raw, spec.read), scope: 'user', source: short(file) })
    // Claude also keeps per-project servers: "local" scope in ~/.claude.json, "project" in .mcp.json.
    // Projects are in your folders (Desktop, Documents), which macOS can hold a look into until you
    // answer its permission prompt, so their .mcp.json is read without blocking.
    if (kind === 'claude' && data?.projects && typeof data.projects === 'object') {
      const projects = Object.entries(data.projects)
      const shared = await Promise.all(projects.map(([proj]) => fs.promises.readFile(path.join(proj, '.mcp.json'), 'utf8').catch(() => null)))
      for (const [i, [proj, p]] of projects.entries()) {
        for (const [name, raw] of Object.entries(p?.mcpServers || {})) found.push({ view: serverView(name, raw, readStd), scope: 'local', project: proj, source: short(file) })
        const mcpJson = path.join(proj, '.mcp.json')
        try {
          const servers = JSON.parse(shared[i])?.mcpServers || {}
          for (const [name, raw] of Object.entries(servers)) found.push({ view: serverView(name, raw, readStd), scope: 'project', project: proj, source: short(mcpJson) })
        } catch { /* no .mcp.json there */ }
      }
    }
  } catch (e) {
    error = `Couldn't read ${short(file)}: ${redactText(e.message).slice(0, 200)}`
  }
  return { kind, label, file: short(file), found, error }
}

async function agentsWithMcp(installed) {
  const list = await installed()
  const have = new Map(list.map((a) => [a.kind, a]))
  // In test mode, an agent with a config file in the test home counts as present (file edits only).
  if (TEST_HOME) for (const kind of Object.keys(SPECS)) if (!have.has(kind) && fs.existsSync(SPECS[kind].file())) have.set(kind, { kind, label: adapter(kind).label, path: null })
  return [...have.values()].filter((a) => SPECS[a.kind])
}
const usesCli = (agent) => !!(SPECS[agent.kind].cli && agent.path && !NO_CLI)

async function listAll(installed) {
  const agents = await agentsWithMcp(installed)
  const reads = await Promise.all(agents.map((a) => readAgent(a.kind, a.label)))
  const byName = new Map()
  for (const r of reads) {
    for (const f of r.found) {
      let s = byName.get(f.view.name)
      if (!s) { s = { ...f.view, agents: [] }; byName.set(f.view.name, s) }
      s.agents.push({
        kind: r.kind, label: r.label, scope: f.scope, source: f.source,
        ...(f.project ? { project: f.project } : {}), ...(f.view.disabled ? { disabled: true } : {}),
        ...(signature(f.view) !== signature(s) ? { differs: true } : {}),
      })
      s.envKeys = [...new Set([...s.envKeys, ...f.view.envKeys])]
      s.headerKeys = [...new Set([...s.headerKeys, ...f.view.headerKeys])]
      s.redacted = s.redacted || f.view.redacted
    }
  }
  for (const s of byName.values()) delete s.disabled
  return {
    servers: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    agents: agents.map((a) => {
      const r = reads.find((x) => x.kind === a.kind)
      return { kind: a.kind, label: a.label, file: r.file, transports: SPECS[a.kind].transports, method: usesCli(a) ? 'cli' : 'file', ...(r.error ? { error: r.error } : {}) }
    }),
    unsupported: (await installed()).filter((a) => !SPECS[a.kind]).map((a) => ({ kind: a.kind, label: a.label })),
    ...(TEST_HOME ? { testHome: true } : {}),
  }
}

// ---------- Writing ----------

async function runCli(bin, args, secrets) {
  const env = { ...process.env, PATH: await loginPath() }
  if (TEST_HOME) {
    env.HOME = TEST_HOME
    env.CODEX_HOME = path.join(TEST_HOME, '.codex')
    delete env.CLAUDE_CONFIG_DIR; delete env.COPILOT_HOME; delete env.XDG_CONFIG_HOME
  }
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env, cwd: HOME, timeout: 60_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error(scrub(stderr || stdout || err.message, secrets) || 'The command failed'))
      else resolve(scrub(stdout, secrets))
    })
  })
}

function hasUserServer(kind, name) {
  const spec = SPECS[kind]
  const { data } = readConfig(spec.file(), spec.format)
  const map = data?.[spec.key]
  return !!(map && typeof map === 'object' && Object.hasOwn(map, name))
}

async function addTo(agent, s) {
  const spec = SPECS[agent.kind]
  if (!spec.transports.includes(s.transport)) throw new Error(`${agent.label} doesn't support ${s.transport.toUpperCase()} servers`)
  if (hasUserServer(agent.kind, s.name)) throw new Error(`Already has a server named ${s.name}`)
  if (usesCli(agent) && (!spec.cliAdds || spec.cliAdds(s))) {
    try { await runCli(agent.path, spec.cli.add(s), Object.values(s.env)) } catch (e) {
      // Codex adds an HTTP server, then tries to sign in and exits non-zero without a browser.
      if (hasUserServer(agent.kind, s.name)) return { via: 'cli', note: spec.loginHint?.(s.name) || 'Added; sign in from the agent' }
      throw e
    }
    return { via: 'cli' }
  }
  const file = spec.file()
  if (spec.format === 'toml') {
    await editToml(file, (text, data) => {
      if (data?.mcp_servers?.[s.name]) throw new Error(`Already has a server named ${s.name}`)
      const block = stringifyToml({ mcp_servers: { [s.name]: spec.entry(s) } })
      return (text.trim() ? text.replace(/\s*$/, '\n\n') : '') + block.trimEnd() + '\n'
    })
    return { via: 'file', ...(s.transport !== 'stdio' && spec.loginHint ? { note: spec.loginHint(s.name) } : {}) }
  }
  await editJson(file, spec.format, spec.key, (map, root) => {
    if (Object.hasOwn(map, s.name)) throw new Error(`Already has a server named ${s.name}`)
    if (spec.newFile && !Object.keys(root).length) Object.assign(root, spec.newFile)
    map[s.name] = spec.entry(s)
  })
  return { via: 'file' }
}

async function removeFrom(agent, name) {
  const spec = SPECS[agent.kind]
  if (!hasUserServer(agent.kind, name)) throw new Error(`No user-level server named ${name}`)
  if (usesCli(agent)) { await runCli(agent.path, spec.cli.remove(name), []); return { via: 'cli' } }
  const file = spec.file()
  if (spec.format === 'toml') {
    await editToml(file, (text) => {
      const next = tomlRemoveServer(text, name)
      if (parseToml(next)?.mcp_servers?.[name]) throw new Error(`Couldn't remove ${name} from ${short(file)} safely; edit it by hand`)
      return next
    })
    return { via: 'file' }
  }
  await editJson(file, spec.format, spec.key, (map) => { if (!Object.hasOwn(map, name)) return false; delete map[name] })
  return { via: 'file' }
}

function validate(body) {
  const b = body || {}
  const name = String(b.name || '').trim()
  if (!NAME_RE.test(name)) throw new Error('Name: 1 to 64 letters, numbers, dots, dashes or underscores')
  const transport = String(b.transport || 'stdio')
  if (!ALL.includes(transport)) throw new Error('Transport must be stdio, http or sse')
  const s = { name, transport, command: undefined, args: [], url: undefined, env: {} }
  if (transport === 'stdio') {
    s.command = String(b.command || '').trim()
    if (!s.command || /[\r\n\0]/.test(s.command)) throw new Error('Enter the command that starts the server')
    const args = b.args == null ? [] : b.args
    if (!Array.isArray(args) || args.length > 64 || args.some((a) => typeof a !== 'string' || /[\r\n\0]/.test(a))) throw new Error('Arguments must be a list of strings')
    if (args.some((a) => /^<[^>]+>$/.test(a))) throw new Error('Replace the <placeholder> arguments first')
    s.args = args
  } else {
    let u
    try { u = new URL(String(b.url || '').trim()) } catch { throw new Error('Enter the server URL') }
    if (!/^https?:$/.test(u.protocol)) throw new Error('The URL must start with http:// or https://')
    s.url = u.toString()
  }
  for (const [k, v] of Object.entries(b.env && typeof b.env === 'object' ? b.env : {})) {
    if (!ENV_KEY_RE.test(k)) throw new Error(`Bad env var name: ${k.slice(0, 40)}`)
    if (typeof v !== 'string' || /[\r\n\0]/.test(v)) throw new Error(`Env var ${k} needs a one-line value`)
    if (v !== '') s.env[k] = v
  }
  const kinds = Array.isArray(b.agents) ? [...new Set(b.agents.map(String))] : []
  if (!kinds.length) throw new Error('Pick at least one agent')
  return { s, kinds }
}

async function forEachAgent(installed, kinds, fn) {
  const agents = await agentsWithMcp(installed)
  const results = []
  for (const kind of kinds) {
    const agent = agents.find((a) => a.kind === kind)
    if (!agent) { results.push({ kind, ok: false, error: SPECS[kind] ? 'Not installed' : "Bridge doesn't manage MCP servers for this agent yet" }); continue }
    try { results.push({ kind, label: agent.label, ok: true, ...(await fn(agent)) }) }
    catch (e) { results.push({ kind, label: agent.label, ok: false, error: e.message }) }
  }
  return results
}

// ---------- Routes ----------

export function mcpRoutes(app, { installed }) {
  app.get('/api/mcp', async (req, res) => {
    try { res.json(await listAll(installed)) } catch (e) { res.status(502).json({ error: redactText(e.message) }) }
  })

  app.get('/api/mcp/catalog', (req, res) => res.json({ servers: MCP_CATALOG }))

  app.post('/api/mcp', async (req, res) => {
    let secrets = []
    try {
      secrets = Object.values(req.body?.env && typeof req.body.env === 'object' ? req.body.env : {}).map(String)
      const { s, kinds } = validate(req.body)
      const results = await forEachAgent(installed, kinds, (agent) => addTo(agent, s))
      // An error might quote the command line; never echo an env value back.
      for (const r of results) if (r.error) r.error = scrub(r.error, secrets)
      res.json({ name: s.name, results })
    } catch (e) { res.status(502).json({ error: scrub(e.message, secrets) }) }
  })

  app.delete('/api/mcp/:name', async (req, res) => {
    try {
      const name = String(req.params.name || '')
      if (!NAME_RE.test(name)) throw new Error('Bad server name')
      let kinds = String(req.query.agents || '').split(',').map((k) => k.trim()).filter(Boolean)
      if (!kinds.length) {
        const all = await agentsWithMcp(installed)
        kinds = all.filter((a) => { try { return hasUserServer(a.kind, name) } catch { return false } }).map((a) => a.kind)
        if (!kinds.length) throw new Error(`No agent has ${name} at user level`)
      }
      res.json({ name, results: await forEachAgent(installed, kinds, (agent) => removeFrom(agent, name)) })
    } catch (e) { res.status(502).json({ error: redactText(e.message) }) }
  })
}
