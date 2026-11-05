// Studio: documents, sheets, decks, PDFs and pages, from any folder Files shows (an agent's, a place
// you added), opened, edited and saved here, on this computer or, through its window, another of
// yours. Every version is kept: yours, an agent's (Ask an agent) and a change from outside, each a
// copy in <data>/studio/versions, newest first, to look at, compare and put back. Files stay where
// they are and stay theirs (Word, Excel, PowerPoint, Markdown, HTML), so anything else opens them too.
// Reads and writes are all async: the folder may be in Documents, where macOS can hold a read.
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA, writeFileAtomic } from './paths.js'
import { safePath } from './files.js'

const DIR = path.join(DATA, 'studio')
const VERSIONS = path.join(DIR, 'versions')
const RECENT = path.join(DIR, 'recent.json')

// What Studio opens, by kind: doc (Word, Markdown, text), sheet (Excel, CSV), deck (PowerPoint, and
// a Markdown deck: marp: true in its front matter), pdf, page (HTML).
const KINDS = {
  '.docx': 'doc', '.md': 'doc', '.markdown': 'doc', '.txt': 'doc',
  '.xlsx': 'sheet', '.xlsm': 'sheet', '.csv': 'sheet', '.tsv': 'sheet',
  '.pptx': 'deck', '.pdf': 'pdf', '.html': 'page', '.htm': 'page',
}
const TEXT = new Set(['.md', '.markdown', '.txt', '.csv', '.tsv', '.html', '.htm'])
export const kindOf = (name, head = '') => {
  const ext = path.extname(String(name)).toLowerCase()
  if ((ext === '.md' || ext === '.markdown') && /^---\s*\n[\s\S]*?\bmarp:\s*true\b[\s\S]*?\n---/.test(head)) return 'deck'
  return KINDS[ext] || null
}
export const opens = (name) => !!KINDS[path.extname(String(name)).toLowerCase()]

const MAX_BYTES = 80 * 1024 * 1024
const KEEP = 60 // versions per file
const MAX_ALL = 2 * 1024 ** 3 // all the copies together
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)
const keyOf = (real) => crypto.createHash('sha1').update(real).digest('hex').slice(0, 20)
const readJSON = async (f, d) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')) } catch { return d } }

// A file Studio may open: inside the root Files gave (an agent's folder, a place), and a kind it knows.
async function locate(root, rel) {
  const { real, rel: r } = await safePath(root, rel)
  const st = await fsp.stat(real)
  if (!st.isFile()) throw new Error('Not a file')
  if (!opens(real)) throw new Error("Studio doesn't open this kind of file")
  if (st.size > MAX_BYTES) throw new Error('Too big for Studio (80 MB at most)')
  return { real, rel: r, st }
}

// ---------- Versions ----------
const indexOf = (real) => path.join(VERSIONS, keyOf(real), 'index.json')
const versionsOf = async (real) => (await readJSON(indexOf(real), { path: real, versions: [] })).versions
// The file as it is now, kept as a version unless the newest one is the same. by: you, agent (with
// its name), outside (changed by something else), restored.
const snapping = new Map() // real -> promise: one at a time per file
function snapshot(real, by, { name = null, buf = null } = {}) {
  const run = (snapping.get(real) || Promise.resolve()).then(async () => {
    const data = buf || await fsp.readFile(real)
    const h = hash(data)
    const idx = await readJSON(indexOf(real), { path: real, versions: [] })
    if (idx.versions[0]?.hash === h) return idx.versions[0]
    const dir = path.dirname(indexOf(real))
    await fsp.mkdir(dir, { recursive: true })
    const id = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
    const file = `${id}${path.extname(real).toLowerCase()}`
    await fsp.writeFile(path.join(dir, file), data)
    const v = { id, at: new Date().toISOString(), by, ...(name ? { name: String(name).slice(0, 80) } : {}), size: data.length, hash: h, file }
    idx.path = real
    idx.versions = [v, ...idx.versions]
    for (const old of idx.versions.splice(KEEP)) await fsp.rm(path.join(dir, old.file), { force: true }).catch(() => {})
    writeFileAtomic(indexOf(real), JSON.stringify(idx, null, 1))
    prune().catch(() => {})
    return v
  })
  snapping.set(real, run.catch(() => {}))
  return run
}
// All the copies together over MAX_ALL: the oldest go, never a file's newest.
let pruning = null
function prune() {
  if (pruning) return pruning
  pruning = (async () => {
    let dirs = []
    try { dirs = await fsp.readdir(VERSIONS) } catch { return }
    const all = []
    for (const d of dirs) {
      const idx = await readJSON(path.join(VERSIONS, d, 'index.json'), null)
      idx?.versions?.slice(1).forEach((v) => all.push({ d, v, idx }))
    }
    let total = 0
    for (const d of dirs) for (const v of (await readJSON(path.join(VERSIONS, d, 'index.json'), { versions: [] })).versions) total += v.size || 0
    all.sort((a, b) => a.v.at.localeCompare(b.v.at))
    const touched = new Set()
    while (total > MAX_ALL && all.length) {
      const { d, v, idx } = all.shift()
      await fsp.rm(path.join(VERSIONS, d, v.file), { force: true }).catch(() => {})
      idx.versions = idx.versions.filter((x) => x.id !== v.id)
      total -= v.size || 0
      touched.add(idx)
    }
    for (const idx of touched) writeFileAtomic(path.join(VERSIONS, keyOf(idx.path), 'index.json'), JSON.stringify(idx, null, 1))
  })().finally(() => { pruning = null })
  return pruning
}
const shown = (vs) => vs.map(({ id, at, by, name, size }) => ({ id, at, by, name: name || null, size }))

// ---------- Asked of an agent ----------
// An edit asked of an agent: the change to the file that comes next is its version, with its name.
const asked = new Map() // real -> { name, at }
const ASK_MS = 30 * 60_000
const whoChanged = (real) => { const a = asked.get(real); return a && Date.now() - a.at < ASK_MS ? { by: 'agent', name: a.name } : { by: 'outside' } }

// The message for an agent: what to change, where, the part meant, and how to keep the file a
// proper Word, Excel or PowerPoint file.
const HOW = {
  doc: (ext) => (ext === '.docx' ? 'It\'s a Word file: change it in place with a library that keeps its formatting (python-docx, or docx for Node), not by rewriting it as text.' : ''),
  sheet: (ext) => (ext === '.xlsx' || ext === '.xlsm' ? 'It\'s an Excel file: change it with a library that keeps its formulas and formatting (openpyxl, or ExcelJS for Node).' : ''),
  deck: (ext) => (ext === '.pptx' ? 'It\'s a PowerPoint file: change it with a library that keeps its layouts (python-pptx, or PptxGenJS for a new deck).' : 'It\'s a Markdown deck (Marp): slides are separated by lines of ---.'),
  pdf: () => 'It\'s a PDF: say what you\'d change, or make the change in the file it was made from.',
  page: () => 'It\'s an HTML page: keep it one file that works on its own.',
}
export function askText({ rel, kind, instruction, selection, where }) {
  const ext = path.extname(rel).toLowerCase()
  return [
    `In ${rel}: ${String(instruction || '').trim()}`,
    selection ? `The part I mean${where ? ` (${where})` : ''}:\n"""\n${String(selection).slice(0, 4000)}\n"""` : '',
    HOW[kind]?.(ext) || '',
    'Edit the file itself and save it: I have it open in Studio, which shows your change.',
  ].filter(Boolean).join('\n\n')
}
export function noteAsk(root, rel, name) {
  return safePath(root, rel).then(({ real }) => { asked.set(real, { name: String(name || 'an agent').slice(0, 80), at: Date.now() }) })
}

// ---------- Opening, saving, watching ----------
const recent = async () => (await readJSON(RECENT, { files: [] })).files
async function remember(entry) {
  const files = [entry, ...(await recent()).filter((f) => !(f.root === entry.root && f.path === entry.path))].slice(0, 40)
  await fsp.mkdir(DIR, { recursive: true })
  writeFileAtomic(RECENT, JSON.stringify({ files }, null, 1))
}
export const recentFiles = recent
export async function forget(root, rel) {
  const files = (await recent()).filter((f) => !(f.root === root && f.path === rel))
  writeFileAtomic(RECENT, JSON.stringify({ files }, null, 1))
  return { files }
}

// A file opened: what it is, and its versions. A change since its newest version (made while it
// wasn't open) is kept first, as from outside (or the agent asked). rootId: how the app names its
// root (a pane, place:<id>), kept in Recent.
export async function open(root, rel, { rootId = null, label = null } = {}) {
  const { real, rel: r, st } = await locate(root, rel)
  const head = TEXT.has(path.extname(real).toLowerCase()) ? (await fsp.readFile(real, 'utf8')).slice(0, 2000) : ''
  const kind = kindOf(real, head)
  const vs = await versionsOf(real)
  const w = whoChanged(real)
  const now = await snapshot(real, vs.length ? w.by : 'opened', { name: w.name })
  if (w.by === 'agent' && now?.by === 'agent') asked.delete(real)
  if (rootId) remember({ root: String(rootId), path: r, name: path.basename(real), kind, at: new Date().toISOString(), ...(label ? { where: String(label).slice(0, 120) } : {}) }).catch(() => {})
  return { path: r, name: path.basename(real), kind, ext: path.extname(real).toLowerCase(), size: st.size, mtime: st.mtimeMs, versions: shown(await versionsOf(real)) }
}

// Saved from Studio: only if nobody changed it since you opened it (mtime: what you loaded),
// unless force. What was there is kept first, if it isn't already.
export async function save(root, rel, buf, { mtime, force = false } = {}) {
  if (!Buffer.isBuffer(buf)) throw new Error('Expected the file')
  if (buf.length > MAX_BYTES) throw new Error('Too big to save (80 MB at most)')
  const { real, st } = await locate(root, rel)
  if (!force && mtime != null && Math.abs(st.mtimeMs - Number(mtime)) > 1) {
    throw Object.assign(new Error('The file changed since you opened it (an agent, or another app). Open its newest version, or save yours over it.'), { conflict: true, status: 409 })
  }
  const w = whoChanged(real)
  await snapshot(real, w.by, { name: w.name })
  await fsp.writeFile(real, buf)
  await snapshot(real, 'you', { buf })
  const after = await fsp.stat(real)
  return { mtime: after.mtimeMs, size: after.size, versions: shown(await versionsOf(real)) }
}

// Has it changed since `since` (its mtime when you loaded it)? Then the change is kept as a version,
// by the agent asked or from outside, and the page offers to show it.
export async function changed(root, rel, since) {
  const { real, st } = await locate(root, rel)
  if (since == null || Math.abs(st.mtimeMs - Number(since)) <= 1) return { changed: false, mtime: st.mtimeMs }
  const w = whoChanged(real)
  const v = await snapshot(real, w.by, { name: w.name })
  if (w.by === 'agent') asked.delete(real)
  return { changed: true, mtime: st.mtimeMs, size: st.size, by: v?.by || w.by, name: v?.name || null, versions: shown(await versionsOf(real)) }
}

export async function versions(root, rel) {
  const { real } = await locate(root, rel)
  return { versions: shown(await versionsOf(real)) }
}
// One version's copy, to show or download.
export async function versionFile(root, rel, id) {
  const { real } = await locate(root, rel)
  const v = (await versionsOf(real)).find((x) => x.id === String(id))
  if (!v) throw new Error('No such version')
  return { file: path.join(path.dirname(indexOf(real)), v.file), name: `${path.basename(real, path.extname(real))} (${v.at.slice(0, 16).replace('T', ' ')})${path.extname(real)}`, version: v }
}
// Put an older version back: what's there now is kept first, so this can be undone too.
export async function restore(root, rel, id) {
  const { real } = await locate(root, rel)
  const { file } = await versionFile(root, rel, id)
  const w = whoChanged(real)
  await snapshot(real, w.by, { name: w.name })
  const data = await fsp.readFile(file)
  await fsp.writeFile(real, data)
  await snapshot(real, 'restored', { buf: data })
  const st = await fsp.stat(real)
  return { mtime: st.mtimeMs, size: st.size, versions: shown(await versionsOf(real)) }
}

// A new file in a folder (relative to root), from the start the page made for it (buf), or empty
// text. A name already taken gets " 2", " 3"... so nothing is overwritten.
export async function create(root, dirRel, name, buf = Buffer.from('')) {
  const { real: dir } = await safePath(root, dirRel || '')
  const st = await fsp.stat(dir)
  if (!st.isDirectory()) throw new Error('Not a folder')
  const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120)
  if (!clean || !opens(clean)) throw new Error('A name ending in .docx, .md, .xlsx, .csv, .pptx or .html')
  const ext = path.extname(clean), stem = clean.slice(0, -ext.length)
  let file = path.join(dir, clean)
  for (let n = 2; await fsp.access(file).then(() => true, () => false); n++) file = path.join(dir, `${stem} ${n}${ext}`)
  await fsp.writeFile(file, buf, { flag: 'wx' })
  return { path: path.relative((await safePath(root, '')).realRoot, file), name: path.basename(file) }
}

// ---------- Design packs ----------
// Your look, once, for everything Studio makes: a pack's colours (background, text, accent), its
// fonts (headings, body) and a logo (a small picture, kept here). The default one goes on new decks
// and their PowerPoints; a deck names another in its front matter (pack: Name). Kept in
// <data>/studio/packs.json, on this computer.
const PACKS = path.join(DIR, 'packs.json')
const HEX = /^#[0-9a-f]{6}$/i
const cleanPack = (p, was = {}) => {
  const colors = Object.fromEntries(['background', 'text', 'accent', 'muted'].map((k) => [k, HEX.test(p?.colors?.[k] || '') ? p.colors[k] : was.colors?.[k] || null]).filter(([, v]) => v))
  const fonts = Object.fromEntries(['heading', 'body'].map((k) => [k, String(p?.fonts?.[k] ?? was.fonts?.[k] ?? '').replace(/[^\w \-,'"]/g, '').slice(0, 80)]).filter(([, v]) => v))
  const logo = p?.logo === null ? null : /^data:image\/(png|jpe?g|svg\+xml|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(String(p?.logo || '')) && String(p.logo).length < 400_000 ? p.logo : was.logo || null
  return { id: was.id || crypto.randomBytes(5).toString('hex'), name: String(p?.name ?? was.name ?? 'My pack').trim().slice(0, 60) || 'My pack', colors, fonts, logo, isDefault: p?.isDefault ?? was.isDefault ?? false, at: new Date().toISOString() }
}
export const packs = async () => (await readJSON(PACKS, { packs: [] })).packs
async function keepPacks(list) {
  await fsp.mkdir(DIR, { recursive: true })
  writeFileAtomic(PACKS, JSON.stringify({ packs: list }, null, 1))
  return { packs: list }
}
export async function savePack(p) {
  const list = await packs()
  const was = p?.id ? list.find((x) => x.id === p.id) : null
  if (p?.id && !was) throw new Error('No such design pack')
  const pack = cleanPack(p, was || {})
  if (!list.length) pack.isDefault = true
  const next = was ? list.map((x) => (x.id === pack.id ? pack : x)) : [...list, pack]
  return keepPacks(pack.isDefault ? next.map((x) => ({ ...x, isDefault: x.id === pack.id })) : next)
}
export async function removePack(id) {
  const list = (await packs()).filter((x) => x.id !== id)
  if (list.length && !list.some((x) => x.isDefault)) list[0].isDefault = true
  return keepPacks(list)
}
