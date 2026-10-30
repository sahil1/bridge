// Small readers for Mail's on-disk formats: .emlx messages (RFC 822 plus a plist trailer)
// and the binary plists Mail uses for Apple Intelligence summaries. Read-only.
import fs from 'node:fs'

// ---------- binary plist: pull out the strings (enough for NSKeyedArchiver summaries) ----------
export function bplistStrings(buf) {
  if (!buf || buf.length < 40 || buf.toString('latin1', 0, 8) !== 'bplist00') return []
  const t = buf.length - 32
  const offSize = buf[t + 6]
  const num = Number(buf.readBigUInt64BE(t + 8))
  const tableAt = Number(buf.readBigUInt64BE(t + 24))
  const readN = (at, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[at + i]; return v }
  const out = []
  for (let i = 0; i < num; i++) {
    let at = readN(tableAt + i * offSize, offSize)
    const marker = buf[at]
    const type = marker >> 4
    if (type !== 5 && type !== 6) continue
    let len = marker & 0x0f
    at += 1
    if (len === 0x0f) { const n = 1 << (buf[at] & 0x0f); len = readN(at + 1, n); at += 1 + n }
    if (type === 5) out.push(buf.toString('latin1', at, at + len))
    else {
      const b = Buffer.from(buf.subarray(at, at + len * 2))
      b.swap16()
      out.push(b.toString('utf16le'))
    }
  }
  return out
}

export function summaryText(buf) {
  return bplistStrings(buf)
    .filter((s) => s.length > 12 && !/^(\$|NS[A-Z])/.test(s))
    .sort((a, b) => b.length - a.length)[0] || null
}

// ---------- RFC 822 / MIME ----------
function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : qp(txt.replace(/_/g, ' '))
      return decodeCharset(bytes, cs)
    } catch { return txt }
  }).replace(/\?=\s+=\?/g, '')
}

function qp(s) {
  const bytes = []
  const src = s.replace(/=\r?\n/g, '')
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { bytes.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2 }
    else bytes.push(src.charCodeAt(i) & 0xff)
  }
  return Buffer.from(bytes)
}

function decodeCharset(bytes, cs = 'utf-8') {
  try { return new TextDecoder(cs.toLowerCase().replace(/^us-ascii$/, 'utf-8')).decode(bytes) } catch { return bytes.toString('utf8') }
}

function splitHead(raw) {
  const i = raw.search(/\r?\n\r?\n/)
  const head = i < 0 ? raw : raw.slice(0, i)
  const body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '')
  const headers = {}
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line)
    if (m) headers[m[1].toLowerCase()] = headers[m[1].toLowerCase()] ? `${headers[m[1].toLowerCase()]}, ${m[2]}` : m[2]
  }
  return { headers, body }
}

const param = (h, name) => (new RegExp(`${name}="?([^";]+)"?`, 'i').exec(h || '') || [])[1]

function htmlToText(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

// Walk the MIME tree; prefer text/plain, fall back to text/html. Collect attachment names.
function walk(raw, acc) {
  const { headers, body } = splitHead(raw)
  const ctype = headers['content-type'] || 'text/plain'
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase()
  const disp = headers['content-disposition'] || ''
  if (/^multipart\//i.test(ctype)) {
    const boundary = param(ctype, 'boundary')
    if (!boundary) return
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith('--')) break
      walk(part.replace(/^\r?\n/, ''), acc)
    }
    return
  }
  const name = param(disp, 'filename') || param(ctype, 'name')
  // Images embedded in the body (signatures, logos) are not attachments worth listing.
  const inline = /^image\//i.test(ctype) && (headers['content-id'] || /inline/i.test(disp))
  if (inline) { acc.inline++; return }
  if (/attachment/i.test(disp) || (name && !/^text\//i.test(ctype))) { if (name) acc.attachments.push(decodeWords(name)); return }
  const bytes = enc === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? qp(body) : Buffer.from(body, 'latin1')
  const text = decodeCharset(bytes, param(ctype, 'charset') || 'utf-8')
  if (/^text\/plain/i.test(ctype) && !acc.plain) acc.plain = text
  else if (/^text\/html/i.test(ctype) && !acc.html) acc.html = text
}

export function readEmlx(file) {
  const buf = fs.readFileSync(file)
  const nl = buf.indexOf(10)
  const len = parseInt(buf.toString('latin1', 0, nl), 10)
  const raw = buf.toString('latin1', nl + 1, nl + 1 + (Number.isFinite(len) ? len : buf.length))
  const { headers } = splitHead(raw)
  const acc = { plain: null, html: null, attachments: [], inline: 0 }
  walk(raw, acc)
  let text = acc.plain || (acc.html ? htmlToText(acc.html) : '')
  // Drop inline-image placeholders and the <url> that Outlook appends after linked text.
  text = text.replace(/\[cid:[^\]]*\]/g, '').replace(/ ?<(?:https?|mailto):[^>\s]+>/g, '').replace(/\r/g, '').replace(/[ \t]{3,}/g, '   ').replace(/^[ \t]+|[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  return {
    from: decodeWords(headers.from),
    to: decodeWords(headers.to),
    cc: decodeWords(headers.cc),
    date: headers.date,
    subject: decodeWords(headers.subject),
    text,
    attachments: acc.attachments.filter((a) => !/^image\d{3}\.(png|jpe?g|gif)$/i.test(a)),
    inlineImages: acc.inline,
  }
}

// Split off the quoted history ("From: … Sent: …" or "On … wrote:") so the newest reply leads.
export function splitQuoted(text) {
  const m = /\n(?:_{5,}\s*\n)?\s*(?:From: .+\n(?:Sent|Date): |On .{6,120}wrote:\s*\n|-{3,} ?Original Message ?-{3,})/i.exec(`\n${text}`)
  if (!m || m.index < 20) return { latest: text, quoted: null }
  return { latest: text.slice(0, m.index - 1).trim(), quoted: text.slice(m.index - 1).trim() }
}
