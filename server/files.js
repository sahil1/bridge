// File and git access inside an agent's working folder: reading, and saving a text file you
// edited in the viewer. Every path is resolved with realpath and must stay inside the agent's root.
// All of it is non-blocking: macOS holds a call into a protected folder (Desktop, Documents...)
// until you answer its prompt, and a blocking one would freeze the whole server meanwhile.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { OFFICE } from './office.js'
import { loginPath } from './agents.js'
import { gitReady, NO_GIT } from './gitready.js'

const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.venv', 'venv', '.next', 'dist', '.cache', '.turbo'])
const MAX_TEXT = 1024 * 1024
const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif', '.bmp': 'image/bmp', '.heic': 'image/heic', '.heif': 'image/heif', '.tif': 'image/tiff', '.tiff': 'image/tiff' }
const PDF = { '.pdf': 'application/pdf' }
// Videos and sounds play in the viewer (the browser's own player, asking for the parts it needs as
// you watch). Whether this browser can play one is up to it: the viewer says so when it can't.
const VIDEO = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp' }
const AUDIO = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.weba': 'audio/webm', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.caf': 'audio/x-caf' }
export const typeOf = (name) => { const ext = path.extname(String(name)).toLowerCase(); return IMAGE[ext] || PDF[ext] || VIDEO[ext] || AUDIO[ext] || null }

export async function safePath(root, rel = '') {
  const realRoot = await fsp.realpath(root)
  const target = path.resolve(realRoot, rel.replace(/^\/+/, ''))
  let real
  try { real = await fsp.realpath(target) } catch { throw new Error('Not found') }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('Outside the agent folder')
  return { real, realRoot, rel: path.relative(realRoot, real) }
}
const exists = (p) => fsp.access(p).then(() => true, () => false)

export async function listDir(root, rel, { showHidden = false } = {}) {
  const { real, rel: r } = await safePath(root, rel)
  const shown = (await fsp.readdir(real, { withFileTypes: true }))
    .filter((e) => (showHidden ? e.name !== '.git' && e.name !== '.DS_Store' : !HIDDEN.has(e.name) && !e.name.startsWith('.')))
  // Every entry's stat at once, so a big folder isn't one wait after another.
  const entries = (await Promise.all(shown.map(async (e) => {
    const st = await fsp.stat(path.join(real, e.name)).catch(() => null) // null: a broken link
    return { name: e.name, path: path.join(r, e.name), dir: !!st?.isDirectory(), size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 }
  })))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return { path: r, entries }
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export async function readFile(root, rel) {
  const { real, rel: r } = await safePath(root, rel)
  const st = await fsp.stat(real)
  if (st.isDirectory()) throw new Error('Is a folder')
  const ext = path.extname(real).toLowerCase()
  const base = { path: r, name: path.basename(real), ext, size: st.size, mtime: st.mtimeMs }
  if (IMAGE[ext]) return { ...base, kind: 'image', type: IMAGE[ext] }
  if (PDF[ext]) return { ...base, kind: 'pdf' }
  if (VIDEO[ext]) return { ...base, kind: 'video', type: VIDEO[ext] }
  if (AUDIO[ext]) return { ...base, kind: 'audio', type: AUDIO[ext] }
  if (OFFICE[ext]) return { ...base, kind: 'office', office: OFFICE[ext] }
  const fh = await fsp.open(real, 'r')
  const len = Math.min(st.size, MAX_TEXT)
  const buf = Buffer.alloc(len)
  await fh.read(buf, 0, len, 0).finally(() => fh.close())
  if (looksBinary(buf)) return { ...base, kind: 'binary' }
  return { ...base, kind: 'text', text: buf.toString('utf8'), truncated: st.size > MAX_TEXT }
}

// Save a text file edited in the viewer. Only files that already exist (so a path can't be made
// up), and only if nobody changed it since you opened it: `mtime` is what you loaded, and a
// different one on disk means an agent wrote to it meanwhile (pass force to overwrite anyway).
const MAX_SAVE = 5 * 1024 * 1024
export async function writeFile(root, rel, text, { mtime, force = false } = {}) {
  if (typeof text !== 'string') throw new Error('Expected the file text')
  if (Buffer.byteLength(text) > MAX_SAVE) throw new Error('Too large to save from here (5 MB at most)')
  const { real } = await safePath(root, rel)
  const st = await fsp.stat(real)
  if (!st.isFile()) throw new Error('Not a file')
  if (!force && mtime != null && Math.abs(st.mtimeMs - Number(mtime)) > 1) {
    const err = new Error('The file changed on disk since you opened it')
    err.conflict = true
    throw err
  }
  await fsp.writeFile(real, text)
  return readFile(root, rel)
}

// A file as it is, for the viewer's picture, PDF or player, or to download. Served by the route in
// parts when asked (Range), straight from disk, so a long video starts at once and seeks anywhere.
export async function rawFile(root, rel) {
  const { real } = await safePath(root, rel)
  const ext = path.extname(real).toLowerCase()
  return { file: real, name: path.basename(real), type: typeOf(real) || 'application/octet-stream', media: !!(VIDEO[ext] || AUDIO[ext]) }
}

// An HTML page and the files next to it (styles, scripts, images), served by path so the page's
// relative links work. The route serves it sandboxed, away from this app's origin.
const SITE = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }
export async function siteFile(root, rel) {
  const { real } = await safePath(root, rel)
  if ((await fsp.stat(real)).isDirectory()) throw new Error('Not found')
  const ext = path.extname(real).toLowerCase()
  return { file: real, type: SITE[ext] || IMAGE[ext] || PDF[ext] || 'application/octet-stream', html: ext === '.html' || ext === '.htm' }
}

// git enters the folder itself (-C) rather than being started in it: on macOS the server waits
// while a new program enters its folder, so one macOS is still asking about (your Desktop, say)
// would freeze everything, not just this call.
const inRepo = (cwd, args) => (cwd ? ['-C', cwd, ...args] : args)

async function git(cwd, args, timeout = 10000) {
  if (!(await gitReady())) return null
  return new Promise((resolve) => {
    execFile('git', inRepo(cwd, args), { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout))
  })
}

// File-name search: git's index when it's a repo, otherwise a bounded walk.
export async function findFiles(root, q, limit = 60) {
  const { realRoot } = await safePath(root, '')
  let files = null
  const tracked = await git(realRoot, ['ls-files', '--cached', '--others', '--exclude-standard'])
  if (tracked != null) files = tracked.split('\n').filter(Boolean)
  if (!files) {
    files = []
    const walk = async (dir, depth) => {
      if (depth > 6 || files.length > 8000) return
      for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
        if (HIDDEN.has(e.name) || e.name.startsWith('.')) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) await walk(p, depth + 1)
        else files.push(path.relative(realRoot, p))
      }
    }
    await walk(realRoot, 0)
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
  const { realRoot } = await safePath(root, '')
  const top = (await git(realRoot, ['rev-parse', '--show-toplevel']))?.trim()
  if (!top) return (await gitReady()) ? { repo: false } : { repo: false, noGit: true }
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
  // Where a push would go: the branch's upstream, else origin, else the only remote (none: no push).
  const upstream = head.match(/\.\.\.(\S+)/)?.[1] || null
  const remotes = (await git(realRoot, ['remote']) || '').split('\n').filter(Boolean)
  const remote = remotes.find((r) => upstream?.startsWith(`${r}/`)) || (remotes.includes('origin') ? 'origin' : remotes[0]) || null
  return { repo: true, branch, ahead, behind, upstream, remote, detached: /^HEAD \(no branch\)|^No commits yet/.test(head), files, lastCommit: last ? { hash: last[0], subject: last[1], when: last[2] } : null }
}

export async function gitDiff(root, rel) {
  const { real, realRoot } = await safePath(root, rel)
  const relToRoot = path.relative(realRoot, real)
  const diff = await git(realRoot, ['diff', 'HEAD', '--no-color', '-U3', '--', relToRoot])
  if (diff) return { diff }
  // Untracked: show the whole file as added.
  const f = await readFile(root, rel)
  if (f.kind !== 'text') return { diff: '', note: `${f.kind} file` }
  return { diff: `--- /dev/null\n+++ b/${relToRoot}\n@@ new file @@\n` + f.text.split('\n').map((l) => `+${l}`).join('\n'), untracked: true }
}

// ---------- Acting on changes (the Changes tab) ----------
// Run git with input on stdin; resolves { ok, out } instead of throwing.
async function gitIn(cwd, args, input = '', timeout = 20000, env = undefined) {
  if (!(await gitReady())) return { ok: false, out: NO_GIT, timedOut: false }
  return new Promise((resolve) => {
    const p = execFile('git', inRepo(cwd, args), { timeout, env, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim(), timedOut: !!err?.killed }))
    p.stdin.on('error', () => {}) // git gone before its input is written: its own answer says so
    if (input) p.stdin.end(input); else p.stdin.end()
  })
}
async function repoOf(root, rel) {
  const { realRoot } = await safePath(root, '')
  const top = (await git(realRoot, ['rev-parse', '--show-toplevel']))?.trim()
  if (!top) throw new Error("This folder isn't a git repository")
  // A path that no longer exists (deleted) can't go through realpath; check it lexically.
  const abs = path.resolve(realRoot, String(rel || '').replace(/^\/+/, ''))
  if (rel && abs !== realRoot && !abs.startsWith(realRoot + path.sep)) throw new Error('Outside the agent folder')
  return { realRoot, top, abs, relTop: rel ? path.relative(top, abs) : null }
}

// Throw away every change to one file: back to the last commit, or gone if it's new.
export async function discardFile(root, rel) {
  const { realRoot, top, abs, relTop } = await repoOf(root, rel)
  const tracked = await gitIn(top, ['cat-file', '-e', `HEAD:${relTop}`])
  if (tracked.ok) {
    const r = await gitIn(top, ['checkout', 'HEAD', '--', relTop])
    if (!r.ok) throw new Error(r.out || "Couldn't restore the file")
  } else {
    await gitIn(top, ['rm', '--cached', '--quiet', '--', relTop])
    // Its folder, links followed, must be in the agent's: a link in the repo to your home folder isn't.
    const dir = await fsp.realpath(path.dirname(abs)).catch(() => null)
    if (!dir || (dir !== realRoot && !dir.startsWith(realRoot + path.sep))) throw new Error('Outside the agent folder')
    if ((await fsp.lstat(abs).catch(() => null))?.isFile()) await fsp.rm(abs)
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

// Push the current branch, setting its upstream the first time (or when it tracks another branch,
// as one made from origin/main does). Never forced. Your login shell's PATH finds credential helpers
// and ssh, and git fails instead of waiting for a password nobody can type here.
export async function push(root) {
  const { top } = await repoOf(root, '')
  const branch = (await git(top, ['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim()
  if (!branch) throw new Error("You're not on a branch (detached HEAD), so there's nothing to push")
  const remotes = (await git(top, ['remote']) || '').split('\n').filter(Boolean)
  if (!remotes.length) throw new Error('This repository has no remote to push to. Add one first (git remote add origin <url>)')
  const upRemote = (await git(top, ['config', '--get', `branch.${branch}.remote`]))?.trim()
  const upMerge = (await git(top, ['config', '--get', `branch.${branch}.merge`]))?.trim()
  const tracked = remotes.includes(upRemote) && upMerge === `refs/heads/${branch}`
  const remote = tracked ? upRemote : remotes.includes('origin') ? 'origin' : remotes[0]
  const env = { ...process.env, PATH: await loginPath(), GIT_TERMINAL_PROMPT: '0' }
  const r = await gitIn(top, ['push', ...(tracked ? [] : ['--set-upstream']), remote, branch], '', 90000, env)
  if (r.timedOut) throw new Error(`The push to ${remote} took over 90 seconds and was stopped. It may be waiting for a password or passphrase; try git push in a terminal once`)
  if (!r.ok) { const msg = pushError(r.out, remote, branch); throw Object.assign(new Error(msg), SIGN_IN.test(msg) ? { code: 'pushAuth' } : {}) }
  return { ok: true, branch, remote, upstream: !tracked, output: r.out.slice(-400) }
}
const SIGN_IN = /turned down the sign-in/
function pushError(out, remote, branch) {
  if (/\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first/i.test(out) && !/hook/i.test(out)) return `${remote} has commits on ${branch} that you don't have here. Pull them in first (ask the agent to pull and rebase), then push again`
  if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied|permission to .* denied|access denied|HTTP 40[13]|publickey|Host key verification failed/i.test(out)) return `${remote} turned down the sign-in. Check that git push works from your terminal (gh auth login, or your SSH key)`
  if (/Repository not found|does not appear to be a git repository|not found/i.test(out)) return `Couldn't find the repository at ${remote}, or you don't have access to it`
  if (/Could not resolve host|Connection (refused|timed out)|Network is unreachable|unable to access/i.test(out)) return `Couldn't reach ${remote}. Check your connection`
  return out.split('\n').filter((l) => l.trim() && !/^(To |hint:)/.test(l)).slice(-4).join('\n').slice(-500) || 'The push failed'
}

// ---------- File actions (the file tree's menu) ----------
// Each acts on one path inside the agent's folder, never the folder itself.
const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 30000, windowsHide: true }, (err, _o, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n')[0])) : resolve())))
async function inside(root, rel) {
  const r = await safePath(root, rel)
  if (r.real === r.realRoot) throw new Error("That's the agent's own folder")
  return r
}
function checkName(name) {
  name = String(name || '').trim()
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name) || (IS_WIN && /[<>:"|?*]/.test(name))) throw new Error('Pick a name without slashes')
  return name
}

// "report.docx" -> "report copy.docx", then "report copy 2.docx", like Finder.
export async function duplicate(root, rel) {
  const { real, realRoot } = await inside(root, rel)
  const dir = path.dirname(real)
  const ext = (await fsp.stat(real)).isDirectory() ? '' : path.extname(real)
  const stem = path.basename(real, ext)
  let dest
  for (let n = 1; n < 500; n++) { dest = path.join(dir, `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`); if (!(await exists(dest))) break }
  await fsp.cp(real, dest, { recursive: true, errorOnExist: true, force: false })
  return { path: path.relative(realRoot, dest) }
}

export async function rename(root, rel, name) {
  const { real, realRoot } = await inside(root, rel)
  const dest = path.join(path.dirname(real), checkName(name))
  if (dest === real) return { path: path.relative(realRoot, real) }
  if (await exists(dest) && dest.toLowerCase() !== real.toLowerCase()) throw new Error(`${path.basename(dest)} already exists here`)
  await fsp.rename(real, dest)
  return { path: path.relative(realRoot, dest) }
}

// A new empty file or folder in `dirRel` ('' is the agent's folder).
export async function create(root, dirRel, name, { folder = false } = {}) {
  const { real, realRoot } = await safePath(root, dirRel)
  if (!(await fsp.stat(real)).isDirectory()) throw new Error('Not a folder')
  const dest = path.join(real, checkName(name))
  if (await exists(dest)) throw new Error(`${path.basename(dest)} already exists here`)
  if (folder) await fsp.mkdir(dest)
  else await fsp.writeFile(dest, '', { flag: 'wx' })
  return { path: path.relative(realRoot, dest) }
}

// To the Trash (Recycle Bin), so it can be put back; never deleted outright.
export async function trash(root, rel) {
  const { real } = await inside(root, rel)
  if (IS_MAC) {
    if (fs.existsSync('/usr/bin/trash')) await run('/usr/bin/trash', [real])
    // Older macOS: through Finder, which macOS asks you to allow once (Automation).
    else {
      await run('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', real]).catch((e) => {
        if (/-1743|not authori[sz]ed to send apple events/i.test(e.message)) throw Object.assign(new Error('macOS didn\'t let Bridge AI ask Finder to move it to the Trash.'), { code: 'automation' })
        throw e
      })
    }
  } else if (IS_WIN) {
    const kind = (await fsp.stat(real)).isDirectory() ? 'DeleteDirectory' : 'DeleteFile'
    const quoted = `'${real.replace(/'/g, "''")}'`
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${kind}(${quoted}, 'OnlyErrorDialogs', 'SendToRecycleBin')`])
  } else {
    await run('gio', ['trash', real]).catch(() => { throw new Error("Couldn't move it to the Trash (gio isn't available)") })
  }
  return { ok: true }
}

// Show it in Finder / Explorer / the file manager, selected.
export async function reveal(root, rel) {
  const { real } = await safePath(root, rel)
  if (IS_MAC) await run('open', ['-R', real])
  else if (IS_WIN) await run('explorer.exe', [`/select,${real}`]).catch(() => {}) // explorer exits 1 even when it worked
  else await run('xdg-open', [(await fsp.stat(real)).isDirectory() ? real : path.dirname(real)])
  return { ok: true }
}

// Open in its usual app (Word, Excel, Preview…). Documents and media only: never something
// that runs (a script, an app, a shortcut), since this can be asked for from a page.
const OPENABLE = new Set(['.pdf', '.docx', '.doc', '.odt', '.rtf', '.pptx', '.ppt', '.odp', '.key', '.xlsx', '.xlsm', '.xls', '.ods', '.numbers', '.pages', '.csv', '.tsv', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.tif', '.tiff', '.bmp', '.mp4', '.mov', '.m4v', '.webm', '.mp3', '.m4a', '.wav', '.aac', '.flac', '.zip', '.epub'])
export async function openDefault(root, rel) {
  const { real } = await inside(root, rel)
  const ext = path.extname(real).toLowerCase()
  if ((await fsp.stat(real)).isDirectory() || !OPENABLE.has(ext)) throw new Error('Only documents, images and media open from here')
  if (IS_MAC) await run('open', [real])
  else if (IS_WIN) await run('explorer.exe', [real]).catch(() => {})
  else await run('xdg-open', [real])
  return { ok: true }
}
export const canOpen = (name) => OPENABLE.has(path.extname(String(name)).toLowerCase())
