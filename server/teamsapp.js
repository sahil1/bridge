// A bot's Teams app (Bots, a beta feature): what you upload to Teams (Apps › Manage your apps ›
// Upload an app) to add the bot there. A zip of three files, made here with nothing downloaded:
//   manifest.json   the app: its name (the bot's), what it says it does, the bot in it (the Azure
//                   Bot's app ID), where it can be used (a chat with it, a team's channels, group
//                   chats), and that it may read the messages of a channel or chat it's added to
//                   (resource-specific consent, granted by whoever adds it there), so a reply in a
//                   thread it answered in needs no mention, as in Slack
//   color.png       its icon, 192×192: a speech bubble on a colour of its own
//   outline.png     the same, 32×32, white on transparent (Teams' rule for the small one)
// Teams wants a higher version to take an app changed since it was uploaded: the version goes up
// whenever what's in the manifest does (teamsbot.js keeps track).
import zlib from 'node:zlib'
import crypto from 'node:crypto'

export const SHORT_MAX = 30 // Teams' longest short name
const COLORS = ['#3B5BDB', '#2B8A3E', '#C2255C', '#D9480F', '#5F3DC4', '#0B7285', '#364FC7', '#1D2330']
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
export const colorOf = (name) => COLORS[crypto.createHash('sha256').update(String(name || '')).digest()[0] % COLORS.length]

// The manifest, as Teams' schema 1.17 has it.
export function manifest({ name, description = '', you = '', appId, teamsAppId, version = '1.0.0' }) {
  const short = clean(name, SHORT_MAX) || 'Bridge AI'
  const who = clean(you, 32)
  const line = clean(description, 80) || clean(who ? `Answers questions for ${who}` : 'Answers questions from the folders it\'s given', 80)
  return {
    $schema: 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json',
    manifestVersion: '1.17',
    version,
    id: teamsAppId,
    developer: {
      name: who || short,
      websiteUrl: 'https://github.com/sahil1/bridge',
      privacyUrl: 'https://github.com/sahil1/bridge/blob/main/PRIVACY.md',
      termsOfUseUrl: 'https://github.com/sahil1/bridge/blob/main/TERMS.md',
    },
    name: { short, full: clean(name, 100) || short },
    description: {
      short: line,
      full: clean(`${line}. ${short} is a bot${who ? ` ${who} runs` : ''} in Bridge AI on their own computer: it answers from the folders it's given, and ${who || 'its owner'} reviews its answers unless they let it answer on its own.`, 4000),
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    accentColor: colorOf(name),
    bots: [{ botId: appId, scopes: ['personal', 'team', 'groupChat'], supportsFiles: false, isNotificationOnly: false }],
    permissions: ['identity', 'messageTeamMembers'],
    validDomains: [],
    webApplicationInfo: { id: appId, resource: 'https://RscBasedStoreApp' },
    authorization: { permissions: { resourceSpecific: [{ name: 'ChannelMessage.Read.Group', type: 'Application' }, { name: 'ChatMessage.Read.Chat', type: 'Application' }] } },
  }
}

// ---------- PNG ----------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c } return t })()
export function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const chunk = (type, data) => { const t = Buffer.from(type, 'ascii'); return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))]) }
// An RGBA picture as a PNG: px(x, y) gives [r, g, b, a] for a pixel's centre, sampled 4×4 for
// smooth edges.
export function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const c = px(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)
        const al = c[3] / 255
        r += c[0] * al; g += c[1] * al; b += c[2] * al; a += al
      }
      const o = y * (w * 4 + 1) + 1 + x * 4
      raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0; raw[o + 3] = Math.round((a / 16) * 255)
    }
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6; head[10] = 0; head[11] = 0; head[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// A speech bubble with three dots, in a box `s` wide: a rounded box, its tail at the lower left.
const inRound = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
const inTri = (x, y, [ax, ay], [bx, by], [cx, cy]) => {
  const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry)
  const d1 = d(x, y, ax, ay, bx, by); const d2 = d(x, y, bx, by, cx, cy); const d3 = d(x, y, cx, cy, ax, ay)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}
const bubble = (x, y, s, grow = 0) => {
  const k = s / 192
  return inRound(x, y, (36 - grow) * k, (44 - grow) * k, (156 + grow) * k, (128 + grow) * k, (22 + grow) * k)
    || inTri(x, y, [(58 - grow) * k, 120 * k], [(54 - grow * 1.5) * k, (156 + grow * 1.5) * k], [(96 + grow) * k, 120 * k])
}
const dot = (x, y, s, i) => { const k = s / 192; return (x - (66 + i * 30) * k) ** 2 + (y - 86 * k) ** 2 <= (10 * k) ** 2 }
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]

// The two icons for a bot: color.png (192×192) and outline.png (32×32).
export function icons(name) {
  const bg = hex(colorOf(name))
  const color = png(192, 192, (x, y) => {
    if (bubble(x, y, 192) && ![0, 1, 2].some((i) => dot(x, y, 192, i))) return [255, 255, 255, 255]
    return [...bg, 255]
  })
  // (White on transparent: the bubble's outline, 2 px, and its dots.)
  const outline = png(32, 32, (x, y) => {
    const s = 32
    const ring = bubble(x, y, s, 0) && !bubble(x, y, s, -12)
    return ring || [0, 1, 2].some((i) => dot(x, y, s, i)) ? [255, 255, 255, 255] : [255, 255, 255, 0]
  })
  return { color, outline }
}

// ---------- Zip ----------
// Files in a zip, each deflated, as any unzip (and Teams) reads them.
export function zip(files) {
  const locals = []
  const central = []
  let offset = 0
  const when = { time: 0, date: (2026 - 1980) << 9 | 1 << 5 | 1 } // a fixed date: the same files make the same zip
  for (const [name, data0] of Object.entries(files)) {
    const data = Buffer.isBuffer(data0) ? data0 : Buffer.from(String(data0))
    const packed = zlib.deflateRawSync(data)
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(when.time, 10); local.writeUInt16LE(when.date, 12); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, packed)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10)
    cen.writeUInt16LE(when.time, 12); cen.writeUInt16LE(when.date, 14); cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt32LE(offset, 42)
    central.push(cen, nameBuf)
    offset += 30 + nameBuf.length + packed.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
// What's in a zip made above (for tests, and to check one before it's offered): { name: Buffer }.
export function unzip(buf) {
  const out = {}
  let i = 0
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8)
    const size = buf.readUInt32LE(i + 18)
    const n = buf.readUInt16LE(i + 26)
    const x = buf.readUInt16LE(i + 28)
    const name = buf.subarray(i + 30, i + 30 + n).toString('utf8')
    const data = buf.subarray(i + 30 + n + x, i + 30 + n + x + size)
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data)
    i += 30 + n + x + size
  }
  return out
}

// The app, zipped: { zip, manifest }.
export function appPackage(o) {
  const m = manifest(o)
  const { color, outline } = icons(o.name)
  return { zip: zip({ 'manifest.json': JSON.stringify(m, null, 2), 'color.png': color, 'outline.png': outline }), manifest: m }
}
