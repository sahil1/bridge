// A bot's session's own MCP server (botsessions.js, frontdesk.js): how its agent asks Bridge AI for
// what it can't do itself, each ask a line in the session's requests (requests.jsonl, in its own
// folder of the desk's, which the agent can neither read nor write), with an HMAC under a key of the
// session's own (requests.key beside it: never on a command line or in its settings), so Bridge AI
// takes only what this server wrote. Nothing is done here: once the turn ends, Bridge AI reads them
// (frontdesk.js requestsOf), then the file starts again.
//   request_push  for a session with a copy of a repository (--push): push its branch and open a
//                 draft pull request. It waits for you, always (Needs You, your direct messages, a
//                 button where it was asked), and is made for the change as you were shown it.
//   hand_to       for a connection's Chief (--chief <roster.json>): one of the bots on its connection
//                 takes the thread from here, with a note; later replies there go to it.
//   ask_bot       for a Chief too: one of those bots answers a question, as whoever asked (with their
//                 rights, under that bot's own rules), and its answer comes back here as your next
//                 message.
//   share_link    (--share): a Share Link to a file or folder in its folders, or a file it made, for
//                 the people in the conversation to open: made by Bridge AI once the turn ends, at once
//                 for the owner, after the owner's OK for anyone else (frontdesk.js).
// node sessionmcp.js <requests.jsonl> <requests.key> [--push] [--share] [--chief <roster.json>]
//
// The Model Context Protocol over stdin and stdout, a JSON-RPC message a line, as outboxmcp.js.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline'

const PROTOCOL = '2025-06-18'
const argv = process.argv.slice(2)
const file = argv[0] ? path.resolve(argv[0]) : null
const keyFile = argv[1] ? path.resolve(argv[1]) : null
const push = argv.includes('--push')
const share = argv.includes('--share')
const rosterAt = argv.indexOf('--chief')
const roster = (() => {
  if (rosterAt < 0 || !argv[rosterAt + 1]) return []
  try { const j = JSON.parse(fs.readFileSync(argv[rosterAt + 1], 'utf8')); return Array.isArray(j) ? j.filter((b) => b?.id && b?.name) : [] } catch { return [] }
})()
const clip = (s, n) => String(s ?? '').replace(/\r\n/g, '\n').slice(0, n)
const one = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const macOf = (key, o) => crypto.createHmac('sha256', String(key)).update(JSON.stringify(o)).digest('hex')

const PUSH = {
  name: 'request_push',
  title: 'Ask to push and open a pull request',
  description: 'Ask the owner to push your branch and open a draft pull request with what you changed in your copy of the repository. You can\'t push yourself: they decide, once this turn ends. Give a short title and a summary of the change.',
  inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'The pull request\'s title' }, summary: { type: 'string', description: 'What changed and why, in a few sentences' } }, required: ['title'] },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}
const names = roster.map((b) => b.name).join(', ')
const HAND = {
  name: 'hand_to',
  title: 'Hand the conversation to another bot',
  description: `Hand this conversation to one of the bots here (${names}): it takes the thread from here, under its own rules, and later replies go to it. Say it in your reply too. Each one, with what it's for: ${roster.map((b) => `${b.name}${b.description ? `: ${b.description}` : ''}${b.access ? ` (${b.access})` : ''}`).join('; ')}.`,
  inputSchema: { type: 'object', properties: { bot: { type: 'string', description: 'Its name, as above' }, note: { type: 'string', description: 'What it should know, in a sentence or two' } }, required: ['bot'] },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}
const ASK = {
  name: 'ask_bot',
  title: 'Ask another bot',
  description: `Ask one of the bots here (${names}) a question, for the person you're answering: it answers as if they asked it, under its own rules, and its answer comes to you as your next message, once this turn ends. End this turn saying you're asking it.`,
  inputSchema: { type: 'object', properties: { bot: { type: 'string', description: 'Its name, as above' }, question: { type: 'string', description: 'What to ask it' } }, required: ['bot', 'question'] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}
const SHARE = {
  name: 'share_link',
  title: 'Share a file or folder with a link',
  description: 'Make a Share Link to a file or a folder in your folders, or a file you made (a report, an HTML page), so the people in this conversation can open it in their browser: an end-to-end encrypted link through the owner\'s relay, for those people only (or with a password), for a day unless you say otherwise. It\'s made once this turn ends: at once when the owner asked, after their OK for anyone else. Give its path; say in your reply that a link is on its way.',
  inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The file or folder, as a path in your folders (or one you made in your outbox)' }, lasts: { type: 'string', enum: ['hour', 'day', 'week'], description: 'How long the link lasts: hour, day (the default) or week' }, who: { description: 'Who may open it: "conversation" (the default: the people in this conversation), "channel" (everyone in this channel), or a list of email addresses', anyOf: [{ type: 'string', enum: ['conversation', 'channel'] }, { type: 'array', items: { type: 'string' }, maxItems: 30 }] }, title: { type: 'string', description: 'What it is, in a few words' } }, required: ['path'] },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}
const TOOLS = [...(push ? [PUSH] : []), ...(share ? [SHARE] : []), ...(roster.length ? [HAND, ASK] : [])]

// (At most 20 asks a turn: counted in the file, which Bridge AI takes and empties as each turn ends
// (botsessions.js takeRequests), so the count is this turn's, however long this server runs.)
const ASKS_MAX = 20
let asked = 0
function note(o) {
  if (!file || !keyFile) throw new Error('This session has nowhere to ask from')
  let key = ''
  try { key = fs.readFileSync(keyFile, 'utf8').trim() } catch { /* none */ }
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('This session has no key to ask with')
  let pending = 0
  try { pending = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length } catch { pending = 0 }
  if (pending >= ASKS_MAX) throw new Error('That\'s as many as one turn may ask')
  asked++
  const line = { ...o, at: new Date().toISOString(), n: asked }
  fs.appendFileSync(file, `${JSON.stringify({ ...line, mac: macOf(key, line) })}\n`, { mode: 0o600 })
}
const botNamed = (name) => {
  const want = one(name, 80).toLowerCase().replace(/^@/, '')
  return roster.find((b) => b.name.toLowerCase() === want || b.id === want) || null
}
async function call(name, a) {
  if (name === 'request_push' && push) {
    const title = one(a?.title, 200)
    if (!title) throw new Error('Give it a title')
    note({ t: 'push', title, summary: clip(a?.summary, 4000) })
    return 'Asked: the owner decides once this turn ends. Say in your reply that it waits for them.'
  }
  if (name === 'share_link' && share) {
    const p = clip(a?.path, 1000).trim()
    if (!p) throw new Error('Give the path of the file or folder to share')
    const lasts = ['hour', 'day', 'week'].includes(a?.lasts) ? a.lasts : 'day'
    const who = Array.isArray(a?.who) ? a.who.slice(0, 30).map((x) => one(x, 200)).filter(Boolean) : a?.who === 'channel' ? 'channel' : 'conversation'
    note({ t: 'share', path: p, lasts, who, title: one(a?.title, 120) })
    return 'Asked: the link is made once this turn ends (at once for the owner, after their OK for anyone else), and posted in this conversation. Say in your reply that a link is on its way.'
  }
  if ((name === 'hand_to' || name === 'ask_bot') && roster.length) {
    const b = botNamed(a?.bot)
    if (!b) throw new Error(`There's no bot here called ${one(a?.bot, 60)}: ${names}`)
    if (name === 'hand_to') { note({ t: 'hand', bot: b.id, note: clip(a?.note, 2000) }); return `${b.name} takes this conversation once this turn ends.` }
    const question = clip(a?.question, 4000).trim()
    if (!question) throw new Error('Say what to ask it')
    note({ t: 'ask', bot: b.id, question })
    return `Asked ${b.name}: its answer comes to you as your next message, once this turn ends.`
  }
  throw Object.assign(new Error(`No tool called ${name}`), { code: -32602 })
}

const send = (o) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`)
async function handle(line) {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.id === undefined) return
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'bridge-ai-session', version: '1' } } })
  if (m.method === 'tools/list') return send({ id: m.id, result: { tools: TOOLS } })
  if (m.method === 'tools/call') {
    try { return send({ id: m.id, result: { content: [{ type: 'text', text: await call(m.params?.name, m.params?.arguments || {}) }] } }) } catch (e) {
      if (e.code === -32602) return send({ id: m.id, error: { code: -32602, message: e.message } })
      return send({ id: m.id, result: { content: [{ type: 'text', text: e.message }], isError: true } })
    }
  }
  if (m.method === 'ping') return send({ id: m.id, result: {} })
  send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } })
}
if (file) {
  let chain = Promise.resolve()
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => { chain = chain.then(() => handle(line)).catch(() => {}) })
  rl.on('close', () => { chain.finally(() => process.stdout.write('', () => process.exit(0))) })
}
