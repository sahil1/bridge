// A stand-in MCP server over stdio (bots-setup), as a tracker of issues: the Model Context Protocol's
// initialize, tools/list and tools/call, a JSON-RPC message a line. Its tools: list_issues and search,
// which say they only read (annotations.readOnlyHint), and create_issue, which doesn't. Each start goes
// in MCP_LOG (when set), with whether the token in its environment (TRACKER_TOKEN) came: { started,
// token }, and each request: { method, tool }.
//   node mcp-server.mjs
import fs from 'node:fs'

const LOG = process.env.MCP_LOG || null
const log = (o) => { if (LOG) fs.appendFileSync(LOG, `${JSON.stringify(o)}\n`) }
log({ started: true, token: !!process.env.TRACKER_TOKEN })
const TOOLS = [
  { name: 'list_issues', title: 'List issues', description: 'The open issues', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'search', title: 'Search', description: 'Issues with these words', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'create_issue', title: 'Create an issue', description: 'A new issue', inputSchema: { type: 'object', properties: { title: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: false } },
]
const send = (o) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`)
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let m
    try { m = JSON.parse(line) } catch { continue }
    log({ method: m.method, ...(m.params?.name ? { tool: m.params.name } : {}) })
    if (m.id == null) continue
    if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'tracker', version: '1.0.0' } } })
    else if (m.method === 'tools/list') send({ id: m.id, result: { tools: TOOLS } })
    else if (m.method === 'tools/call') send({ id: m.id, result: { content: [{ type: 'text', text: m.params?.name === 'create_issue' ? 'Made issue 42.' : 'Issue 7: the pricing page is wrong.' }] } })
    else send({ id: m.id, error: { code: -32601, message: `No such method: ${m.method}` } })
  }
})
process.stdin.on('end', () => process.exit(0))
