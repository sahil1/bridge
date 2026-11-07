// Studio's home: the documents, sheets, decks and PDFs you've used lately, wherever they are, beside
// what you opened in Studio. And editing in place: part of a document rewritten as asked.
//
// Looked for only when Studio's home asks (never before Studio is opened), without waiting on your
// folders: macOS's Spotlight (its own index of what you opened and changed, so nothing in Documents,
// Desktop or Downloads is read and macOS asks nothing), Windows' Recent items, Linux's recently-used
// list; then a short look through your agents' folders and the places you added to Files, a few
// levels down, for so long, through so many files. Kept a minute. A file found outside those folders
// opens through its own folder (found:<key>), which only a folder found this way can be.
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { DATA, writeFileAtomic } from './paths.js'
import { opens, kindOf } from './studio.js'

const DIR = path.join(DATA, 'studio')
const FOUND = path.join(DIR, 'found.json')
const RECENTLY = ['.docx', '.xlsx', '.xlsm', '.pptx', '.pdf', '.md', '.csv']
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv', 'Library', 'Pods', 'DerivedData', '.next', '.cache', 'coverage', 'AppData'])
const LOOK_MS = 2500 // the longest the look through folders takes
const LOOK_FILES = 4000 // the most entries it reads
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
const hiddenPath = (p, home) => tilde(p, home).split(/[\\/]/).some((s) => (s.startsWith('.') && s !== '.' && s !== '~') || SKIP.has(s))

// Spotlight: what you opened in the last 60 days or changed in the last 30, in your home folder, and
// when (its attributes, so no file is read).
function spotlight(home, signal) {
  const named = (exts) => exts.map((e) => `kMDItemFSName == "*${e}"c`).join(' || ')
  const query = `((${named(['.docx', '.xlsx', '.xlsm', '.pptx', '.pdf'])}) && (kMDItemLastUsedDate >= $time.today(-60) || kMDItemFSContentChangeDate >= $time.today(-30))) || ((${named(['.md', '.csv'])}) && kMDItemLastUsedDate >= $time.today(-60))`
  return new Promise((resolve, reject) => {
    const kid = execFile('mdfind', ['-onlyin', home, '-attr', 'kMDItemLastUsedDate', '-attr', 'kMDItemFSContentChangeDate', query], { timeout: 6000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err && !out) return reject(err)
      const date = (s) => { const d = s && s !== '(null)' ? new Date(s.replace(/^(\S+) (\S+) ([+-]\d{2})(\d{2})$/, '$1T$2$3:$4')) : null; return d && !Number.isNaN(d.getTime()) ? d.getTime() : null }
      const files = []
      for (const line of String(out || '').split('\n')) {
        if (!line.trim()) continue
        const [file, ...attrs] = line.split(/ {3}(?=kMDItem\w+ = )/)
        const v = Object.fromEntries(attrs.map((a) => /^(kMDItem\w+) = (.*)$/.exec(a.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]))
        files.push({ file, used: date(v.kMDItemLastUsedDate), changed: date(v.kMDItemFSContentChangeDate) })
      }
      resolve(files)
    })
    signal?.addEventListener('abort', () => kid.kill(), { once: true })
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
async function windowsRecent(signal) {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent')
  const names = (await fsp.readdir(dir)).filter((n) => /\.lnk$/i.test(n) && RECENTLY.includes(path.extname(n.slice(0, -4)).toLowerCase()))
  const out = []
  for (const n of names.slice(0, 300)) {
    if (signal?.aborted) break
    const f = path.join(dir, n)
    const [b, st] = await Promise.all([fsp.readFile(f).catch(() => null), fsp.stat(f).catch(() => null)])
    const file = b && lnkTarget(b)
    if (file && st) out.push({ file, used: st.mtimeMs, changed: null })
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
// A look through folders: a few levels down, the files of the kinds Studio opens, with when each
// changed; bounded by time and by how many entries it reads.
async function look(dirs, { signal, until, budget }) {
  const out = []
  const walk = async (dir, depth) => {
    if (depth > 3 || signal?.aborted || Date.now() > until || budget.n <= 0) return
    let list
    try { list = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    budget.n -= list.length
    const sub = []
    for (const e of list) {
      if (e.name.startsWith('.') || e.name.startsWith('~$') || SKIP.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) sub.push(p)
      else if (e.isFile() && opens(e.name)) out.push(p)
    }
    for (const s of sub) await walk(s, depth + 1)
  }
  for (const d of dirs) await walk(d, 0)
  const withTimes = []
  for (const f of out.slice(0, 800)) {
    if (signal?.aborted || Date.now() > until + 1000) break
    const st = await fsp.stat(f).catch(() => null)
    if (st) withTimes.push({ file: f, used: null, changed: st.mtimeMs })
  }
  return withTimes
}

let cache = null // { at, value }
let finding = null
// roots: your agents' folders and your places ([{ root, dir, label }]), so a file in one opens
// through it (and Ask an agent finds the agent working there). Back: { files, sources, errors, at },
// each file { root, path, name, kind, ext, dir, at, used, where }.
export async function found({ roots = [], home = os.homedir(), signal, fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.value
  if (finding) return finding
  finding = (async () => {
    const sources = []
    const errors = []
    let list = []
    const ctl = new AbortController()
    const stop = () => ctl.abort()
    signal?.addEventListener('abort', stop, { once: true })
    try {
      if (process.platform === 'darwin') {
        try { list = await spotlight(home, ctl.signal); sources.push('spotlight') } catch (e) { errors.push({ source: 'spotlight', error: e.code === 'ENOENT' ? 'Spotlight isn\'t on this Mac' : e.killed ? 'Spotlight took too long to answer' : String(e.message || e).split('\n')[0] }) }
      } else if (process.platform === 'win32') {
        try { list = await windowsRecent(ctl.signal); sources.push('recent') } catch (e) { errors.push({ source: 'recent', error: e.message }) }
      } else {
        try { list = await xbelRecent(home); sources.push('xbel') } catch (e) { if (e.code !== 'ENOENT') errors.push({ source: 'xbel', error: e.message }) }
      }
      // Windows and Linux don't stop a look in Documents, Desktop and Downloads; a Mac asks you
      // first, so there Spotlight answers for them instead.
      const usual = process.platform === 'darwin' ? [] : ['Documents', 'Desktop', 'Downloads'].map((n) => path.join(home, n))
      const dirs = [...new Set([...roots.map((r) => r.dir), ...usual])].filter(Boolean)
      if (dirs.length) { list.push(...await look(dirs, { signal: ctl.signal, until: Date.now() + LOOK_MS, budget: { n: LOOK_FILES } })); sources.push('folders') }
    } finally { signal?.removeEventListener('abort', stop) }
    // Each file once (the newest word on it), none in a folder nobody looks in, newest first.
    const by = new Map()
    for (const x of list) {
      if (!x.file) continue
      const file = path.resolve(x.file)
      if (!opens(file) || hiddenPath(file, home) || path.basename(file).startsWith('~$')) continue
      const at = Math.max(x.used || 0, x.changed || 0)
      if (!at) continue
      const was = by.get(file)
      if (!was || at > was.at) by.set(file, { file, at, used: x.used || was?.used || null })
    }
    const top = [...by.values()].sort((a, b) => b.at - a.at).slice(0, 80)
    const dirsFound = await loadFound()
    let added = false
    const files = top.map((x) => {
      const dir = path.dirname(x.file)
      const r = roots.filter((o) => o.dir && x.file.startsWith(o.dir + path.sep)).sort((a, b) => b.dir.length - a.dir.length)[0]
      const name = path.basename(x.file)
      let root, rel
      if (r) { root = r.root; rel = path.relative(r.dir, x.file).split(path.sep).join('/') } else {
        const key = dirKey(dir)
        if (dirsFound.get(key) !== dir) { dirsFound.set(key, dir); added = true }
        root = `found:${key}`
        rel = name
      }
      return { root, path: rel, name, kind: kindOf(name), ext: path.extname(name).toLowerCase(), dir: tilde(dir, home), at: new Date(x.at).toISOString(), used: !!x.used, where: r?.label || null }
    })
    if (added) { await fsp.mkdir(DIR, { recursive: true }); writeFileAtomic(FOUND, JSON.stringify({ dirs: Object.fromEntries([...dirsFound].slice(-400)) }, null, 1)) }
    const value = { files, sources, errors, at: new Date().toISOString() }
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
