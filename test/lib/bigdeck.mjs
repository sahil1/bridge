// A big PowerPoint, as a deck full of photos is: slides from deckfile.mjs, every other one with a
// photo of its own (a PNG of a few thousand pixels across, made here: a gradient with noise in it,
// so it neither packs small nor looks like nothing), stored in the file as PowerPoint stores media.
// About 95 MB with the defaults, of which the slides' own XML is a few kilobytes.
import zlib from 'node:zlib'
import JSZip from 'jszip'
import { deckPptx, ph, p, pic } from './deckfile.mjs'

const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
// A photo-like PNG, w by h: a diagonal gradient from one colour to another, with noise.
export function photoPng(w, h, seed = 1, [a, b] = [[30, 90, 160], [230, 160, 60]]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc(h * (1 + w * 3))
  let x = seed >>> 0 || 1
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3)
    for (let i = 0; i < w; i++) {
      const t = (i / w + y / h) / 2
      x = (x * 1103515245 + 12345) >>> 0
      const n = (x >>> 24) % 48 - 24
      for (let c = 0; c < 3; c++) raw[row + 1 + i * 3 + c] = Math.max(0, Math.min(255, Math.round(a[c] + (b[c] - a[c]) * t + n)))
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))])
}

const COLORS = [[[30, 90, 160], [230, 160, 60]], [[20, 120, 90], [240, 220, 120]], [[120, 40, 110], [250, 150, 140]], [[40, 40, 60], [120, 190, 240]]]
// The deck: count slides, a photo (w by h) on every other one from the first, photos of them all.
export async function bigDeck({ count = 24, photos = 9, w = 2400, h = 1500, title = 'Avathon Autonomy Platform for Renewables' } = {}) {
  const slides = []
  const withPhoto = new Set()
  for (let n = 1; n <= count; n++) {
    const photo = withPhoto.size < photos && n % 2 === 1
    if (photo) withPhoto.add(n)
    slides.push(photo
      ? { layout: 'titleOnly', pictures: ['rIdPic'], shapes: [ph('title', null, [p(n === 1 ? title : `Site ${n}: wind and solar`)], 'Title 1'), pic(`Site photo ${n}`, 'rIdPic', 0.9, 1.7, 11.5, 5.3)] }
      : { layout: 'obj', shapes: [ph('title', null, [p(`Site ${n} results`)], 'Title 1'), ph(null, 1, [p(`Output up ${n % 9 + 2}%`), p(`${n * 3} turbines watched`), p('No unplanned stops')], 'Content Placeholder 2')] })
  }
  const z = await JSZip.loadAsync(await deckPptx({ slides }))
  for (const n of withPhoto) {
    const rels = `ppt/slides/_rels/slide${n}.xml.rels`
    z.file(rels, (await z.file(rels).async('string')).replace('../media/image1.png', `../media/photo${n}.png`))
    z.file(`ppt/media/photo${n}.png`, photoPng(w, h, n * 7919, COLORS[n % COLORS.length]), { compression: 'STORE' })
  }
  return { bytes: new Uint8Array(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })), photos: [...withPhoto] }
}

// A bigger file than that without holding it in memory: a zip's parts (bytes) with more of them
// added (each { name, bytes }, stored as PowerPoint stores media), written to `to` as they go.
export async function withMore(bytes, more, to) {
  const { entriesIn, packedOf, crc32 } = await import('../../server/zip.js')
  const fs = await import('node:fs')
  const buf = Buffer.from(bytes)
  const fd = fs.openSync(to, 'w')
  const cen = []
  let at = 0
  const put = (name, e, packed) => {
    const n = Buffer.from(name)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(e.method, 8); h.writeUInt16LE(0x21, 12)
    h.writeUInt32LE(e.crc >>> 0, 14); h.writeUInt32LE(e.csize, 18); h.writeUInt32LE(e.size, 22); h.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(e.method, 10); c.writeUInt16LE(0x21, 14)
    c.writeUInt32LE(e.crc >>> 0, 16); c.writeUInt32LE(e.csize, 20); c.writeUInt32LE(e.size, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(at, 42)
    cen.push(c, n)
    fs.writeSync(fd, h); fs.writeSync(fd, n); fs.writeSync(fd, packed)
    at += 30 + n.length + packed.length
  }
  for (const e of entriesIn(buf).values()) put(e.name, e, packedOf(buf, e))
  for (const m of more) put(m.name, { method: 0, crc: crc32(m.bytes), csize: m.bytes.length, size: m.bytes.length }, m.bytes)
  const cd = Buffer.concat(cen)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cen.length / 2, 8); end.writeUInt16LE(cen.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16)
  fs.writeSync(fd, cd); fs.writeSync(fd, end)
  fs.closeSync(fd)
}

// A big PDF: pages, each a photo of its own (raw pixels, as a scan is) with its number on it,
// written here (PDF 1.4, no library), so it's big where a scan is: its pictures.
export function bigPdf({ pages = 30, w = 1400, h = 900 } = {}) {
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')]
  const offsets = []
  let size = parts[0].length
  const obj = (n, body) => { offsets[n] = size; const b = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'); parts.push(b); size += b.length }
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 3} 0 R`)
  obj(1, '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n')
  obj(2, `2 0 obj<</Type/Pages/Kids[${kids.join(' ')}]/Count ${pages}>>endobj\n`)
  for (let i = 0; i < pages; i++) {
    const pg = 3 + i * 3, content = pg + 1, img = pg + 2
    obj(pg, `${pg} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w / 2} ${h / 2}]/Contents ${content} 0 R/Resources<</XObject<</Im0 ${img} 0 R>>/Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj\n`)
    const draw = `q ${w / 2} 0 0 ${h / 2} 0 0 cm /Im0 Do Q BT /F1 28 Tf 30 ${h / 2 - 50} Td (Page ${i + 1}) Tj ET`
    obj(content, `${content} 0 obj<</Length ${draw.length}>>stream\n${draw}\nendstream endobj\n`)
    // The pixels as they are (a PNG's IDAT, unpacked, is them with a filter byte before each row).
    const png = photoPng(w, h, i * 104729 + 7)
    const raw = zlib.inflateSync(png.subarray(41, png.length - 16))
    const px = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) raw.copy(px, y * w * 3, y * (1 + w * 3) + 1, (y + 1) * (1 + w * 3))
    obj(img, Buffer.concat([Buffer.from(`${img} 0 obj<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Length ${px.length}>>stream\n`, 'latin1'), px, Buffer.from('\nendstream endobj\n', 'latin1')]))
  }
  const count = 3 + pages * 3
  const xref = `xref\n0 ${count}\n0000000000 65535 f \n${Array.from({ length: count - 1 }, (_, i) => `${String(offsets[i + 1]).padStart(10, '0')} 00000 n \n`).join('')}`
  parts.push(Buffer.from(`${xref}trailer<</Size ${count}/Root 1 0 R>>\nstartxref\n${size}\n%%EOF\n`, 'latin1'))
  return Buffer.concat(parts)
}
