// CSV and TSV files: read the way they're written, and written back the same way. Its encoding
// (a byte order mark, UTF-8, else the Windows one most older files are in), its separator (comma,
// semicolon, tab or pipe: whichever splits its lines most evenly, or Excel's "sep=;" line), its
// line endings and its last newline are found when it opens and kept when it's saved. Each field
// keeps its own text and quotes unless it was changed, so a file saved with nothing changed is the
// same bytes, and a change shows in a diff as just that change.

export const SEPARATORS = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }
// What it can be read as. Studio can write all but the last ones back; those are saved as UTF-8,
// which it says before saving (notKept).
export const ENCODINGS = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252', 'shift_jis', 'gbk', 'big5', 'euc-kr']
const WRITES = new Set(['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252'])

// The encoding: a byte order mark says it; else UTF-8 if the bytes are UTF-8, else Windows-1252.
export function sniffEncoding(bytes) {
  const b = bytes
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return 'utf-8-bom'
  if (b[0] === 0xff && b[1] === 0xfe) return 'utf-16le'
  if (b[0] === 0xfe && b[1] === 0xff) return 'utf-16be'
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return 'utf-8' } catch { return 'windows-1252' }
}
export function decode(bytes, enc) {
  const skip = enc === 'utf-8-bom' ? 3 : (enc === 'utf-16le' || enc === 'utf-16be') && (bytes[0] === 0xff || bytes[0] === 0xfe) ? 2 : 0
  return new TextDecoder(enc === 'utf-8-bom' ? 'utf-8' : enc).decode(bytes.subarray(skip))
}
// Windows-1252's characters at 0x80-0x9f; the rest of 0xa0-0xff is Latin-1, the same code.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
export function encode(text, enc) {
  if (enc === 'utf-16le' || enc === 'utf-16be') {
    const out = new Uint8Array(2 + text.length * 2)
    const le = enc === 'utf-16le'
    out[0] = le ? 0xff : 0xfe; out[1] = le ? 0xfe : 0xff
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[2 + i * 2 + (le ? 0 : 1)] = c & 0xff; out[2 + i * 2 + (le ? 1 : 0)] = c >> 8 }
    return out
  }
  if (enc === 'windows-1252') {
    const out = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      const k = CP1252.indexOf(text[i])
      out[i] = c <= 0xff ? c : k >= 0 ? 0x80 + k : 0x3f // ? for what it can't hold
    }
    return out
  }
  const body = new TextEncoder().encode(text)
  if (enc !== 'utf-8-bom') return body
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf]); out.set(body, 3)
  return out
}
// Characters Windows-1252 can't hold (a file read as it, then typed into): saved as "?" otherwise.
export const fitsEncoding = (text, enc) => enc !== 'windows-1252' || [...text].every((ch) => ch.charCodeAt(0) <= 0xff || CP1252.includes(ch))

// Fields, each with its raw text as written (quotes and all), row by row; a quoted field may run
// over several lines.
export function tokenize(text, sep) {
  const rows = []
  let row = [], start = 0, i = 0, quoted = false, val = ''
  const end = (to) => { row.push({ v: val, raw: text.slice(start, to) }); val = '' }
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { val += '"'; i += 2; continue } quoted = false; i++; continue }
      val += ch; i++; continue
    }
    if (ch === '"' && text.slice(start, i).trim() === '') { quoted = true; val = ''; i++; continue }
    if (ch === sep) { end(i); i++; start = i; continue }
    if (ch === '\n' || ch === '\r') {
      end(i); rows.push(row); row = []
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      start = i; continue
    }
    val += ch; i++
  }
  if (start < text.length || row.length) { end(text.length); rows.push(row) }
  return rows
}

// The separator: Excel's "sep=;" first line, else the one that splits the first lines into the
// same number of fields most often, more fields winning a tie. A file with none is one column.
export function sniffSeparator(text, fallback = ',') {
  const m = /^sep=(.)\r?\n/.exec(text)
  if (m) return m[1]
  const sample = text.slice(0, 20000)
  let best = fallback, score = 0
  for (const sep of Object.keys(SEPARATORS)) {
    const counts = tokenize(sample, sep).slice(0, 40).map((r) => r.length).filter((n, i, a) => i < a.length - 1 || a.length === 1)
    if (!counts.length || Math.max(...counts) < 2) continue
    const freq = {}
    for (const n of counts) freq[n] = (freq[n] || 0) + 1
    const [n, hits] = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    const s = (hits / counts.length) * 1000 + Number(n)
    if (n > 1 && s > score) { score = s; best = sep }
  }
  return best
}

// A number only when it's written the way a number writes itself back: "120" and "-3.5" are
// numbers; "007", "1,200", "1e5" and long IDs stay text, so nothing changes when it's saved.
const NUM = /^-?(0|[1-9]\d{0,14})(\.\d{1,15})?$/
export const asCell = (v) => (NUM.test(v) && String(Number(v)) === v ? { v: Number(v), t: 2 } : { v, t: 1 })

// How a file is read: what was found (or picked) and the fields as written, to write back.
export function readCsv(buf, { ext = '.csv', sep: pickSep = null, enc: pickEnc = null } = {}) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const enc = pickEnc || sniffEncoding(bytes)
  const text = decode(bytes, enc)
  const hint = /^sep=(.)(\r?\n)/.exec(text)
  const body = hint ? text.slice(hint[0].length) : text
  const sep = pickSep || (hint ? hint[1] : sniffSeparator(body, ext === '.tsv' ? '\t' : ','))
  const crlf = (body.match(/\r\n/g) || []).length
  const lf = (body.match(/\n/g) || []).length
  const eol = crlf && crlf >= lf - crlf ? '\r\n' : '\n'
  const rows = tokenize(body, sep)
  const lastNewline = /\r?\n$/.test(body)
  return { rows, sep, enc, eol, hint: hint ? hint[0] : '', lastNewline, sniffed: { sep: !pickSep, enc: !pickEnc } }
}

const quote = (s, sep) => (/["\n\r]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
const same = (field, v) => field && (field.v === v || (v !== '' && String(field.v) === v))

// Back to its own bytes: each field as it was written unless its value changed, in the file's
// separator, line endings and encoding. cells(r) gives a row's values as text (formulas as their
// results), up to its last one.
export function writeCsv(read, lines, { sep = read.sep, enc = read.enc } = {}) {
  const out = []
  for (let r = 0; r < lines.length; r++) {
    const was = read.rows[r] || []
    const vals = lines[r]
    // A row with nothing changed is written as it was, empty fields at its end too.
    if (sep === read.sep && vals.length <= was.length && was.every((f, c) => same(f, vals[c] ?? ''))) { out.push(was.map((f) => f.raw).join(sep)); continue }
    out.push(vals.map((v, c) => (sep === read.sep && same(was[c], v) ? was[c].raw : quote(v, sep))).join(sep))
  }
  const text = `${read.hint && sep === read.sep ? read.hint : ''}${out.join(read.eol)}${out.length && read.lastNewline ? read.eol : ''}`
  const writeAs = WRITES.has(enc) ? enc : 'utf-8'
  return { bytes: encode(text, writeAs), enc: writeAs, fits: fitsEncoding(text, writeAs) }
}
export const writesBack = (enc) => WRITES.has(enc)
