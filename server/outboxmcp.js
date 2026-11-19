// A bot's run's outbox as an MCP server (botfiles.js): one tool, save_file, that puts a file in that
// run's outbox and nowhere else, so Claude Code answering a question is given a way to send a file
// back without being given a tool that writes files. Started by Claude Code for that run alone, from
// the run's MCP config (botmcp.js runFolder): node outboxmcp.js <outbox>.
//
// The Model Context Protocol over stdin and stdout, a JSON-RPC message a line: initialize,
// tools/list and tools/call. A file's name is its name only (a path in it is cut to its last part,
// and characters a name can't have, or that hide what it is, are taken out), it's written only into
// the outbox as it is (its real path, checked), and none bigger than MAX. What it writes is looked
// at again once the answer is in (botfiles.js collect), where what may not go is refused.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const MAX = 25 * 1024 * 1024
const PROTOCOL = '2025-06-18'
const box = process.argv[2] ? path.resolve(process.argv[2]) : null
const TOOL = {
  name: 'save_file',
  title: 'Save a file to send back',
  description: 'Save a file to send back with your answer (a chart, a spreadsheet, a PDF, a picture). It goes in your outbox, the only place you can put a file.',
  inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Its name, with its kind: chart.svg, totals.csv' }, content: { type: 'string', description: 'What it holds' }, base64: { type: 'boolean', description: 'true when content is base64 (a picture, a PDF)' } }, required: ['name', 'content'] },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}
const nameOf = (n) => path.basename(String(n || '').replace(/\\/g, '/')).replace(/\p{Cf}/gu, '').replace(/[:*?"<>|\x00-\x1f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 120) // eslint-disable-line no-control-regex

function save(a) {
  if (!box) throw new Error('This run has no outbox')
  const name = nameOf(a?.name)
  if (!name) throw new Error('Give the file a name')
  const body = a?.base64 === true ? Buffer.from(String(a.content || ''), 'base64') : Buffer.from(String(a?.content ?? ''), 'utf8')
  if (body.length > MAX) throw new Error('That file is too big to send back')
  const real = fs.realpathSync(box)
  const to = path.join(real, name)
  if (path.dirname(to) !== real) throw new Error('Only a name: the file goes in your outbox')
  // (Never through a link someone put there: the file is made new, or replaced as itself.)
  try { if (fs.lstatSync(to).isSymbolicLink()) fs.rmSync(to) } catch { /* not there */ }
  fs.writeFileSync(to, body, { mode: 0o600 })
  return `Saved ${name} (${body.length} bytes): it goes with your answer.`
}

const send = (o) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`)
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.id === undefined) return // a notification: nothing to answer
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'bridge-ai-outbox', version: '1' } } })
  if (m.method === 'tools/list') return send({ id: m.id, result: { tools: [TOOL] } })
  if (m.method === 'tools/call') {
    if (m.params?.name !== 'save_file') return send({ id: m.id, error: { code: -32602, message: `No tool called ${m.params?.name}` } })
    try { return send({ id: m.id, result: { content: [{ type: 'text', text: save(m.params.arguments || {}) }] } }) } catch (e) { return send({ id: m.id, result: { content: [{ type: 'text', text: e.message }], isError: true } }) }
  }
  if (m.method === 'ping') return send({ id: m.id, result: {} })
  send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } })
})
rl.on('close', () => process.exit(0))
