// A bot's session with Full Access (frontdesk.js): its PreToolUse hook before each edit (Edit, Write,
// MultiEdit, NotebookEdit), keeping the file as it was, so the change its turn made can be undone in
// Activity (frontdesk.js fullEdits, botwrite.js made). It never refuses anything: a session with Full
// Access is as your own Claude Code; this only remembers.
//   node botundo.mjs --dir <the session's undo folder> --root <folder> [--root <folder> …]
// For a file inside one of its roots (its real path), the first time in a turn: its bytes as they are
// (blobs/<sha256>), or that it wasn't there, in index.jsonl beside them ({ n, path, root, existed,
// hash, mode, tool, at }). A file over 50 MB, or outside its roots, is noted as one that can't be put
// back. Exit 0, always.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX = 50 * 1024 * 1024
const argv = process.argv.slice(2)
let dir = null
const roots = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir' && argv[i + 1]) dir = path.resolve(argv[++i])
  else if (argv[i] === '--root' && argv[i + 1]) roots.push(argv[++i])
}
const real = (p) => { try { return fs.realpathSync(p) } catch { return null } }
const within = (p, r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep)

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { input += d; if (input.length > 4 * 1024 * 1024) input = input.slice(0, 4 * 1024 * 1024) })
process.stdin.on('end', () => {
  try { keep(JSON.parse(input || '{}')) } catch { /* nothing to keep */ }
  process.exit(0)
})

function keep(j) {
  if (!dir) return
  const x = j?.tool_input || {}
  const given = x.file_path || x.notebook_path || x.path
  if (!given) return
  const at = path.resolve(String(j?.cwd || process.cwd()), String(given))
  // (Its folder as it really is, the file's name as given: a link in it is kept as the link's target.)
  const folder = real(path.dirname(at))
  if (!folder) return
  const full = path.join(folder, path.basename(at))
  const rootsReal = roots.map(real).filter(Boolean)
  const root = rootsReal.find((r) => within(full, r))
  fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true, mode: 0o700 })
  const index = path.join(dir, 'index.jsonl')
  const seen = (() => { try { return fs.readFileSync(index, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } })()
  if (seen.some((e) => e.path === full)) return
  const line = { n: seen.length + 1, path: full, root: root || null, tool: String(j?.tool_name || ''), at: new Date().toISOString() }
  let st = null
  try { st = fs.lstatSync(full) } catch { st = null }
  if (!root) Object.assign(line, { existed: !!st, outside: true })
  else if (!st) Object.assign(line, { existed: false })
  else if (!st.isFile() || st.size > MAX) Object.assign(line, { existed: true, kept: false })
  else {
    const buf = fs.readFileSync(full)
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    const blob = path.join(dir, 'blobs', hash)
    if (!fs.existsSync(blob)) fs.writeFileSync(blob, buf, { mode: 0o600 })
    Object.assign(line, { existed: true, hash, mode: st.mode & 0o777, size: buf.length })
  }
  fs.appendFileSync(index, `${JSON.stringify(line)}\n`, { mode: 0o600 })
}
