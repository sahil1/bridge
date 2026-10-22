// Word, PowerPoint and Excel files in the file viewer. Spreadsheets (and CSV) are read here into
// a table. Documents and decks are turned into a PDF by LibreOffice when it's installed (the same
// viewer as any PDF); without it, their text is read straight from the file so there is something
// to look at. Nothing is sent anywhere: it all happens on this computer.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { CACHE, IS_MAC, IS_WIN, ensureDir } from './paths.js'

export const OFFICE = {
  '.docx': 'document', '.doc': 'document', '.odt': 'document', '.rtf': 'document',
  '.pptx': 'slides', '.ppt': 'slides', '.odp': 'slides',
  '.xlsx': 'sheet', '.xlsm': 'sheet', '.xls': 'sheet', '.ods': 'sheet', '.csv': 'sheet', '.tsv': 'sheet',
}
const MAX_ROWS = 2000
const MAX_COLS = 80
const MAX_ENTRY = 60 * 1024 * 1024 // unpacked size of one part of the file

// ---------- zip (docx, pptx and xlsx are zip files of XML) ----------
// Read without blocking: the file is in your folders, where macOS can hold a read while it asks you.
async function unzip(file) {
  const buf = await fsp.readFile(file)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error("This file isn't in the newer Office format, or it's damaged")
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extra = buf.readUInt16LE(p + 30)
    const comment = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    entries.set(buf.toString('utf8', p + 46, p + 46 + nameLen), { method, size, local })
    p += 46 + nameLen + extra + comment
  }
  return (name) => {
    const e = entries.get(name)
    if (!e) return null
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
    const data = buf.subarray(start, start + e.size)
    if (e.method === 0) return data.toString('utf8')
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY }).toString('utf8')
    return null
  }
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = (s) => String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m))
const attr = (tag, name) => unxml((new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1] ?? '')
const texts = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => unxml(m[1])).join('')

// ---------- spreadsheets ----------
const colNum = (ref) => { let n = 0; for (const ch of ref) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
function fmtNumber(v, code) {
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  if (code === 'date') {
    const d = new Date(Math.round((n - 25569) * 864e5))
    const iso = d.toISOString()
    return n % 1 === 0 ? iso.slice(0, 10) : n < 1 ? iso.slice(11, 16) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
  }
  if (code === 'pct') return `${+(n * 100).toPrecision(10)}%`
  return String(+n.toPrecision(12))
}

async function readXlsx(file) {
  const part = await unzip(file)
  const wb = part('xl/workbook.xml')
  if (!wb) throw new Error("Couldn't find the sheets in this workbook")
  const rels = new Map([...(part('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]))
  const shared = [...(part('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1], 't'))
  // Which cell styles are dates or percentages, so 45200 shows as 2023-10-01 and 0.25 as 25%.
  const styles = part('xl/styles.xml') || ''
  const custom = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode')]))
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || ''
  const kindOf = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId'))
    if (DATE_IDS.has(id)) return 'date'
    if (id === 9 || id === 10) return 'pct'
    const code = (custom.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
    if (/%/.test(code)) return 'pct'
    if (/[dmyhs]/i.test(code) && !/^[#0,.\s]*$/.test(code)) return 'date'
    return null
  })
  const sheets = []
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name')
    const target = rels.get(attr(m[0], 'r:id')) || ''
    const xml = part(target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)
    if (!xml) { sheets.push({ name, rows: [], cols: 0 }); continue }
    const rows = []
    let cols = 0
    let truncated = false
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const y = attr(r[1], 'r') ? Number(attr(r[1], 'r')) - 1 : rows.length
      if (y >= MAX_ROWS) { truncated = true; break }
      const row = []
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r').replace(/\d+/g, '')
        const x = ref ? colNum(ref) : row.length
        if (x >= MAX_COLS) { truncated = true; continue }
        const t = attr(c[1], 't')
        const body = c[2] || ''
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
        let val = ''
        if (t === 's') val = shared[Number(v)] ?? ''
        else if (t === 'inlineStr') val = texts(body, 't')
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE'
        else if (t === 'str' || t === 'e') val = unxml(v ?? '')
        else if (v != null) val = fmtNumber(unxml(v), kindOf[Number(attr(c[1], 's') || 0)])
        row[x] = val
      }
      if (row.length) { rows[y] = row; cols = Math.max(cols, row.length) }
    }
    sheets.push({ name, rows: Array.from(rows, (r) => Array.from({ length: cols }, (_, i) => r?.[i] ?? '')), cols, truncated })
  }
  return sheets
}

async function readCsv(file, sep) {
  const text = (await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let q = false
  let truncated = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"' && cell === '') q = true
    else if (ch === sep) { row.push(cell); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row.slice(0, MAX_COLS)); row = []; cell = ''
      if (rows.length >= MAX_ROWS) { truncated = i < text.length - 1; break }
    } else cell += ch
  }
  if (cell || row.length) rows.push([...row, cell].slice(0, MAX_COLS))
  const cols = Math.max(0, ...rows.map((r) => r.length))
  return [{ name: path.basename(file), rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')), cols, truncated }]
}

export async function sheet(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') return { sheets: await readCsv(file, ext === '.tsv' ? '\t' : await sepOf(file)) }
  if (ext === '.xlsx' || ext === '.xlsm') return { sheets: await readXlsx(file) }
  // Older or OpenDocument spreadsheets: LibreOffice turns them into .xlsx first.
  return { sheets: await readXlsx(await convert(file, 'xlsx')) }
}
// Some "CSV" files use semicolons (Excel in many European settings).
async function sepOf(file) {
  const head = (await fsp.readFile(file, 'utf8')).slice(0, 4000).split(/\r?\n/)[0] || ''
  return (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ','
}

// ---------- documents and decks: their text, when LibreOffice isn't there ----------
export async function outline(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext !== '.docx' && ext !== '.pptx') throw new Error('Install LibreOffice to see this file here')
  const part = await unzip(file)
  if (ext === '.docx') {
    const xml = part('word/document.xml') || ''
    const blocks = []
    for (const p of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
      const text = texts(p[1], 'w:t')
      if (!text.trim()) continue
      const style = attr(/<w:pStyle\b[^>]*>/.exec(p[1])?.[0] || '', 'w:val')
      const level = /^(Title)$/i.test(style) ? 1 : Number(/^Heading(\d)/i.exec(style)?.[1]) || 0
      blocks.push({ text, level, list: /<w:numPr>/.test(p[1]) || /^List/i.test(style) })
    }
    return { sections: [{ blocks }] }
  }
  const sections = []
  for (let n = 1; n < 1000; n++) {
    const xml = part(`ppt/slides/slide${n}.xml`)
    if (xml == null) break
    const blocks = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) => texts(p[1], 'a:t')).filter((t) => t.trim()).map((text) => ({ text, level: 0 }))
    const notes = part(`ppt/notesSlides/notesSlide${n}.xml`)
    sections.push({ title: `Slide ${n}`, blocks, notes: notes ? [...notes.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) => texts(p[1], 'a:t')).filter((t) => t.trim() && !/^\d+$/.test(t.trim())).join('\n') : '' })
  }
  return { sections }
}

// ---------- LibreOffice ----------
let sofficePath
export function soffice() {
  if (sofficePath !== undefined) return sofficePath
  const tries = IS_MAC ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', path.join(os.homedir(), 'Applications/LibreOffice.app/Contents/MacOS/soffice')]
    : IS_WIN ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')]
    : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice', '/opt/libreoffice/program/soffice']
  sofficePath = tries.find((p) => fs.existsSync(p)) || null
  return sofficePath
}

// One conversion at a time; each result is kept (by file, size and time) so opening it again is instant.
let queue = Promise.resolve()
export async function convert(file, to = 'pdf') {
  const bin = soffice()
  if (!bin) throw Object.assign(new Error('LibreOffice is needed to show this file here'), { needs: 'libreoffice' })
  const st = await fsp.stat(file)
  const dir = ensureDir(path.join(CACHE, 'office'))
  const key = crypto.createHash('sha1').update(`${file}\0${st.size}\0${st.mtimeMs}\0${to}`).digest('hex').slice(0, 20)
  const out = path.join(dir, `${key}.${to}`)
  if (fs.existsSync(out)) return out
  const run = () => new Promise((resolve, reject) => {
    if (fs.existsSync(out)) return resolve(out)
    const work = fs.mkdtempSync(path.join(dir, 'job-'))
    // Its own profile, so it works while you have LibreOffice open.
    const profile = pathToFileURL(ensureDir(path.join(dir, 'profile'))).href
    execFile(bin, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo', '--convert-to', to, '--outdir', work, file], { timeout: 120000 }, (err) => {
      const made = fs.readdirSync(work).find((n) => n.toLowerCase().endsWith(`.${to}`))
      if (made) fs.renameSync(path.join(work, made), out)
      fs.rmSync(work, { recursive: true, force: true })
      if (made) { prune(dir); resolve(out) } else reject(new Error(err?.killed ? 'LibreOffice took too long with this file' : "LibreOffice couldn't open this file"))
    })
  })
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}

// Keep the newest 60 converted files.
function prune(dir) {
  try {
    const files = fs.readdirSync(dir).filter((n) => /^[0-9a-f]{20}\./.test(n)).map((n) => ({ p: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t)
    for (const f of files.slice(60)) fs.rmSync(f.p, { force: true })
  } catch { /* best effort */ }
}
