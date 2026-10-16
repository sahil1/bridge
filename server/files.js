// File and git access inside an agent's working folder: reading, and saving a text file you
// edited in the viewer. Every path is resolved with realpath and must stay inside the agent's root.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { OFFICE } from './office.js'

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
  if (OFFICE[ext]) return { ...base, kind: 'office', office: OFFICE[ext] }
  const fd = fs.openSync(real, 'r')
  const len = Math.min(st.size, MAX_TEXT)
  const buf = Buffer.alloc(len)
  fs.readSync(fd, buf, 0, len, 0)
  fs.closeSync(fd)
  if (looksBinary(buf)) return { ...base, kind: 'binary' }
  return { ...base, kind: 'text', text: buf.toString('utf8'), truncated: st.size > MAX_TEXT }
}

// Save a text file edited in the viewer. Only files that already exist (so a path can't be made
// up), and only if nobody changed it since you opened it: `mtime` is what you loaded, and a
// different one on disk means an agent wrote to it meanwhile (pass force to overwrite anyway).
const MAX_SAVE = 5 * 1024 * 1024
export function writeFile(root, rel, text, { mtime, force = false } = {}) {
  if (typeof text !== 'string') throw new Error('Expected the file text')
  if (Buffer.byteLength(text) > MAX_SAVE) throw new Error('Too large to save from here (5 MB at most)')
  const { real } = safePath(root, rel)
  const st = fs.statSync(real)
  if (!st.isFile()) throw new Error('Not a file')
  if (!force && mtime != null && Math.abs(st.mtimeMs - Number(mtime)) > 1) {
    const err = new Error('The file changed on disk since you opened it')
    err.conflict = true
    throw err
  }
  fs.writeFileSync(real, text)
  return readFile(root, rel)
}

export function rawFile(root, rel) {
  const { real } = safePath(root, rel)
  const ext = path.extname(real).toLowerCase()
  return { file: real, type: IMAGE[ext] || PDF[ext] || 'application/octet-stream' }
}

// An HTML page and the files next to it (styles, scripts, images), served by path so the page's
// relative links work. The route serves it sandboxed, away from this app's origin.
const SITE = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }
export function siteFile(root, rel) {
  const { real } = safePath(root, rel)
  if (fs.statSync(real).isDirectory()) throw new Error('Not found')
  const ext = path.extname(real).toLowerCase()
  return { file: real, type: SITE[ext] || IMAGE[ext] || PDF[ext] || 'application/octet-stream', html: ext === '.html' || ext === '.htm' }
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

// ---------- Acting on changes (the Changes tab) ----------
// Run git with input on stdin; resolves { ok, out } instead of throwing.
function gitIn(cwd, args, input = '', timeout = 20000) {
  return new Promise((resolve) => {
    const p = execFile('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() }))
    if (input) p.stdin.end(input); else p.stdin.end()
  })
}
async function repoOf(root, rel) {
  const { realRoot } = safePath(root, '')
  const top = (await git(realRoot, ['rev-parse', '--show-toplevel']))?.trim()
  if (!top) throw new Error("This folder isn't a git repository")
  // A path that no longer exists (deleted) can't go through realpath; check it lexically.
  const abs = path.resolve(realRoot, String(rel || '').replace(/^\/+/, ''))
  if (rel && abs !== realRoot && !abs.startsWith(realRoot + path.sep)) throw new Error('Outside the agent folder')
  return { realRoot, top, abs, relTop: rel ? path.relative(top, abs) : null }
}

// Throw away every change to one file: back to the last commit, or gone if it's new.
export async function discardFile(root, rel) {
  const { top, abs, relTop } = await repoOf(root, rel)
  const tracked = await gitIn(top, ['cat-file', '-e', `HEAD:${relTop}`])
  if (tracked.ok) {
    const r = await gitIn(top, ['checkout', 'HEAD', '--', relTop])
    if (!r.ok) throw new Error(r.out || "Couldn't restore the file")
  } else {
    await gitIn(top, ['rm', '--cached', '--quiet', '--', relTop])
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) fs.rmSync(abs)
  }
  return { ok: true }
}

// Throw away one change (hunk) in a file: the hunk-th "@@" block of its diff against HEAD.
export async function discardHunk(root, rel, hunk) {
  const { top, relTop } = await repoOf(root, rel)
  const diff = (await gitIn(top, ['diff', 'HEAD', '--no-color', '-U3', '--', relTop])).out
  const at = diff.indexOf('\n@@')
  if (at < 0) throw new Error('No changes to undo in that file')
  const header = diff.slice(0, at + 1)
  const hunks = diff.slice(at + 1).split(/\n(?=@@ )/)
  const h = hunks[Number(hunk)]
  if (h == null) throw new Error('That change is no longer there; reload the diff')
  const patch = `${header}${h.endsWith('\n') ? h : `${h}\n`}`
  const r = await gitIn(top, ['apply', '-R', '--whitespace=nowarn', '-'], patch)
  if (!r.ok) throw new Error(`Couldn't undo that change: ${r.out.slice(0, 200)}`)
  return { ok: true }
}

// Commit the given files (or every change in the folder) with a message. Git's own hooks run.
export async function commit(root, { message, paths = null }) {
  const msg = String(message || '').trim()
  if (!msg) throw new Error('Write a commit message')
  const { realRoot, top } = await repoOf(root, '')
  const list = Array.isArray(paths) && paths.length ? paths.map((p) => path.relative(top, path.resolve(realRoot, String(p)))) : [path.relative(top, realRoot) || '.']
  if (list.some((p) => p.startsWith('..'))) throw new Error('Outside the agent folder')
  const add = await gitIn(top, ['add', '-A', '--', ...list])
  if (!add.ok) throw new Error(add.out || "Couldn't stage the files")
  const r = await gitIn(top, ['commit', '-m', msg, '--', ...list], '', 120000)
  if (!r.ok) throw new Error(r.out.slice(-600) || 'The commit failed')
  const head = (await git(top, ['log', '-1', '--format=%h']))?.trim()
  return { ok: true, hash: head, output: r.out.slice(-400) }
}

// ---------- File actions (the file tree's menu) ----------
// Each acts on one path inside the agent's folder, never the folder itself.
const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 30000, windowsHide: true }, (err, _o, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n')[0])) : resolve())))
function inside(root, rel) {
  const r = safePath(root, rel)
  if (r.real === r.realRoot) throw new Error("That's the agent's own folder")
  return r
}
function checkName(name) {
  name = String(name || '').trim()
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name) || (IS_WIN && /[<>:"|?*]/.test(name))) throw new Error('Pick a name without slashes')
  return name
}

// "report.docx" -> "report copy.docx", then "report copy 2.docx", like Finder.
export function duplicate(root, rel) {
  const { real, realRoot } = inside(root, rel)
  const dir = path.dirname(real)
  const ext = fs.statSync(real).isDirectory() ? '' : path.extname(real)
  const stem = path.basename(real, ext)
  let dest
  for (let n = 1; n < 500; n++) { dest = path.join(dir, `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`); if (!fs.existsSync(dest)) break }
  fs.cpSync(real, dest, { recursive: true, errorOnExist: true, force: false })
  return { path: path.relative(realRoot, dest) }
}

export function rename(root, rel, name) {
  const { real, realRoot } = inside(root, rel)
  const dest = path.join(path.dirname(real), checkName(name))
  if (dest === real) return { path: path.relative(realRoot, real) }
  if (fs.existsSync(dest) && dest.toLowerCase() !== real.toLowerCase()) throw new Error(`${path.basename(dest)} already exists here`)
  fs.renameSync(real, dest)
  return { path: path.relative(realRoot, dest) }
}

// A new empty file or folder in `dirRel` ('' is the agent's folder).
export function create(root, dirRel, name, { folder = false } = {}) {
  const { real, realRoot } = safePath(root, dirRel)
  if (!fs.statSync(real).isDirectory()) throw new Error('Not a folder')
  const dest = path.join(real, checkName(name))
  if (fs.existsSync(dest)) throw new Error(`${path.basename(dest)} already exists here`)
  if (folder) fs.mkdirSync(dest)
  else fs.writeFileSync(dest, '', { flag: 'wx' })
  return { path: path.relative(realRoot, dest) }
}

// To the Trash (Recycle Bin), so it can be put back; never deleted outright.
export async function trash(root, rel) {
  const { real } = inside(root, rel)
  if (IS_MAC) {
    if (fs.existsSync('/usr/bin/trash')) await run('/usr/bin/trash', [real])
    else await run('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', real])
  } else if (IS_WIN) {
    const kind = fs.statSync(real).isDirectory() ? 'DeleteDirectory' : 'DeleteFile'
    const quoted = `'${real.replace(/'/g, "''")}'`
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${kind}(${quoted}, 'OnlyErrorDialogs', 'SendToRecycleBin')`])
  } else {
    await run('gio', ['trash', real]).catch(() => { throw new Error("Couldn't move it to the Trash (gio isn't available)") })
  }
  return { ok: true }
}

// Show it in Finder / Explorer / the file manager, selected.
export async function reveal(root, rel) {
  const { real } = safePath(root, rel)
  if (IS_MAC) await run('open', ['-R', real])
  else if (IS_WIN) await run('explorer.exe', [`/select,${real}`]).catch(() => {}) // explorer exits 1 even when it worked
  else await run('xdg-open', [fs.statSync(real).isDirectory() ? real : path.dirname(real)])
  return { ok: true }
}

// Open in its usual app (Word, Excel, Preview…). Documents and media only: never something
// that runs (a script, an app, a shortcut), since this can be asked for from a page.
const OPENABLE = new Set(['.pdf', '.docx', '.doc', '.odt', '.rtf', '.pptx', '.ppt', '.odp', '.key', '.xlsx', '.xlsm', '.xls', '.ods', '.numbers', '.pages', '.csv', '.tsv', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.tif', '.tiff', '.bmp', '.mp4', '.mov', '.m4v', '.webm', '.mp3', '.m4a', '.wav', '.aac', '.flac', '.zip', '.epub'])
export async function openDefault(root, rel) {
  const { real } = inside(root, rel)
  const ext = path.extname(real).toLowerCase()
  if (fs.statSync(real).isDirectory() || !OPENABLE.has(ext)) throw new Error('Only documents, images and media open from here')
  if (IS_MAC) await run('open', [real])
  else if (IS_WIN) await run('explorer.exe', [real]).catch(() => {})
  else await run('xdg-open', [real])
  return { ok: true }
}
export const canOpen = (name) => OPENABLE.has(path.extname(String(name)).toLowerCase())
