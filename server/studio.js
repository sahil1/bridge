// Studio: documents, sheets, decks, PDFs and pages, from any folder Files shows (an agent's, a place
// you added), opened, edited and saved here, on this computer or, through its window, another of
// yours. Every version is kept: yours, an agent's (Ask an agent) and a change from outside, each a
// copy in <data>/studio/versions, newest first, to look at, compare and put back. Files stay where
// they are and stay theirs (Word, Excel, PowerPoint, Markdown, HTML), so anything else opens them too.
// Reads and writes are all async: the folder may be in Documents, where macOS can hold a read.
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { DATA, writeFileAtomic } from './paths.js'
import { safePath } from './files.js'
import * as doctext from './doctext.js'

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

// One at a time per key: each waits for the one before it to finish.
function queue() {
  const last = new Map() // key -> the last one's promise
  return (key, fn) => {
    const run = (last.get(key) || Promise.resolve()).then(fn)
    const tail = run.catch(() => {})
    last.set(key, tail)
    tail.then(() => { if (last.get(key) === tail) last.delete(key) })
    return run
  }
}

// ---------- Versions ----------
const indexOf = (real) => path.join(VERSIONS, keyOf(real), 'index.json')
// A file's list of versions (its index.json), read and written one at a time: a look at the list
// waits for a version being kept, so it never meets the list half written, nor holds it open while
// it's replaced (Windows refuses that, and the look came back empty). A list that can't be read
// is an error, never an empty one, which the next version would be kept over, losing the others;
// one that isn't JSON any more is put aside (its copies stay), and a new one started.
const inIndex = queue()
async function readIndex(file) {
  for (let i = 0; ; i++) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')) } catch (e) {
      if (e.code === 'ENOENT') return { versions: [] }
      if (i < 3) { await new Promise((r) => setTimeout(r, 100 * (i + 1))); continue }
      if (!(e instanceof SyntaxError)) throw new Error(`Couldn't read this file's versions: ${e.message}`)
      await fsp.rename(file, `${file}.${Date.now()}.unreadable`).catch(() => {})
      return { versions: [] }
    }
  }
}
const versionsOf = (real) => inIndex(indexOf(real), () => readIndex(indexOf(real))).then((idx) => idx.versions)
// The file as it is now, kept as a version unless the newest one is the same. by: you, agent (with
// its name), outside (changed by something else), restored. auto: saved as you typed (a document
// saves itself): one version for each few minutes of typing, the newest of them, so typing for
// an hour keeps a handful, not hundreds; a save of yours (Save, ⌘S) keeps the one it's at.
const MERGE_MS = 10 * 60_000
function snapshot(real, by, { name = null, buf = null, auto = false } = {}) {
  return inIndex(indexOf(real), async () => {
    const data = buf || await fsp.readFile(real)
    const h = hash(data)
    const idx = await readIndex(indexOf(real))
    const top = idx.versions[0]
    if (top?.hash === h) {
      if (by === 'you' && buf && !auto && top.auto) { delete top.auto; delete top.since; writeFileAtomic(indexOf(real), JSON.stringify(idx, null, 1)) }
      return top
    }
    const dir = path.dirname(indexOf(real))
    await fsp.mkdir(dir, { recursive: true })
    const id = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
    const file = `${id}${path.extname(real).toLowerCase()}`
    await fsp.writeFile(path.join(dir, file), data)
    const at = new Date().toISOString()
    const merge = auto && by === 'you' && top?.by === 'you' && top.auto && Date.now() - Date.parse(top.since || top.at) < MERGE_MS
    const v = { id, at, by, ...(name ? { name: String(name).slice(0, 80) } : {}), size: data.length, hash: h, file, ...(auto ? { auto: true, since: merge ? top.since || top.at : at } : {}) }
    idx.path = real
    idx.versions = merge ? [v, ...idx.versions.slice(1)] : [v, ...idx.versions]
    const dropped = [...(merge ? [top] : []), ...idx.versions.splice(KEEP)]
    writeFileAtomic(indexOf(real), JSON.stringify(idx, null, 1))
    // Their copies only once the list no longer names them.
    for (const old of dropped) await fsp.rm(path.join(dir, old.file), { force: true }).catch(() => {})
    prune().catch(() => {})
    return v
  })
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
    const gone = new Map() // folder -> the ids of its versions to go
    while (total > MAX_ALL && all.length) {
      const { d, v } = all.shift()
      gone.set(d, (gone.get(d) || new Set()).add(v.id))
      total -= v.size || 0
    }
    // Each file's list taken as it is by then (a version kept meanwhile stays on it), in its turn.
    for (const [d, ids] of gone) {
      const file = path.join(VERSIONS, d, 'index.json')
      await inIndex(file, async () => {
        const idx = await readIndex(file)
        const out = idx.versions.filter((x) => ids.has(x.id))
        idx.versions = idx.versions.filter((x) => !ids.has(x.id))
        writeFileAtomic(file, JSON.stringify(idx, null, 1))
        for (const v of out) await fsp.rm(path.join(VERSIONS, d, v.file), { force: true }).catch(() => {})
      }).catch(() => {})
    }
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
  deck: (ext) => (ext === '.pptx' ? 'It\'s a PowerPoint file: change it with a library that keeps its layouts (python-pptx, or PptxGenJS for a new deck).' : 'It\'s a Markdown deck (Marp): slides are separated by lines of ---, and a slide\'s layout is a class directive on it (<!-- _class: title -->; also section, stats, cols, quote, image, picture). Keep its front matter.'),
  pdf: () => 'It\'s a PDF: say what you\'d change, or make the change in the file it was made from.',
  page: () => 'It\'s an HTML page: keep it one file that works on its own.',
}
export function askText({ rel, kind, instruction, selection, where, propose = false }) {
  const ext = path.extname(rel).toLowerCase()
  return [
    `In ${rel}: ${String(instruction || '').trim()}`,
    selection ? `The part I mean${where ? ` (${where})` : ''}:\n"""\n${String(selection).slice(0, 4000)}\n"""` : '',
    propose && PROPOSE[kind] ? PROPOSE[kind](proposalName(rel)) : HOW[kind]?.(ext) || '',
    propose && PROPOSE[kind] ? '' : 'Edit the file itself and save it: I have it open in Studio, which shows your change.',
  ].filter(Boolean).join('\n\n')
}

// ---------- A change shown before it's made ----------
// Asked "in place" (a sheet's AI Assist), the agent doesn't edit the file: it writes the change as
// JSON beside it (a dot file in the same folder, where any agent may write), Studio shows it on
// the open file, and you keep it or not. Taken once: read, then deleted.
const proposalName = (rel) => `.${path.basename(rel)}.studio-change.json`
const PROPOSE = {
  sheet: (name) => [
    `Don't change the file itself. Write your change as JSON to ${name} in the same folder as it, and nothing else; Studio shows it to me on the sheet, and makes it if I keep it:`,
    '{"summary": "what this does, in one sentence", "sheet": "the sheet\'s name", "cells": {"D2": "=B2*C2", "D1": "Total", "B7": 42}, "answer": "for a question: the answer, in a few sentences", "chart": {"type": "column|bar|line|pie", "title": "…", "range": "A1:B7"}}',
    'Only what the change needs: "cells" maps A1 references to their new contents (a formula starts with =, numbers as numbers, "" empties a cell), "answer" is for a question (a summary of the cells, say), "chart" for a chart of a range whose first column is the labels and first row the series names. Read the file yourself if you need more of it than the part above.',
  ].join('\n'),
}
export async function takeProposal(root, rel) {
  const { real } = await locate(root, rel)
  const file = path.join(path.dirname(real), proposalName(real))
  let text
  try { text = await fsp.readFile(file, 'utf8') } catch { return { proposal: null } }
  await fsp.rm(file, { force: true }).catch(() => {})
  if (text.length > 2 * 1024 * 1024) return { proposal: null, error: 'The agent\'s change was too big to show (2 MB at most)' }
  try { return { proposal: JSON.parse(text) } } catch (e) { return { proposal: null, error: `The agent's change isn't JSON Studio can read: ${e.message}` } }
}
// One left from an earlier ask isn't taken as the answer to a new one.
export async function dropProposal(root, rel) {
  const { real } = await locate(root, rel)
  await fsp.rm(path.join(path.dirname(real), proposalName(real)), { force: true }).catch(() => {})
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

// Studio's writes to a file (a save, a version put back) and the looks at whether it changed, one
// at a time per file: a look never sees a save half written, or written and not yet kept as yours
// (it took it for a change from outside, and kept a version by "outside" of your own save).
const inTurn = queue()

// Saved from Studio: only if nobody changed it since you opened it (mtime: what you loaded),
// unless force. What was there is kept first, if it isn't already. auto: saved as you typed.
export async function save(root, rel, buf, { mtime, force = false, auto = false } = {}) {
  if (!Buffer.isBuffer(buf)) throw new Error('Expected the file')
  if (buf.length > MAX_BYTES) throw new Error('Too big to save (80 MB at most)')
  const { real } = await locate(root, rel)
  return inTurn(real, async () => {
    const st = await fsp.stat(real)
    if (!force && mtime != null && Math.abs(st.mtimeMs - Number(mtime)) > 1) {
      throw Object.assign(new Error('The file changed since you opened it (an agent, or another app). Open its newest version, or save yours over it.'), { conflict: true, status: 409 })
    }
    const w = whoChanged(real)
    await snapshot(real, w.by, { name: w.name })
    await fsp.writeFile(real, buf)
    await snapshot(real, 'you', { buf, auto })
    const after = await fsp.stat(real)
    return { mtime: after.mtimeMs, size: after.size, versions: shown(await versionsOf(real)) }
  })
}

// Has it changed since `since` (its mtime when you loaded it)? Then the change is kept as a version,
// by the agent asked or from outside, and the page offers to show it.
export async function changed(root, rel, since) {
  const { real } = await locate(root, rel)
  return inTurn(real, async () => {
    const st = await fsp.stat(real)
    if (since == null || Math.abs(st.mtimeMs - Number(since)) <= 1) return { changed: false, mtime: st.mtimeMs }
    const w = whoChanged(real)
    const v = await snapshot(real, w.by, { name: w.name })
    if (w.by === 'agent') asked.delete(real)
    return { changed: true, mtime: st.mtimeMs, size: st.size, by: v?.by || w.by, name: v?.name || null, versions: shown(await versionsOf(real)) }
  })
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
  return inTurn(real, async () => {
    const w = whoChanged(real)
    await snapshot(real, w.by, { name: w.name })
    const data = await fsp.readFile(file)
    await fsp.writeFile(real, data)
    await snapshot(real, 'restored', { buf: data })
    const st = await fsp.stat(real)
    return { mtime: st.mtimeMs, size: st.size, versions: shown(await versionsOf(real)) }
  })
}

// A new file in a folder (relative to root), from the start the page made for it (buf), or empty
// text. A name already taken gets " 2", " 3"... so nothing is overwritten; a copy Studio makes,
// "<name> (Studio)", gets "(Studio 2)".
export async function create(root, dirRel, name, buf = Buffer.from('')) {
  const { real: dir } = await safePath(root, dirRel || '')
  const st = await fsp.stat(dir)
  if (!st.isDirectory()) throw new Error('Not a folder')
  const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120)
  if (!clean || !opens(clean)) throw new Error('A name ending in .docx, .md, .xlsx, .csv, .pptx or .html')
  const ext = path.extname(clean), stem = clean.slice(0, -ext.length)
  let file = path.join(dir, clean)
  const nth = (n) => (/ \(Studio\)$/.test(stem) ? `${stem.slice(0, -1)} ${n})` : `${stem} ${n}`)
  for (let n = 2; await fsp.access(file).then(() => true, () => false); n++) file = path.join(dir, `${nth(n)}${ext}`)
  await fsp.writeFile(file, buf, { flag: 'wx' })
  return { path: path.relative((await safePath(root, '')).realRoot, file), name: path.basename(file) }
}

// A picture for a deck, beside it: in an images folder next to the deck, named as it came (a name
// taken gets "-2"). Its path from the deck's folder, as the deck's Markdown names it.
const PICTURE = /\.(png|jpe?g|gif|webp|svg)$/i
export async function savePicture(root, deckRel, name, buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('Expected the picture')
  if (buf.length > 20 * 1024 * 1024) throw new Error('Too big a picture (20 MB at most)')
  const clean = path.basename(String(name || '')).replace(/[\\/:*?"<>|#()[\]\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  if (!PICTURE.test(clean)) throw new Error('A picture: PNG, JPEG, GIF, WebP or SVG')
  const { real: deck } = await safePath(root, deckRel)
  const dir = path.join(path.dirname(deck), 'images')
  await fsp.mkdir(dir, { recursive: true })
  const ext = path.extname(clean), stem = clean.slice(0, -ext.length)
  let file = path.join(dir, clean)
  for (let n = 2; await fsp.access(file).then(() => true, () => false); n++) file = path.join(dir, `${stem}-${n}${ext}`)
  await fsp.writeFile(file, buf, { flag: 'wx' })
  return { src: `images/${path.basename(file)}` }
}

// ---------- Decks written by a model ----------
// How a deck Studio draws is written: its layouts, as Marp class directives. Meetings' Make a deck
// writes to the same.
export const DECK_RULES = [
  'Write it in Marp Markdown. Slides are separated by a line with --- on it, with a blank line before and after. Each slide sets its layout with a class directive as its first line, or none for a plain slide of a title and points:',
  '- <!-- _class: title --> the opening slide: "# The title", then "## A one-line subtitle".',
  '- (no directive) "# A title", then 3 to 5 short bullets ("- ...").',
  '- <!-- _class: section --> a divider between parts: "# The part\'s name".',
  '- <!-- _class: stats --> "# A title", then 2 to 4 bullets that each start with a number in bold: "- **42%** of trials convert".',
  '- <!-- _class: cols --> "# A title", then "### One side" with its bullets and "### The other" with its bullets, side by side.',
  '- <!-- _class: quote --> "> What someone said", then a line with who said it.',
  'Use a mix of layouts where they fit the content. Keep bullets under 12 words, and every word true to what you were given. Under each slide, what the speaker says, in an HTML comment: <!-- ... -->. No pictures, no HTML, no code fences around the answer.',
].join('\n')
const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}\n[…]` : String(s || ''))
// The deck's slides without its front matter, numbered for the model.
const numbered = (slides) => slides.map((s, i) => `Slide ${i + 1}:\n${s}`).join('\n\n---\n\n')
// What to ask for: a whole deck (mode deck) from what it's about and a document's words, slide n
// rewritten (slide), or a slide to go after slide n (add). slides: the deck's slides as Markdown.
export function deckAsk({ mode, prompt, slides = [], at = 0, source = null, sourceName = null, count = null }) {
  const want = String(prompt || '').trim()
  const deck = clip(numbered(slides), 24_000)
  const n = Math.max(0, Math.min(slides.length - 1, Number(at) || 0))
  const parts = mode === 'deck'
    ? [
        `Write a slide deck${want ? `: ${want}` : ' from the document below'}.`,
        count ? `About ${Math.max(2, Math.min(30, Number(count)))} slides.` : 'Between 6 and 10 slides.',
        source ? `\nThe document (${sourceName || 'attached'}), to make it from:\n"""\n${clip(source, 30_000)}\n"""` : '',
        `\n${DECK_RULES}`,
        'Answer with the slides only, without front matter.',
      ]
    : [
        `This is a slide deck, for context:\n"""\n${deck}\n"""`,
        mode === 'add' ? `\nWrite one new slide to go after slide ${n + 1}${want ? `: ${want}` : ', that follows on from it'}.` : `\nRewrite slide ${n + 1}${want ? `: ${want}` : ' to be clearer and shorter'}. Keep what it says unless asked otherwise.`,
        source ? `\nFrom this document (${sourceName || 'attached'}):\n"""\n${clip(source, 20_000)}\n"""` : '',
        `\n${DECK_RULES}`,
        `Answer with ${mode === 'add' ? 'the new slide' : 'the rewritten slide'} only, and nothing else.`,
      ]
  return { system: 'You write clear, short, well-structured slide decks in Marp Markdown. You answer with the Markdown asked for and nothing else.', prompt: parts.filter(Boolean).join('\n') }
}
// The words of a document to make a deck from: a file in your folders (from), or one sent from the
// page (upload: { name, data } in base64), read on this computer (doctext.js) and then deleted.
export async function deckSource(from, upload) {
  if (from?.root && from.path) {
    const { real } = await safePath(from.root, from.path)
    if (!doctext.readable(real)) throw new Error(`Studio can't read the words in ${path.basename(real)} on this computer`)
    return { name: path.basename(real), text: await doctext.textOf(real, 40_000) }
  }
  if (upload?.data) {
    const name = path.basename(String(upload.name || 'document.txt')).slice(0, 120)
    if (!doctext.readable(name)) throw new Error(`Studio can't read the words in ${name} on this computer`)
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-deck-'))
    const file = path.join(dir, name)
    try {
      await fsp.writeFile(file, Buffer.from(String(upload.data), 'base64'))
      return { name, text: await doctext.textOf(file, 40_000) }
    } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}) }
  }
  return null
}
// The slides in a model's answer: its fence and front matter taken off, split at its lines of ---.
export function deckAnswer(text) {
  let md = String(text || '').trim()
  const fence = /```(?:markdown|md|marp)?[ \t]*\n([\s\S]*?)\n```/.exec(md)
  if (fence) md = fence[1].trim()
  md = md.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, (m) => (/^\s*(marp|title|theme|paginate|pack)\s*:/m.test(m) ? '' : m))
  const slides = md.split(/\n[ \t]*---[ \t]*\n/).map((s) => s.trim()).filter((s) => s && s !== '---')
  if (!slides.length) throw new Error('The model\'s answer had no slides in it. Try again, or pick another model.')
  return { slides: slides.slice(0, 40) }
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
