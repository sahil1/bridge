// A bot's run's outbox as an MCP server (botfiles.js), so Claude Code answering a question is given
// a way to send a file back without being given a tool that writes files. Started by Claude Code for
// that run alone, from the run's MCP config (botmcp.js runFolder): node outboxmcp.js <outbox>
// [<attach.json>]. Its tools (botattach.js, which botanswer.js gives a model too):
//   save_file    a file it makes, put in the run's outbox and nowhere else. Its name is its name only
//                (a path in it is cut to its last part, and characters a name can't have, or that hide
//                what it is, are taken out), written only into the outbox as it is (its real path,
//                checked), none bigger than EACH, MAX at most, TOTAL all told.
//   attach_file  a file in the bot's folders, sent as it is (a PDF, a Word document, a picture), only
//                with attach.json: the folders it may be in, as Bridge AI has them (a file of the run's
//                MCP folder, readable by you only, which its agent can't read). It's checked here as
//                botattach.js says, so the agent hears at once why one can't go, and noted beside the
//                outbox (never in it); nothing is copied here. Data and config files only when you
//                let the bot send them (config in attach.json).
// What's in the outbox is looked at again once the answer is in, and each file attached checked
// again and copied in then (botfiles.js collect): that's the gate, this a convenience.
//
// The Model Context Protocol over stdin and stdout, a JSON-RPC message a line: initialize,
// tools/list and tools/call, answered one at a time, in order.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { save, attach, MAX, EACH, sizeOf } from './botattach.js'

const PROTOCOL = '2025-06-18'
const box = process.argv[2] ? path.resolve(process.argv[2]) : null
// (The folders it may attach from: none, no attach_file.)
const ctx = (() => {
  try {
    const j = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
    const folders = (Array.isArray(j.folders) ? j.folders : []).map((f) => (f && typeof f === 'object' ? { path: String(f.path || ''), real: f.real ? String(f.real) : null } : { path: String(f || '') })).filter((f) => f.path)
    return folders.length ? { folders, cwd: j.cwd ? String(j.cwd) : null, config: j.config === true, ...(Array.isArray(j.keptOut) ? { keptOut: j.keptOut.map(String) } : {}) } : null
  } catch { return null }
})()
const SAVE = {
  name: 'save_file',
  title: 'Save a file to send back',
  description: 'Save a file you make to send back with your answer (a chart, a spreadsheet, a PDF, a picture). It goes in your outbox, the only place you can put a file.',
  inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Its name, with its kind: chart.svg, totals.csv' }, content: { type: 'string', description: 'What it holds' }, base64: { type: 'boolean', description: 'true when content is base64 (a picture, a PDF)' } }, required: ['name', 'content'] },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}
const ATTACH = {
  name: 'attach_file',
  title: 'Attach a file from your folders',
  description: `Send back a file that's in your folders as it is, with your answer: a PDF, a Word document, a spreadsheet, a presentation, a picture${ctx?.config ? ', or a data or config file' : ''}. Give its path. ${MAX} files at most with an answer, none over ${sizeOf(EACH)}; never a hidden file or one that holds keys, passwords, tokens or credentials.`,
  inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The file\'s path, in one of your folders' } }, required: ['path'] },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}
const TOOLS = [SAVE, ...(ctx ? [ATTACH] : [])]

async function call(name, a) {
  if (name === 'save_file') return save(box, a)
  if (name === 'attach_file' && ctx) return attach(box, a?.path, ctx)
  throw Object.assign(new Error(`No tool called ${name}`), { code: -32602 })
}

const send = (o) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`)
async function handle(line) {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.id === undefined) return // a notification: nothing to answer
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'bridge-ai-outbox', version: '1' } } })
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
// One at a time, in order (a file noted is counted before the next is looked at), and every one
// answered before it ends.
let chain = Promise.resolve()
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => { chain = chain.then(() => handle(line)).catch(() => {}) })
rl.on('close', () => { chain.finally(() => process.stdout.write('', () => process.exit(0))) })
