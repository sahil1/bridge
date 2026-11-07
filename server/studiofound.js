// Studio's home: your documents, sheets, decks, PDFs and pages, wherever they are, beside what you
// opened in Studio, each with where it is (a project, a place, a cloud drive, a folder in your home)
// so the home can show them by kind and by where. And editing in place: part of a document
// rewritten as asked.
//
// Looked for only when Studio's home asks (never before Studio is opened), without waiting on your
// folders: macOS's Spotlight (its own index, so nothing in Documents, Desktop or Downloads is read and
// macOS asks nothing) for every Word, Excel, PowerPoint and PDF file in your home folder, iCloud Drive
// and the cloud drives in ~/Library/CloudStorage (OneDrive, Google Drive, Dropbox, Box) included, and
// the Markdown and CSV files you opened lately; Windows' Recent items; Linux's recently-used list;
// then a short look through your agents' folders, the places you added to Files and Studio's own
// folder (and on Windows and Linux your Documents, Desktop, Downloads and cloud drive folders), a few
// levels down, each a share of the time and the files, never into a folder macOS would ask about
// first. In a project's code (a git repository) only its documents proper are listed: Word, Excel,
// PowerPoint, PDFs and Markdown decks, not its READMEs, pages and data. Kinds Studio doesn't open
// are listed too (opens: false), to open in their own app: Word's, Excel's and PowerPoint's older
// formats and OpenDocument's everywhere, and Pages, Numbers and Keynote on a Mac. The newest 100 of
// each kind, saying how many there were when there were more. Kept a minute. A file found outside
// those folders opens through its own folder (found:<key>), which only a folder found this way can be.
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { DATA, writeFileAtomic } from './paths.js'
import { opens, kindOf } from './studio.js'
import { mayLook } from './projects.js'

const DIR = path.join(DATA, 'studio')
const FOUND = path.join(DIR, 'found.json')
const OFFICE = ['.docx', '.xlsx', '.xlsm', '.pptx', '.pdf']
// What Studio doesn't open but lists by its kind, for its own app to open. Apple's are a Mac's
// only; there a Keynote, Pages or Numbers file can be a folder (a package), and Spotlight is asked
// for them by kind, as .key is also the name of a key file.
const OTHER = { '.doc': 'doc', '.odt': 'doc', '.xls': 'sheet', '.ods': 'sheet', '.ppt': 'deck', '.odp': 'deck', ...(process.platform === 'darwin' ? { '.pages': 'doc', '.numbers': 'sheet', '.key': 'deck' } : {}) }
const APPLE = new Set(['.pages', '.numbers', '.key'])
const otherKind = (name) => OTHER[path.extname(String(name)).toLowerCase()] || null
const lists = (name) => opens(name) || !!otherKind(name)
const RECENTLY = [...OFFICE, ...Object.keys(OTHER), '.md', '.csv']
const MARKDOWN = new Set(['.md', '.markdown'])
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv', 'Library', 'Pods', 'DerivedData', '.next', '.cache', 'coverage', 'AppData', 'fixtures', '__fixtures__'])
const LOOK_MS = 2500 // the longest the look through folders takes
const LOOK_FILES = 6000 // the most entries it reads, shared between the folders
const HEADS = 400 // the most Markdown files it opens to tell a deck (its front matter) from a document
const SPOT_MS = 8000 // the longest Spotlight is waited for
const SPOT_MAX = 20_000 // the most files taken from it
const PER_KIND = 100 // the newest of each kind on the home
const readJSON = async (f, d) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')) } catch { return d } }

let foundDirs = null // key -> folder
const loadFound = async () => (foundDirs ||= new Map(Object.entries((await readJSON(FOUND, { dirs: {} })).dirs || {})))
const dirKey = (dir) => crypto.createHash('sha1').update(dir).digest('hex').slice(0, 12)
export async function foundDir(key) {
  const d = (await loadFound()).get(String(key))
  if (!d) throw new Error('Studio didn\'t find that folder. Open Studio\'s home again to look for your files.')
  return d
}
const tilde = (p, home) => (p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p)
// On a Mac your cloud drives are in ~/Library, among apps' own files: CloudStorage (OneDrive, Google
// Drive, Dropbox, Box) and Mobile Documents (iCloud Drive). What's in them is yours.
const CLOUD_MAC = /^~\/Library\/(CloudStorage|Mobile Documents)\/[^/]+(?=\/|$)/
const hiddenPath = (p, home) => tilde(p, home).replace(CLOUD_MAC, '~').split(/[\\/]/).some((s) => (s.startsWith('.') && s !== '.' && s !== '~') || SKIP.has(s))

// Where a file is, for the home to show them by: the project or place it's in (r), Studio's own
// folder, a cloud drive, the folder in your home it's under (Documents, Downloads…), your home
// folder itself, or another disk. { type, name }: type project, place, studio, cloud, folder, home
// or other; name as the project or place is called, or as the folder, drive or disk is.
const CLOUDS = [[/^OneDrive/i, 'OneDrive'], [/^(GoogleDrive|Google Drive)/i, 'Google Drive'], [/^Dropbox/i, 'Dropbox'], [/^Box\b/i, 'Box'], [/^iCloud ?Drive/i, 'iCloud Drive']]
function areaOf(file, home, r = null) {
  if (r?.own) return { type: 'studio', name: null }
  if (r) return { type: String(r.root).startsWith('place:') ? 'place' : 'project', name: r.label || path.basename(r.dir) }
  if (!file.startsWith(home + path.sep)) {
    const parts = file.split(/[\\/]/).filter(Boolean)
    return { type: 'other', name: (['Volumes', 'media', 'mnt'].includes(parts[0]) ? parts[1] : parts[0]) || null }
  }
  const rel = file.slice(home.length + 1).split(path.sep)
  if (rel[0] === 'Library' && rel[1] === 'Mobile Documents') return { type: 'cloud', name: 'iCloud Drive' }
  const top = rel[0] === 'Library' && rel[1] === 'CloudStorage' ? rel[2] || '' : rel[0]
  const cloud = CLOUDS.find(([re]) => re.test(top))
  if (cloud) return { type: 'cloud', name: cloud[1] }
  return rel.length === 1 ? { type: 'home', name: null } : { type: 'folder', name: top }
}

// Spotlight: every Word, Excel, PowerPoint and PDF file in your home folder, whenever it changed (and
// the kinds Studio lists for their own app: Keynote, Pages and Numbers by their kind), and the
// Markdown and CSV files you opened in the last 60 days (all of them would be every README in every
// project), each with when you last opened it and when it changed (its attributes, so no file is
// read). Read as it comes, up to SPOT_MAX files.
function spotlight(home, signal) {
  const named = (exts) => exts.map((e) => `kMDItemFSName == "*${e}"c`).join(' || ')
  const others = Object.keys(OTHER).filter((e) => !APPLE.has(e))
  const query = `(${named([...OFFICE, ...others])}) || (kMDItemContentType == "com.apple.iwork.*" && (${named([...APPLE])})) || ((${named(['.md', '.csv'])}) && kMDItemLastUsedDate >= $time.today(-60))`
  const date = (s) => { const d = s && s !== '(null)' ? new Date(s.replace(/^(\S+) (\S+) ([+-]\d{2})(\d{2})$/, '$1T$2$3:$4')) : null; return d && !Number.isNaN(d.getTime()) ? d.getTime() : null }
  const parse = (line) => {
    if (!line.trim()) return null
    const [file, ...attrs] = line.split(/ {3}(?=kMDItem\w+ = )/)
    const v = Object.fromEntries(attrs.map((a) => /^(kMDItem\w+) = (.*)$/.exec(a.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]))
    return { file, used: date(v.kMDItemLastUsedDate), changed: date(v.kMDItemFSContentChangeDate) }
  }
  return new Promise((resolve, reject) => {
    const files = []
    let rest = ''
    let over = false
    const kid = spawn('mdfind', ['-onlyin', home, '-attr', 'kMDItemLastUsedDate', '-attr', 'kMDItemFSContentChangeDate', query], { stdio: ['ignore', 'pipe', 'ignore'] })
    const finish = (err) => {
      if (over) return
      over = true
      clearTimeout(timer)
      if (err && !files.length) reject(err)
      else resolve(Object.assign(files, { partial: !!err }))
    }
    // Too long: what came by then, said to be only part.
    const timer = setTimeout(() => { kid.kill(); finish(Object.assign(new Error('Spotlight took too long to answer'), { killed: true })) }, SPOT_MS)
    kid.stdout.setEncoding('utf8')
    kid.stdout.on('data', (s) => {
      const lines = (rest + s).split('\n')
      rest = lines.pop()
      for (const line of lines) { const x = parse(line); if (x) files.push(x) }
      if (files.length >= SPOT_MAX) { kid.kill(); finish() }
    })
    kid.on('error', finish)
    kid.on('close', () => { const x = parse(rest); if (x && !over) files.push(x); finish() })
    signal?.addEventListener('abort', () => { kid.kill(); finish(Object.assign(new Error('Stopped'), { killed: true })) }, { once: true })
  })
}
// Windows' Recent items: a shortcut (.lnk) for each file you opened. The file it points to, from the
// shortcut itself (its LinkInfo), and when you opened it (the shortcut's own time).
export function lnkTarget(b) {
  if (b.length < 0x4c || b.readUInt32LE(0) !== 0x4c) return null
  const flags = b.readUInt32LE(0x14)
  let p = 0x4c
  if (flags & 1) p += 2 + b.readUInt16LE(p)
  if (!(flags & 2) || p + 0x1c > b.length) return null
  const headerSize = b.readUInt32LE(p + 4)
  if (!(b.readUInt32LE(p + 8) & 1)) return null
  const z8 = (at) => { let e = at; while (e < b.length && b[e]) e++; return b.toString('latin1', at, e) }
  const z16 = (at) => { let e = at; while (e + 1 < b.length && (b[e] || b[e + 1])) e += 2; return b.toString('utf16le', at, e) }
  if (headerSize >= 0x24) {
    const base = b.readUInt32LE(p + 0x1c), suffix = b.readUInt32LE(p + 0x20)
    if (base) return z16(p + base) + (suffix ? z16(p + suffix) : '')
  }
  return z8(p + b.readUInt32LE(p + 0x10)) + z8(p + b.readUInt32LE(p + 0x18))
}
// The newest 300 shortcuts are read (by their own time), not the first 300 the folder lists.
async function windowsRecent(signal) {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent')
  const names = (await fsp.readdir(dir)).filter((n) => /\.lnk$/i.test(n) && RECENTLY.includes(path.extname(n.slice(0, -4)).toLowerCase()))
  const timed = []
  for (const n of names.slice(0, 2000)) {
    if (signal?.aborted) break
    const st = await fsp.stat(path.join(dir, n)).catch(() => null)
    if (st) timed.push({ f: path.join(dir, n), at: st.mtimeMs })
  }
  const out = []
  for (const { f, at } of timed.sort((a, b) => b.at - a.at).slice(0, 300)) {
    if (signal?.aborted) break
    const b = await fsp.readFile(f).catch(() => null)
    const file = b && lnkTarget(b)
    if (file) out.push({ file, used: at, changed: null })
  }
  return out
}
// Linux: the desktop's list of recently used files (recently-used.xbel), and when.
async function xbelRecent(home) {
  const x = await fsp.readFile(path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'recently-used.xbel'), 'utf8')
  const out = []
  for (const m of x.matchAll(/<bookmark\b([^>]*)>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((v) => [v[1], v[2]]))
    if (!a.href?.startsWith('file://')) continue
    let file
    try { file = decodeURIComponent(new URL(a.href.replace(/&amp;/g, '&')).pathname) } catch { continue }
    const when = Date.parse(a.visited || a.modified || a.added || '')
    out.push({ file, used: Number.isNaN(when) ? null : when, changed: null })
  }
  return out
}
// Windows and Linux don't stop a look in Documents, Desktop and Downloads (a Mac asks you first, so
// there Spotlight answers for them), nor in the cloud drives' folders in your home: OneDrive (one
// per account on Windows), Dropbox, Google Drive, Box.
async function usualDirs(home) {
  if (process.platform === 'darwin') return []
  const clouds = (await fsp.readdir(home, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && /^(OneDrive|Dropbox|Google Drive|Box)\b/i.test(e.name)).map((e) => e.name)
  return [...['Documents', 'Desktop', 'Downloads'], ...clouds].map((n) => ({ dir: path.join(home, n), usual: true }))
}
// Whether a folder is a project's code: a git repository (its .git a folder, or a file in a worktree).
const isCode = (dir) => fsp.access(path.join(dir, '.git')).then(() => true, () => false)
// The first bytes of a Markdown file, to tell a deck (marp: true in its front matter).
async function headOf(file) {
  const fh = await fsp.open(file, 'r').catch(() => null)
  if (!fh) return ''
  try { const b = Buffer.alloc(600); const { bytesRead } = await fh.read(b, 0, 600, 0); return b.toString('utf8', 0, bytesRead) } catch { return '' } finally { await fh.close().catch(() => {}) }
}
// A look through folders: a few levels down, breadth first, the files of the kinds Studio lists, with
// their kind and when each changed. Each folder gets its share of the time and the entries read, so
// one big project doesn't leave the others unlooked. In a project's code only Word, Excel,
// PowerPoint (any of their formats), PDF files and Markdown decks; what's left out is counted
// (skipped). A Keynote, Pages or Numbers file is a package (a folder) or a zip, never a key file
// that's also named .key. late: it ran out of time before it was through (a folder slow to answer),
// so some files may be missing.
async function look(roots, { signal, until, budget }) {
  const found = []
  let heads = 0, skipped = 0, late = false
  for (let i = 0; i < roots.length; i++) {
    const r = roots[i]
    if (signal?.aborted) break
    if (Date.now() > until) { late = true; break }
    if (!mayLook(r.dir)) continue
    const end = Math.min(until, Date.now() + Math.max(300, (until - Date.now()) / (roots.length - i)))
    r.code = !r.own && !r.usual && await isCode(r.dir)
    let left = Math.max(300, Math.floor(budget / roots.length))
    const queue = [[r.dir, 0]]
    while (queue.length && left > 0 && !signal?.aborted) {
      if (Date.now() > end) { late = true; break }
      const [dir, depth] = queue.shift()
      if (!mayLook(dir)) continue
      let list
      try { list = await fsp.readdir(dir, { withFileTypes: true }) } catch { continue }
      left -= list.length
      for (const e of list) {
        if (e.name.startsWith('.') || e.name.startsWith('~$') || SKIP.has(e.name)) continue
        const p = path.join(dir, e.name)
        const ext = path.extname(e.name).toLowerCase()
        const apple = APPLE.has(ext) && !!OTHER[ext] // a Mac's Keynote, Pages or Numbers, maybe a package
        if (e.isDirectory() && !apple) { if (depth < 3) queue.push([p, depth + 1]) } else if ((e.isFile() || apple) && lists(e.name)) found.push({ file: p, r })
      }
    }
  }
  const out = []
  for (const x of found) {
    if (signal?.aborted || out.length >= 1500) break
    if (Date.now() > until + 1500) { late = true; break }
    const ext = path.extname(x.file).toLowerCase()
    let kind = kindOf(x.file) || otherKind(x.file)
    if (MARKDOWN.has(ext)) kind = heads++ < HEADS ? kindOf(x.file, await headOf(x.file)) : x.r.code ? null : kind
    if (x.r.code && !OFFICE.includes(ext) && !OTHER[ext] && kind !== 'deck') { skipped++; continue }
    const st = await fsp.stat(x.file).catch(() => null)
    if (!st || (APPLE.has(ext) && !st.isDirectory() && !(await headOf(x.file)).startsWith('PK'))) continue
    out.push({ file: x.file, used: null, changed: st.mtimeMs, kind })
  }
  return { list: out, skipped, late }
}

let cache = null // { at, value }
let finding = null
// roots: your agents' folders and your places ([{ root, dir, label }]), so a file in one opens
// through it (and Ask an agent finds the agent working there); own: Studio's own folder (decks made
// from meetings, new files with nowhere else to go). Back: { files, sources, errors, at, capped,
// skipped }, each file { root, path, name, kind, ext, dir, at, used, where, area }, with opens: false
// for a kind Studio doesn't open; capped: how many of a kind there were, when more than PER_KIND;
// skipped: files in projects' code not listed.
export async function found({ roots = [], own = null, home = os.homedir(), signal, fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.value
  if (finding) return finding
  finding = (async () => {
    const sources = []
    const errors = []
    let list = []
    let skipped = 0
    const ctl = new AbortController()
    const stop = () => ctl.abort()
    signal?.addEventListener('abort', stop, { once: true })
    const mine = [...(own ? [{ root: 'studio', dir: own, own: true }] : []), ...roots]
    try {
      if (process.platform === 'darwin') {
        try {
          list = await spotlight(home, ctl.signal)
          sources.push('spotlight')
          if (list.partial) errors.push({ source: 'spotlight', error: 'Spotlight took too long to answer', partial: true })
        } catch (e) { errors.push({ source: 'spotlight', error: e.code === 'ENOENT' ? 'Spotlight isn\'t on this Mac' : e.killed ? 'Spotlight took too long to answer' : String(e.message || e).split('\n')[0] }) }
      } else if (process.platform === 'win32') {
        try { list = await windowsRecent(ctl.signal); sources.push('recent') } catch (e) { errors.push({ source: 'recent', error: e.message }) }
      } else {
        try { list = await xbelRecent(home); sources.push('xbel') } catch (e) { if (e.code !== 'ENOENT') errors.push({ source: 'xbel', error: e.message }) }
      }
      const usual = await usualDirs(home)
      const seen = new Set()
      const dirs = [...mine, ...usual].filter((r) => r.dir && !seen.has(r.dir) && seen.add(r.dir))
      if (dirs.length) {
        const got = await look(dirs, { signal: ctl.signal, until: Date.now() + LOOK_MS, budget: LOOK_FILES })
        list.push(...got.list)
        skipped = got.skipped
        if (own) sources.push('studio')
        if (dirs.some((r) => !r.own)) sources.push('folders')
        if (got.late) errors.push({ source: 'folders', error: 'A folder was slow to answer, and the look ran out of time', partial: true })
      }
    } finally { signal?.removeEventListener('abort', stop) }
    // Each file once (the newest word on it), none in a folder nobody looks in (but Studio's own),
    // newest first.
    const ownDir = own && path.resolve(own)
    const by = new Map()
    for (const x of list) {
      if (!x.file) continue
      const file = path.resolve(x.file)
      const isOwn = ownDir && file.startsWith(ownDir + path.sep)
      if (!lists(file) || (!isOwn && hiddenPath(file, home)) || path.basename(file).startsWith('~$')) continue
      const at = Math.max(x.used || 0, x.changed || 0)
      if (!at) continue
      const was = by.get(file)
      const kind = x.kind || was?.kind || kindOf(file) || otherKind(file)
      if (!was || at > was.at) by.set(file, { file, at, used: x.used || was?.used || null, kind })
      else if (!was.kind || x.kind) was.kind = kind
    }
    // The newest PER_KIND of each kind, and how many there were of a kind with more.
    const counts = {}
    const top = [...by.values()].sort((a, b) => b.at - a.at).filter((x) => (counts[x.kind] = (counts[x.kind] || 0) + 1) <= PER_KIND)
    const capped = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > PER_KIND))
    const dirsFound = await loadFound()
    let added = false
    const inside = [] // the folder of yours each file is in, if any
    const files = top.map((x) => {
      const dir = path.dirname(x.file)
      const r = mine.filter((o) => o.dir && x.file.startsWith(path.resolve(o.dir) + path.sep)).sort((a, b) => b.dir.length - a.dir.length)[0]
      inside.push(r && !r.own ? r.dir : null)
      const name = path.basename(x.file)
      let root, rel
      if (r) { root = r.root; rel = path.relative(r.dir, x.file).split(path.sep).join('/') } else {
        const key = dirKey(dir)
        if (dirsFound.get(key) !== dir) { dirsFound.set(key, dir); added = true }
        root = `found:${key}`
        rel = name
      }
      return { root, path: rel, name, kind: x.kind, ext: path.extname(name).toLowerCase(), dir: tilde(dir, home), at: new Date(x.at).toISOString(), used: !!x.used, where: r?.own ? null : r?.label || null, area: areaOf(x.file, home, r), ...(opens(name) ? {} : { opens: false }) }
    })
    // Two projects or places of the same name, in two folders: each named with its folder too.
    const dirsOf = new Map()
    files.forEach((f, i) => { if (inside[i]) dirsOf.set(f.area.name, new Set([...(dirsOf.get(f.area.name) || []), inside[i]])) })
    files.forEach((f, i) => { if (inside[i] && dirsOf.get(f.area.name).size > 1) f.area = { ...f.area, name: `${f.area.name} (${path.basename(inside[i])})` } })
    if (added) { await fsp.mkdir(DIR, { recursive: true }); writeFileAtomic(FOUND, JSON.stringify({ dirs: Object.fromEntries([...dirsFound].slice(-400)) }, null, 1)) }
    const value = { files, sources, errors, at: new Date().toISOString(), capped, skipped, perKind: PER_KIND }
    if (!ctl.signal.aborted) cache = { at: Date.now(), value }
    return value
  })().finally(() => { finding = null })
  return finding
}
// A folder added (a place): looked through again next time.
export const forgetFound = () => { cache = null }

// ---------- Edit in place ----------
// Part of a document rewritten as asked (shorter, longer, plainer…) by the model picked for Studio,
// else the one the app reaches first; the page shows the change before you take it. The text around
// it goes too, so the new words fit.
const REWRITE_SYSTEM = 'You edit part of a document as asked. You get the instruction and the part to change, and the text around it for context. Answer with the new text for that part only: no quotes around it, no notes, nothing before or after it, and no Markdown the part didn\'t have. Keep its language unless the instruction asks for another. Keep paragraphs apart with a blank line, as the part has them.'
export const REWRITE_MAX = 20_000
export async function rewrite({ text, instruction, before = '', after = '', name = '', model, reply }) {
  const t = String(text || '')
  const said = String(instruction || '').trim()
  if (!t.trim()) throw new Error('Pick the words to change first')
  if (!said) throw new Error('Say how to change them')
  if (t.length > REWRITE_MAX) throw new Error('That\'s more than Studio rewrites at once (20,000 characters). Pick less of it.')
  if (!model) throw Object.assign(new Error('There\'s no model to write with. Sign in to an agent like Claude Code, or add a model in Settings › Model Providers.'), { code: 'no-model', status: 409 })
  const around = [
    name && `The document is ${String(name).slice(0, 200)}.`,
    before && `Just before the part:\n"""\n${String(before).slice(-1500)}\n"""`,
    after && `Just after it:\n"""\n${String(after).slice(0, 1000)}\n"""`,
  ].filter(Boolean).join('\n\n')
  const r = await reply(model, [{ role: 'user', text: `Instruction: ${said.slice(0, 2000)}\n\nText:\n${t}` }], { system: `${REWRITE_SYSTEM}${around ? `\n\n${around}` : ''}`, feature: 'studio' })
  let out = String(r?.text || '').trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(out)
  if (fenced) out = fenced[1].trim()
  if (/^["“'][\s\S]*["”']$/.test(out) && !/^["“']/.test(t.trim())) out = out.slice(1, -1).trim()
  if (!out) throw new Error('The model sent back nothing')
  return { text: out }
}
