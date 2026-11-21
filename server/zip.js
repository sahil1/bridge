// Word, Excel and PowerPoint files are zips. What's in one, read from its central directory (the list
// at its end): each part's name, where it starts, how it's packed and how big it is. From a file's
// bytes in memory (office.js, botattach.js), or from the file itself, read only where it's needed
// (Studio's big files, studioparts.js: the list, then each part as it's asked for). And a zip
// written from parts, each copied as it was packed (nothing packed again).
import zlib from 'node:zlib'
import { openToRead } from './openread.js'

const EOCD = 0x06054b50, EOCD64 = 0x06064b50, LOC64 = 0x07064b50, CEN = 0x02014b50, LOC = 0x04034b50
const TAIL = 22 + 65535 // the end record and the longest comment after it

// Where the central directory is, from the file's last bytes (tail, which start at `at` in it).
function endOf(tail, at) {
  let e = -1
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { e = i; break }
  if (e < 0) return null
  let count = tail.readUInt16LE(e + 10), size = tail.readUInt32LE(e + 12), offset = tail.readUInt32LE(e + 16)
  // Zip64: a list longer than 65,535 parts, or past 4 GB.
  if ((count === 0xffff || offset === 0xffffffff || size === 0xffffffff) && e >= 20 && tail.readUInt32LE(e - 20) === LOC64) {
    return { zip64At: Number(tail.readBigUInt64LE(e - 20 + 8)), at: at + e }
  }
  return { count, size, offset, at: at + e }
}
function end64(rec) {
  if (rec.readUInt32LE(0) !== EOCD64) return null
  return { count: Number(rec.readBigUInt64LE(32)), size: Number(rec.readBigUInt64LE(40)), offset: Number(rec.readBigUInt64LE(48)) }
}

// The parts listed in a central directory's bytes: name -> { name, method, flags, crc, csize, size,
// local (where its own header starts), time, date }.
function partsIn(cd, count) {
  const out = new Map()
  let p = 0
  for (let n = 0; n < count && p + 46 <= cd.length && cd.readUInt32LE(p) === CEN; n++) {
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), time = cd.readUInt16LE(p + 12), date = cd.readUInt16LE(p + 14)
    const crc = cd.readUInt32LE(p + 16)
    let csize = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24)
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32)
    let local = cd.readUInt32LE(p + 42)
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
    // Zip64's sizes and place, in its extra field, for those written as 0xffffffff.
    if (size === 0xffffffff || csize === 0xffffffff || local === 0xffffffff) {
      for (let x = p + 46 + nameLen, xe = x + extraLen; x + 4 <= xe;) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2)
        if (id === 1) {
          let q = x + 4
          if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8 }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8 }
          if (local === 0xffffffff) local = Number(cd.readBigUInt64LE(q))
        }
        x += 4 + len
      }
    }
    if (!name.endsWith('/')) out.set(name, { name, method, flags, crc, csize, size, local, time, date })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

// ---------- In memory ----------
// A zip's parts, from its bytes; null when it isn't a zip.
export function entriesIn(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null
  const from = Math.max(0, buf.length - TAIL)
  let end = endOf(buf.subarray(from), from)
  if (!end) return null
  if (end.zip64At != null) end = end64(buf.subarray(end.zip64At, end.zip64At + 56))
  if (!end || end.offset + end.size > buf.length) return null
  return partsIn(buf.subarray(end.offset, end.offset + end.size), end.count)
}
// Where a part's packed bytes start, after its own header (whose name and extra field may differ
// in length from the central directory's).
const dataAt = (head, e) => e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
// A part's bytes, unpacked (max: the most it may unpack to; more throws, as a zip bomb would).
export function dataOf(buf, e, { max = 256 * 1024 * 1024 } = {}) {
  const packed = packedOf(buf, e)
  return packed ? unpack(packed, e, max) : null
}
// Its bytes as they're packed in the zip.
export function packedOf(buf, e) {
  if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== LOC) return null
  const start = dataAt(buf.subarray(e.local, e.local + 30), e)
  return buf.subarray(start, start + e.csize)
}
export function unpack(packed, e, max = 256 * 1024 * 1024) {
  if (e.method === 0) return packed
  if (e.method === 8) return zlib.inflateRawSync(packed, { maxOutputLength: Math.max(1, max) })
  return null
}

// ---------- From a file ----------
// A zip on disk: its parts listed from its central directory, each read when it's asked for. Read
// without counting as opening it (openread.js), as the rest of what Files shows is.
export async function openZip(file) {
  const fh = await openToRead(file)
  try {
    const { size } = await fh.stat()
    const read = async (at, n) => { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, at); return bytesRead === n ? b : b.subarray(0, bytesRead) }
    const from = Math.max(0, size - TAIL)
    let end = endOf(await read(from, size - from), from)
    if (!end) throw new Error('not a zip')
    if (end.zip64At != null) end = end64(await read(end.zip64At, 56))
    if (!end || end.offset + end.size > size) throw new Error('not a zip')
    const entries = partsIn(await read(end.offset, end.size), end.count)
    // A part's own header and where its packed bytes are.
    const where = async (e) => {
      const head = await read(e.local, 30)
      if (head.length < 30 || head.readUInt32LE(0) !== LOC) throw new Error(`${e.name} isn't where the zip says it is`)
      return dataAt(head, e)
    }
    return {
      size, entries,
      // Its packed bytes, as they are in the file (to copy into another zip as they are).
      packed: async (e) => read(await where(e), e.csize),
      // Its bytes, unpacked; the first `first` of them only, when that's all that's needed (a
      // picture's size is in its first bytes).
      read: async (e, { max = 256 * 1024 * 1024, first = 0 } = {}) => {
        const at = await where(e)
        if (first && e.method === 0) return read(at, Math.min(first, e.csize))
        if (first && e.method === 8) {
          const packed = await read(at, Math.min(e.csize, Math.max(first, 64 * 1024)))
          try { return zlib.inflateRawSync(packed, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 8 * 1024 * 1024 }).subarray(0, first) } catch { return Buffer.alloc(0) }
        }
        return unpack(await read(at, e.csize), e, max)
      },
      close: () => fh.close().catch(() => {}),
    }
  } catch (e) { await fh.close().catch(() => {}); throw e }
}

// ---------- Writing ----------
// A zip from parts, each { name, method, crc, csize, size, packed (its bytes as packed), time,
// date }, in that order. Under 4 GB and 65,535 parts (what Studio saves is far less).
export function zipOf(parts) {
  const chunks = []
  const cen = []
  let at = 0
  for (const p of parts) {
    const name = Buffer.from(p.name, 'utf8')
    const h = Buffer.alloc(30)
    h.writeUInt32LE(LOC, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(p.method, 8)
    h.writeUInt16LE(p.time || 0, 10); h.writeUInt16LE(p.date || 0x21, 12); h.writeUInt32LE(p.crc >>> 0, 14)
    h.writeUInt32LE(p.csize, 18); h.writeUInt32LE(p.size, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(CEN, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(p.method, 10)
    c.writeUInt16LE(p.time || 0, 12); c.writeUInt16LE(p.date || 0x21, 14); c.writeUInt32LE(p.crc >>> 0, 16)
    c.writeUInt32LE(p.csize, 20); c.writeUInt32LE(p.size, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(at, 42)
    cen.push(c, name)
    chunks.push(h, name, p.packed)
    at += 30 + name.length + p.packed.length
    if (at > 0xfffffff0) throw new Error('Too big a zip to write here (4 GB at most)')
  }
  if (parts.length > 0xfffe) throw new Error('Too many parts in one zip to write here')
  const cd = Buffer.concat(cen)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(EOCD, 0); e.writeUInt16LE(parts.length, 8); e.writeUInt16LE(parts.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(at, 16)
  return Buffer.concat([...chunks, cd, e])
}
// A part to write as it is (stored, not packed): for zipOf.
export function stored(name, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
  return { name, method: 0, crc: zlib.crc32 ? zlib.crc32(buf) : crc32(buf), csize: buf.length, size: buf.length, packed: buf }
}
let table = null
export function crc32(buf) {
  table ||= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  let c = 0xffffffff
  for (const x of buf) c = table[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
