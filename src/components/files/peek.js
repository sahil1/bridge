// A first look inside a document, for its icon (views.jsx Thumb): a Word, PowerPoint or Excel file's
// own picture of itself where it keeps one (docProps/thumbnail.jpeg, which Office saves for Finder),
// else the first words of a Word file's first page or of a deck's first slide; a Markdown or text
// file's first lines (a Markdown deck's first slide). Read in parts, as a PDF's first page is (the
// file route answers Range): the end of a zip for where things are in it, then only that, so a big
// file is never read whole for its icon. views.jsx never asks for a file on a cloud drive (reading
// one would download it). Each answer is kept for the file as it is (its time in the address).

// What can be looked into, by extension.
const OFFICE = /\.(docx|docm|pptx|pptm|xlsx|xlsm)$/i
const TEXT = /\.(md|markdown|txt)$/i
export const canPeek = (name) => OFFICE.test(name) || TEXT.test(name)

const kept = new Map() // url: { pic } | { page } | { slide } | null
const KEEP = 300
function keep(url, v) {
  kept.set(url, v)
  while (kept.size > KEEP) {
    const [k, old] = kept.entries().next().value
    if (old?.pic) URL.revokeObjectURL(old.pic)
    kept.delete(k)
  }
  return v
}

// Bytes from..to of a file (to may be past its end; from below 0: the last -from bytes). Only a part
// asked for is read: a file route that answered with the whole file isn't read on, unless it's small.
async function part(url, from, to, signal) {
  let r = await fetch(url, { headers: { Range: from < 0 ? `bytes=${from}` : `bytes=${from}-${to}` }, signal, credentials: 'same-origin' })
  // The last bytes of a file shorter than that many: the whole file, now its size is known.
  const size = r.status === 416 && Number(/\/(\d+)$/.exec(r.headers.get('content-range') || '')?.[1])
  if (size && from < 0) { r.body?.cancel().catch(() => {}); r = await fetch(url, { headers: { Range: `bytes=0-${size - 1}` }, signal, credentials: 'same-origin' }) }
  if (r.status === 206) {
    const size = Number(/\/(\d+)$/.exec(r.headers.get('content-range') || '')?.[1]) || null
    return { bytes: new Uint8Array(await r.arrayBuffer()), size }
  }
  if (!r.ok || Number(r.headers.get('content-length') || Infinity) > 2e6) { r.body?.cancel().catch(() => {}); throw new Error(`no part (${r.status})`) }
  const all = new Uint8Array(await r.arrayBuffer())
  const at = from < 0 ? Math.max(0, all.length + from) : from
  return { bytes: all.subarray(at, from < 0 ? all.length : to + 1), size: all.length, whole: all }
}

const u16 = (b, i) => b[i] | (b[i + 1] << 8)
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

// Where each file in a zip is: its central directory, from the end of the file.
async function zipFiles(url, signal) {
  const tail = await part(url, -65536, 0, signal)
  const b = tail.bytes
  let end = -1
  for (let i = b.length - 22; i >= 0; i--) if (u32(b, i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('not a zip')
  const dirSize = u32(b, end + 12)
  const dirAt = u32(b, end + 16)
  if (dirAt === 0xffffffff) throw new Error('zip64')
  const tailAt = (tail.size ?? b.length) - b.length
  const dir = dirAt >= tailAt ? b.subarray(dirAt - tailAt, dirAt - tailAt + dirSize) : (await part(url, dirAt, dirAt + dirSize - 1, signal)).bytes
  const out = new Map()
  const dec = new TextDecoder()
  for (let i = 0; i + 46 <= dir.length && u32(dir, i) === 0x02014b50;) {
    const nameLen = u16(dir, i + 28)
    const name = dec.decode(dir.subarray(i + 46, i + 46 + nameLen))
    out.set(name, { method: u16(dir, i + 10), packed: u32(dir, i + 20), size: u32(dir, i + 24), at: u32(dir, i + 42) })
    i += 46 + nameLen + u16(dir, i + 30) + u16(dir, i + 32)
  }
  return out
}

// A file in a zip, or as much of its start as max packed bytes give (a long document's first page).
async function zipRead(url, f, { max = Infinity, signal } = {}) {
  const want = Math.min(f.packed, max)
  let got = (await part(url, f.at, f.at + 30 + 512 + want - 1, signal)).bytes
  if (u32(got, 0) !== 0x04034b50) throw new Error('not where the zip said')
  const start = 30 + u16(got, 26) + u16(got, 28)
  if (start + want > got.length) got = (await part(url, f.at + start, f.at + start + want - 1, signal)).bytes
  else got = got.subarray(start, start + want)
  if (f.method === 0) return got
  if (f.method !== 8 || typeof DecompressionStream !== 'function') throw new Error('can\'t unpack it here')
  return inflate(got, want < f.packed)
}
// Unpacked: all of it, or (cut: only its start was read) as much as that start gives.
async function inflate(bytes, cut) {
  const ds = new DecompressionStream('deflate-raw')
  const w = ds.writable.getWriter()
  w.write(bytes).catch(() => {})
  w.close().catch(() => {})
  const r = ds.readable.getReader()
  const out = []
  let n = 0
  try {
    for (;;) {
      const { value, done } = await r.read()
      if (done) break
      out.push(value); n += value.length
      if (n > 400_000) { r.cancel().catch(() => {}); break }
    }
  } catch (e) { if (!cut || !n) throw e }
  const all = new Uint8Array(n)
  let at = 0
  for (const c of out) { all.set(c, at); at += c.length }
  return all
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
const runs = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => unxml(m[1])).join('')
const LINES = 22

// A Word file's first page: its paragraphs, headings marked, up to a page break.
function wordPage(xml) {
  const page = []
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0]
    const text = runs(p, 'w:t').trim()
    const head = /<w:pStyle w:val="(Title|Subtitle|Heading\d|berschrift\d|Titre\d?)"/i.test(p)
    if (text || (page.length && page.at(-1).text)) page.push({ text, head })
    // Up to where Word last broke the page (or a break of its own), once there's something on it.
    if (page.length >= LINES || (page.length > 2 && /<w:br [^>]*w:type="page"|<w:lastRenderedPageBreak\/>/.test(p))) break
  }
  return page.some((l) => l.text) ? page : null
}
// A deck's first slide: its title and what else it says.
function pptSlide(xml) {
  let title = ''
  const lines = []
  for (const m of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const sp = m[0]
    const paras = [...sp.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((x) => runs(x[0], 'a:t').trim()).filter(Boolean)
    if (!paras.length) continue
    if (!title && /<p:ph [^>]*type="(ctrTitle|title)"/.test(sp)) title = paras.join(' ')
    else lines.push(...paras)
  }
  if (!title && lines.length) title = lines.shift()
  return title || lines.length ? { title, lines: lines.slice(0, 6) } : null
}
// A Markdown or text file's first lines (Markdown's marks taken off, headings marked); a Markdown
// deck's (marp: true) first slide.
function textPage(text, md) {
  let body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const front = md && /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n/.exec(body)
  const deck = !!front && /\bmarp:\s*true\b/.test(front[1])
  if (front) body = body.slice(front[0].length)
  const plain = (l) => l.replace(/^#+\s*/, '').replace(/^\s*[-*+]\s+/, '• ').replace(/^>\s?/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]+/g, '').trim()
  if (deck) {
    const first = body.split(/\n---[ \t]*\n/)[0].split('\n').filter((l) => l.trim() && !/^<!--/.test(l.trim()))
    const t = first.findIndex((l) => /^#/.test(l))
    const title = plain(first[t >= 0 ? t : 0] || '')
    return { slide: { title, lines: first.filter((_, i) => i !== (t >= 0 ? t : 0)).map(plain).filter(Boolean).slice(0, 6) } }
  }
  const page = body.split('\n').slice(0, LINES * 2).map((l) => ({ text: md ? plain(l) : l.trimEnd(), head: md && /^#{1,3}\s/.test(l) }))
    .filter((l, i, all) => l.text || (i && all[i - 1].text)).slice(0, LINES)
  return page.some((l) => l.text) ? { page } : null
}

// What the icon shows: { pic } (a picture's address), { page: [{ text, head }] }, { slide: { title,
// lines } }, or null (the kind's own icon).
export async function peek(url, name, { signal } = {}) {
  if (kept.has(url)) return kept.get(url)
  let v = null
  try {
    if (OFFICE.test(name)) {
      const files = await zipFiles(url, signal)
      const thumb = ['docProps/thumbnail.jpeg', 'docProps/thumbnail.jpg', 'docProps/thumbnail.png'].map((n) => [n, files.get(n)]).find(([, f]) => f && f.size < 3e6)
      if (thumb) v = { pic: URL.createObjectURL(new Blob([await zipRead(url, thumb[1], { signal })], { type: thumb[0].endsWith('png') ? 'image/png' : 'image/jpeg' })) }
      else if (files.has('word/document.xml')) { const page = wordPage(new TextDecoder().decode(await zipRead(url, files.get('word/document.xml'), { max: 48_000, signal }))); v = page && { page } }
      else if (files.has('ppt/slides/slide1.xml')) { const slide = pptSlide(new TextDecoder().decode(await zipRead(url, files.get('ppt/slides/slide1.xml'), { max: 96_000, signal }))); v = slide && { slide } }
    } else if (TEXT.test(name)) {
      const got = await part(url, 0, 4095, signal)
      v = textPage(new TextDecoder().decode(got.bytes.subarray(0, 4096)), !/\.txt$/i.test(name))
    }
  } catch (e) {
    if (signal?.aborted) throw e
    v = null
  }
  return keep(url, v)
}
