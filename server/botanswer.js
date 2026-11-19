// What answers a bot's questions (Bots, Settings › Bots › Set Up › What Answers): an ordered list, its
// first choice and then its fallbacks, each one of
//   agent:<kind>[:<model>]   an agent's command line that can only read (Claude Code, Codex), on a
//                            model of its own or its usual one: agent:claude:opus, agent:codex
//   model:<route>:<model>    any model in chatmodels.js's one list: a key in Model Providers, Ollama's
//                            or LM Studio's, the local model built in (model:ollama:qwen3)
// Automatic (no list of your own) is the best that's here: the agent you picked for it, Claude Code,
// Codex, then the models a key reaches, the models on this computer last. So Automatic never goes
// from a model on this computer to one elsewhere; a list of your own goes where it says. Fallback off:
// only the first that's there is tried.
//
// One that can't answer is passed over at once, the next tried, and why is in its record: not
// installed, not signed in, at its usage limit, a provider's error (a key turned down, a 429, a 5xx,
// no network), a server on this computer that isn't running, or a command line that never got going.
// An answer, or NO ANSWER, is an answer. When none can, the question is passed to you with each one's
// reason (frontdesk.js).
//
// A model answers through Bridge AI's own tools (runChat below): it reads, searches and lists only
// inside the bot's folders (their real paths, so a link out of them is refused, as Claude Code's
// --add-dir with dontAsk refuses it), and the files attached to the question; and calls the bot's MCP
// servers' tools under the same rules as Claude Code's runs (botmcp.js). It can't change a file, run a
// command or reach anything else, so it's kept to its folders as Claude Code is. Its one way to make
// a file is save_file, into its run's outbox (botfiles.js) and nowhere else, to send back with its
// answer.
import fs from 'node:fs'
import path from 'node:path'
import { adapter, readOnly, canChange } from './agents.js'
import { HOME } from './paths.js'
import * as botmcp from './botmcp.js'

const AGENTS = ['claude', 'codex']
const ID = /^(agent:(claude|codex)(:[\w.-]{1,60})?|model:[a-z][\w-]*:[^\s]{1,200})$/
export const validId = (id) => ID.test(String(id || '')) && !/^model:cli:/.test(String(id))
// An entry by its id: { id, kind, agent, model }.
export function entryOf(id) {
  const s = String(id || '')
  if (!validId(s)) return null
  if (s.startsWith('agent:')) { const [, agent, ...m] = s.split(':'); return { id: s, kind: 'agent', agent, model: m.join(':') || null } }
  return { id: s, kind: 'model', model: s.slice(6) }
}
// Whether it runs on this computer (a model here), or elsewhere (an agent's provider, a key's).
export const isLocal = (e) => e?.kind === 'model' && /^(ollama|lmstudio|bridge):/.test(e.model)
export const canMakeChanges = (e) => e?.kind === 'agent' && canChange(e.agent)
// Its name, as it's shown and said: Claude Code (opus), or a model as Model Providers names it.
export function labelOf(e, models = []) {
  if (!e) return ''
  if (e.kind === 'agent') return `${adapter(e.agent).label}${e.model ? ` (${e.model})` : ''}`
  const m = models.find((x) => x.id === e.model)
  return m ? `${m.label}${m.provider ? ` · ${m.provider}` : ''}` : e.model.split(':').slice(1).join(':') || e.model
}

// What can be picked here: each agent that can only read (on its usual model, or one of its own),
// and each model you can reach but through a sign-in (an agent covers that), local or not.
export function options({ installed = [], models = [] }) {
  const have = new Set(installed)
  const out = []
  for (const k of AGENTS) {
    if (!readOnly(k)) continue
    out.push({ id: `agent:${k}`, installed: have.has(k) })
    for (const m of adapter(k).models || []) out.push({ id: `agent:${k}:${m}`, installed: have.has(k) })
  }
  for (const m of models) if (m.via !== 'sign-in' && !String(m.id).startsWith('cli:')) out.push({ id: `model:${m.id}` })
  return out.map((x) => { const e = entryOf(x.id); return { ...x, label: labelOf(e, models), local: isLocal(e), changes: canMakeChanges(e) } })
}

// The list a bot answers with, in order: its own, or Automatic's; each entry once.
export function listOf(bot, { installed = [], models = [] }) {
  const own = Array.isArray(bot.answerers) && bot.answerers.length ? bot.answerers : null
  const ids = own || [
    ...(bot.agent ? [`agent:${bot.agent}`] : []),
    ...AGENTS.filter((k) => installed.includes(k) && readOnly(k)).map((k) => `agent:${k}`),
    ...models.filter((m) => m.via !== 'sign-in' && m.via !== 'local' && !String(m.id).startsWith('cli:')).map((m) => `model:${m.id}`),
    ...models.filter((m) => m.via === 'local').map((m) => `model:${m.id}`),
  ]
  const list = [...new Set(ids)].map(entryOf).filter(Boolean).map((e) => ({ ...e, label: labelOf(e, models), local: isLocal(e) }))
  return { list, automatic: !own, fallback: bot.fallback !== false }
}
// Why it can't answer now, before it's tried, or null: not installed, not one that can only read,
// not signed in; a model no key or server here reaches.
export function notReady(e, { installed = [], models = [], signedIn = {} }) {
  if (e.kind === 'agent') {
    if (!installed.includes(e.agent)) return `${adapter(e.agent).label} isn't installed here`
    if (!readOnly(e.agent)) return `${adapter(e.agent).label} can't answer read-only`
    if (signedIn[e.agent] === false) return `${adapter(e.agent).label} isn't signed in here`
    return null
  }
  if (models.some((m) => m.id === e.model)) return null
  return isLocal(e) ? `${labelOf(e, models)} isn't running on this computer` : `${labelOf(e, models)} isn't set up here: no key for it in Model Providers`
}

// ---------- A model answering ----------
const STEPS = 12
const READ_MAX = 400 // lines a read gives, unless it asks for fewer
const FILE_MAX = 2 * 1024 * 1024
const FOUND_MAX = 100
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build'])
const SYSTEM = 'You are a bot\'s answering agent in Bridge AI. The message you\'re given is your brief: who you answer for, what you may read and the question. Use your tools to read the folders it names before answering; they only read. Then answer as the brief says, with nothing else.'
const TOOLS = [
  { name: 'read_file', description: 'Read a text file in the folders you can read. Returns its lines, numbered.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'The file: a path in one of your folders, or relative to the first' }, offset: { type: 'integer', description: 'First line to read, from 1' }, limit: { type: 'integer', description: 'How many lines, 400 if not given' } }, required: ['path'] } },
  { name: 'list_files', description: 'List a folder you can read: its files, and its folders ending in /.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'The folder; the first of yours if not given' } } } },
  { name: 'search', description: 'Search the files in your folders for text or a regular expression. Returns "path:line: text" for each match.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Text or a JavaScript regular expression' }, path: { type: 'string', description: 'A folder or file to search in; all your folders if not given' } }, required: ['pattern'] } },
]
const SAVE = { name: 'save_file', description: 'Save a file to send back with your answer (a chart, a table, a document). It goes in your outbox, the only place you can write.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Its name, with its extension: chart.svg, totals.csv' }, content: { type: 'string', description: 'What it holds' }, base64: { type: 'boolean', description: 'true when content is base64 (a picture, a PDF)' } }, required: ['name', 'content'] } }
const SAVE_MAX = 25 * 1024 * 1024
const tilde = (p) => (p === HOME || p.startsWith(HOME + path.sep) ? `~${p.slice(HOME.length)}` : p)
const refused = (why) => Object.assign(new Error(why), { refused: true })

// A question answered by a model: { text, reads, tools, steps }. reply: chatmodels.js's. folders:
// the folders it may read (the first, where a relative path starts); also: other folders of its own
// (the files attached to the question); mcp: { servers: { name: config }, all } (its MCP servers, and
// whether every tool may be used, else only those that only read). outbox: its run's, where
// save_file writes (botfiles.js); none, no save_file. onStep({ doing, reading, tools }): as it goes,
// for Try It. signal: stop it. messages: its conversation, added to as it goes, so the caller has it
// when it's stopped (frontdesk.js: a run stopped at its time limit is picked up from it); with none,
// it starts from the brief.
export async function runChat({ reply, model, brief, folders = [], also = [], mcp = null, outbox = null, signal, onStep = () => {}, messages = null }) {
  const real = async (p) => fs.promises.realpath(p).catch(() => null)
  const roots = (await Promise.all(folders.map(real))).filter(Boolean)
  const allowed = [...roots, ...(await Promise.all(also.map(real))).filter(Boolean)]
  const within = (p) => allowed.some((r) => p === r || p.startsWith(r + path.sep))
  // A path it asked for, as the real path it is, only inside its folders.
  async function place(p, { dir = false } = {}) {
    const raw = String(p || '').trim().replace(/^~(?=$|[\\/])/, HOME)
    if (!raw && dir && roots[0]) return roots[0]
    if (!roots.length && !raw) throw refused('You have no folders to read.')
    const full = path.isAbsolute(raw) ? raw : path.join(roots[0] || HOME, raw)
    const r = await real(full)
    if (!r) throw refused(`${tilde(full)} isn't there.`)
    if (!within(r)) throw refused(`${tilde(full)} is outside the folders you can read: refused.`)
    return r
  }
  const reads = []
  const used = new Map()
  const status = (doing) => onStep({ doing, reading: reads.map((x) => x.what).slice(-5), tools: [...used.values()] })
  async function walk(dir, fn, depth = 0) {
    let ents = []
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (SKIP.has(e.name) || e.isSymbolicLink()) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth < 8) { if (await walk(p, fn, depth + 1) === false) return false } } else if (e.isFile() && (await fn(p)) === false) return false
    }
    return true
  }
  // Its MCP servers' tools it may use, as tools of its own.
  const mcpTools = new Map() // tool name -> { server, tool }
  for (const [server, raw] of Object.entries(mcp?.servers || {})) {
    const r = await botmcp.toolsOf(server, raw)
    for (const t of r.tools || []) if (mcp.all || t.readOnly) mcpTools.set(botmcp.toolName(server, t.name), { server, tool: t.name, raw, description: t.description || t.title || t.name, schema: t.schema || { type: 'object', properties: {} } })
  }
  const tools = [...TOOLS, ...(outbox ? [SAVE] : []), ...[...mcpTools].map(([name, x]) => ({ name, description: `${x.description} (MCP server ${x.server})`, parameters: x.schema }))]
  async function run(c) {
    const a = c.args || {}
    // (Its name only: a path in it goes nowhere but the outbox.)
    if (c.name === 'save_file' && outbox) {
      const name = path.basename(String(a.name || '').replace(/\\/g, '/')).replace(/\p{Cf}/gu, '').replace(/[:*?"<>|\x00-\x1f]+/g, '-').replace(/^\.+/, '').slice(0, 120) // eslint-disable-line no-control-regex
      if (!name) throw refused('Give the file a name.')
      const body = a.base64 === true ? Buffer.from(String(a.content || ''), 'base64') : Buffer.from(String(a.content ?? ''), 'utf8')
      if (body.length > SAVE_MAX) throw refused('That file is too big to send back.')
      // (As many as a run sends, all told: 5, 25 MB each.)
      const there = (await fs.promises.readdir(outbox).catch(() => [])).filter((n) => n !== name)
      const sizes = await Promise.all(there.map((n) => fs.promises.lstat(path.join(outbox, n)).then((x) => x.size, () => 0)))
      if (there.length >= 5) throw refused('You\'ve saved 5 files already, the most that go with an answer.')
      if (sizes.reduce((a, b) => a + b, 0) + body.length > 5 * SAVE_MAX) throw refused('That\'s more than an answer can send back, all told.')
      await fs.promises.writeFile(path.join(outbox, name), body, { mode: 0o600 })
      status(`save_file: ${name}`)
      return `Saved ${name} (${body.length} bytes): it goes with your answer.`
    }
    if (c.name === 'read_file') {
      const p = await place(a.path)
      const st = await fs.promises.stat(p)
      if (!st.isFile()) throw refused(`${tilde(p)} isn't a file.`)
      if (st.size > FILE_MAX) throw refused(`${tilde(p)} is too big to read here.`)
      reads.push({ tool: 'Read', what: tilde(p) })
      status(`read_file: ${tilde(p)}`)
      const lines = (await fs.promises.readFile(p, 'utf8')).split('\n')
      const from = Math.max(1, Number(a.offset) || 1)
      const n = Math.max(1, Math.min(2000, Number(a.limit) || READ_MAX))
      return lines.slice(from - 1, from - 1 + n).map((l, i) => `${from + i}\t${l}`).join('\n') || '(empty)'
    }
    if (c.name === 'list_files') {
      const p = await place(a.path, { dir: true })
      reads.push({ tool: 'Glob', what: tilde(p) })
      status(`list_files: ${tilde(p)}`)
      const ents = await fs.promises.readdir(p, { withFileTypes: true })
      return ents.filter((e) => !e.name.startsWith('.')).slice(0, 500).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n') || '(empty)'
    }
    if (c.name === 'search') {
      let re
      try { re = new RegExp(String(a.pattern || ''), 'i') } catch { re = new RegExp(String(a.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
      const under = a.path ? [await place(a.path, { dir: true })] : roots
      reads.push({ tool: 'Grep', what: under.map(tilde).join(', ') })
      status(`search: ${a.pattern}`)
      const found = []
      for (const top of under) {
        const one = async (p) => {
          const st = await fs.promises.stat(p).catch(() => null)
          if (!st || st.size > FILE_MAX) return true
          const text = await fs.promises.readFile(p, 'utf8').catch(() => '')
          if (text.includes('\0')) return true
          text.split('\n').forEach((l, i) => { if (found.length < FOUND_MAX && re.test(l)) found.push(`${tilde(p)}:${i + 1}: ${l.slice(0, 300)}`) })
          return found.length < FOUND_MAX
        }
        if ((await fs.promises.stat(top)).isFile()) await one(top)
        else await walk(top, one)
      }
      return found.join('\n') || 'Nothing matches.'
    }
    const t = mcpTools.get(c.name)
    if (!t) throw refused(`There's no tool called ${c.name} for you here.`)
    status(`${t.server}: ${t.tool}`)
    const k = `${t.server}\n${t.tool}`
    used.set(k, { server: t.server, tool: t.tool, n: (used.get(k)?.n || 0) + 1 })
    return botmcp.callTool(t.server, t.raw, t.tool, a)
  }
  if (!messages?.length) messages = [{ role: 'user', text: brief }]
  status(null)
  for (let step = 1; ; step++) {
    if (signal?.aborted) throw Object.assign(new Error('stopped'), { stopped: true })
    const r = await reply(model, messages, { signal, tools, system: SYSTEM, feature: 'bots' })
    messages.push({ role: 'assistant', text: r.text || '', ...(r.calls?.length ? { calls: r.calls } : {}) })
    if (!r.calls?.length || step >= STEPS) return { text: String(r.text || '').trim(), reads, tools: [...used.values()], steps: step, messages }
    for (const c of r.calls) {
      let res
      try { res = { text: String(await run(c)).slice(0, 60000) } } catch (e) { res = { text: e.refused ? e.message : `It didn't work: ${e.message}`, error: true } }
      messages.push({ role: 'tool', id: c.id, name: c.name, text: res.text, ...(res.error ? { error: true } : {}) })
    }
  }
}

// A model's conversation as it stood when its run was stopped, to go on from: up to its last whole
// step, so a reply whose tool calls didn't all get their results (stopped in the middle) is left
// out, and asked again.
export function wholeSteps(messages) {
  const list = Array.isArray(messages) ? messages.filter((m) => m && typeof m === 'object' && m.role) : []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m.role !== 'assistant' || !m.calls?.length) continue
    const got = list.slice(i + 1).filter((x) => x.role === 'tool').length
    return got < m.calls.length ? list.slice(0, i) : list
  }
  return list
}
