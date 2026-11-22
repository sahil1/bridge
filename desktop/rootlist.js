// The built app's own copy of Bridge AI (app-root, outside the app's archive: the server, the page it
// serves, their packages and helpers), as it was built. stage.js lists every file with its SHA-256
// (app-root.list, which goes inside the archive, where Electron's own integrity check covers it);
// main.js checks app-root against it before it starts the server or opens its keys, and starts
// neither if anything was changed, added or taken away.
// Programs (Mach-O and Windows executables and libraries) are listed but not hashed: signing the app
// changes their bytes after the list is made, so they're left to their code signature. What the
// packaging leaves out by design may be missing: the other Mac chip's packages and llama-server
// (after-pack.js), and dot files. Finder's .DS_Store files are ignored.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const PROGRAM = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'])
const program = (head) => PROGRAM.has(head.subarray(0, 4).toString('hex')) || head.subarray(0, 2).toString('latin1') === 'MZ'
const ignored = (rel) => path.posix.basename(rel) === '.DS_Store'

// Every file under root, by its path from there (with /), symbolic links as what they point to.
function walk(root) {
  const out = []
  const go = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) go(abs, r)
      else if (e.isFile() || e.isSymbolicLink()) out.push({ abs, rel: r, link: e.isSymbolicLink() })
    }
  }
  go(root, '')
  return out
}
// One file: 'bin' for a program, else its SHA-256 (a link to a folder: of where it points).
async function hashOf({ abs, link }) {
  if (link) {
    const st = await fs.promises.stat(abs).catch(() => null)
    if (!st || st.isDirectory()) return `link:${crypto.createHash('sha256').update(await fs.promises.readlink(abs)).digest('hex')}`
  }
  const fd = await fs.promises.open(abs, 'r')
  try {
    const head = Buffer.alloc(4)
    const { bytesRead } = await fd.read(head, 0, 4, 0)
    if (bytesRead >= 2 && program(head.subarray(0, bytesRead))) return 'bin'
    const h = crypto.createHash('sha256')
    for await (const c of fd.createReadStream({ autoClose: false, start: 0 })) h.update(c)
    return h.digest('hex')
  } finally { await fd.close() }
}
async function each(list, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const x = list[i++]; await fn(x) } }))
}
// Which Mac chip a file is only for, as after-pack.js takes them out of the other chip's app: a
// package that says it's for macOS on one chip, or llama-server's folder for one. '-': both.
function chipOf(root) {
  const seen = new Map()
  const pkgCpu = (dir) => {
    if (!seen.has(dir)) {
      let cpu = null
      try { const p = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8')); if (p.os?.includes('darwin') && p.cpu?.length === 1) cpu = p.cpu[0] } catch { /* not a package */ }
      seen.set(dir, cpu)
    }
    return seen.get(dir)
  }
  return (rel) => {
    const llama = /^native\/llama\/darwin-(arm64|x64)\//.exec(rel)
    if (llama) return llama[1]
    const parts = rel.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] !== 'node_modules') continue
      const n = parts[i + 1]?.startsWith('@') ? 3 : 2
      const cpu = pkgCpu(parts.slice(0, i + n).join('/'))
      if (cpu) return cpu
    }
    return '-'
  }
}
// The list (stage.js): a line for each file, its hash (or bin), its chip and its path.
async function make(root) {
  const files = walk(root).filter((f) => !ignored(f.rel))
  const chip = chipOf(root)
  const lines = []
  await each(files, 16, async (f) => { lines.push(`${await hashOf(f)}\t${chip(f.rel)}\t${f.rel}`) })
  return `${lines.sort((a, b) => (a.split('\t')[2] < b.split('\t')[2] ? -1 : 1)).join('\n')}\n`
}
// Checks root against the list (main.js): { ok, changed, added, missing, ms }.
async function verify(root, text, { arch = process.arch } = {}) {
  const t = Date.now()
  const want = new Map()
  for (const line of String(text).split('\n')) {
    const [hash, chip, rel] = line.split('\t')
    if (rel) want.set(rel, { hash, chip })
  }
  const changed = []
  const added = []
  const present = new Set()
  const files = walk(root).filter((f) => !ignored(f.rel))
  await each(files, 16, async (f) => {
    present.add(f.rel)
    const w = want.get(f.rel)
    if (!w) { added.push(f.rel); return }
    const h = await hashOf(f).catch(() => null)
    if (h !== w.hash) changed.push(f.rel)
  })
  const missing = [...want.entries()].filter(([rel, w]) => !present.has(rel) && !path.posix.basename(rel).startsWith('.') && (w.chip === '-' || w.chip === arch)).map(([rel]) => rel)
  return { ok: want.size > 0 && !changed.length && !added.length && !missing.length, changed: changed.sort(), added: added.sort(), missing: missing.sort(), files: files.length, ms: Date.now() - t }
}

module.exports = { make, verify, walk, program }
