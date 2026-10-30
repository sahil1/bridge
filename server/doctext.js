// The words in a file linked to a meeting, or on a screen captured in one, for the model writing
// its notes or answering about it: Word and PowerPoint (office.js), Excel and CSV, PDFs and
// pictures (native/bridgeocr, on a Mac), older Word and RTF (macOS textutil), Markdown and plain
// text. Read from where the file is, when it's needed; kept by the file's size and time, so a
// summary written again doesn't read it again. Nothing leaves this computer.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { ROOT, IS_MAC } from './paths.js'
import * as office from './office.js'

export const ocrBin = () => { const f = process.env.BRIDGE_OCR || path.join(ROOT, 'native', 'bin', 'bridgeocr'); return (IS_MAC || process.env.BRIDGE_OCR) && fs.existsSync(f) ? f : null }
export const IMAGE = /^\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/i
const PLAIN = new Set(['.txt', '.md', '.markdown', '.json', '.log', '.html', '.htm', '.xml', '.yaml', '.yml', '.eml', '.vtt', '.srt'])
const run = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 90_000, maxBuffer: 32 * 1024 * 1024 }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).trim().split('\n')[0])) : resolve(out)))
})
const untag = (h) => h.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

// What can be read, by the file's name.
export function readable(file) {
  const ext = path.extname(String(file)).toLowerCase()
  if (['.docx', '.pptx', '.xlsx', '.xlsm', '.csv', '.tsv'].includes(ext) || PLAIN.has(ext)) return true
  if (ext === '.pdf' || IMAGE.test(ext)) return !!ocrBin()
  return IS_MAC && ['.doc', '.rtf', '.odt', '.rtfd', '.webarchive'].includes(ext)
}

const kept = new Map() // file -> { key, text }
// The text, up to max characters. Throws when the file is gone (code ENOENT) or can't be read.
export async function textOf(file, max = 40_000) {
  const st = await fs.promises.stat(file)
  if (!st.isFile()) throw new Error('That\'s a folder, not a file')
  if (st.size > 200 * 1024 * 1024) throw new Error('It\'s too big to read (over 200 MB)')
  const key = `${st.size}:${st.mtimeMs}`
  const had = kept.get(file)
  if (had?.key === key) return had.text.slice(0, max)
  const ext = path.extname(file).toLowerCase()
  let text
  if (ext === '.docx' || ext === '.pptx') {
    const o = await office.outline(file)
    text = o.sections.map((s) => [s.title ? `## ${s.title}` : '', ...s.blocks.map((b) => b.text), s.notes ? `(Speaker notes: ${s.notes})` : ''].filter(Boolean).join('\n')).join('\n\n')
  } else if (['.xlsx', '.xlsm', '.csv', '.tsv'].includes(ext)) {
    const { sheets } = await office.sheet(file)
    text = sheets.map((s) => `## ${s.name}\n${s.rows.slice(0, 300).map((r) => r.join(' | ').replace(/( \| )+$/, '')).filter((r) => r.trim()).join('\n')}`).join('\n\n')
  } else if (ext === '.pdf' || IMAGE.test(ext)) {
    const bin = ocrBin()
    if (!bin) throw new Error(`Reading ${ext === '.pdf' ? 'a PDF' : 'a picture'} needs Bridge AI on a Mac`)
    text = await run(bin, [ext === '.pdf' ? 'pdf' : 'image', file])
  } else if (IS_MAC && ['.doc', '.rtf', '.odt', '.rtfd', '.webarchive'].includes(ext)) {
    text = await run('/usr/bin/textutil', ['-convert', 'txt', '-stdout', file])
  } else if (PLAIN.has(ext)) {
    const fh = await fs.promises.open(file, 'r')
    try { const b = Buffer.alloc(Math.min(st.size, max * 3)); await fh.read(b, 0, b.length, 0); text = b.toString('utf8') } finally { await fh.close() }
    if (/^\.html?$/.test(ext)) text = untag(text)
  } else throw new Error(`Bridge AI can't read ${ext ? `${ext.slice(1).toUpperCase()} files` : 'this file'} yet`)
  text = String(text).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  kept.set(file, { key, text })
  if (kept.size > 300) kept.delete(kept.keys().next().value)
  return text.slice(0, max)
}
