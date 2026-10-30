// Bridge AI's own chat: talk to any model you can reach (chatmodels.js) with nothing to install.
// It runs in a terminal like the other agents, so everything Bridge AI does with agents works with
// it: Chat, the phone, the message queue, notifications. Its screen is drawn like Claude Code's
// (an input box between two rules, a "✻ Thinking… (esc to interrupt)" line while it waits), and
// each turn is logged in Codex's format, so Chat reads it the way it reads Codex.
//
// Started in a project folder (not the one plain chats share), it works on files: it can read,
// search, change files and run commands with tools, and asks before each change or command, with
// a numbered menu like Claude Code's, so the question shows as a card in Chat. Edits are logged as
// Codex's apply_patch, so Chat shows what changed.
//
//   node chatagent.js --session-id <id> [first message]     a new chat
//   node chatagent.js --resume <id>                          the same chat, after a restart
// The model comes from BRIDGE_CHAT_MODEL, else the one the chat last used, else the first you
// can reach. In the chat: /model to switch, /models to list.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DATA, dataFile, ensureDir } from './paths.js'
import { models, describe, reply, canUseTools, SYSTEM } from './chatmodels.js'

const args = process.argv.slice(2)
let sessionId = null
let resuming = false
let opening = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--session-id' || args[i] === '--resume') { resuming = args[i] === '--resume'; sessionId = args[++i] } else opening = args[i]
}
if (!/^[\w-]{8,64}$/.test(sessionId || '')) { console.error('Usage: chatagent.js --session-id <id> [message] | --resume <id>'); process.exit(2) }
const LOG = dataFile('chat-logs', `${sessionId}.jsonl`) // transcripts.js reads it from there
ensureDir(path.dirname(LOG))
// working / blocked / idle, for herdr, which can't tell (runtime/herdr.js reads it).
const STATE = dataFile('chat-logs', `${sessionId}.state`)
const state = (s) => { try { fs.writeFileSync(STATE, s, { mode: 0o600 }) } catch { /* read-only disk */ } }
state('idle')
const WORK = path.resolve(process.cwd())
const PROJECT = WORK !== path.join(DATA, 'chats') // plain chats share that folder: no files there

// ---------- The log ----------
// Two records of each turn: Codex's, for Chat to show, and bridge_turn, the conversation as the
// model sees it (tool calls and their results included), to carry on from after a restart.
const now = () => new Date().toISOString()
const write = (type, payload) => fs.appendFileSync(LOG, JSON.stringify({ timestamp: now(), type, payload }) + '\n', { mode: 0o600 })
const said = (role, text, extra = {}) => write('response_item', { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }], ...extra })
const messages = []
const remember = (m) => { messages.push(m); write('bridge_turn', m) }
let model = null
if (fs.existsSync(LOG)) {
  const legacy = []
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    const p = e.payload || {}
    if (e.type === 'turn_context' && p.model) model = p.model
    if (e.type === 'bridge_turn' && p.role) messages.push(p)
    if (e.type === 'response_item' && p.type === 'message' && !p.bridge_error) legacy.push({ role: p.role, text: (p.content || []).map((c) => c.text || '').join('') })
  }
  if (!messages.length) messages.push(...legacy) // a chat from before bridge_turn
} else write('session_meta', { id: sessionId, cwd: WORK, originator: 'bridge_chat', timestamp: now() })

// Every tool call needs its result before the next turn: one cut off (a crash, a restart) gets one.
function settle() {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.calls?.length) continue
    let at = i + 1
    const done = new Set()
    for (; at < messages.length && messages[at].role === 'tool'; at++) done.add(messages[at].id)
    const missing = m.calls.filter((c) => !done.has(c.id))
    if (missing.length) messages.splice(at, 0, ...missing.map((c) => ({ role: 'tool', id: c.id, name: c.name, text: 'Not run: it was stopped.', error: true })))
  }
}

// ---------- The screen ----------
const out = (s) => process.stdout.write(s)
const R = () => process.stdout.rows || 40
const C = () => process.stdout.columns || 100
const RULE = () => '─'.repeat(Math.max(10, C() - 1))
let buf = ''
let busy = false
let ctrl = null
let asking = null // { resolve }: a change or command waiting for your yes or no
const queue = []
// Lines scroll in the rows above the box; the box stays on the bottom three rows.
const say = (text = '') => { for (const l of String(text).replace(/\r/g, '').split('\n')) out(`\x1b7\x1b[${R() - 4};1H\n${l}\x1b8`) }
const dim = (t) => `\x1b[2m${t}\x1b[0m`
const status = (t) => out(`\x1b7\x1b[${R() - 3};1H\x1b[2K${t}\x1b8`)
function box() {
  if (asking) return
  const shown = buf.replace(/\n/g, ' ⏎ ')
  const fit = shown.length > C() - 4 ? `…${shown.slice(-(C() - 5))}` : shown
  out(`\x1b[${R() - 2};1H\x1b[2K${RULE()}\x1b[${R()};1H\x1b[2K${RULE()}\x1b[${R() - 1};1H\x1b[2K❯ ${fit || dim(`Message ${model ? describe(model) : 'a model'}`)}\x1b[${R() - 1};${3 + fit.length}H`)
}
const draw = () => { out(`\x1b[2J\x1b[1;${R() - 4}r`); box() }
process.stdout.on('resize', draw)

// ---------- Tools ----------
const TOOLS = [
  { name: 'read_file', description: 'Read a text file in the project. Returns its lines, numbered.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'The file, relative to the project folder' }, offset: { type: 'integer', description: 'First line to read, from 1' }, limit: { type: 'integer', description: 'How many lines, 400 if not given' } }, required: ['path'] } },
  { name: 'list_files', description: 'List a folder in the project: its files, and its folders ending in /.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'The folder, relative to the project folder; the project folder if not given' } } } },
  { name: 'search', description: 'Search the files in the project for text or a regular expression. Returns "path:line: text" for each match.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Text or a JavaScript regular expression' }, path: { type: 'string', description: 'A folder or file to search in; the whole project if not given' } }, required: ['pattern'] } },
  { name: 'write_file', description: 'Create a file, or replace a whole file, with this content. The user is asked first.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Replace a piece of text in a file. old_text must appear in the file exactly once, character for character; include enough around it to make it unique. The user is asked first.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'] } },
  { name: 'run_command', description: 'Run a shell command in the project folder and get its output and exit code. Two minutes at most; nothing interactive. The user is asked first.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
]
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', '.venv', '__pycache__', 'target', 'coverage'])
const rel = (f) => path.relative(WORK, f) || '.'
function where(p) {
  const f = path.resolve(WORK, String(p || '.'))
  if (f !== WORK && !f.startsWith(WORK + path.sep)) throw new Error(`${p} is outside the project folder (${WORK})`)
  return f
}
const isText = (b) => !b.subarray(0, 8000).includes(0)
const clip = (s, n = 30000) => (s.length > n ? `${s.slice(0, n / 2)}\n… (${s.length - n} characters cut) …\n${s.slice(-n / 2)}` : s)

function readFile({ path: p, offset, limit }) {
  const f = where(p)
  const st = fs.statSync(f)
  if (st.isDirectory()) throw new Error(`${p} is a folder; use list_files`)
  const b = fs.readFileSync(f)
  if (!isText(b)) return `${rel(f)} is a binary file (${st.size} bytes).`
  const lines = b.toString('utf8').split('\n')
  const from = Math.max(1, Number(offset) || 1)
  const n = Math.min(2000, Math.max(1, Number(limit) || 400))
  const part = lines.slice(from - 1, from - 1 + n).map((l, i) => `${from + i}\t${l.length > 2000 ? `${l.slice(0, 2000)}…` : l}`).join('\n')
  const more = from - 1 + n < lines.length ? `\n(${lines.length} lines in all; read on with offset ${from + n})` : ''
  return clip(part + more, 60000) || '(empty file)'
}
function listFiles({ path: p }) {
  const items = fs.readdirSync(where(p), { withFileTypes: true }).filter((d) => d.name !== '.git').sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
  return items.slice(0, 500).map((d) => (d.isDirectory() ? `${d.name}/` : d.name)).join('\n') + (items.length > 500 ? `\n(and ${items.length - 500} more)` : '') || '(empty folder)'
}
function search({ pattern, path: p }) {
  let re
  try { re = new RegExp(pattern) } catch { re = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }
  const hits = []
  let files = 0
  const walk = (f) => {
    if (hits.length >= 200 || files >= 5000) return
    let st
    try { st = fs.statSync(f) } catch { return }
    if (st.isDirectory()) {
      for (const d of fs.readdirSync(f)) if (!SKIP.has(d)) walk(path.join(f, d))
      return
    }
    files++
    if (st.size > 1024 * 1024) return
    const b = fs.readFileSync(f)
    if (!isText(b)) return
    b.toString('utf8').split('\n').forEach((l, i) => { if (hits.length < 200 && re.test(l)) hits.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 200)}`) })
  }
  walk(where(p))
  return hits.length ? hits.join('\n') + (hits.length >= 200 ? '\n(stopped at 200 matches)' : '') : 'No matches.'
}
function runCommand(command, signal) {
  return new Promise((resolve) => {
    const [bin, argv] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', command]] : [process.env.SHELL || '/bin/sh', ['-c', command]]
    const child = spawn(bin, argv, { cwd: WORK, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    const add = (d) => { text += d; if (text.length > 200000) text = text.slice(-100000) }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const stop = () => { try { child.kill('SIGTERM') } catch { /* gone */ } }
    const timer = setTimeout(stop, 120000)
    signal?.addEventListener('abort', stop, { once: true })
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, text: e.message }) })
    child.on('close', (code, sig) => { clearTimeout(timer); resolve({ code: code ?? 1, text: clip(text) + (sig ? `\n(stopped: ${sig})` : '') }) })
  })
}
// Codex's patch format, for Chat's "Changed files" (edits.js reads it).
const lines = (t, mark) => String(t).split('\n').slice(0, 600).map((l) => `${mark}${l}`).join('\n')
const patchOf = (file, before, after) => (before == null
  ? `*** Begin Patch\n*** Add File: ${rel(file)}\n${lines(after, '+')}\n*** End Patch`
  : `*** Begin Patch\n*** Update File: ${rel(file)}\n@@\n${lines(before, '-')}\n${lines(after, '+')}\n*** End Patch`)

// ---------- Asking first ----------
// "Don't ask again in this chat", or how much it was started allowed to do (the access chip):
// edits, file changes without asking; full, commands too.
const ACCESS = process.env.BRIDGE_CHAT_ACCESS
const allowed = { edit: ACCESS === 'edits' || ACCESS === 'full', run: ACCESS === 'full' }
function ask(question, detail, kind) {
  if (allowed[kind]) return Promise.resolve('yes')
  return new Promise((resolve) => {
    status('')
    out(`\x1b[${R() - 2};1H\x1b[J`) // the box makes way for the menu
    const menu = [dim(RULE()), `\x1b[1mDo you want to ${question}?\x1b[0m`, ...String(detail || '').split('\n').slice(0, 10).map((l) => `  ${dim(l.slice(0, C() - 4))}`),
      '❯ 1. Yes', `  2. Yes, and don't ask again for ${kind === 'edit' ? 'file changes' : 'commands'} in this chat`, '  3. No, and tell it what to do instead (esc)']
    for (const l of menu) say(l)
    state('blocked')
    // Answered: the menu scrolls back off the screen (it would read as still asking), and one line says what you chose.
    asking = { resolve: (a) => {
      asking = null
      state('working')
      if (a === 'always') allowed[kind] = true
      out(`\x1b7\x1b[${menu.length}T\x1b8`)
      say(dim(a === 'no' ? '  You said no.' : a === 'always' ? '  Yes, and from now on in this chat.' : '  Yes.'))
      box()
      resolve(a)
    } }
  })
}

// One tool call: what it shows, what it logs, and what the model gets back. The log names the call
// by an id Chat can ask for its diff by (some providers' ids are a digit or two).
const EDITS = new Set(['write_file', 'edit_file'])
const logId = (id) => (/^[\w-]{4,100}$/.test(String(id)) ? String(id) : `call-${crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 12)}`)
async function runTool(c0, signal) {
  const c = { ...c0, id: logId(c0.id) }
  const a = c.args || {}
  try {
    if (c.name === 'read_file' || c.name === 'list_files' || c.name === 'search') {
      const hint = c.name === 'read_file' ? `read ${a.path}` : c.name === 'list_files' ? `ls ${a.path || '.'}` : `search "${a.pattern}"${a.path ? ` in ${a.path}` : ''}`
      say(`\x1b[1m●\x1b[0m ${hint}`)
      write('response_item', { type: 'function_call', name: c.name, call_id: c.id, arguments: JSON.stringify({ ...a, command: hint }) })
      const text = c.name === 'read_file' ? readFile(a) : c.name === 'list_files' ? listFiles(a) : search(a)
      write('response_item', { type: 'function_call_output', call_id: c.id, output: text.slice(0, 2000) })
      const n = text.split('\n').length
      say(dim(`  ${n} line${n === 1 ? '' : 's'}`))
      return { text }
    }
    if (EDITS.has(c.name)) {
      const f = where(a.path)
      const before = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
      let after
      if (c.name === 'write_file') after = String(a.content ?? '')
      else {
        if (before == null) throw new Error(`${a.path} doesn't exist; use write_file to create it`)
        const n = a.old_text ? before.split(String(a.old_text)).length - 1 : 0
        if (n !== 1) throw new Error(n ? `old_text appears ${n} times in ${a.path}; include more around it so it appears once` : `old_text isn't in ${a.path}; read the file and copy the text exactly`)
        after = before.replace(String(a.old_text), () => String(a.new_text ?? ''))
      }
      const patch = c.name === 'edit_file' ? patchOf(f, a.old_text, a.new_text) : patchOf(f, before, after)
      say(`\x1b[1m●\x1b[0m ${before == null ? 'Create' : 'Change'} ${rel(f)}`)
      write('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: c.id, input: patch })
      const answer = await ask(`${before == null ? 'create' : 'change'} ${rel(f)}`, patch.split('\n').slice(2, -1).join('\n'), 'edit')
      if (answer === 'no') {
        write('response_item', { type: 'custom_tool_call_output', call_id: c.id, output: 'Rejected by the user' })
        return { text: 'The user said no to this change.', error: true, declined: true }
      }
      ensureDir(path.dirname(f))
      fs.writeFileSync(f, after)
      write('response_item', { type: 'custom_tool_call_output', call_id: c.id, output: 'Done' })
      return { text: `${before == null ? 'Created' : 'Changed'} ${rel(f)}.` }
    }
    if (c.name === 'run_command') {
      const cmd = String(a.command || '').trim()
      if (!cmd) throw new Error('No command given')
      say(`\x1b[1m●\x1b[0m Run ${cmd.split('\n')[0].slice(0, 120)}`)
      write('response_item', { type: 'function_call', name: 'shell', call_id: c.id, arguments: JSON.stringify({ command: cmd }) })
      const answer = await ask('run this command', cmd, 'run')
      if (answer === 'no') {
        write('response_item', { type: 'function_call_output', call_id: c.id, output: 'Rejected by the user' })
        return { text: 'The user said no to running this.', error: true, declined: true }
      }
      status('✻ Running… (esc to interrupt)')
      const r = await runCommand(cmd, signal)
      status('')
      write('response_item', { type: 'function_call_output', call_id: c.id, output: JSON.stringify({ output: r.text.slice(0, 4000), metadata: { exit_code: r.code } }) })
      const tail = r.text.trim().split('\n').slice(-4).join('\n')
      if (tail) say(dim(tail.split('\n').map((l) => `  ${l.slice(0, C() - 4)}`).join('\n')))
      say(dim(`  exit ${r.code}`))
      return { text: `Exit code ${r.code}\n${r.text || '(no output)'}`, error: r.code !== 0 }
    }
    throw new Error(`There's no tool called ${c.name}`)
  } catch (e) {
    say(`\x1b[31m  ${e.message}\x1b[0m`)
    if (EDITS.has(c.name)) write('response_item', { type: 'custom_tool_call_output', call_id: c.id, output: `Failed to apply: ${e.message}` })
    return { text: `Error: ${e.message}`, error: true }
  }
}

// ---------- Talking to the model ----------
const NONE = 'No model to talk to yet. Add an API key in Settings › Model providers, start Ollama or LM Studio, or sign in to an agent like Claude Code or Codex. Then send your message again.'
const MAX_STEPS = 40
let noTools = false // the model turned tools down once: it only talks from then on
const tools = () => (PROJECT && !noTools && canUseTools(model) ? TOOLS : null)
const system = () => (tools()
  ? `${SYSTEM}\n\nYou are working in the project folder ${WORK} on ${process.platform}. Use your tools to look at files before you change them, keep changes small and to the point, and run the project's own checks when it has them. Paths are relative to the project folder. The user is asked before each change and command; when they say no, stop and ask what they want instead. Today is ${new Date().toDateString()}.`
  : SYSTEM)
async function pick() {
  if (model) return model
  const list = await models({ fresh: true }).catch(() => [])
  const best = (PROJECT && list.find((m) => canUseTools(m.id))) || list[0]
  if (best) { model = best.id; write('turn_context', { model }) }
  return model
}
async function next(signal) {
  settle()
  try {
    return await reply(model, messages, { signal, tools: tools(), system: system() })
  } catch (e) {
    // A model that can't take tools (some local and hosted ones): carry on just talking.
    if (tools() && e.status === 400 && /tool|function/i.test(e.message)) {
      noTools = true
      say(dim(`${describe(model)} can't use tools here, so it can only talk, not work on files. /models lists others.`))
      return reply(model, messages, { signal, tools: null, system: system() })
    }
    throw e
  }
}
async function pump() {
  if (busy || !queue.length) return
  busy = true
  const text = queue.shift()
  say(`\x1b[1m> ${text.split('\n').join('\n  ')}\x1b[0m`)
  if (!(await pick())) { say(NONE); say(); busy = false; box(); return pump() }
  said('user', text)
  remember({ role: 'user', text })
  state('working')
  const started = Date.now()
  ctrl = new AbortController()
  try {
    for (let steps = 1; ; steps++) {
      status(`✻ Thinking… (esc to interrupt) · ${describe(model)}`)
      const r = await next(ctrl.signal)
      status('') // done before the answer shows in Chat, so it never looks still busy
      if (r.text) { said('assistant', r.text, { model }); say(r.text) }
      remember({ role: 'assistant', text: r.text || '', ...(r.calls.length && { calls: r.calls }) })
      if (!r.calls.length) break
      let stop = false
      for (const c of r.calls) {
        const res = stop || ctrl.signal.aborted ? { text: 'Not run: the user stopped it.', error: true } : await runTool(c, ctrl.signal)
        remember({ role: 'tool', id: c.id, name: c.name, text: res.text, ...(res.error && { error: true }) })
        if (res.declined) stop = true
      }
      if (stop) { say(dim('Stopped. Tell it what to do instead.')); break }
      if (ctrl.signal.aborted) throw new Error('stopped')
      if (steps >= MAX_STEPS) { say(dim(`That took ${MAX_STEPS} steps, so it stopped here. Send a message to carry on.`)); break }
    }
    say(dim(`${describe(model)} · ${Math.round((Date.now() - started) / 1000)}s`))
  } catch (e) {
    if (ctrl.signal.aborted) say(dim('Stopped.'))
    else {
      const msg = `Couldn't get an answer from ${describe(model)}. ${e.message}`
      said('assistant', msg, { bridge_error: true })
      say(`\x1b[31m${msg}\x1b[0m`)
    }
  } finally {
    ctrl = null
    busy = false
    state('idle')
    status('')
    say()
    box()
  }
  pump()
}

async function command(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (cmd === '/models' || (cmd === '/model' && !arg)) {
    const list = await models({ fresh: true }).catch(() => [])
    say(model ? `Talking to ${describe(model, list)}.` : 'No model picked yet.')
    if (!list.length) say(NONE)
    list.forEach((m, i) => say(`  ${i + 1}. ${m.id}  ${dim(`${m.label}, ${m.provider}${PROJECT && !canUseTools(m.id) ? ', talk only' : ''}`)}`))
    say('Switch with /model <number or name>. Any model a provider has works by name, e.g. /model openai:gpt-5-mini')
  } else if (cmd === '/model') {
    const list = await models().catch(() => [])
    const pickd = /^\d+$/.test(arg) ? list[Number(arg) - 1]?.id : arg.includes(':') ? arg : list.find((m) => m.label.toLowerCase() === arg.toLowerCase() || m.id.endsWith(`:${arg}`))?.id
    if (!pickd) say(`No model "${arg}". Type /models to see what you can use.`)
    else { model = pickd; noTools = false; write('turn_context', { model }); say(`Set model to ${model}: ${describe(model, list)}.`) } // the words models.js looks for
  } else say('Commands: /models lists what you can talk to; /model <number or name> switches. Everything else goes to the model.')
  say()
  box()
}

function submit(text) {
  const t = text.trim()
  if (!t) return box()
  if (/^\/models?\b|^\/help$/.test(t)) return command(t)
  queue.push(t)
  pump()
}

// ---------- Keys ----------
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
out('\x1b[?2004h') // pasted text comes marked, so its line breaks don't send it
let pasting = false
process.stdin.on('data', (d) => {
  for (let i = 0; i < d.length; i++) {
    const ch = d[i]
    // A change or command waiting: 1 or y yes, 2 or a always, 3, n or Esc no; Enter is the one marked.
    if (asking) {
      const seq = ch === '\x1b' ? /^\x1b(\[[0-9;?]*[ -/]*[@-~]|O.)?/.exec(d.slice(i))[0] : ch
      i += seq.length - 1
      const a = seq === '1' || seq === 'y' || seq === '\r' ? 'yes' : seq === '2' || seq === 'a' ? 'always' : seq === '3' || seq === 'n' || seq === '\x1b' || seq === '\x03' ? 'no' : null
      if (a) asking.resolve(a)
      continue
    }
    if (ch === '\x1b') {
      const rest = d.slice(i)
      if (rest.startsWith('\x1b[200~')) { pasting = true; i += 5; continue }
      if (rest.startsWith('\x1b[201~')) { pasting = false; i += 5; continue }
      const seq = /^\x1b(\[[0-9;?]*[ -/]*[@-~]|O.|.)?/.exec(rest)[0]
      if (seq === '\x1b' && ctrl) ctrl.abort() // Esc on its own: stop waiting for the answer
      i += seq.length - 1
      continue
    }
    if (ch === '\x03') { if (ctrl) ctrl.abort(); else if (buf) buf = ''; else { out('\x1b[r\x1b[?2004l\n'); process.exit(0) } continue }
    if (ch === '\r' && !pasting) { const t = buf; buf = ''; submit(t); continue }
    if (ch === '\x7f' || ch === '\b') { buf = buf.slice(0, -1); continue }
    if (ch === '\n' || ch === '\r') { buf += '\n'; continue }
    if (ch === '\x15') { buf = ''; continue } // Ctrl+U
    if (ch >= ' ') buf += ch
  }
  box()
})
for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0))

draw()
;(async () => {
  if (process.env.BRIDGE_CHAT_MODEL && process.env.BRIDGE_CHAT_MODEL !== model && !resuming) { model = process.env.BRIDGE_CHAT_MODEL; write('turn_context', { model }) }
  await pick()
  const list = await models().catch(() => [])
  say(`\x1b[1mBridge AI chat\x1b[0m · ${model ? describe(model, list) : 'no model yet'}`)
  if (PROJECT) say(dim(model && !canUseTools(model) ? `In ${WORK}. Through a sign-in it can only talk; pick a model with an API key (/models) to work on files.` : `Working in ${WORK}. It asks before it changes a file or runs a command.`))
  say(dim('Type a message. /models lists what you can talk to; /model switches.'))
  if (!model) say(NONE)
  if (resuming) for (const m of messages.filter((x) => x.role !== 'tool' && x.text).slice(-6)) say(`${m.role === 'user' ? '> ' : ''}${m.text.length > 400 ? `${m.text.slice(0, 400)}…` : m.text}`)
  say()
  box()
  if (opening) submit(opening)
})()
