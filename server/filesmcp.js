// A bot's run that changes files (botwrite.js) as an MCP server of Bridge AI's own, bridge_files: two
// tools, delete_file and move_file, each only inside that run's staging copy, so Claude Code (whose
// own tools edit and write, never delete or move) can take a file away or move one when that's what
// was asked. Nothing it does reaches a real folder: Bridge AI takes what changed in the copy, and a
// change that deletes or moves a file always waits for you, whoever asked. Started by Claude Code for
// that run alone, from the run's MCP config (botmcp.js runFolder): node filesmcp.js <copy>.
//
// The Model Context Protocol over stdin and stdout, a JSON-RPC message a line: initialize,
// tools/list and tools/call. A path is one in the copy (from its top, or absolute inside it): no ..,
// git's own folder by no name, no link anywhere on the way, a file (never a folder), inside the copy as
// it really is and in one of its folders' copies (--part); a move's new place not there yet. What it
// takes away and puts is written to the run's log as the hook's is (botguard.mjs: an HMAC with the
// run's key, from its file), for Bridge AI to take only that. node filesmcp.js <copy> [--part
// <name>]… [--log <file> --key <file>]
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import crypto from 'node:crypto'

const PROTOCOL = '2025-06-18'
const argv = process.argv.slice(2)
const root = argv[0] ? path.resolve(argv[0]) : null
const parts = []
let log = null
let keyFile = null
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--part' && argv[i + 1]) parts.push(argv[++i])
  else if (argv[i] === '--log' && argv[i + 1]) log = argv[++i]
  else if (argv[i] === '--key' && argv[i + 1]) keyFile = argv[++i]
}
// (The run's key, from its file alone: botguard.mjs. With none, nothing is taken away or moved.)
const key = (() => { try { return fs.readFileSync(keyFile, 'utf8').trim() } catch { return '' } })()
const real = (() => { try { return fs.realpathSync.native(root) } catch { return null } })()
const gitLike = (name) => { const n = String(name || '').toLowerCase().replace(/:.*$/, '').replace(/[. ]+$/, ''); return n === '.git' || /^git~\d+$/.test(n) }
const noted = (kind, p) => {
  if (!log) return
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Its checks have no key to write them down with, so nothing was done')
  fs.appendFileSync(log, `${crypto.createHmac('sha256', key).update(`${kind}\n${p}`).digest('hex')}\n`, { mode: 0o600 })
}
const PATH = { type: 'string', description: 'The file: a path in your copy, from its top (Hiring/old.md), or the whole path' }
const TOOLS = [
  {
    name: 'delete_file', title: 'Delete a file in your copy',
    description: 'Delete one file in your copy of the folders you change. Bridge AI shows its owner what changed, and a deletion always waits for them to approve it.',
    inputSchema: { type: 'object', properties: { path: PATH }, required: ['path'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'move_file', title: 'Move or rename a file in your copy',
    description: 'Move or rename one file in your copy of the folders you change. A move always waits for the owner to approve it.',
    inputSchema: { type: 'object', properties: { from: PATH, to: { type: 'string', description: 'Where it goes: a path in your copy that isn\'t there yet' } }, required: ['from', 'to'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
]

const within = (p) => p === real || p.startsWith(real + path.sep)
// (A path's case, on Windows, where it doesn't matter, for finding the copy it's given in; each file
// is then named by its real path, as the system has it, which is what's written down.)
const fold = (s) => (process.platform === 'win32' ? String(s).toLowerCase() : String(s))
// A path in the copy, checked: { full, rel, missing: the folders it needs made, in order }, or throws,
// saying why. there: a file that's there (to delete or move); else a place nothing is yet.
function placeOf(p, { there = true } = {}) {
  if (!root || !real) throw new Error('This run has no copy')
  const s = String(p ?? '').trim()
  if (!s || s.includes('\0')) throw new Error('Give a path')
  const abs = path.isAbsolute(s) ? s : path.join(real, s)
  if (abs.split(/[\\/]+/).includes('..')) throw new Error(`${s} has .. in it`)
  const norm = path.resolve(abs)
  const top = [real, root].find((r) => fold(norm).startsWith(fold(r) + path.sep))
  if (!top) throw new Error(`${s} is outside your copy`)
  const rel = path.relative(top, norm)
  const segs = rel.split(path.sep)
  if (segs.some(gitLike)) throw new Error(`${s} is git's own`)
  if (parts.length ? segs.length < 2 || !parts.includes(segs[0]) : /^(\.claude|\.mcp\.json)$/.test(segs[0].toLowerCase().replace(/:.*$/, '').replace(/[. ]+$/, '')) || /^(claude|mcp)[^~]{0,6}~\d/i.test(segs[0])) throw new Error(`${s} isn't in a copy of one of your folders`)
  const missing = []
  let at = real
  for (const [i, x] of segs.entries()) {
    at = path.join(at, x)
    const last = i === segs.length - 1
    if (missing.length) { if (!last) missing.push(at); continue }
    let st = null
    try { st = fs.lstatSync(at) } catch { /* not there */ }
    if (!st) {
      if (there) throw new Error(`${s} isn't there`)
      if (!last) missing.push(at)
      continue
    }
    if (st.isSymbolicLink()) throw new Error(`${path.relative(real, at)} is a link`)
    if (!last && !st.isDirectory()) throw new Error(`${path.relative(real, at)} isn't a folder`)
    if (last && !there) throw new Error(`${s} is there already`)
    if (last && !st.isFile()) throw new Error(`${s} isn't a file: only a file can be deleted or moved`)
  }
  const full = path.join(real, rel)
  const up = missing.length ? real : fs.realpathSync.native(path.dirname(full))
  if (!within(up)) throw new Error(`${s} is outside your copy`)
  if (path.relative(real, up).split(path.sep).some(gitLike)) throw new Error(`${s} is git's own`)
  // (Written down by its folder's real path, as the system has it, and its own name; what's done is
  // done to the path as it was checked, never to wherever a link might lead.)
  const named = missing.length ? full : path.join(up, path.basename(full))
  return { full, named, rel: rel.split(path.sep).join('/'), missing }
}

function call(name, a) {
  if (name === 'delete_file') {
    const p = placeOf(a?.path)
    noted('d', p.named)
    fs.unlinkSync(p.full)
    return `Deleted ${p.rel} in your copy. Bridge AI shows the owner, who approves it before it's deleted for real.`
  }
  if (name === 'move_file') {
    const from = placeOf(a?.from)
    const to = placeOf(a?.to, { there: false })
    // (The folders its new place needs, made one by one inside the copy.)
    for (const d of to.missing) { fs.mkdirSync(d); if (fs.lstatSync(d).isSymbolicLink() || !within(fs.realpathSync.native(d))) throw new Error(`${path.relative(real, d)} is outside your copy`) }
    noted('d', from.named)
    noted('w', to.named)
    fs.renameSync(from.full, to.full)
    return `Moved ${from.rel} to ${to.rel} in your copy. Bridge AI shows the owner, who approves it before it's moved for real.`
  }
  throw new Error(`No tool called ${name}`)
}

const send = (o) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`)
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.id === undefined) return // a notification: nothing to answer
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'bridge-ai-files', version: '1' } } })
  if (m.method === 'tools/list') return send({ id: m.id, result: { tools: TOOLS } })
  if (m.method === 'tools/call') {
    if (!TOOLS.some((t) => t.name === m.params?.name)) return send({ id: m.id, error: { code: -32602, message: `No tool called ${m.params?.name}` } })
    try { return send({ id: m.id, result: { content: [{ type: 'text', text: call(m.params.name, m.params.arguments || {}) }] } }) } catch (e) { return send({ id: m.id, result: { content: [{ type: 'text', text: e.message }], isError: true } }) }
  }
  if (m.method === 'ping') return send({ id: m.id, result: {} })
  send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } })
})
rl.on('close', () => process.exit(0))
