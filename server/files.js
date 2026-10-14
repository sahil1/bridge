// Read-only file and git access inside an agent's working folder.
// Every path is resolved with realpath and must stay inside the agent's root.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.venv', 'venv', '.next', 'dist', '.cache', '.turbo'])
const MAX_TEXT = 1024 * 1024
const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const PDF = { '.pdf': 'application/pdf' }

export function safePath(root, rel = '') {
  const realRoot = fs.realpathSync(root)
  const target = path.resolve(realRoot, rel.replace(/^\/+/, ''))
  let real
  try { real = fs.realpathSync(target) } catch { throw new Error('Not found') }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('Outside the agent folder')
  return { real, realRoot, rel: path.relative(realRoot, real) }
}

export function listDir(root, rel, { showHidden = false } = {}) {
  const { real, rel: r } = safePath(root, rel)
  const entries = fs.readdirSync(real, { withFileTypes: true })
    .filter((e) => (showHidden ? e.name !== '.git' && e.name !== '.DS_Store' : !HIDDEN.has(e.name) && !e.name.startsWith('.')))
    .map((e) => {
      const p = path.join(real, e.name)
      let st = null
      try { st = fs.statSync(p) } catch { /* broken link */ }
      return { name: e.name, path: path.join(r, e.name), dir: !!st?.isDirectory(), size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 }
    })
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return { path: r, entries }
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export function readFile(root, rel) {
  const { real, rel: r } = safePath(root, rel)
  const st = fs.statSync(real)
  if (st.isDirectory()) throw new Error('Is a folder')
  const ext = path.extname(real).toLowerCase()
  const base = { path: r, name: path.basename(real), ext, size: st.size, mtime: st.mtimeMs }
  if (IMAGE[ext]) return { ...base, kind: 'image' }
  if (PDF[ext]) return { ...base, kind: 'pdf' }
  const fd = fs.openSync(real, 'r')
  const len = Math.min(st.size, MAX_TEXT)
  const buf = Buffer.alloc(len)
  fs.readSync(fd, buf, 0, len, 0)
  fs.closeSync(fd)
  if (looksBinary(buf)) return { ...base, kind: 'binary' }
  return { ...base, kind: 'text', text: buf.toString('utf8'), truncated: st.size > MAX_TEXT }
}

export function rawFile(root, rel) {
  const { real } = safePath(root, rel)
  const ext = path.extname(real).toLowerCase()
  return { file: real, type: IMAGE[ext] || PDF[ext] || 'application/octet-stream' }
}

function git(cwd, args, timeout = 10000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout))
  })
}

// File-name search: git's index when it's a repo, otherwise a bounded walk.
export async function findFiles(root, q, limit = 60) {
  const { realRoot } = safePath(root, '')
  let files = null
  const tracked = await git(realRoot, ['ls-files', '--cached', '--others', '--exclude-standard'])
  if (tracked != null) files = tracked.split('\n').filter(Boolean)
  if (!files) {
    files = []
    const walk = (dir, depth) => {
      if (depth > 6 || files.length > 8000) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (HIDDEN.has(e.name) || e.name.startsWith('.')) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p, depth + 1)
        else files.push(path.relative(realRoot, p))
      }
    }
    walk(realRoot, 0)
  }
  const needle = q.toLowerCase()
  const score = (f) => {
    const lf = f.toLowerCase()
    const base = path.basename(lf)
    if (base === needle) return 0
    if (base.startsWith(needle)) return 1
    if (base.includes(needle)) return 2
    if (lf.includes(needle)) return 3
    // subsequence match on the basename
    let i = 0
    for (const ch of base) if (ch === needle[i]) i++
    return i === needle.length ? 4 : 9
  }
  return files.map((f) => [score(f), f]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].length - b[1].length).slice(0, limit).map(([, f]) => f)
}

export async function gitStatus(root) {
  const { realRoot } = safePath(root, '')
  const top = (await git(realRoot, ['rev-parse', '--show-toplevel']))?.trim()
  if (!top) return { repo: false }
  const out = await git(realRoot, ['status', '--porcelain=v1', '-b', '--untracked-files=all', '--', '.'])
  const lines = (out || '').split('\n').filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : ''
  const branch = head.split('...')[0]
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] || 0)
  const behind = Number(head.match(/behind (\d+)/)?.[1] || 0)
  const prefix = path.relative(top, realRoot)
  const files = lines.map((l) => {
    const x = l[0], y = l[1]
    let p = l.slice(3)
    if (p.includes(' -> ')) p = p.split(' -> ')[1]
    p = p.replace(/^"|"$/g, '')
    const rel = prefix ? path.relative(prefix, p) : p
    const status = x === '?' ? 'untracked' : x === 'A' || y === 'A' ? 'added' : x === 'D' || y === 'D' ? 'deleted' : x === 'R' ? 'renamed' : 'modified'
    return { path: rel, status, staged: x !== ' ' && x !== '?' }
  })
  const stat = await git(realRoot, ['diff', 'HEAD', '--numstat', '--', '.'])
  const counts = {}
  for (const l of (stat || '').split('\n').filter(Boolean)) {
    const [a, d, p] = l.split('\t')
    counts[prefix ? path.relative(prefix, p) : p] = { add: Number(a) || 0, del: Number(d) || 0 }
  }
  for (const f of files) Object.assign(f, counts[f.path] || {})
  const last = (await git(realRoot, ['log', '-1', '--format=%h%x09%s%x09%cr']))?.trim().split('\t')
  return { repo: true, branch, ahead, behind, files, lastCommit: last ? { hash: last[0], subject: last[1], when: last[2] } : null }
}

export async function gitDiff(root, rel) {
  const { real, realRoot } = safePath(root, rel)
  const relToRoot = path.relative(realRoot, real)
  const diff = await git(realRoot, ['diff', 'HEAD', '--no-color', '-U3', '--', relToRoot])
  if (diff) return { diff }
  // Untracked: show the whole file as added.
  const f = readFile(root, rel)
  if (f.kind !== 'text') return { diff: '', note: `${f.kind} file` }
  return { diff: `--- /dev/null\n+++ b/${relToRoot}\n@@ new file @@\n` + f.text.split('\n').map((l) => `+${l}`).join('\n'), untracked: true }
}
