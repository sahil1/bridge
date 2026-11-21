// A big Word, Excel or PowerPoint file opened in Studio in parts, so the page (on this computer, or a
// phone through the relay) gets only what it shows. Such a file is a zip (zip.js): its XML (the
// slides, the document, the cells, their layouts and styles) is what the editor holds, and that's
// small; its pictures, videos and embedded files are most of its size. So:
//   - slim(): the file with its XML as it is (each part copied as it was packed, nothing packed
//     again) and, for each picture or other big part, a few bytes in its place that name it (a
//     marker), so the editor sees every part the file has and keeps each where it is;
//   - part(): one of those, when the page shows it: a picture at the size it's drawn at (macOS's
//     sips, else ImageMagick where it's installed, else as it is), kept in the cache;
//   - merge(): a save of such a file, whose markers are put back as the parts they name, copied
//     from the file as it was opened (or from its versions, if it changed since): nothing the page
//     never had is lost, and only what changed is sent.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { CACHE, IS_MAC, IS_WIN } from './paths.js'
import { openToRead } from './openread.js'
import { openZip, entriesIn, packedOf, unpack, zipOf, stored } from './zip.js'
import { imageSize } from '../shared/imagesize.js'

// What the editor holds (kept in the slim file): XML, and anything small.
const MODEL = /\.(xml|rels|vml)$/i
const SMALL = 32 * 1024
export const leftOut = (e) => !MODEL.test(e.name) && e.size > SMALL
const PICTURE = /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', xml: 'application/xml', rels: 'application/xml' }
export const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'

// ---------- The marker ----------
// In a part's place in the slim file: its CRC and size (so a save finds exactly that part again,
// under its own name or, copied with a slide, another), and its name.
const MAGIC = 'BRIDGE-STUDIO-PART/1\n'
export const markerOf = (e) => Buffer.from(`${MAGIC}${(e.crc >>> 0).toString(16)}\n${e.size}\n${e.name}\n`, 'utf8')
function readMarker(buf) {
  if (!buf || buf.length > 2048 || buf.toString('latin1', 0, MAGIC.length) !== MAGIC) return null
  const [crc, size, ...name] = buf.toString('utf8', MAGIC.length).replace(/\n$/, '').split('\n')
  return /^[0-9a-f]{1,8}$/.test(crc) && /^\d+$/.test(size) ? { crc: parseInt(crc, 16) >>> 0, size: Number(size), name: name.join('\n') } : null
}

// ---------- What's in it ----------
// Its parts, read once for each time it changed: what the editor gets (model, in bytes unpacked) and
// what's left on the computer (left: name, size, and a picture's size: shared/imagesize.js).
const indexes = new Map() // real -> { key, at, value }
const keyOf = (st) => `${st.size}:${Math.round(st.mtimeMs)}`
export async function index(real, st) {
  const was = indexes.get(real)
  if (was?.key === keyOf(st)) return was.value
  const z = await openZip(real)
  try {
    let model = 0
    const left = []
    for (const e of z.entries.values()) {
      if (!leftOut(e)) { model += e.size; continue }
      const item = { name: e.name, size: e.size }
      if (PICTURE.test(e.name) || /\.svg$/i.test(e.name)) {
        const s = /\.svg$/i.test(e.name) ? null : imageSize(await z.read(e, { first: 64 * 1024 }).catch(() => null))
        if (s) Object.assign(item, { w: s.w, h: s.h, pw: s.pw, ph: s.ph })
      }
      left.push(item)
    }
    const value = { model, left, parts: z.entries.size }
    indexes.set(real, { key: keyOf(st), value })
    if (indexes.size > 40) indexes.delete(indexes.keys().next().value)
    return value
  } finally { await z.close() }
}

// The file as the page gets it: its XML as it is, a marker in each big part's place.
export async function slim(real) {
  const z = await openZip(real)
  try {
    const out = []
    for (const e of z.entries.values()) {
      if (leftOut(e)) out.push({ ...stored(e.name, markerOf(e)), time: e.time, date: e.date })
      else out.push({ ...e, packed: await z.packed(e) })
    }
    return zipOf(out)
  } finally { await z.close() }
}

// ---------- One part ----------
// A part the page shows, as { file } (a picture made smaller, from the cache) or { stream, length }
// (as it is in the file), with its type. w: the width it's drawn at, in the screen's pixels; a
// picture wider than that comes that wide (a photo with no see-through parts as a JPEG), where this
// computer can make one smaller.
const SIZES = [320, 640, 960, 1280, 1920, 2560, 3840]
const PICS = path.join(CACHE, 'studio-pictures')
export async function part(real, st, name, { w = 0 } = {}) {
  const z = await openZip(real)
  try {
    const e = z.entries.get(String(name))
    if (!e) throw Object.assign(new Error('That part isn\'t in the file'), { status: 404 })
    const want = Number(w) > 0 ? SIZES.find((s) => s >= Number(w)) || SIZES[SIZES.length - 1] : 0
    if (want && PICTURE.test(e.name) && !/\.gif$/i.test(e.name)) {
      const s = imageSize(await z.read(e, { first: 64 * 1024 }).catch(() => null))
      const tool = s && s.pw > want * 1.15 ? await resizer() : null
      if (tool) {
        const file = await smaller({ z, e, real, st, want, alpha: s.alpha, tool }).catch(() => null)
        if (file) return { file, type: file.endsWith('.png') ? 'image/png' : 'image/jpeg', resized: true }
      }
    }
    // As it is: read from the file as it goes, unpacked on the way.
    if (e.method !== 0 && e.method !== 8) throw new Error('That part is packed in a way Studio doesn\'t read')
    if (!e.csize) return { stream: Readable.from([]), length: 0, type: mimeOf(e.name) }
    const start = await startOf(real, e)
    const raw = fs.createReadStream(real, { start, end: start + e.csize - 1 })
    const stream = e.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw
    if (e.method === 8) raw.on('error', (x) => stream.destroy(x))
    return { stream, length: e.size, type: mimeOf(e.name) }
  } finally { await z.close() }
}
async function startOf(real, e) {
  const fh = await openToRead(real)
  try {
    const head = Buffer.alloc(30)
    await fh.read(head, 0, 30, e.local)
    return e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  } finally { await fh.close() }
}

// Making a picture smaller: macOS's own sips; elsewhere ImageMagick, where it's installed (magick,
// or convert on Linux, where that's ImageMagick's and not Windows' own disk tool); else none, and
// pictures come as they are. Looked for once.
let tool = null
async function resizer() {
  if (tool) return tool.value
  const found = async () => {
    if (IS_MAC && fs.existsSync('/usr/bin/sips')) return { kind: 'sips', bin: '/usr/bin/sips' }
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
    for (const n of IS_WIN ? ['magick.exe'] : ['magick', 'convert']) for (const d of dirs) if (fs.existsSync(path.join(d, n))) return { kind: 'magick', bin: path.join(d, n) }
    return null
  }
  tool = { value: await found() }
  return tool.value
}
const run = (bin, args) => new Promise((resolve, reject) => execFile(bin, args, { timeout: 30_000, windowsHide: true }, (err) => (err ? reject(err) : resolve())))
// Two at a time; the same picture asked for twice is made once.
let running = 0
const waiting = []
const making = new Map()
async function smaller({ z, e, real, st, want, alpha, tool: t }) {
  const key = crypto.createHash('sha1').update(`${real}\n${keyOf(st)}\n${e.name}\n${want}`).digest('hex').slice(0, 32)
  const out = path.join(PICS, `${key}${alpha ? '.png' : '.jpg'}`)
  if (await fsp.access(out).then(() => true, () => false)) { fsp.utimes(out, new Date(), new Date()).catch(() => {}); return out }
  if (making.has(key)) return making.get(key)
  const job = (async () => {
    if (running >= 2) await new Promise((r) => waiting.push(r))
    running++
    const tmp = path.join(PICS, `.in-${key}${path.extname(e.name).toLowerCase()}`)
    const made = path.join(PICS, `.out-${key}${alpha ? '.png' : '.jpg'}`)
    try {
      await fsp.mkdir(PICS, { recursive: true })
      await fsp.writeFile(tmp, await z.read(e, { max: 512 * 1024 * 1024 }))
      if (t.kind === 'sips') await run(t.bin, ['--resampleWidth', String(want), '-s', 'format', alpha ? 'png' : 'jpeg', ...(alpha ? [] : ['-s', 'formatOptions', '82']), tmp, '--out', made])
      else await run(t.bin, [`${tmp}[0]`, '-auto-orient', '-resize', `${want}x>`, ...(alpha ? [] : ['-quality', '82', '-background', 'white', '-flatten']), made])
      await fsp.rename(made, out)
      if (Math.random() < 0.05) tidy().catch(() => {})
      return out
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {})
      await fsp.rm(made, { force: true }).catch(() => {})
      running--
      waiting.shift()?.()
    }
  })()
  making.set(key, job)
  try { return await job } finally { making.delete(key) }
}
// The cache of smaller pictures: the ones looked at longest ago go once it's over 400 MB.
async function tidy() {
  const names = (await fsp.readdir(PICS)).filter((n) => !n.startsWith('.'))
  const all = await Promise.all(names.map(async (n) => { const s = await fsp.stat(path.join(PICS, n)).catch(() => null); return s && { n, size: s.size, at: s.mtimeMs } }))
  let total = all.reduce((a, x) => a + (x?.size || 0), 0)
  for (const x of all.filter(Boolean).sort((a, b) => a.at - b.at)) {
    if (total <= 400 * 1024 * 1024) break
    await fsp.rm(path.join(PICS, x.n), { force: true }).catch(() => {})
    total -= x.size
  }
}

// ---------- Saving ----------
// What the page saved (a zip, with markers where it never had the part), with each marker put back
// as the part it names: from the file as it is (sources[0]), else from its versions (the copy it was
// opened from among them), the same part by its CRC and size, under its own name or another (a
// picture on a slide that was copied). One that can't be found anywhere stops the save, saying so:
// nothing is written without it.
export async function merge(buf, sources) {
  const entries = entriesIn(buf)
  if (!entries) throw new Error('What the page sent to save isn\'t the file it opened (not a zip)')
  const opened = new Map()
  const zipAt = async (src) => {
    if (!opened.has(src)) opened.set(src, await openZip(src).catch(() => null))
    return opened.get(src)
  }
  const find = async (m) => {
    for (const src of sources) {
      const z = await zipAt(src)
      if (!z) continue
      const same = z.entries.get(m.name)
      if (same && same.crc >>> 0 === m.crc && same.size === m.size) return { z, e: same }
      for (const e of z.entries.values()) if (e.crc >>> 0 === m.crc && e.size === m.size) return { z, e }
    }
    return null
  }
  try {
    const out = []
    let markers = 0
    for (const e of entries.values()) {
      const packed = packedOf(buf, e)
      if (!packed) throw new Error(`What the page sent to save is damaged (${e.name})`)
      const m = e.size < 2048 ? readMarker(unpack(packed, e, 4096)) : null
      if (!m) { out.push({ ...e, packed }); continue }
      markers++
      const src = await find(m)
      if (!src) throw new Error(`${m.name} (a part of the file the page never had) isn't in the file any more, nor in its versions, so saving it now would lose it. Open the file again, then make the change.`)
      out.push({ ...src.e, name: e.name, packed: await src.z.packed(src.e) })
    }
    return { bytes: zipOf(out), markers }
  } finally { for (const z of opened.values()) await z?.close() }
}

// A file's SHA-256, read as it goes (a big one isn't held in memory for it).
export async function hashFile(file) {
  const h = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), h)
  return h.digest('hex').slice(0, 32)
}
