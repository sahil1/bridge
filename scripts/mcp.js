// `bridge-ai mcp`: Bridge AI as an MCP server for the app that starts this (Claude Code, Claude
// Desktop, Cursor, Codex), over stdin and stdout, one JSON-RPC message a line. The protocol is
// answered here (server/mcpproto.js); each tool call and resource read is asked of the running
// Bridge AI with its key (localapi.js), which decides what's shared, does it and writes it down
// (server/mcptools.js). So the tools are listed even while Bridge AI isn't running, and each says
// then how to start it. Nothing but MCP messages goes to stdout; anything else to stderr.
import readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeMcp, connection } from '../server/mcpproto.js'
import { api } from './localapi.js'
import { TOKEN_FILE } from '../server/apitoken.js'

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version } catch { return '0' } })()
const NOT_RUNNING = 'Bridge AI isn\'t running on this computer. Open the Bridge AI app (or run bridge-ai start), then try again.'
const said = (e) => (e.down ? NOT_RUNNING
  : e.code === 'apiKey' ? `Bridge AI didn't take its key from ${TOKEN_FILE}: open Bridge AI once so it makes it, then try again.`
    : e.status === 404 ? 'This Bridge AI is older than this command: update it (Settings › About & Updates), then try again.'
      : `Bridge AI couldn't do that: ${e.message}`)

export async function serve({ input = process.stdin, output = process.stdout } = {}) {
  const write = (m) => output.write(`${JSON.stringify(m)}\n`)
  let last = { at: 0, v: null }
  const state = async () => {
    if (last.v && Date.now() - last.at < 3000) return last.v
    const v = await api('/mcp-server/state').then((s) => ({ on: !!s.on, send: !!s.send }), () => ({ on: false, send: false }))
    last = { at: Date.now(), v }
    return v
  }
  const backend = {
    state,
    call: (name, args, client) => api('/mcp-server/call', { method: 'POST', body: { name, args, client } }).then((r) => r.result, (e) => ({ content: [{ type: 'text', text: said(e) }], isError: true })),
    resources: (client) => api(`/mcp-server/resources?client=${encodeURIComponent(client?.name || '')}`).then((r) => r.resources || [], () => []),
    read: (uri, client) => api('/mcp-server/read', { method: 'POST', body: { uri, client } }).then((r) => r.contents ? r : null, (e) => { if (e.status === 404) return null; throw new Error(said(e)) }),
  }
  const mcp = makeMcp({ version: VERSION, backend })
  const cancelled = new Set()
  const conn = connection({ via: 'stdio', notify: write })

  // Sending to agents turned on or off: the tools change, said to the app (looked at every 5 s,
  // a call to this computer that isn't written down as one of the app's).
  let was = await state()
  const watch = setInterval(async () => {
    const s = await state()
    if (s.send !== was.send) mcp.toolsChanged(conn)
    was = s
  }, 5000)
  watch.unref()

  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  const pending = new Set()
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'That wasn\'t JSON' } }); return }
    if (msg?.method === 'notifications/cancelled') cancelled.add(msg.params?.requestId)
    const p = mcp.handle(msg, conn).then((res) => {
      if (res && !(res.id !== undefined && cancelled.delete(res.id))) write(res)
    }, (e) => process.stderr.write(`bridge-ai mcp: ${e.message}\n`))
    pending.add(p)
    p.finally(() => pending.delete(p))
  })
  await new Promise((resolve) => rl.on('close', resolve))
  clearInterval(watch)
  await Promise.allSettled([...pending])
}

