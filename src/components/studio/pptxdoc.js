// A PowerPoint as Studio edits it, and back, keeping everything it doesn't change exactly as it
// was. The file is read as PowerPoint reads it: each slide's shapes, pictures, lines, groups,
// tables and charts where they are, its placeholders taking their places and text styles from its
// layout and master, its colours and fonts from its theme. Each slide keeps its own XML, one piece
// per thing on it, so a change rewrites only that thing; saving writes only the slides that
// changed, and every other part of the file (masters, layouts, themes, charts' workbooks, media,
// comments, animations) is copied as it was. No browser APIs, so the tests read and write in Node.
import JSZip from 'jszip'

export const EMU_PX = 9525 // 914400 EMU an inch, 96 px an inch
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument.presentationml'

// ---------- XML ----------
// A small scanner that keeps where each element starts and ends in its source, so an element can
// be written back as it was: { name, attrs, kids, s, e } an element, { text } its words.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unent = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m)))
export const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export function parseXml(src) {
  const root = { name: '#doc', attrs: {}, kids: [], s: 0, e: src.length }
  const stack = [root]
  const re = /<(\/?)([A-Za-z_][\w.\-:]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g
  let m
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1]
    if (m[6] != null) { if (m[6].trim() || /:t$|^t$/.test(top.name)) top.kids.push({ text: unent(m[6]) }); continue }
    if (m[5] != null) { top.kids.push({ text: m[5] }); continue }
    if (!m[2]) continue
    if (m[1]) { const el = stack.pop(); if (el) el.e = re.lastIndex; if (!stack.length) stack.push(root); continue }
    const attrs = {}
    if (m[3]) for (const a of m[3].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unent(a[2] ?? a[3])
    const el = { name: m[2], attrs, kids: [], s: m.index, e: re.lastIndex }
    top.kids.push(el)
    if (!m[4]) stack.push(el)
  }
  return root
}
export const kid = (el, name) => el?.kids?.find((k) => k.name === name) || null
export const kids = (el, name) => (el?.kids || []).filter((k) => (name ? k.name === name : k.name))
export function deep(el, name, out = []) { for (const k of el?.kids || []) { if (k.name === name) out.push(k); if (k.kids) deep(k, name, out) } return out }
const first = (el, name) => deep(el, name)[0] || null
const textIn = (el) => (el?.text != null ? el.text : (el?.kids || []).map(textIn).join(''))
const num = (v, d = null) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))
const raw = (src, el) => (el ? src.slice(el.s, el.e) : '')
// An element's attribute set (value) or taken out (null), in its start tag.
export function withAttr(xml, name, value) {
  const end = xml.indexOf('>')
  let head = xml.slice(0, end + 1)
  const re = new RegExp(`\\s${name.replace(':', '\\:')}="[^"]*"`)
  head = head.replace(re, '')
  if (value != null) head = head.replace(/(\s*\/?>)$/, ` ${name}="${esc(value)}"$1`)
  return head + xml.slice(end + 1)
}
// An element's children by name, in the order a schema has them: one taken out, replaced or put
// in its place. order: the children's names in order (a group of names that take one place, as
// fills do, is one entry: ['a:noFill', 'a:solidFill', …]).
export function withChild(xml, names, child, order) {
  const tree = parseXml(xml)
  const el = tree.kids.find((k) => k.name)
  const group = [].concat(names)
  if (!el) return xml
  const self = xml.slice(el.s, el.e).endsWith('/>') && el.kids.length === 0 && !xml.slice(el.s, el.e).includes(`</${el.name}>`)
  if (self) {
    if (!child) return xml
    return xml.slice(0, el.e).replace(/\s*\/>$/, `>${child}</${el.name}>`) + xml.slice(el.e)
  }
  const old = el.kids.filter((k) => k.name && group.includes(k.name))
  let out = xml
  if (old.length) {
    const at = old[0].s
    // Taken out last to first, so where each is stays right.
    for (const k of [...old].reverse()) out = out.slice(0, k.s) + out.slice(k.e)
    return child ? out.slice(0, at) + child + out.slice(at) : out
  }
  if (!child) return xml
  const rank = (n) => order.findIndex((o) => [].concat(o).includes(n))
  const mine = rank(group[0])
  const after = el.kids.find((k) => k.name && rank(k.name) > mine)
  const at = after ? after.s : xml.lastIndexOf(`</${el.name}>`)
  return xml.slice(0, at) + child + xml.slice(at)
}

// ---------- The package ----------
const relsPath = (p) => { const i = p.lastIndexOf('/'); return `${p.slice(0, i + 1)}_rels/${p.slice(i + 1)}.rels` }
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1)
function resolve(from, target) {
  const parts = (target.startsWith('/') ? target.slice(1) : `${dirOf(from)}${target}`).split('/')
  const out = []
  for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.' && x !== '') out.push(x) }
  return out.join('/')
}
// The path from one part to another, as a relationship names it.
export function relTarget(from, to) {
  const a = dirOf(from).split('/').filter(Boolean), b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}
function relsOf(xml, from) {
  const out = {}
  for (const r of deep(parseXml(xml || ''), 'Relationship')) {
    const ext = r.attrs.TargetMode === 'External'
    out[r.attrs.Id] = { id: r.attrs.Id, type: String(r.attrs.Type || '').split('/').pop(), typeUri: r.attrs.Type, target: ext ? r.attrs.Target : resolve(from, r.attrs.Target || ''), external: ext }
  }
  return out
}
function relsXml(rels, from) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">${Object.values(rels).map((r) => `<Relationship Id="${esc(r.id)}" Type="${esc(r.typeUri || `${REL}/${r.type}`)}" Target="${esc(r.external ? r.target : relTarget(from, r.target))}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf' }
export const mimeOf = (p) => MIME[String(p).split('.').pop().toLowerCase()] || 'application/octet-stream'
export const showable = (p) => /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(p)

// ---------- Colours ----------
const SCHEME = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
const PRESET = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', purple: '800080', navy: '000080' }
const rgbOf = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const hexOf = (a) => a.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
function hsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function rgb([h, s, l]) {
  if (!s) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)]
}
// A colour element (srgbClr, schemeClr…) with what changes it (lumMod, tint, alpha…): { hex, alpha }.
// cx: { scheme, map } the theme's colours and the master's names for them; ph: the colour a style
// puts in phClr.
export function colorOf(el, cx, ph = null) {
  if (!el) return null
  let hex = null
  const v = el.attrs.val
  if (el.name === 'a:srgbClr') hex = /^[0-9a-f]{6}$/i.test(v || '') ? v.toUpperCase() : null
  else if (el.name === 'a:sysClr') hex = (el.attrs.lastClr || (v === 'window' ? 'FFFFFF' : '000000')).toUpperCase()
  else if (el.name === 'a:prstClr') hex = PRESET[v] || '000000'
  else if (el.name === 'a:scrgbClr') hex = hexOf(['r', 'g', 'b'].map((k) => num(el.attrs[k], 0) / 100000))
  else if (el.name === 'a:hslClr') hex = hexOf(rgb([num(el.attrs.hue, 0) / 21600000, num(el.attrs.sat, 0) / 100000, num(el.attrs.lum, 0) / 100000]))
  else if (el.name === 'a:schemeClr') {
    if (v === 'phClr') return ph ? applyMods(ph, el) : null
    const slot = cx?.map?.[v] || v
    hex = cx?.scheme?.[slot] || null
  }
  if (!hex) return null
  return applyMods({ hex, alpha: 1 }, el)
}
// Tints and shades are worked out in linear light, as PowerPoint does (accent 1, 4472C4, tinted
// 40% is CFD5EA, a table's banded rows), not in the screen's values.
const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
const toSrgb = (x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055)
function applyMods(c, el) {
  let [r, g, b] = rgbOf(c.hex)
  let alpha = c.alpha ?? 1
  for (const m of el.kids || []) {
    const val = num(m.attrs?.val, 100000) / 100000
    if (m.name === 'a:lumMod' || m.name === 'a:lumOff' || m.name === 'a:satMod' || m.name === 'a:satOff' || m.name === 'a:hueOff' || m.name === 'a:hueMod') {
      const x = hsl([r, g, b])
      if (m.name === 'a:lumMod') x[2] *= val
      else if (m.name === 'a:lumOff') x[2] += val
      else if (m.name === 'a:satMod') x[1] *= val
      else if (m.name === 'a:satOff') x[1] += val
      else if (m.name === 'a:hueOff') x[0] += num(m.attrs?.val, 0) / 21600000
      else x[0] *= val
      x[1] = Math.max(0, Math.min(1, x[1])); x[2] = Math.max(0, Math.min(1, x[2]))
      ;[r, g, b] = rgb(x)
    } else if (m.name === 'a:tint') [r, g, b] = [r, g, b].map((x) => toSrgb(toLinear(x) * val + 1 - val))
    else if (m.name === 'a:shade') [r, g, b] = [r, g, b].map((x) => toSrgb(toLinear(x) * val))
    else if (m.name === 'a:alpha') alpha = val
    else if (m.name === 'a:alphaMod') alpha *= val
    else if (m.name === 'a:inv') [r, g, b] = [1 - r, 1 - g, 1 - b]
    else if (m.name === 'a:gray') { const y = 0.3 * r + 0.59 * g + 0.11 * b; r = g = b = y }
  }
  return { hex: hexOf([r, g, b]), alpha }
}
export const css = (c) => (!c ? 'transparent' : c.alpha >= 1 ? `#${c.hex}` : `rgb(${rgbOf(c.hex).map((x) => Math.round(x * 255)).join(' ')} / ${+c.alpha.toFixed(3)})`)
const COLOR_EL = new Set(['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:scrgbClr', 'a:hslClr'])
const colorKid = (el) => (el?.kids || []).find((k) => COLOR_EL.has(k.name)) || null

// A fill: solidFill, gradFill, blipFill, noFill, pattFill, grpFill. { type, color, stops, angle,
// scaled, radial, path, focus, rid, … } or null when there's none (so it's inherited). A pattern is
// its two colours ({ prst, fg, bg }, color its foreground, for what takes one colour).
export function fillOf(parent, cx, ph = null) {
  for (const k of parent?.kids || []) {
    if (k.name === 'a:noFill') return { type: 'none' }
    if (k.name === 'a:solidFill') return { type: 'solid', color: colorOf(colorKid(k), cx, ph) }
    if (k.name === 'a:gradFill') {
      const stops = deep(k, 'a:gs').map((g) => ({ at: num(g.attrs.pos, 0) / 1000, color: colorOf(colorKid(g), cx, ph) })).filter((x) => x.color).sort((a, b) => a.at - b.at)
      const lin = first(k, 'a:lin'), path = first(k, 'a:path'), to = kid(path, 'a:fillToRect')
      // A radial one grows from the middle of its fillToRect (insets from each side, out of 100000).
      const focus = to ? { x: (num(to.attrs.l, 0) + 100000 - num(to.attrs.r, 0)) / 200000, y: (num(to.attrs.t, 0) + 100000 - num(to.attrs.b, 0)) / 200000 } : { x: 0.5, y: 0.5 }
      return { type: 'grad', stops, angle: lin ? num(lin.attrs.ang, 0) / 60000 : 90, scaled: lin?.attrs.scaled === '1' || lin?.attrs.scaled === 'true', radial: !!path && !lin, path: path?.attrs.path || null, focus }
    }
    if (k.name === 'a:blipFill') return blipOf(k)
    if (k.name === 'a:pattFill') {
      const fg = colorOf(colorKid(kid(k, 'a:fgClr')), cx, ph) || { hex: '000000', alpha: 1 }
      return { type: 'pattern', prst: k.attrs.prst || 'pct5', fg, bg: colorOf(colorKid(kid(k, 'a:bgClr')), cx, ph) || { hex: 'FFFFFF', alpha: 1 }, color: fg }
    }
    if (k.name === 'a:grpFill') return { type: 'group' }
  }
  return null
}
// A picture fill (a:blipFill): its picture, stretched into its box (fillRect: insets from each
// side) or tiled (at tx, ty in px, sx, sy its scale, from its algn corner, flipped or not), cropped
// (srcRect), and what's done to it: see-through (alphaModFix), grey (grayscl), brighter or more
// contrasting (lum), recoloured (duotone). Fractions are of 1.
function blipOf(k) {
  const b = first(k, 'a:blip'), tile = kid(k, 'a:tile'), src = kid(k, 'a:srcRect'), fr = kid(kid(k, 'a:stretch'), 'a:fillRect')
  const box = (el) => (el && ['l', 't', 'r', 'b'].some((n) => el.attrs[n]) ? { l: num(el.attrs.l, 0) / 100000, t: num(el.attrs.t, 0) / 100000, r: num(el.attrs.r, 0) / 100000, b: num(el.attrs.b, 0) / 100000 } : null)
  const amt = kid(b, 'a:alphaModFix'), lum = kid(b, 'a:lum')
  return {
    type: 'blip', rid: deep(b, 'asvg:svgBlip')[0]?.attrs['r:embed'] || b?.attrs['r:embed'] || null,
    tile: tile ? { tx: num(tile.attrs.tx, 0) / EMU_PX, ty: num(tile.attrs.ty, 0) / EMU_PX, sx: num(tile.attrs.sx, 100000) / 100000, sy: num(tile.attrs.sy, 100000) / 100000, flip: tile.attrs.flip || 'none', algn: tile.attrs.algn || 'tl' } : null,
    crop: box(src), inset: box(fr), alpha: amt ? Math.max(0, Math.min(1, num(amt.attrs.amt, 100000) / 100000)) : 1,
    gray: !!kid(b, 'a:grayscl'), lum: lum ? { bright: num(lum.attrs.bright, 0) / 100000, contrast: num(lum.attrs.contrast, 0) / 100000 } : null, duotone: !!kid(b, 'a:duotone'),
  }
}
// A picture's size in px as PowerPoint sizes one (its pixels at its own dots to the inch, 96 when it
// doesn't say), from its first bytes: PNG, JPEG, GIF, BMP and WebP; null for any other.
export function imageSize(b) {
  if (!b || b.length < 30) return null
  const u16 = (o, le) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
  const u32 = (o, le) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0)
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  let w = 0, h = 0, dx = 96, dy = 96
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    w = u32(16); h = u32(20)
    for (let i = 8; i + 12 <= b.length;) {
      const len = u32(i), type = tag(i + 4)
      if (type === 'pHYs' && b[i + 16] === 1 && u32(i + 8) && u32(i + 12)) { dx = Math.round(u32(i + 8) * 0.0254); dy = Math.round(u32(i + 12) * 0.0254) }
      if (type === 'IDAT' || type === 'IEND') break
      i += len + 12
    }
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m === 0xff || m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += m === 0xff ? 1 : 2; continue }
      const len = u16(i + 2)
      if (m === 0xe0 && tag(i + 4) === 'JFIF') { const unit = b[i + 11], x = u16(i + 12), y = u16(i + 14); if (x && y && unit === 1) { dx = x; dy = y } else if (x && y && unit === 2) { dx = x * 2.54; dy = y * 2.54 } }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = u16(i + 5); w = u16(i + 7); break }
      i += 2 + len
    }
  } else if (tag(0) === 'GIF8') { w = u16(6, true); h = u16(8, true) }
  else if (b[0] === 0x42 && b[1] === 0x4d) { w = u32(18, true); h = Math.abs(u32(22, true) | 0); const ppm = u32(38, true); if (ppm) dx = dy = Math.round(ppm * 0.0254) }
  else if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const kind = tag(12)
    if (kind === 'VP8X') { w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16)); h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    else if (kind === 'VP8 ') { w = u16(26, true) & 0x3fff; h = u16(28, true) & 0x3fff }
    else if (kind === 'VP8L') { const v = u32(21, true); w = (v & 0x3fff) + 1; h = ((v >> 14) & 0x3fff) + 1 }
  }
  return w > 0 && h > 0 ? { w: (w * 96) / dx, h: (h * 96) / dy } : null
}
// A line (a:ln): { color, width (px), dash, head, tail } or { none: true }; null: inherited.
export function lineOf(ln, cx, ph = null) {
  if (!ln) return null
  const f = fillOf(ln, cx, ph)
  if (f?.type === 'none') return { none: true }
  const dash = kid(ln, 'a:prstDash')?.attrs.val || null
  const end = (n) => { const e = kid(ln, n); return e && e.attrs.type && e.attrs.type !== 'none' ? { type: e.attrs.type, w: e.attrs.w || 'med', len: e.attrs.len || 'med' } : null }
  return { color: f?.type === 'solid' || f?.type === 'pattern' ? f.color : f?.type === 'grad' ? f.stops[0]?.color : null, width: ln.attrs.w != null ? num(ln.attrs.w, 9525) / EMU_PX : null, dash, head: end('a:headEnd'), tail: end('a:tailEnd'), cap: ln.attrs.cap || null }
}

// ---------- Fonts ----------
// A PowerPoint font, with the ones that look like it on a Mac, Windows and Linux after it.
const LIKE = {
  calibri: "Calibri, Carlito, 'Helvetica Neue', Arial, sans-serif", 'calibri light': "'Calibri Light', Calibri, Carlito, 'Helvetica Neue', Arial, sans-serif",
  aptos: "Aptos, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif", 'aptos display': "'Aptos Display', Aptos, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  cambria: 'Cambria, Caladea, Georgia, serif', 'times new roman': "'Times New Roman', Times, 'Liberation Serif', serif", georgia: 'Georgia, serif',
  arial: "Arial, 'Liberation Sans', Helvetica, sans-serif", helvetica: "Helvetica, 'Helvetica Neue', Arial, sans-serif", 'segoe ui': "'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif",
  'century gothic': "'Century Gothic', Futura, 'Avenir Next', sans-serif", 'gill sans mt': "'Gill Sans MT', 'Gill Sans', 'Helvetica Neue', sans-serif", 'tw cen mt': "'Tw Cen MT', 'Avenir Next Condensed', 'Arial Narrow', sans-serif",
  'courier new': "'Courier New', Courier, 'Liberation Mono', monospace", consolas: "Consolas, Menlo, 'DejaVu Sans Mono', monospace", verdana: 'Verdana, Geneva, sans-serif', tahoma: 'Tahoma, Verdana, sans-serif',
  garamond: "Garamond, 'EB Garamond', Georgia, serif", 'franklin gothic book': "'Franklin Gothic Book', 'Franklin Gothic', 'Helvetica Neue', Arial, sans-serif",
}
export function fontCss(name) {
  const n = String(name || '').replace(/['"\\;{}<>]/g, '').trim()
  if (!n) return "'Helvetica Neue', Arial, sans-serif"
  return LIKE[n.toLowerCase()] || `'${n}', ${/serif|roman|georgia|garamond|cambria|book/i.test(n) && !/sans/i.test(n) ? 'Georgia, serif' : "'Helvetica Neue', Arial, sans-serif"}`
}

// ---------- Text ----------
// A paragraph's properties (from a:pPr or a:lvlNpPr), as far as they say: { algn, marL, indent,
// lnSpc: { pct } | { pts }, spcBef, spcAft, bu, buColor, buSize, buFont, rPr (its default run) }.
function paraProps(el, cx) {
  if (!el) return {}
  const o = {}
  const a = el.attrs
  if (a.algn) o.algn = a.algn
  if (a.marL != null) o.marL = num(a.marL, 0) / EMU_PX
  if (a.indent != null) o.indent = num(a.indent, 0) / EMU_PX
  if (a.lvl != null) o.lvl = num(a.lvl, 0)
  const spc = (n) => { const s = kid(el, n); if (!s) return undefined; const p = kid(s, 'a:spcPct'), t = kid(s, 'a:spcPts'); return p ? { pct: num(p.attrs.val, 100000) / 100000 } : t ? { pts: num(t.attrs.val, 0) / 100 } : undefined }
  for (const [k, n] of [['lnSpc', 'a:lnSpc'], ['spcBef', 'a:spcBef'], ['spcAft', 'a:spcAft']]) { const v = spc(n); if (v) o[k] = v }
  for (const k of el.kids || []) {
    if (k.name === 'a:buNone') o.bu = { none: true }
    else if (k.name === 'a:buChar') o.bu = { char: k.attrs.char || '•' }
    else if (k.name === 'a:buAutoNum') o.bu = { auto: k.attrs.type || 'arabicPeriod', start: num(k.attrs.startAt, 1) }
    else if (k.name === 'a:buBlip') o.bu = { char: '•' }
    else if (k.name === 'a:buClr') o.buColor = colorOf(colorKid(k), cx)
    else if (k.name === 'a:buClrTx') o.buColor = null
    else if (k.name === 'a:buSzPct') o.buSize = num(k.attrs.val, 100000) / 100000
    else if (k.name === 'a:buFont') o.buFont = k.attrs.typeface
    else if (k.name === 'a:defRPr') o.rPr = runProps(k, cx)
  }
  return o
}
// A run's properties (a:rPr, a:defRPr, a:endParaRPr): { sz (pt), b, i, u, strike, color, font,
// cap, baseline, highlight, spc, link }.
function runProps(el, cx) {
  if (!el) return {}
  const o = {}, a = el.attrs
  if (a.sz != null) o.sz = num(a.sz, 1800) / 100
  if (a.b != null) o.b = a.b === '1' || a.b === 'true'
  if (a.i != null) o.i = a.i === '1' || a.i === 'true'
  if (a.u != null) o.u = a.u !== 'none'
  if (a.strike != null) o.strike = a.strike !== 'noStrike'
  if (a.cap != null) o.cap = a.cap
  if (a.baseline != null) o.baseline = num(a.baseline, 0) / 1000
  if (a.spc != null) o.spc = num(a.spc, 0) / 100
  const f = fillOf(el, cx)
  if (f?.type === 'solid' || f?.type === 'pattern') o.color = f.color
  else if (f?.type === 'grad') o.color = f.stops[0]?.color || null
  else if (f?.type === 'none') o.color = { hex: 'FFFFFF', alpha: 0 }
  const lat = kid(el, 'a:latin')
  if (lat?.attrs.typeface) o.font = lat.attrs.typeface
  const hl = kid(el, 'a:highlight')
  if (hl) o.highlight = colorOf(colorKid(hl), cx)
  if (kid(el, 'a:hlinkClick')) o.link = true
  return o
}
const mergeP = (a, b) => ({ ...a, ...b, rPr: { ...(a.rPr || {}), ...(b.rPr || {}) } })
// A list style's levels (a:lstStyle, a:titleStyle, a:bodyStyle…): nine paragraph properties.
function levelsOf(el, cx) {
  const out = Array.from({ length: 9 }, () => ({}))
  if (!el) return out
  const def = paraProps(kid(el, 'a:defPPr'), cx)
  for (let i = 0; i < 9; i++) out[i] = mergeP(def, paraProps(kid(el, `a:lvl${i + 1}pPr`), cx))
  return out
}
const mergeLevels = (...ls) => Array.from({ length: 9 }, (_, i) => ls.reduce((acc, l) => mergeP(acc, l?.[i] || {}), {}))

// A text body as it's kept for editing: each paragraph's own XML in pieces, so writing it back
// keeps what Studio doesn't change. { bodyPr, lstStyle, paras: [{ pPr, runs: [{ rPr, text, br,
// fld }], end }] }, each piece its XML.
export function textModel(txBody, src) {
  if (!txBody) return null
  const paras = kids(txBody, 'a:p').map((p) => {
    const out = { pPr: '', runs: [], end: '' }
    for (const k of p.kids) {
      if (k.name === 'a:pPr') out.pPr = raw(src, k)
      else if (k.name === 'a:r') out.runs.push({ rPr: raw(src, kid(k, 'a:rPr')), text: textIn(kid(k, 'a:t')) })
      else if (k.name === 'a:br') out.runs.push({ rPr: raw(src, kid(k, 'a:rPr')), text: '', br: true })
      else if (k.name === 'a:fld') out.runs.push({ rPr: raw(src, kid(k, 'a:rPr')), text: textIn(kid(k, 'a:t')), fld: raw(src, k), type: k.attrs.type || '' })
      else if (k.name === 'a:endParaRPr') out.end = raw(src, k)
    }
    return out
  })
  return { bodyPr: raw(src, kid(txBody, 'a:bodyPr')), lstStyle: raw(src, kid(txBody, 'a:lstStyle')), paras }
}
// A text model written back as a text body (p:txBody, or a:txBody in a table cell).
export function textXml(t, tag = 'p:txBody') {
  const paras = (t.paras.length ? t.paras : [{ pPr: '', runs: [], end: '' }]).map((p) => {
    const runs = p.runs.map((r) => {
      if (r.br) return `<a:br>${r.rPr || ''}</a:br>`
      if (r.fld) {
        const tree = parseXml(r.fld).kids[0]
        const tEl = deep(tree, 'a:t')[0]
        if (!tEl || textIn(tEl) === r.text) return r.fld
        return r.fld.slice(0, tEl.s) + `<a:t>${esc(r.text)}</a:t>` + r.fld.slice(tEl.e)
      }
      return `<a:r>${r.rPr || ''}<a:t>${esc(r.text)}</a:t></a:r>`
    }).join('')
    return `<a:p>${p.pPr || ''}${runs}${p.end || ''}</a:p>`
  }).join('')
  return `<${tag}>${t.bodyPr || '<a:bodyPr/>'}${t.lstStyle || '<a:lstStyle/>'}${paras}</${tag}>`
}
// The words of a text model, a paragraph a line.
export const plainOf = (t) => (t?.paras || []).map((p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join('')).join('\n')

// A run's properties, set: { b, i, u, strike, sz, color (hex or null), font, baseline } on its
// a:rPr's XML (or a new one); null takes one off.
const RPR_ORDER = ['a:ln', ['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill'], 'a:effectLst', 'a:effectDag', 'a:highlight', 'a:uLnTx', 'a:uLn', 'a:uFillTx', 'a:uFill', 'a:latin', 'a:ea', 'a:cs', 'a:sym', 'a:hlinkClick', 'a:hlinkMouseOver', 'a:rtl', 'a:extLst']
export function withRun(rPr, set, tag = 'a:rPr') {
  let x = rPr || `<${tag} lang="en-US" dirty="0"/>`
  for (const [k, v] of Object.entries(set)) {
    if (k === 'b' || k === 'i') x = withAttr(x, k, v == null ? null : v ? '1' : '0')
    else if (k === 'u') x = withAttr(x, 'u', v == null ? null : v ? 'sng' : 'none')
    else if (k === 'strike') x = withAttr(x, 'strike', v == null ? null : v ? 'sngStrike' : 'noStrike')
    else if (k === 'sz') x = withAttr(x, 'sz', v == null ? null : String(Math.round(v * 100)))
    else if (k === 'baseline') x = withAttr(x, 'baseline', v ? String(Math.round(v * 1000)) : null)
    else if (k === 'color') x = withChild(x, RPR_ORDER[1], v ? `<a:solidFill><a:srgbClr val="${String(v).replace('#', '').toUpperCase()}"/></a:solidFill>` : null, RPR_ORDER)
    else if (k === 'highlight') x = withChild(x, 'a:highlight', v ? `<a:highlight><a:srgbClr val="${String(v).replace('#', '').toUpperCase()}"/></a:highlight>` : null, RPR_ORDER)
    else if (k === 'font') { x = withChild(x, 'a:latin', v ? `<a:latin typeface="${esc(v)}"/>` : null, RPR_ORDER); x = withChild(x, 'a:cs', v ? `<a:cs typeface="${esc(v)}"/>` : null, RPR_ORDER) }
  }
  return x.replace(/\sdirty="[^"]*"/, ' dirty="0"').replace(/\serr="1"/, '')
}
// A paragraph's properties, set: { algn, lvl, bullet: 'char' | 'num' | 'none' | null (as its
// level has it), lnSpc (a multiple, or null) }.
const PPR_ORDER = ['a:lnSpc', 'a:spcBef', 'a:spcAft', ['a:buClrTx', 'a:buClr'], ['a:buSzTx', 'a:buSzPct', 'a:buSzPts'], ['a:buFontTx', 'a:buFont'], ['a:buNone', 'a:buAutoNum', 'a:buChar', 'a:buBlip'], 'a:tabLst', 'a:defRPr', 'a:extLst']
export function withPara(pPr, set) {
  let x = pPr || '<a:pPr/>'
  for (const [k, v] of Object.entries(set)) {
    if (k === 'algn') x = withAttr(x, 'algn', v || null)
    else if (k === 'lvl') x = withAttr(x, 'lvl', v ? String(v) : null)
    else if (k === 'lnSpc') x = withChild(x, 'a:lnSpc', v ? `<a:lnSpc><a:spcPct val="${Math.round(v * 100000)}"/></a:lnSpc>` : null, PPR_ORDER)
    else if (k === 'bullet') {
      const MARKS = ['a:buNone', 'a:buAutoNum', 'a:buChar', 'a:buBlip']
      x = withChild(x, ['a:buFontTx', 'a:buFont'], null, PPR_ORDER)
      x = withChild(x, MARKS, null, PPR_ORDER)
      if (v === 'none') x = withAttr(withAttr(withChild(x, MARKS, '<a:buNone/>', PPR_ORDER), 'marL', '0'), 'indent', '0')
      else if (v === 'num' || v === 'char') {
        x = withChild(x, ['a:buFontTx', 'a:buFont'], v === 'num' ? '<a:buFont typeface="+mj-lt"/>' : '<a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/>', PPR_ORDER)
        x = withChild(x, MARKS, v === 'num' ? '<a:buAutoNum type="arabicPeriod"/>' : '<a:buChar char="•"/>', PPR_ORDER)
        // A bullet needs room to hang in.
        if (!/\smarL="[1-9]/.test(x.slice(0, x.indexOf('>')))) x = withAttr(withAttr(x, 'marL', String(342900 + 457200 * num(/\slvl="(\d)"/.exec(x)?.[1], 0))), 'indent', '-342900')
      }
    }
  }
  return x === '<a:pPr/>' ? '' : x
}

// ---------- Reading ----------
// A placeholder's own (type, idx) and the one it takes after on its layout and master.
const phOf = (el) => { const nv = kid(el, 'p:nvSpPr') || kid(el, 'p:nvPicPr') || kid(el, 'p:nvGraphicFramePr') || kid(el, 'p:nvCxnSpPr'); const ph = nv && first(nv, 'p:ph'); return ph ? { type: ph.attrs.type || 'body', idx: ph.attrs.idx != null ? String(ph.attrs.idx) : null, hasType: !!ph.attrs.type } : null }
function matchPh(list, ph, master = false) {
  if (!ph || !list) return null
  if (!master && ph.idx != null) { const m = list.find((x) => x.ph.idx === ph.idx); if (m && (m.ph.type === ph.type || !ph.hasType || !m.ph.hasType || /^(body|obj|subTitle)$/.test(ph.type))) return m }
  const t = master ? ({ ctrTitle: 'title', subTitle: 'body', obj: 'body', chart: 'body', tbl: 'body', clipArt: 'body', dgm: 'body', media: 'body', pic: 'body' }[ph.type] || ph.type) : ph.type
  return list.find((x) => x.ph.type === t) || (t === 'ctrTitle' ? list.find((x) => x.ph.type === 'title') : null) || (!master && t === 'subTitle' ? list.find((x) => x.ph.type === 'body') : null) || (master && t !== 'title' && !['dt', 'ftr', 'sldNum', 'hdr'].includes(t) ? list.find((x) => x.ph.type === 'body') : null)
}
const xfrmOf = (x) => {
  if (!x) return null
  const off = kid(x, 'a:off'), ext = kid(x, 'a:ext')
  if (!off || !ext) return null
  const o = { x: num(off.attrs.x, 0), y: num(off.attrs.y, 0), w: num(ext.attrs.cx, 0), h: num(ext.attrs.cy, 0), rot: num(x.attrs.rot, 0) / 60000, flipH: x.attrs.flipH === '1', flipV: x.attrs.flipV === '1' }
  const co = kid(x, 'a:chOff'), ce = kid(x, 'a:chExt')
  if (co && ce) o.ch = { x: num(co.attrs.x, 0), y: num(co.attrs.y, 0), w: num(ce.attrs.cx, 0), h: num(ce.attrs.cy, 0) }
  return o
}
// What a part's shapes and placeholders are (a slide, its layout, its master), parsed once.
function partOf(doc, path, xml) {
  const tree = parseXml(xml)
  const top = tree.kids.find((k) => k.name)
  const cSld = kid(top, 'p:cSld')
  const spTree = kid(cSld, 'p:spTree')
  const phs = []
  for (const k of kids(spTree)) { const ph = phOf(k); if (ph) phs.push({ ph, el: k, xfrm: xfrmOf(kid(kid(k, 'p:spPr'), 'a:xfrm') || kid(k, 'p:xfrm')) }) }
  const rels = relsOf(doc.text(relsPath(path)), path)
  return { path, xml, tree, top, cSld, spTree, phs, rels, name: cSld?.attrs.name || '' }
}
function themeOf(xml, rels = {}) {
  const tree = parseXml(xml || '')
  const scheme = {}
  const cs = first(tree, 'a:clrScheme')
  for (const s of SCHEME) { const el = kid(cs, `a:${s}`); const c = colorKid(el); if (c) scheme[s] = c.name === 'a:sysClr' ? (c.attrs.lastClr || (c.attrs.val === 'window' ? 'FFFFFF' : '000000')).toUpperCase() : (c.attrs.val || '000000').toUpperCase() }
  const font = (w) => kid(first(tree, `a:${w}`), 'a:latin')?.attrs.typeface || null
  const fmt = first(tree, 'a:fmtScheme')
  return { scheme, fonts: { major: font('majorFont'), minor: font('minorFont') }, fills: kids(kid(fmt, 'a:fillStyleLst')), lines: kids(kid(fmt, 'a:lnStyleLst')), bgFills: kids(kid(fmt, 'a:bgFillStyleLst')), src: xml || '', rels }
}
const clrMapOf = (el) => (el ? { ...el.attrs } : null)

// The file, read: { size: { cx, cy }, slides, layouts, masters, … } with what saving needs.
export async function readPptx(buf) {
  const zip = await JSZip.loadAsync(buf)
  const texts = new Map()
  const bin = new Map()
  for (const [name, f] of Object.entries(zip.files)) {
    if (f.dir) continue
    if (/\.(xml|rels)$/i.test(name)) texts.set(name, await f.async('string'))
    else if (showable(name)) bin.set(name, await f.async('uint8array'))
  }
  // Pictures' bytes are read at once, so a slide's can be drawn as soon as it's asked for.
  const doc = { zip, texts, bin, text: (p) => texts.get(p) ?? null, layouts: new Map(), masters: new Map(), themes: new Map() }
  const rootRels = relsOf(doc.text('_rels/.rels'), '')
  const presPath = Object.values(rootRels).find((r) => r.type === 'officeDocument')?.target || 'ppt/presentation.xml'
  const presXml = doc.text(presPath)
  if (!presXml) throw new Error('This isn\'t a PowerPoint file (it has no presentation in it)')
  const pres = parseXml(presXml)
  doc.presPath = presPath
  doc.presRels = relsOf(doc.text(relsPath(presPath)), presPath)
  const sz = first(pres, 'p:sldSz')
  doc.size = { cx: num(sz?.attrs.cx, 12192000), cy: num(sz?.attrs.cy, 6858000) }
  doc.defaultText = first(pres, 'p:defaultTextStyle')
  doc.notesMaster = Object.values(doc.presRels).find((r) => r.type === 'notesMaster')?.target || null
  const ts = doc.text(Object.values(doc.presRels).find((r) => r.type === 'tableStyles')?.target || '')
  doc.tableStyles = new Map(deep(parseXml(ts || ''), 'a:tblStyle').map((s) => [s.attrs.styleId, s]))
  doc.layoutOf = (path) => {
    if (!doc.layouts.has(path)) {
      const xml = doc.text(path)
      if (!xml) return null
      const l = partOf(doc, path, xml)
      l.type = l.top?.attrs.type || 'cust'
      l.master = Object.values(l.rels).find((r) => r.type === 'slideMaster')?.target || null
      l.showMasterSp = l.top?.attrs.showMasterSp !== '0'
      l.clrMapOvr = clrMapOf(first(kid(l.top, 'p:clrMapOvr'), 'a:overrideClrMapping'))
      doc.layouts.set(path, l)
    }
    return doc.layouts.get(path)
  }
  doc.masterOf = (path) => {
    if (!doc.masters.has(path)) {
      const xml = doc.text(path)
      if (!xml) return null
      const m = partOf(doc, path, xml)
      m.theme = Object.values(m.rels).find((r) => r.type === 'theme')?.target || null
      m.clrMap = clrMapOf(kid(m.top, 'p:clrMap')) || {}
      const tx = kid(m.top, 'p:txStyles')
      m.txStyles = { title: kid(tx, 'p:titleStyle'), body: kid(tx, 'p:bodyStyle'), other: kid(tx, 'p:otherStyle') }
      m.layouts = kids(kid(m.top, 'p:sldLayoutIdLst'), 'p:sldLayoutId').map((x) => m.rels[x.attrs['r:id']]?.target).filter(Boolean)
      doc.masters.set(path, m)
    }
    return doc.masters.get(path)
  }
  doc.themeOf = (path) => { if (!doc.themes.has(path)) doc.themes.set(path, themeOf(doc.text(path), relsOf(doc.text(relsPath(path)), path))); return doc.themes.get(path) }
  let key = 0
  doc.slides = kids(first(pres, 'p:sldIdLst'), 'p:sldId').map((s) => {
    const rid = s.attrs['r:id']
    const path = doc.presRels[rid]?.target
    return path && doc.text(path) ? slideOf(doc, path, { rid, sldId: s.attrs.id, key: `s${key++}` }) : null
  }).filter(Boolean)
  doc.nextKey = () => `s${key++}`
  // Its comments: the authors, and each slide's (PowerPoint's modern ones).
  doc.authors = authorsOf(doc)
  for (const s of doc.slides) s.comments = slideComments(doc, s)
  return doc
}

// A slide as it's kept: its XML around its shapes (head, tail) and each shape's own (objs).
function slideOf(doc, path, o) {
  const xml = doc.text(path)
  const tree = parseXml(xml)
  const top = tree.kids.find((k) => k.name)
  const spTree = first(top, 'p:spTree')
  const list = kids(spTree)
  const grpSpPr = list.find((k) => k.name === 'p:grpSpPr')
  const headEnd = grpSpPr ? grpSpPr.e : (kid(spTree, 'p:nvGrpSpPr')?.e ?? spTree.e)
  const ext = list.find((k) => k.name === 'p:extLst')
  const objs = list.filter((k) => k.s >= headEnd && k !== ext).map((k) => raw(xml, k))
  const rels = relsOf(doc.text(relsPath(path)), path)
  const notesPath = Object.values(rels).find((r) => r.type === 'notesSlide')?.target || null
  return {
    ...o, path, orig: path, head: xml.slice(0, headEnd), tail: xml.slice(ext ? ext.s : spTree.e - '</p:spTree>'.length), objs, rels,
    layout: Object.values(rels).find((r) => r.type === 'slideLayout')?.target || null,
    hidden: top?.attrs.show === '0',
    notes: { path: notesPath, text: notesPath ? notesTextOf(doc.text(notesPath)) : '' },
    changed: false,
  }
}
function notesTextOf(xml) {
  const tree = parseXml(xml || '')
  for (const sp of deep(tree, 'p:sp')) {
    const ph = phOf(sp)
    if (ph?.type === 'body') return kids(kid(sp, 'p:txBody'), 'a:p').map((p) => deep(p, 'a:t').map(textIn).join('')).join('\n')
  }
  return ''
}

// ---------- A slide, drawn ----------
// Where each thing on a slide is and how it looks, with everything it takes from its layout,
// master and theme: { w, h (px), bg, under: [the master's and layout's own shapes], objs: [each
// shape on the slide: { at (its place in the slide's list), kind, x, y, w, h (px), rot, flipH,
// flipV, name, ph, geom, fill, line, text, img, kids, table, chart, … }] }.
export function slideView(doc, slide) {
  const layout = slide.layout ? doc.layoutOf(slide.layout) : null
  const master = layout?.master ? doc.masterOf(layout.master) : null
  const theme = master?.theme ? doc.themeOf(master.theme) : themeOf('')
  const slideTop = parseXml(`${slide.head}${slide.tail}`).kids.find((k) => k.name)
  const map = { ...(master?.clrMap || {}), ...(layout?.clrMapOvr || {}), ...(clrMapOf(first(kid(slideTop, 'p:clrMapOvr'), 'a:overrideClrMapping')) || {}) }
  const cx = { doc, theme, scheme: theme.scheme, map, layout, master }
  const view = { w: doc.size.cx / EMU_PX, h: doc.size.cy / EMU_PX, under: [], objs: [] }
  // The background: the slide's own, else its layout's, else its master's; with none, the colour
  // the master's map makes the background (bg1: lt1, or dk1 on a dark master).
  const bgOf = (top, rels) => { const bg = kid(kid(top, 'p:cSld'), 'p:bg'); return bg ? { bg, rels } : null }
  const bgAt = bgOf(slideTop, slide.rels) || (layout && bgOf(layout.top, layout.rels)) || (master && bgOf(master.top, master.rels))
  const plain = { type: 'solid', color: { hex: theme.scheme[map.bg1 || 'lt1'] || 'FFFFFF', alpha: 1 } }
  view.bg = bgAt ? backgroundOf(bgAt.bg, { ...cx, rels: bgAt.rels }) : plain
  // A picture that can't be drawn here (an EMF, a TIFF, or one not in the file): that colour, as
  // the nearest, and what it was kept so the editor can say so.
  if (view.bg.type === 'blip' && view.bg.lost) { view.bgLost = view.bg.lost; view.bg = plain }
  // What the master and layout draw under the slide's own (not their placeholders).
  const showMaster = slideTop?.attrs.showMasterSp !== '0'
  if (showMaster && master && layout?.showMasterSp !== false) for (const k of kids(master.spTree)) { if (!phOf(k)) { const o = objOf(k, master.xml, { ...cx, rels: master.rels, level: 'master' }); if (o) view.under.push(o) } }
  if (showMaster && layout) for (const k of kids(layout.spTree)) { if (!phOf(k)) { const o = objOf(k, layout.xml, { ...cx, rels: layout.rels, level: 'layout' }); if (o) view.under.push(o) } }
  slide.objs.forEach((xml, at) => {
    const el = parseXml(xml).kids.find((k) => k.name)
    const o = el && objOf(el, xml, { ...cx, rels: slide.rels, level: 'slide' })
    if (o) { o.at = at; view.objs.push(o) }
  })
  return view
}
// The deck's look in a Markdown deck's terms (pptx.js, and AI Assist's slides shown before they're
// kept), from its first slide's master: its background as one colour (a see-through one over
// white, a gradient's middle, a pattern's two mixed, a picture's nearest: the colour its colour map
// makes the background), its titles' colour (its title style, through that map), its first accent
// and its fonts. Words that wouldn't read on that background are the theme's dark or light,
// whichever reads. Colours as #rrggbb.
export function deckLook(doc) {
  const s = doc.slides[0]
  const layout = s?.layout ? doc.layoutOf(s.layout) : null
  const master = layout?.master ? doc.masterOf(layout.master) : null
  if (!master) return null
  const theme = master.theme ? doc.themeOf(master.theme) : themeOf('')
  const cx = { doc, theme, scheme: theme.scheme, map: { ...master.clrMap, ...(layout?.clrMapOvr || {}) }, layout, master }
  const named = (n) => colorOf({ name: 'a:schemeClr', attrs: { val: n }, kids: [] }, cx) || { hex: n === 'bg1' ? 'FFFFFF' : '000000', alpha: 1 }
  const blend = (c, under = 'FFFFFF') => { const a = rgbOf(c.hex), b = rgbOf(under); return hexOf(a.map((v, i) => v * c.alpha + b[i] * (1 - c.alpha))) }
  const mixed = (a, b, t) => ({ hex: hexOf(rgbOf(a.hex).map((v, i) => v + (rgbOf(b.hex)[i] - v) * t)), alpha: a.alpha + (b.alpha - a.alpha) * t })
  const own = kid(kid(master.top, 'p:cSld'), 'p:bg')
  const bg = own ? backgroundOf(own, { ...cx, rels: master.rels }) : { type: 'none' }
  const at = (stops, x) => { const i = stops.findIndex((g) => g.at >= x); if (i < 0) return stops.at(-1).color; if (i === 0) return stops[0].color; const a = stops[i - 1], b = stops[i]; return mixed(a.color, b.color, (x - a.at) / Math.max(0.001, b.at - a.at)) }
  const one = bg.type === 'solid' && bg.color ? bg.color : bg.type === 'grad' && bg.stops.length ? at(bg.stops, 50) : bg.type === 'pattern' ? mixed(bg.fg, bg.bg, 0.5) : null
  const back = blend(one || named('bg1'))
  const lum = (h) => { const [r, g, b] = rgbOf(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const title = levelsOf(master.txStyles.title, cx)[0]?.rPr?.color
  let text = blend(title || named('tx1'), back)
  if (contrast(text, back) < 3) text = [named('dk1').hex, named('lt1').hex].sort((a, b) => contrast(b, back) - contrast(a, back))[0]
  return { name: 'theme', colors: { background: `#${back.toLowerCase()}`, text: `#${text.toLowerCase()}`, accent: `#${blend(named('accent1')).toLowerCase()}` }, fonts: { heading: theme.fonts.major, body: theme.fonts.minor } }
}
// A background (p:bg): its own fill (p:bgPr), or one of the theme's styles in a colour (p:bgRef:
// 1001 and on the background styles, 1 to 999 the shapes' fills), a picture's in the part that
// names it (the theme's, for a style).
function backgroundOf(bg, cx) {
  const pr = kid(bg, 'p:bgPr')
  if (pr) return withPicture(fillOf(pr, cx) || { type: 'none' }, cx)
  const ref = kid(bg, 'p:bgRef')
  if (ref) {
    const idx = num(ref.attrs.idx, 0)
    const ph = colorOf(colorKid(ref), cx)
    const style = idx >= 1001 ? cx.theme.bgFills[idx - 1001] : idx > 0 ? cx.theme.fills[idx - 1] : null
    const tcx = { ...cx, rels: cx.theme.rels }
    const f = style ? withPicture(fillOf({ kids: [style] }, tcx, ph), tcx) : null
    return f || (ph ? { type: 'solid', color: ph } : { type: 'none' })
  }
  return { type: 'none' }
}
// A picture fill with its address and its size (for tiling); lost: its kind, when it can't be shown.
function withPicture(f, cx) {
  if (f?.type !== 'blip') return f
  const part = cx.rels?.[f.rid]?.target || null
  const bytes = part ? cx.doc.bin.get(part) : null
  if (!bytes) return { ...f, lost: part && cx.doc.zip?.file(part) ? (part.split('.').pop() || '').toUpperCase() : 'missing' }
  return { ...f, part, url: mediaUrl(cx, f.rid), size: imageSize(bytes) }
}
const RENDERED_PH = new Set(['title', 'ctrTitle', 'subTitle', 'body', 'obj', 'pic', 'chart', 'tbl', 'dgm', 'media', 'clipArt', 'sldNum', 'dt', 'ftr', 'hdr'])
// One thing on a slide (or a layout or master), for drawing.
function objOf(el, src, cx, inGroup = false) {
  if (el.name === 'mc:AlternateContent') {
    const pick = kid(el, 'mc:Fallback') || kid(el, 'mc:Choice')
    const inner = pick && kids(pick)[0]
    const o = inner ? objOf(inner, src, cx, inGroup) : null
    if (o) o.alternate = true
    return o
  }
  const kind = { 'p:sp': 'sp', 'p:pic': 'pic', 'p:cxnSp': 'cxn', 'p:grpSp': 'grp', 'p:graphicFrame': 'frame', 'p:contentPart': 'ink' }[el.name]
  if (!kind || kind === 'ink') return null
  const nv = kid(el, { sp: 'p:nvSpPr', pic: 'p:nvPicPr', cxn: 'p:nvCxnSpPr', grp: 'p:nvGrpSpPr', frame: 'p:nvGraphicFramePr' }[kind])
  const cNvPr = kid(nv, 'p:cNvPr')
  const ph = phOf(el)
  if (ph && !RENDERED_PH.has(ph.type)) return null
  const spPr = kid(el, kind === 'grp' ? 'p:grpSpPr' : 'p:spPr')
  // Where it is: its own, else its placeholder's on the layout, else on the master.
  const lph = ph && cx.level === 'slide' ? matchPh(cx.layout?.phs, ph) : null
  const mph = ph && cx.level !== 'master' ? matchPh(cx.master?.phs, lph?.ph || ph, true) : null
  const xf = xfrmOf(kind === 'frame' ? kid(el, 'p:xfrm') : kid(spPr, 'a:xfrm')) || lph?.xfrm || mph?.xfrm
  if (!xf) return null
  const o = { kind, id: cNvPr?.attrs.id, name: cNvPr?.attrs.name || '', descr: cNvPr?.attrs.descr || '', hidden: cNvPr?.attrs.hidden === '1', ph, x: xf.x / EMU_PX, y: xf.y / EMU_PX, w: xf.w / EMU_PX, h: xf.h / EMU_PX, rot: xf.rot || 0, flipH: !!xf.flipH, flipV: !!xf.flipV }
  if (o.hidden) return null
  // A style's fill, line and font colour (p:style), under its own.
  const style = kid(el, 'p:style')
  const ref = (n, list) => { const r = kid(style, n); if (!r) return null; const c = colorOf(colorKid(r), cx); const i = num(r.attrs.idx, 0); return { c, el: i > 0 ? list?.[i - 1] : null, idx: i } }
  const fr = ref('a:fillRef', cx.theme.fills), lr = ref('a:lnRef', cx.theme.lines), fo = kid(style, 'a:fontRef')
  if (kind === 'grp') {
    o.ch = xf.ch || { x: xf.x, y: xf.y, w: xf.w, h: xf.h }
    o.ch = { x: o.ch.x / EMU_PX, y: o.ch.y / EMU_PX, w: o.ch.w / EMU_PX, h: o.ch.h / EMU_PX }
    o.kids = kids(el).filter((k) => !/^p:(nvGrpSpPr|grpSpPr)$/.test(k.name)).map((k) => objOf(k, src, { ...cx, groupFill: fillOf(spPr, cx) || cx.groupFill }, true)).filter(Boolean)
    return o
  }
  if (kind === 'frame') {
    const data = first(el, 'a:graphicData')
    const uri = data?.attrs.uri || ''
    if (/table$/.test(uri)) { o.kind = 'table'; o.table = tableOf(first(data, 'a:tbl'), src, cx) } else if (/chart$/.test(uri)) {
      o.kind = 'chart'
      const rid = first(data, 'c:chart')?.attrs['r:id']
      const path = cx.rels[rid]?.target
      o.chart = path ? chartOf(cx.doc.text(path), cx) : null
    } else if (/diagram$/.test(uri)) {
      o.kind = 'diagram'
      // PowerPoint keeps a drawing of the diagram beside it: its shapes, drawn as they are.
      const dm = first(data, 'dgm:relIds')?.attrs['r:dm']
      const dataPath = cx.rels[dm]?.target
      const dataRels = dataPath ? relsOf(cx.doc.text(relsPath(dataPath)), dataPath) : {}
      const drawingId = dataPath ? deep(parseXml(cx.doc.text(dataPath) || ''), 'dsp:dataModelExt')[0]?.attrs.relId : null
      const drawing = Object.values(cx.rels).find((r) => r.type === 'diagramDrawing' && (!drawingId || r.id === drawingId))?.target || Object.values(dataRels).find((r) => r.type === 'diagramDrawing')?.target
      const dxml = drawing ? cx.doc.text(drawing) : null
      if (dxml) {
        const norm = dxml.replace(/<(\/?)dsp:/g, '<$1p:')
        const tree = parseXml(norm)
        const t = first(tree, 'p:spTree')
        const dRels = relsOf(cx.doc.text(relsPath(drawing)), drawing)
        o.kids = kids(t).filter((k) => k.name === 'p:sp' || k.name === 'p:grpSp' || k.name === 'p:pic').map((k) => objOf(k, norm, { ...cx, rels: dRels, level: 'diagram' }, true)).filter(Boolean)
        o.ch = { x: 0, y: 0, w: o.w, h: o.h }
      }
    } else {
      // An OLE object or anything else in a frame: its picture, when it has one.
      const pic = first(el, 'p:pic')
      if (pic) { const p = objOf(pic, src, cx, inGroup); if (p) { p.x = o.x; p.y = o.y; p.w = o.w; p.h = o.h; p.at = o.at; return p } }
      o.kind = 'other'
    }
    return o
  }
  // Its shape.
  const geom = kid(spPr, 'a:prstGeom'), cust = kid(spPr, 'a:custGeom')
  const av = (g) => Object.fromEntries(deep(g, 'a:gd').map((d) => [d.attrs.name, num(/^val\s+(-?\d+)/.exec(d.attrs.fmla || '')?.[1], null)]).filter((x) => x[1] != null))
  const lgeom = lph && kid(kid(lph.el, 'p:spPr'), 'a:prstGeom')
  o.geom = geom ? { prst: geom.attrs.prst, av: av(geom) } : cust ? { prst: 'custom', paths: pathsOf(cust) } : lgeom ? { prst: lgeom.attrs.prst, av: av(lgeom) } : { prst: kind === 'cxn' ? 'line' : 'rect', av: {} }
  // Its fill and line: its own, else its style's; a placeholder's from its layout's and master's.
  const phSpPr = [lph, mph].filter(Boolean).map((p) => kid(p.el, 'p:spPr'))
  const ownFill = fillOf(spPr, cx)
  const inherited = phSpPr.map((x) => fillOf(x, cx)).find(Boolean)
  o.fill = ownFill?.type === 'group' ? (cx.groupFill || null) : ownFill || inherited || (fr?.el ? fillOf({ kids: [fr.el] }, cx, fr.c) : null) || (kind === 'pic' ? null : { type: 'none' })
  if (o.fill?.type === 'blip') o.fill = withPicture(o.fill, cx)
  const ownLine = lineOf(kid(spPr, 'a:ln'), cx) || phSpPr.map((x) => lineOf(kid(x, 'a:ln'), cx)).find(Boolean)
  const styleLine = lr?.el ? lineOf(lr.el, cx, lr.c) : null
  o.line = ownLine || styleLine ? { ...(styleLine || {}), ...Object.fromEntries(Object.entries(ownLine || {}).filter(([, v]) => v != null)) } : null
  if (o.line && !o.line.none && !o.line.color && styleLine?.color) o.line.color = styleLine.color
  if (kind === 'pic') {
    const blip = first(kid(el, 'p:blipFill'), 'a:blip')
    const svg = deep(blip, 'asvg:svgBlip')[0]
    const rid = svg?.attrs['r:embed'] || blip?.attrs['r:embed']
    const src2 = kid(kid(el, 'p:blipFill'), 'a:srcRect')
    // How see-through, grey, bright and contrasting it's made (Picture Transparency, Recolor…).
    const { alpha, gray, lum } = blipOf(kid(el, 'p:blipFill'))
    o.img = { rid, url: mediaUrl(cx, rid), part: cx.rels[rid]?.target || null, crop: { l: num(src2?.attrs.l, 0) / 100000, t: num(src2?.attrs.t, 0) / 100000, r: num(src2?.attrs.r, 0) / 100000, b: num(src2?.attrs.b, 0) / 100000 }, video: !!first(nv, 'a:videoFile') || !!first(nv, 'p14:media'), alpha, gray, lum }
  }
  // Its text, with its levels' styles from the master down.
  const txBody = kid(el, 'p:txBody')
  const lt = (p) => p && kid(kid(p.el, 'p:txBody'), 'a:lstStyle')
  const master = cx.master
  // A title takes the master's title style; a subtitle, as the rest, its body style.
  const ms = !ph ? (master?.txStyles.other) : ph.type === 'title' || ph.type === 'ctrTitle' ? master?.txStyles.title : ['dt', 'ftr', 'sldNum', 'hdr'].includes(ph.type) ? master?.txStyles.other : master?.txStyles.body
  const base = levelsOf(cx.doc.defaultText, cx)
  const fontColor = fo ? colorOf(colorKid(fo), cx) : null
  const fontRefFont = fo ? (fo.attrs.idx === 'major' ? '+mj-lt' : fo.attrs.idx === 'minor' ? '+mn-lt' : null) : null
  const styled = fontColor || fontRefFont ? Array.from({ length: 9 }, () => ({ rPr: { ...(fontColor ? { color: fontColor } : {}), ...(fontRefFont ? { font: fontRefFont } : {}) } })) : null
  const levels = mergeLevels(base, levelsOf(ms, cx), styled, levelsOf(lt(mph), cx), levelsOf(lt(lph), cx), levelsOf(kid(txBody, 'a:lstStyle'), cx))
  const bodyPrs = [mph, lph].filter(Boolean).map((p) => kid(kid(p.el, 'p:txBody'), 'a:bodyPr')).concat([kid(txBody, 'a:bodyPr')]).filter(Boolean)
  const body = bodyOf(bodyPrs)
  o.textModel = txBody ? textModel(txBody, src) : null
  // An empty placeholder shows its layout's prompt while it's edited ("Click to add title").
  const promptOf = (p) => (p ? plainOf(textModel(kid(p.el, 'p:txBody'), (p === lph ? cx.layout : cx.master).xml)).split('\n')[0] : '')
  if (ph && (!o.textModel || !plainOf(o.textModel).trim()) && cx.level === 'slide') {
    o.empty = true
    o.prompt = promptOf(lph) || ''
  }
  o.text = o.textModel ? textView(o.textModel, levels, body, cx) : null
  o.levels = levels
  o.body = body
  if (o.text && cx.level === 'slide' && ph?.type === 'sldNum') o.text.slideNumber = true
  if (cx.level !== 'slide' && ph) return null
  return o
}
function bodyOf(list) {
  const o = { anchor: 't', l: 7.2, t: 3.6, r: 7.2, b: 3.6, wrap: true, vert: null, autofit: null, fontScale: 1, lnReduce: 0, anchorCtr: false }
  for (const b of list) {
    const a = b.attrs
    if (a.anchor) o.anchor = a.anchor
    for (const [k, n] of [['l', 'lIns'], ['t', 'tIns'], ['r', 'rIns'], ['b', 'bIns']]) if (a[n] != null) o[k] = num(a[n], 0) / EMU_PX
    if (a.wrap) o.wrap = a.wrap !== 'none'
    if (a.vert) o.vert = a.vert === 'horz' ? null : a.vert
    if (a.anchorCtr) o.anchorCtr = a.anchorCtr === '1'
    const na = kid(b, 'a:normAutofit'), sa = kid(b, 'a:spAutoFit'), no = kid(b, 'a:noAutofit')
    if (na) { o.autofit = 'shrink'; o.fontScale = num(na.attrs.fontScale, 100000) / 100000; o.lnReduce = num(na.attrs.lnSpcReduction, 0) / 100000 } else if (sa) { o.autofit = 'grow'; o.fontScale = 1; o.lnReduce = 0 } else if (no) { o.autofit = null; o.fontScale = 1; o.lnReduce = 0 }
  }
  return o
}
// A text model as it's drawn: each paragraph's look (its level's, then its own) and each run's.
export function textView(t, levels, body, cx) {
  const counters = []
  const scale = body?.fontScale || 1
  const font = (f) => (f === '+mj-lt' || f === '+mj-ea' || f === '+mj-cs' ? cx.theme.fonts.major : f === '+mn-lt' || f === '+mn-ea' || f === '+mn-cs' ? cx.theme.fonts.minor : f)
  return {
    body,
    paras: t.paras.map((p) => {
      const own = paraProps(p.pPr ? parseXml(p.pPr).kids[0] : null, cx)
      const lvl = Math.max(0, Math.min(8, own.lvl ?? 0))
      const pp = mergeP(levels[lvl] || {}, own)
      const rp = (r) => { const x = { ...pp.rPr, ...runProps(r ? parseXml(r).kids[0] : null, cx) }; x.font = font(x.font) || cx.theme.fonts.minor; x.sz = (x.sz || 18) * scale; return x }
      const runs = p.runs.map((r) => ({ text: r.text, br: !!r.br, fld: r.type || null, ...rp(r.rPr) }))
      const end = rp(p.end)
      const words = runs.some((r) => r.text)
      // Its bullet: a character, a number counted along its level, or none.
      let bullet = null
      const bu = pp.bu
      if (words && bu && !bu.none) {
        const size = (runs.find((r) => r.text)?.sz || end.sz) * (pp.buSize || 1)
        const color = pp.buColor || runs.find((r) => r.text)?.color || end.color
        const face = pp.buFont && !/^\+/.test(pp.buFont) ? pp.buFont : runs.find((r) => r.text)?.font || end.font
        if (bu.auto) {
          for (let i = lvl + 1; i < 9; i++) counters[i] = 0
          counters[lvl] = (counters[lvl] || bu.start - 1) + 1
          bullet = { text: numbered(bu.auto, counters[lvl]), size, color, font: face, auto: true }
        } else bullet = /wingdings|symbol/i.test(face || '') ? { text: WING[bu.char] || '•', size, color, font: null } : { text: bu.char, size, color, font: face }
      } else if (!words) { /* an empty line keeps the count */ } else for (let i = lvl; i < 9; i++) counters[i] = 0
      return { lvl, algn: pp.algn || 'l', marL: pp.marL ?? 0, indent: pp.indent ?? 0, lnSpc: pp.lnSpc || null, spcBef: pp.spcBef || null, spcAft: pp.spcAft || null, bullet, runs, end }
    }),
  }
}
// Bullets in Wingdings and Symbol, as the characters they show.
const WING = { 'Ø': '➢', '§': '▪', 'ü': '✓', q: '❑', v: '❖', n: '■', l: '●', 'Ÿ': '•', 'à': '→', 'è': '➔', 'û': '✗', w: '◆', o: '□', '': '•', '': '▪', '': '➢', '': '✓' }
const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
function numbered(type, n) {
  const roman = () => { let s = '', x = n; for (const [v, r] of ROMAN) while (x >= v) { s += r; x -= v } return s }
  const alpha = () => { let s = '', x = n; while (x > 0) { s = String.fromCharCode(97 + ((x - 1) % 26)) + s; x = Math.floor((x - 1) / 26) } return s }
  const core = /^roman/.test(type) ? roman() : /^alpha/.test(type) ? alpha() : String(n)
  const cased = /Uc/.test(type) ? core.toUpperCase() : core
  return /ParenBoth/.test(type) ? `(${cased})` : /ParenR/.test(type) ? `${cased})` : /Plain/.test(type) ? cased : `${cased}.`
}
function mediaUrl(cx, rid) {
  const r = cx.rels?.[rid]
  if (!r || r.external) return r?.external && /^https?:/.test(r.target) ? null : null
  return cx.doc.urlOf ? cx.doc.urlOf(r.target) : null
}
// A custom shape's paths, in its own units: [{ w, h, fill, stroke, cmds: [[op, ...pts]] }].
function pathsOf(cust) {
  return deep(cust, 'a:path').map((p) => ({
    w: num(p.attrs.w, 0), h: num(p.attrs.h, 0), fill: p.attrs.fill !== 'none', stroke: p.attrs.stroke !== '0',
    cmds: kids(p).map((c) => {
      const pts = kids(c, 'a:pt').map((pt) => [num(pt.attrs.x, 0), num(pt.attrs.y, 0)])
      if (c.name === 'a:arcTo') return ['A', num(c.attrs.wR, 0), num(c.attrs.hR, 0), num(c.attrs.stAng, 0) / 60000, num(c.attrs.swAng, 0) / 60000]
      return [{ 'a:moveTo': 'M', 'a:lnTo': 'L', 'a:cubicBezTo': 'C', 'a:quadBezTo': 'Q', 'a:close': 'Z' }[c.name] || 'Z', ...pts]
    }),
  }))
}

// ---------- Tables ----------
// PowerPoint's own table styles, for a file that names one without keeping it: Medium Style 2 in
// each accent, its plain one, and no style.
const TABLE_STYLES = { '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'accent1', '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'accent2', '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'accent3', '{00A15C55-8517-42AA-B614-E9B94910E393}': 'accent4', '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'accent5', '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'accent6', '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'dk1', '{2D5ABB26-0587-4C30-8999-92F81FD0307C}': null, '{5940675A-B579-460E-94D1-54222C63F5DA}': 'grid' }
function tableOf(tbl, src, cx) {
  const pr = kid(tbl, 'a:tblPr')
  const flags = { firstRow: pr?.attrs.firstRow === '1', lastRow: pr?.attrs.lastRow === '1', firstCol: pr?.attrs.firstCol === '1', lastCol: pr?.attrs.lastCol === '1', bandRow: pr?.attrs.bandRow === '1', bandCol: pr?.attrs.bandCol === '1' }
  const styleId = kid(pr, 'a:tableStyleId') ? textIn(kid(pr, 'a:tableStyleId')).trim() : null
  const own = styleId ? cx.doc.tableStyles.get(styleId) : null
  const known = styleId && styleId in TABLE_STYLES ? TABLE_STYLES[styleId] : styleId ? 'accent1' : null
  const part = (name) => {
    if (own) {
      const el = kid(own, `a:${name}`)
      if (!el) return null
      const tc = kid(el, 'a:tcStyle'), tx = kid(el, 'a:tcTxStyle')
      const fill = fillOf(kid(tc, 'a:fill'), cx) || (kid(tc, 'a:fillRef') ? { type: 'solid', color: colorOf(colorKid(kid(tc, 'a:fillRef')), cx) } : null)
      const border = (n) => { const b = kid(kid(tc, 'a:tcBdr'), `a:${n}`); return b ? lineOf(kid(b, 'a:ln'), cx) : null }
      return { fill, text: { b: tx?.attrs.b === 'on', color: colorOf(colorKid(tx), cx) }, borders: { l: border('left'), r: border('right'), t: border('top'), b: border('bottom'), h: border('insideH'), v: border('insideV') } }
    }
    if (!known) return null
    if (known === 'grid') return name === 'wholeTbl' ? { borders: { all: { color: colorOf({ name: 'a:schemeClr', attrs: { val: 'tx1' }, kids: [] }, cx), width: 1 } } } : null
    const accent = { name: 'a:schemeClr', attrs: { val: known }, kids: [] }
    const tint = (v) => ({ ...accent, kids: [{ name: 'a:tint', attrs: { val: String(v) }, kids: [] }] })
    const white = { color: { hex: 'FFFFFF', alpha: 1 }, width: 1 }
    if (name === 'wholeTbl') return { fill: { type: 'solid', color: colorOf(tint(20000), cx) }, text: { color: colorOf({ name: 'a:schemeClr', attrs: { val: 'dk1' }, kids: [] }, cx) }, borders: { all: white } }
    if (name === 'band1H' || name === 'band1V') return { fill: { type: 'solid', color: colorOf(tint(40000), cx) } }
    if (name === 'firstRow' || name === 'lastRow' || name === 'firstCol' || name === 'lastCol') return { fill: { type: 'solid', color: colorOf(accent, cx) }, text: { b: true, color: { hex: 'FFFFFF', alpha: 1 } }, borders: name === 'firstRow' ? { b: { color: { hex: 'FFFFFF', alpha: 1 }, width: 3 } } : null }
    return null
  }
  const parts = Object.fromEntries(['wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V', 'firstRow', 'lastRow', 'firstCol', 'lastCol'].map((n) => [n, part(n)]))
  const cols = kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').map((g) => num(g.attrs.w, 0) / EMU_PX)
  const trs = kids(tbl, 'a:tr')
  const rows = trs.map((tr, ri) => ({
    h: num(tr.attrs.h, 0) / EMU_PX,
    cells: kids(tr, 'a:tc').map((tc, ci) => {
      const tcPr = kid(tc, 'a:tcPr')
      const looks = [parts.wholeTbl]
      if (flags.bandRow && !(flags.firstRow && ri === 0)) looks.push((ri - (flags.firstRow ? 1 : 0)) % 2 === 0 ? parts.band1H : parts.band2H)
      if (flags.bandCol) looks.push(ci % 2 === 0 ? parts.band1V : parts.band2V)
      if (flags.firstCol && ci === 0) looks.push(parts.firstCol)
      if (flags.lastCol && ci === cols.length - 1) looks.push(parts.lastCol)
      if (flags.firstRow && ri === 0) looks.push(parts.firstRow)
      if (flags.lastRow && ri === trs.length - 1) looks.push(parts.lastRow)
      const look = looks.filter(Boolean).reduce((a, b) => ({ fill: b.fill || a.fill, text: { ...a.text, ...(b.text || {}) }, borders: { ...a.borders, ...(b.borders || {}) } }), { fill: null, text: {}, borders: {} })
      const fill = fillOf(tcPr, cx) || look.fill
      const ln = (n) => { const l = kid(tcPr, n); return l ? lineOf(l, cx) : null }
      const bd = look.borders
      const border = { l: ln('a:lnL') || bd.l || (ci ? bd.v : null) || bd.all, r: ln('a:lnR') || bd.r || bd.v || bd.all, t: ln('a:lnT') || bd.t || (ri ? bd.h : null) || bd.all, b: ln('a:lnB') || bd.b || bd.h || bd.all }
      const tm = textModel(kid(tc, 'a:txBody'), src)
      const levels = mergeLevels(levelsOf(cx.doc.defaultText, cx), levelsOf(cx.master?.txStyles.other, cx), [{ rPr: { ...(look.text.b ? { b: true } : {}), ...(look.text.color ? { color: look.text.color } : {}) } }, ...Array(8).fill({ rPr: { ...(look.text.b ? { b: true } : {}), ...(look.text.color ? { color: look.text.color } : {}) } })])
      const body = { anchor: tcPr?.attrs.anchor || 't', l: num(tcPr?.attrs.marL, 91440) / EMU_PX, r: num(tcPr?.attrs.marR, 91440) / EMU_PX, t: num(tcPr?.attrs.marT, 45720) / EMU_PX, b: num(tcPr?.attrs.marB, 45720) / EMU_PX, wrap: true, fontScale: 1 }
      return { span: num(tc.attrs.gridSpan, 1), rowSpan: num(tc.attrs.rowSpan, 1), hMerge: tc.attrs.hMerge === '1', vMerge: tc.attrs.vMerge === '1', fill, border, textModel: tm, text: tm ? textView(tm, levels, body, cx) : null }
    }),
  }))
  return { cols, rows }
}

// ---------- Charts ----------
// A chart from its part's own values: { type: bar | col | line | pie | doughnut | area | scatter,
// stacked, title, cats, series: [{ name, values, color }], legend }.
function chartOf(xml, cx) {
  if (!xml) return null
  const tree = parseXml(xml)
  const plot = first(tree, 'c:plotArea')
  const kinds = kids(plot).filter((k) => /Chart$/.test(k.name))
  if (!kinds.length) return null
  const c0 = kinds[0]
  const strs = (el) => { const cache = first(el, 'c:strCache') || first(el, 'c:numCache'); return kids(cache, 'c:pt').sort((a, b) => num(a.attrs.idx, 0) - num(b.attrs.idx, 0)).map((p) => textIn(kid(p, 'c:v'))) }
  const nums = (el) => { const cache = first(el, 'c:numCache'); const n = num(kid(cache, 'c:ptCount')?.attrs.val, 0); const out = Array(n).fill(null); for (const p of kids(cache, 'c:pt')) out[num(p.attrs.idx, 0)] = num(textIn(kid(p, 'c:v')), null); return out }
  const series = []
  for (const k of kinds) for (const s of kids(k, 'c:ser')) {
    const i = series.length
    const f = fillOf(kid(s, 'c:spPr'), cx) || (k.name === 'c:lineChart' ? { type: 'solid', color: lineOf(kid(kid(s, 'c:spPr'), 'a:ln'), cx)?.color } : null)
    const pts = kids(s, 'c:dPt').map((d) => ({ i: num(kid(d, 'c:idx')?.attrs.val, 0), color: fillOf(kid(d, 'c:spPr'), cx)?.color }))
    series.push({ name: strs(kid(s, 'c:tx')).join(' ') || `Series ${i + 1}`, cats: strs(kid(s, 'c:cat') || kid(s, 'c:xVal')), values: nums(kid(s, 'c:val') || kid(s, 'c:yVal')), color: f?.color || { hex: cx.scheme[`accent${(i % 6) + 1}`] || '4472C4', alpha: 1 }, points: pts, kind: k.name.replace(/^c:|Chart$/g, '') })
  }
  const type = c0.name.replace(/^c:|Chart$/g, '').replace('3D', '')
  const dir = kid(c0, 'c:barDir')?.attrs.val
  const grouping = kid(c0, 'c:grouping')?.attrs.val || 'clustered'
  const tEl = first(tree, 'c:title')
  const title = tEl ? deep(tEl, 'a:t').map(textIn).join('') || (series.length === 1 ? series[0].name : '') : (first(tree, 'c:autoTitleDeleted')?.attrs.val === '0' && series.length === 1 ? series[0].name : '')
  const legend = first(tree, 'c:legend') ? (first(first(tree, 'c:legend'), 'c:legendPos')?.attrs.val || 'r') : null
  return { type: type === 'bar' ? (dir === 'bar' ? 'bar' : 'col') : type, stacked: /stacked/i.test(grouping), percent: grouping === 'percentStacked', title, cats: series[0]?.cats || [], series, legend, holeSize: num(first(c0, 'c:holeSize')?.attrs.val, 50) }
}

// ---------- Changes ----------
// Each changes a slide's XML and gives back a new slide (the old one is left as it was, so undo
// is the old one back).
const touch = (slide, more) => ({ ...slide, ...more, changed: true })
export const objEl = (xml) => parseXml(xml).kids.find((k) => k.name)
// An element at a path of child indexes within a shape's XML (a shape in a group), changed by fn.
export function editAt(xml, path, fn) {
  if (!path.length) return fn(xml)
  const top = objEl(xml)
  const list = kids(top).filter((k) => !/^p:(nvGrpSpPr|grpSpPr)$/.test(k.name))
  const el = list[path[0]]
  if (!el) return xml
  return xml.slice(0, el.s) + editAt(xml.slice(el.s, el.e), path.slice(1), fn) + xml.slice(el.e)
}
// The XML of the element at a path in a shape's (a shape in a group).
export function xmlAt(xml, path = []) {
  if (!path.length) return xml
  const list = kids(objEl(xml)).filter((k) => !/^p:(nvGrpSpPr|grpSpPr)$/.test(k.name))
  const el = list[path[0]]
  return el ? xmlAt(xml.slice(el.s, el.e), path.slice(1)) : null
}
// An empty text model, for a shape or cell with no words yet.
export const emptyText = (anchor = 't') => ({ bodyPr: anchor === 't' ? '<a:bodyPr/>' : `<a:bodyPr rtlCol="0" anchor="${anchor}"/>`, lstStyle: '<a:lstStyle/>', paras: [{ pPr: '', runs: [], end: '' }] })
// The words of a shape (or a shape in its group, or a table's cell) as a text model.
export function textAt(xml, { path = [], cell = null } = {}) {
  const part = xmlAt(xml, path)
  if (!part) return null
  const el = objEl(part)
  if (cell) {
    const tc = kids(kids(first(el, 'a:tbl'), 'a:tr')[cell[0]], 'a:tc')[cell[1]]
    if (!tc) return null
    return textModel(kid(tc, 'a:txBody'), part) || emptyText()
  }
  if (el.name !== 'p:sp') return null
  return textModel(kid(el, 'p:txBody'), part) || emptyText('ctr')
}
// Every piece of words on a slide: [{ at, path, cell, t }] (shapes, those in groups, table cells).
export function textsOf(slide) {
  const out = []
  slide.objs.forEach((xml, at) => {
    const walk = (part, path) => {
      const el = objEl(part)
      if (!el) return
      if (el.name === 'p:sp') { const t = textModel(kid(el, 'p:txBody'), part); if (t) out.push({ at, path, cell: null, t }) }
      else if (el.name === 'p:grpSp') kids(el).filter((k) => !/^p:(nvGrpSpPr|grpSpPr)$/.test(k.name)).forEach((k, i) => walk(part.slice(k.s, k.e), [...path, i]))
      else if (el.name === 'p:graphicFrame') kids(first(el, 'a:tbl'), 'a:tr').forEach((tr, r) => kids(tr, 'a:tc').forEach((tc, c) => { const t = textModel(kid(tc, 'a:txBody'), part); if (t) out.push({ at, path, cell: [r, c], t }) }))
    }
    walk(xml, [])
  })
  return out
}
// A slide's words changed at one of textsOf's places.
export function withTextAt(slide, { at, path = [], cell = null }, t) {
  return changeObj(slide, at, (xml) => (cell ? withCellText(xml, cell[0], cell[1], t) : editAt(xml, path, (x) => withText(x, t))))
}
// A shape's place set (in px): { x, y, w, h, rot, flipH, flipV }.
export function withXfrm(xml, box) {
  const el = objEl(xml)
  const frame = el.name === 'p:graphicFrame'
  const prName = el.name === 'p:grpSp' ? 'p:grpSpPr' : 'p:spPr'
  const pr = frame ? null : kid(el, prName)
  const old = frame ? kid(el, 'p:xfrm') : kid(pr, 'a:xfrm')
  const was = xfrmOf(old)
  const e = (v) => String(Math.round(v * EMU_PX))
  const rot = box.rot ?? was?.rot ?? 0
  const flipH = box.flipH ?? was?.flipH, flipV = box.flipV ?? was?.flipV
  const tag = frame ? 'p:xfrm' : 'a:xfrm'
  const ch = was?.ch ? `<a:chOff x="${was.ch.x}" y="${was.ch.y}"/><a:chExt cx="${was.ch.w}" cy="${was.ch.h}"/>` : el.name === 'p:grpSp' ? `<a:chOff x="${e(box.x)}" y="${e(box.y)}"/><a:chExt cx="${e(box.w)}" cy="${e(box.h)}"/>` : ''
  const next = `<${tag}${rot ? ` rot="${Math.round(((rot % 360) + 360) % 360 * 60000)}"` : ''}${flipH ? ' flipH="1"' : ''}${flipV ? ' flipV="1"' : ''}><a:off x="${e(box.x)}" y="${e(box.y)}"/><a:ext cx="${e(Math.max(0, box.w))}" cy="${e(Math.max(0, box.h))}"/>${ch}</${tag}>`
  if (old) return xml.slice(0, old.s) + next + xml.slice(old.e)
  if (frame) { const nv = kid(el, 'p:nvGraphicFramePr'); return xml.slice(0, nv.e) + next + xml.slice(nv.e) }
  if (!pr) return xml
  const prXml = xml.slice(pr.s, pr.e)
  const self = /\/>$/.test(prXml) && !prXml.includes(`</${prName}>`)
  const filled = self ? prXml.replace(/\s*\/>$/, `>${next}</${prName}>`) : prXml.replace(/^(<[^>]*>)/, `$1${next}`)
  return xml.slice(0, pr.s) + filled + xml.slice(pr.e)
}
// Its text set (a text model), or put in a shape that had none.
export function withText(xml, t) {
  const el = objEl(xml)
  const tx = kid(el, 'p:txBody')
  const out = textXml(t)
  if (tx) return xml.slice(0, tx.s) + out + xml.slice(tx.e)
  if (el.name !== 'p:sp') return xml
  const end = xml.lastIndexOf('</p:sp>')
  return xml.slice(0, end) + out + xml.slice(end)
}
const SPPR_ORDER = ['a:xfrm', ['a:custGeom', 'a:prstGeom'], ['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill'], 'a:ln', ['a:effectLst', 'a:effectDag'], 'a:scene3d', 'a:sp3d', 'a:extLst']
function withSpPr(xml, fn) {
  const el = objEl(xml)
  const pr = kid(el, el.name === 'p:grpSp' ? 'p:grpSpPr' : 'p:spPr')
  if (!pr) return xml
  return xml.slice(0, pr.s) + fn(xml.slice(pr.s, pr.e)) + xml.slice(pr.e)
}
// Its fill: a colour (hex), 'none', or null for its style's.
export function withFill(xml, color) {
  return withSpPr(xml, (pr) => withChild(pr, SPPR_ORDER[2], color === 'none' ? '<a:noFill/>' : color ? `<a:solidFill><a:srgbClr val="${color.replace('#', '').toUpperCase()}"/></a:solidFill>` : null, SPPR_ORDER))
}
// Its line: { color (hex, 'none' or null), width (px), dash }.
const LN_ORDER = [['a:noFill', 'a:solidFill', 'a:gradFill', 'a:pattFill'], 'a:prstDash', 'a:custDash', ['a:round', 'a:bevel', 'a:miter'], 'a:headEnd', 'a:tailEnd', 'a:extLst']
export function withLine(xml, set) {
  return withSpPr(xml, (pr) => {
    const el = parseXml(pr).kids[0]
    let ln = raw(pr, kid(el, 'a:ln')) || '<a:ln/>'
    if ('width' in set) ln = withAttr(ln, 'w', set.width == null ? null : String(Math.round(set.width * EMU_PX)))
    if ('color' in set) ln = withChild(ln, LN_ORDER[0], set.color === 'none' ? '<a:noFill/>' : set.color ? `<a:solidFill><a:srgbClr val="${set.color.replace('#', '').toUpperCase()}"/></a:solidFill>` : null, LN_ORDER)
    if ('dash' in set) ln = withChild(ln, 'a:prstDash', set.dash && set.dash !== 'solid' ? `<a:prstDash val="${set.dash}"/>` : null, LN_ORDER)
    return withChild(pr, 'a:ln', ln, SPPR_ORDER)
  })
}
// Its words shrunk to fit (scale: 1 is their own size), as PowerPoint keeps it in its body.
const BODY_ORDER = ['a:prstTxWarp', ['a:noAutofit', 'a:normAutofit', 'a:spAutoFit'], 'a:scene3d', 'a:sp3d', 'a:flatTx', 'a:extLst']
export function withAutofit(xml, scale) {
  const el = objEl(xml)
  const tx = kid(el, 'p:txBody')
  const b = kid(tx, 'a:bodyPr')
  if (!b) return xml
  const fit = scale >= 1 ? '<a:normAutofit/>' : `<a:normAutofit fontScale="${Math.round(scale * 100000)}"${scale < 0.9 ? ' lnSpcReduction="10000"' : ''}/>`
  return xml.slice(0, b.s) + withChild(xml.slice(b.s, b.e), BODY_ORDER[1], fit, BODY_ORDER) + xml.slice(b.e)
}
// A picture's crop (each side as a share of it, 0 to 1).
export function withCrop(xml, c) {
  const el = objEl(xml)
  const bf = kid(el, 'p:blipFill')
  if (!bf) return xml
  const part = xml.slice(bf.s, bf.e)
  const v = (x) => String(Math.round(x * 100000))
  const rect = c && (c.l || c.t || c.r || c.b) ? `<a:srcRect${c.l ? ` l="${v(c.l)}"` : ''}${c.t ? ` t="${v(c.t)}"` : ''}${c.r ? ` r="${v(c.r)}"` : ''}${c.b ? ` b="${v(c.b)}"` : ''}/>` : null
  return xml.slice(0, bf.s) + withChild(part, 'a:srcRect', rect, ['a:blip', 'a:srcRect', ['a:tile', 'a:stretch']]) + xml.slice(bf.e)
}
// A shape's id in its slide made new (a copy), and every id in it under a group.
function withIds(xml, next) { return xml.replace(/(<p:cNvPr\b[^>]*?\bid=")(\d+)"/g, (m, a) => `${a}${next()}"`) }
const idsIn = (slide) => slide.objs.join('').match(/<p:cNvPr\b[^>]*?\bid="(\d+)"/g)?.map((x) => Number(/id="(\d+)"/.exec(x)[1])) || []
export function idMaker(slide) { let n = Math.max(1, ...idsIn(slide)); return () => ++n }

export function changeObj(slide, at, fn) { const objs = [...slide.objs]; objs[at] = fn(objs[at]); return touch(slide, { objs }) }
export function removeObjs(slide, ats) { const gone = new Set(ats); return touch(slide, { objs: slide.objs.filter((_, i) => !gone.has(i)) }) }
// Pieces of XML put on a slide (pasted, duplicated, new), on top, with ids of their own. rels: the
// relationships they use from where they came (copied into this slide's, renamed).
export function addObjs(slide, xmls, { rels = {}, at = null } = {}) {
  const next = idMaker(slide)
  let own = { ...slide.rels }
  const renamed = {}
  for (const [rid, r] of Object.entries(rels)) {
    if (!xmls.some((x) => x.includes(`"${rid}"`))) continue
    const same = Object.values(own).find((x) => x.type === r.type && x.target === r.target && !!x.external === !!r.external)
    if (same) { renamed[rid] = same.id; continue }
    const id = freeRid(own)
    own = { ...own, [id]: { ...r, id } }
    renamed[rid] = id
  }
  const fixed = xmls.map((x) => withIds(x.replace(/(r:(?:embed|link|id|dm|lo|qs|cs|pict)=")([^"]+)"/g, (m, a, rid) => `${a}${renamed[rid] || rid}"`), next))
  const objs = [...slide.objs]
  objs.splice(at == null ? objs.length : at, 0, ...fixed)
  return touch(slide, { objs, rels: own })
}
export function freeRid(rels) { let i = 1; while (rels[`rId${i}`]) i++; return `rId${i}` }
// Things moved to the front or back, or a step either way: dir 'front', 'back', 'forward', 'backward'.
export function reorderObjs(slide, ats, dir) {
  const set = new Set(ats)
  const objs = slide.objs.map((xml, i) => ({ xml, on: set.has(i) }))
  if (dir === 'front' || dir === 'back') {
    const moving = objs.filter((o) => o.on), rest = objs.filter((o) => !o.on)
    return touch(slide, { objs: (dir === 'front' ? [...rest, ...moving] : [...moving, ...rest]).map((o) => o.xml) })
  }
  if (dir === 'forward') for (let i = objs.length - 2; i >= 0; i--) { if (objs[i].on && !objs[i + 1].on) [objs[i], objs[i + 1]] = [objs[i + 1], objs[i]] }
  else for (let i = 1; i < objs.length; i++) { if (objs[i].on && !objs[i - 1].on) [objs[i], objs[i - 1]] = [objs[i - 1], objs[i]] }
  return touch(slide, { objs: objs.map((o) => o.xml) })
}
export const withHidden = (slide, hidden) => touch(slide, { hidden })
export const withNotes = (slide, text) => ({ ...slide, notes: { ...slide.notes, text, changed: true }, changed: true })

// ---------- New things ----------
const NV = (tag, id, name, more = '') => `<p:cNvPr id="${id}" name="${esc(name)}"/>${more}`
const px = (v) => Math.round(v * EMU_PX)
const xf = (b) => `<a:xfrm><a:off x="${px(b.x)}" y="${px(b.y)}"/><a:ext cx="${px(b.w)}" cy="${px(b.h)}"/></a:xfrm>`
// A text box, with its words in the deck's body font and colour (from the master's).
export const textBoxXml = (b, text = '') => `<p:sp><p:nvSpPr>${NV('sp', 1, 'TextBox')}<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xf(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${String(text).split('\n').map((l) => `<a:p>${l ? `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r>` : ''}<a:endParaRPr lang="en-US" dirty="0"/></a:p>`).join('')}</p:txBody></p:sp>`
// A shape as PowerPoint makes one: filled in the theme's first accent, its words in white, centred.
export const shapeXml = (b, prst) => `<p:sp><p:nvSpPr>${NV('sp', 1, prst)}<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(b)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody></p:sp>`
// A line from one corner of a box to the other (flipped for one going up), an arrow if asked.
export const lineXml = (b, { arrow = false, flipV = false } = {}) => `<p:cxnSp><p:nvCxnSpPr>${NV('cxn', 1, arrow ? 'Arrow' : 'Line')}<p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flipV ? ' flipV="1"' : ''}><a:off x="${px(b.x)}" y="${px(b.y)}"/><a:ext cx="${px(b.w)}" cy="${px(b.h)}"/></a:xfrm><a:prstGeom prst="${arrow ? 'straightConnector1' : 'line'}"><a:avLst/></a:prstGeom><a:ln w="28575">${arrow ? '<a:tailEnd type="triangle"/>' : ''}</a:ln></p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style></p:cxnSp>`
export const pictureXml = (b, rid, name = 'Picture') => `<p:pic><p:nvPicPr>${NV('pic', 1, name)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xf(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
// A table in PowerPoint's own default style: a header row, banded rows.
export const tableXml = (b, rows, cols) => {
  const cw = px(b.w / cols), rh = px(Math.min(b.h / rows, 40))
  const cell = '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p></a:txBody><a:tcPr/></a:tc>'
  return `<p:graphicFrame><p:nvGraphicFramePr>${NV('frame', 1, 'Table')}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${px(b.x)}" y="${px(b.y)}"/><a:ext cx="${cw * cols}" cy="${rh * rows}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid>${`<a:gridCol w="${cw}"/>`.repeat(cols)}</a:tblGrid>${`<a:tr h="${rh}">${cell.repeat(cols)}</a:tr>`.repeat(rows)}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}
// A table cell's text set, or a row or column added or taken out.
export function withCellText(xml, r, c, t) {
  const tbl = first(objEl(xml), 'a:tbl')
  const tc = kids(kids(tbl, 'a:tr')[r], 'a:tc')[c]
  if (!tc) return xml
  const tx = kid(tc, 'a:txBody')
  const out = textXml(t, 'a:txBody')
  return tx ? xml.slice(0, tx.s) + out + xml.slice(tx.e) : xml.slice(0, tc.s) + xml.slice(tc.s, tc.e).replace(/^(<a:tc\b[^>]*>)/, `$1${out}`) + xml.slice(tc.e)
}
export function withRow(xml, at, add) {
  const el = objEl(xml)
  const tbl = first(el, 'a:tbl')
  const rows = kids(tbl, 'a:tr')
  if (!add && rows.length <= 1) return xml
  const tr = rows[Math.min(at, rows.length - 1)]
  const h = num(tr.attrs.h, 0)
  let out
  if (add) {
    const copy = xml.slice(tr.s, tr.e).replace(/<a:txBody>[\s\S]*?<\/a:txBody>/g, (m) => { const t = textModel(parseXml(m).kids[0], m); return textXml({ ...t, paras: [{ pPr: t.paras[0]?.pPr || '', runs: [], end: t.paras[0]?.runs[0]?.rPr?.replace(/^<a:rPr/, '<a:endParaRPr').replace(/<\/a:rPr>$/, '</a:endParaRPr>') || t.paras[0]?.end || '' }] }, 'a:txBody') }).replace(/\s(rowSpan|vMerge)="[^"]*"/g, '')
    const pos = at >= rows.length ? tr.e : tr.s
    out = xml.slice(0, pos) + copy + xml.slice(pos)
  } else out = xml.slice(0, tr.s) + xml.slice(tr.e)
  return frameHeight(out, add ? h : -h)
}
export function withCol(xml, at, add) {
  const el = objEl(xml)
  const tbl = first(el, 'a:tbl')
  const grid = kids(kid(tbl, 'a:tblGrid'), 'a:gridCol')
  if (!add && grid.length <= 1) return xml
  const i = Math.min(at, grid.length - 1)
  const w = num(grid[i].attrs.w, 0)
  // Last to first, so each place stays right: every row's cell, then the grid's column.
  const edits = []
  for (const tr of kids(tbl, 'a:tr')) {
    const tc = kids(tr, 'a:tc')[i]
    if (!tc) continue
    if (add) { const pos = at >= grid.length ? tc.e : tc.s; edits.push([pos, pos, '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p></a:txBody><a:tcPr/></a:tc>']) } else edits.push([tc.s, tc.e, ''])
  }
  const g = grid[i]
  if (add) { const pos = at >= grid.length ? g.e : g.s; edits.push([pos, pos, `<a:gridCol w="${w}"/>`]) } else edits.push([g.s, g.e, ''])
  let out = xml
  for (const [s, e, x] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + x + out.slice(e)
  const frame = objEl(out)
  const ext = kid(kid(frame, 'p:xfrm'), 'a:ext')
  if (!ext) return out
  const cx = num(ext.attrs.cx, 0) + (add ? w : -w)
  return out.slice(0, ext.s) + withAttr(out.slice(ext.s, ext.e), 'cx', String(cx)) + out.slice(ext.e)
}
function frameHeight(xml, d) {
  const ext = kid(kid(objEl(xml), 'p:xfrm'), 'a:ext')
  if (!ext) return xml
  return xml.slice(0, ext.s) + withAttr(xml.slice(ext.s, ext.e), 'cy', String(Math.max(0, num(ext.attrs.cy, 0) + d))) + xml.slice(ext.e)
}
// Shapes put in a group of their own (their places, in the slide's, as the group's), or a group's
// shapes put back on the slide where they show.
export function groupXml(xmls, box) {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="1" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${px(box.x)}" y="${px(box.y)}"/><a:ext cx="${px(box.w)}" cy="${px(box.h)}"/><a:chOff x="${px(box.x)}" y="${px(box.y)}"/><a:chExt cx="${px(box.w)}" cy="${px(box.h)}"/></a:xfrm></p:grpSpPr>${xmls.join('')}</p:grpSp>`
}
export function ungroupXml(xml) {
  const el = objEl(xml)
  const g = xfrmOf(kid(kid(el, 'p:grpSpPr'), 'a:xfrm'))
  const list = kids(el).filter((k) => !/^p:(nvGrpSpPr|grpSpPr)$/.test(k.name))
  if (!g) return list.map((k) => xml.slice(k.s, k.e))
  const ch = g.ch || g
  const sx = ch.w ? g.w / ch.w : 1, sy = ch.h ? g.h / ch.h : 1
  return list.map((k) => {
    const part = xml.slice(k.s, k.e)
    const own = objEl(part)
    const x = xfrmOf(own.name === 'p:graphicFrame' ? kid(own, 'p:xfrm') : kid(kid(own, own.name === 'p:grpSp' ? 'p:grpSpPr' : 'p:spPr'), 'a:xfrm'))
    if (!x) return part
    return withXfrm(part, { x: (g.x + (x.x - ch.x) * sx) / EMU_PX, y: (g.y + (x.y - ch.y) * sy) / EMU_PX, w: (x.w * sx) / EMU_PX, h: (x.h * sy) / EMU_PX, rot: (x.rot || 0) + (g.rot || 0) })
  })
}

// ---------- Slides ----------
// A new slide on a layout: the layout's placeholders, empty, to type in.
export function newSlide(doc, layoutPath) {
  const l = doc.layoutOf(layoutPath)
  let id = 1
  const phs = (l?.phs || []).filter((p) => !['dt', 'ftr', 'sldNum', 'hdr'].includes(p.ph.type)).map((p) => {
    const name = p.el.kids.find((k) => /^p:nv/.test(k.name)) ? (first(p.el, 'p:cNvPr')?.attrs.name || 'Placeholder') : 'Placeholder'
    const phTag = raw(l.xml, first(p.el, 'p:ph'))
    if (p.el.name !== 'p:sp') return ''
    return `<p:sp><p:nvSpPr><p:cNvPr id="${++id}" name="${esc(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phTag}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody></p:sp>`
  }).filter(Boolean)
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
  return {
    key: doc.nextKey(), path: null, orig: null, rid: null, sldId: null, isNew: true, changed: true, hidden: false,
    head: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`,
    tail: '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
    objs: phs, rels: { rId1: { id: 'rId1', type: 'slideLayout', typeUri: `${REL}/slideLayout`, target: layoutPath } }, layout: layoutPath, notes: { path: null, text: '' },
  }
}
// A copy of a slide (duplicated, pasted): the same XML and relationships, its notes copied.
export const copySlide = (doc, slide) => ({ ...slide, key: doc.nextKey(), path: null, orig: null, rid: null, sldId: null, isNew: true, changed: true, from: slide.path || slide.from || null, notes: { path: null, text: slide.notes.text, changed: !!slide.notes.text } })
export const withLayout = (slide, layoutPath) => {
  const rels = { ...slide.rels }
  const r = Object.values(rels).find((x) => x.type === 'slideLayout')
  if (r) rels[r.id] = { ...r, target: layoutPath }
  return touch(slide, { rels, layout: layoutPath })
}
// The deck's layouts, in its first master's order: [{ path, name, type }].
export function layoutsOf(doc) {
  const out = []
  const masters = [...new Set(doc.slides.map((s) => doc.layoutOf(s.layout)?.master).filter(Boolean))]
  if (!masters.length) { const m = Object.values(doc.presRels).find((r) => r.type === 'slideMaster')?.target; if (m) masters.push(m) }
  for (const m of masters) for (const p of doc.masterOf(m)?.layouts || []) { const l = doc.layoutOf(p); if (l) out.push({ path: p, name: l.name, type: l.type, master: m }) }
  return out
}

// ---------- Saving ----------
// The file's bytes, with the slides as they are now: those not changed as they were, byte for byte.
// media: new pictures by their part's path ({ bytes, type }).
// threads: every slide's comments now (deckcomments.jsx's), written where they changed; left out,
// the comments are kept as they were.
export async function writePptx(doc, slides, { media = new Map(), threads = null } = {}) {
  const zip = doc.zip
  const out = new JSZip()
  const files = new Map()
  for (const [name, f] of Object.entries(zip.files)) if (!f.dir) files.set(name, f)
  const put = new Map() // path -> string or bytes, over what's there
  const gone = new Set()
  let ct = doc.text('[Content_Types].xml') || ''
  const presRels = { ...doc.presRels }
  // Parts that go: the slides taken out (and their notes).
  const kept = new Set(slides.map((s) => s.path).filter(Boolean))
  for (const s of doc.slides) {
    if (kept.has(s.path)) continue
    gone.add(s.path); gone.add(relsPath(s.path))
    if (s.notes.path) { gone.add(s.notes.path); gone.add(relsPath(s.notes.path)) }
    // its comments go with it
    if (s.comments?.path) { gone.add(s.comments.path); ct = ct.replace(new RegExp(`<Override PartName="/${s.comments.path.replace(/[.]/g, '\\.')}"[^>]*/>`), '') }
    if (s.rid) delete presRels[s.rid]
    ct = ct.replace(new RegExp(`<Override PartName="/${s.path.replace(/[.]/g, '\\.')}"[^>]*/>`), '')
    if (s.notes.path) ct = ct.replace(new RegExp(`<Override PartName="/${s.notes.path.replace(/[.]/g, '\\.')}"[^>]*/>`), '')
  }
  const taken = new Set([...files.keys()].filter((n) => !gone.has(n)))
  const free = (dir, base, ext) => { let i = 1; while (taken.has(`${dir}${base}${i}${ext}`) || put.has(`${dir}${base}${i}${ext}`)) i++; const p = `${dir}${base}${i}${ext}`; taken.add(p); return p }
  const override = (path, type) => { if (!ct.includes(`PartName="/${path}"`)) ct = ct.replace('</Types>', `<Override PartName="/${path}" ContentType="${type}"/></Types>`) }
  // A chart (and its workbook and colours) copied with a slide: a part of its own.
  const copyPart = (path) => {
    const ext = path.slice(path.lastIndexOf('.'))
    const dir = dirOf(path), base = path.slice(dir.length, path.lastIndexOf('.')).replace(/\d+$/, '')
    const to = free(dir, base, ext)
    const f = files.get(path)
    if (f) put.set(to, f)
    const type = new RegExp(`<Override PartName="/${path.replace(/[.]/g, '\\.')}" ContentType="([^"]+)"`).exec(ct)?.[1]
    if (type) override(to, type)
    const rx = doc.text(relsPath(path))
    if (rx) {
      const rels = relsOf(rx, path)
      for (const r of Object.values(rels)) if (!r.external && /^(package|oleObject|chartUserShapes|themeOverride|chartStyle|chartColorStyle)$/.test(r.type)) r.target = copyPart(r.target)
      put.set(relsPath(to), relsXml(rels, to))
    }
    return to
  }
  const ids = []
  let nextSldId = Math.max(255, ...doc.slides.map((s) => Number(s.sldId) || 0))
  const placed = []
  for (const s of slides) {
    let path = s.path, rid = s.rid, sldId = s.sldId
    if (!path) {
      path = free('ppt/slides/', 'slide', '.xml')
      rid = freeRid(presRels)
      presRels[rid] = { id: rid, type: 'slide', typeUri: `${REL}/slide`, target: path }
      sldId = String(++nextSldId)
      override(path, `${CT}.slide+xml`)
    }
    placed.push({ s, path, rid, sldId })
    ids.push(`<p:sldId id="${sldId}" r:id="${rid}"/>`)
  }
  for (const { s, path } of placed) {
    if (!s.changed && !s.notes.changed && s.path === path) continue
    const rels = {}
    for (const [id, r] of Object.entries(s.rels)) rels[id] = { ...r }
    // A copied slide's charts are its own; its notes are written below.
    if (s.isNew) for (const r of Object.values(rels)) if (!r.external && /^(chart|diagramData|diagramLayout|diagramQuickStyle|diagramColors|diagramDrawing|oleObject|package)$/.test(r.type)) r.target = copyPart(r.target)
    for (const r of Object.values(rels)) if (r.type === 'notesSlide') delete rels[r.id]
    // A copied slide starts with no comments of its own (the original's stay with it).
    if (s.isNew) for (const r of Object.values(rels)) if (r.typeUri === CM_REL) delete rels[r.id]
    // Its notes: kept, changed, made, or taken off when emptied.
    let notesPath = s.isNew ? null : s.notes.path
    const text = s.notes.text || ''
    if (notesPath && (s.notes.changed || s.isNew)) put.set(notesPath, notesWith(doc.text(notesPath), text))
    if (!notesPath && text.trim() && doc.notesMaster) {
      notesPath = free('ppt/notesSlides/', 'notesSlide', '.xml')
      put.set(notesPath, notesWith(null, text))
      put.set(relsPath(notesPath), relsXml({ rId1: { id: 'rId1', type: 'notesMaster', typeUri: `${REL}/notesMaster`, target: doc.notesMaster }, rId2: { id: 'rId2', type: 'slide', typeUri: `${REL}/slide`, target: path } }, notesPath))
      override(notesPath, `${CT}.notesSlide+xml`)
    }
    if (notesPath) { const id = freeRid(rels); rels[id] = { id, type: 'notesSlide', typeUri: `${REL}/notesSlide`, target: notesPath } }
    put.set(path, `${s.hidden && !/<p:sld\b[^>]*\sshow="0"/.test(s.head) ? withHiddenHead(s.head, true) : !s.hidden && /<p:sld\b[^>]*\sshow="0"/.test(s.head) ? withHiddenHead(s.head, false) : s.head}${s.objs.join('')}${timingFor(s)}`)
    put.set(relsPath(path), relsXml(rels, path))
  }
  // The comments, where they changed.
  if (threads) ct = writeDeckComments(doc, placed, put, gone, ct, threads)
  // New pictures, and their kinds in the content types.
  for (const [path, m] of media) {
    put.set(path, m.bytes)
    const ext = path.split('.').pop().toLowerCase()
    if (!new RegExp(`<Default Extension="${ext}"`, 'i').test(ct)) ct = ct.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${m.type}"/>`)
  }
  // The slides' order, in the presentation; its relationships if slides came or went.
  const presXml = doc.text(doc.presPath)
  const sameOrder = placed.length === doc.slides.length && placed.every((p, i) => p.path === doc.slides[i].path)
  if (!sameOrder) {
    const list = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/.exec(presXml)
    const next = `<p:sldIdLst>${ids.join('')}</p:sldIdLst>`
    put.set(doc.presPath, list ? presXml.replace(list[0], next) : presXml.replace(/(<\/p:sldMasterIdLst>)/, `$1${next}`))
    put.set(relsPath(doc.presPath), relsXml(presRels, doc.presPath))
  }
  if (ct !== doc.text('[Content_Types].xml')) put.set('[Content_Types].xml', ct)
  // Everything else, as it was, in the order it was.
  for (const [name, f] of files) {
    if (gone.has(name)) continue
    if (put.has(name)) { const v = put.get(name); out.file(name, typeof v === 'string' || v instanceof Uint8Array ? v : await v.async('uint8array')); put.delete(name); continue }
    out.file(name, await f.async('uint8array'))
  }
  for (const [name, v] of put) out.file(name, typeof v === 'string' || v instanceof Uint8Array ? v : await v.async('uint8array'))
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}
// A slide's animations name its shapes by id: once one they name is gone, they go too (or
// PowerPoint would find the file broken). Its other animations are kept as they were.
function timingFor(s) {
  if (!/<p:timing\b/.test(s.tail)) return s.tail
  const ids = new Set(idsIn(s).map(String))
  const named = [...s.tail.matchAll(/\bspid="(\d+)"/g)].map((m) => m[1])
  return named.every((id) => ids.has(id)) ? s.tail : s.tail.replace(/<p:timing\b[\s\S]*?<\/p:timing>/, '')
}
export const animationsLost = (s) => /<p:timing\b/.test(s.tail) && timingFor(s) !== s.tail
const withHiddenHead = (head, hidden) => head.replace(/<p:sld\b[^>]*>/, (tag) => withAttr(tag, 'show', hidden ? '0' : null))
// A notes page with this text in its notes, in place of what was there (or a new one).
function notesWith(xml, text) {
  const paras = String(text).split('\n').map((l) => `<a:p>${l ? `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r>` : '<a:endParaRPr lang="en-US" dirty="0"/>'}</a:p>`).join('')
  if (xml) {
    const tree = parseXml(xml)
    for (const sp of deep(tree, 'p:sp')) {
      if (phOf(sp)?.type !== 'body') continue
      const tx = kid(sp, 'p:txBody')
      if (tx) { const b = kid(tx, 'a:bodyPr'), l = kid(tx, 'a:lstStyle'); return xml.slice(0, tx.s) + `<p:txBody>${raw(xml, b) || '<a:bodyPr/>'}${raw(xml, l) || '<a:lstStyle/>'}${paras}</p:txBody>` + xml.slice(tx.e) }
      const end = sp.e - '</p:sp>'.length
      return xml.slice(0, end) + `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody>` + xml.slice(end)
    }
  }
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
}
// A new picture's part: its path in the file, for a slide's relationship to it.
export function newMediaPath(doc, media, ext) {
  let i = 1
  while (doc.zip.file(`ppt/media/image${i}.${ext}`) || media.has(`ppt/media/image${i}.${ext}`)) i++
  return `ppt/media/image${i}.${ext}`
}
export function withPictureRel(slide, target) {
  const same = Object.values(slide.rels).find((r) => r.type === 'image' && r.target === target)
  if (same) return { slide, rid: same.id }
  const rid = freeRid(slide.rels)
  return { slide: touch(slide, { rels: { ...slide.rels, [rid]: { id: rid, type: 'image', typeUri: `${REL}/image`, target } } }), rid }
}
export const slideNumberOf = (slides, slide) => slides.indexOf(slide) + 1

// ---------- Comments (PowerPoint's modern ones) ----------
// Each slide's comments are in their own part (ppt/comments/modernComment_<slide id>_<its
// creation id, in hex>.xml), found by the slide's relationship: a comment (cm) on the slide (its
// sldMk) or on a shape on it (deMkLst, the shape by its id), who wrote it (an id in the
// presentation's authors part), when, its words (a txBody), resolved or not (status), and its
// replies (replyLst). Read, each slide's are { path, list: [{ id, slide (its key), shape, author,
// initials, date, text, parent, done, raw }] }; written (writePptx's threads), a comment Studio
// didn't change is written as it was, and a part with nothing changed in it isn't written at all.
const P188 = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main'
const PC = 'http://schemas.microsoft.com/office/powerpoint/2013/main/command'
const AC = 'http://schemas.microsoft.com/office/drawing/2013/main/command'
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const CM_REL = 'http://schemas.microsoft.com/office/2018/10/relationships/comments'
const AUTHORS_REL = 'http://schemas.microsoft.com/office/2018/10/relationships/authors'
const CM_CT = 'application/vnd.ms-powerpoint.comments+xml'
const AUTHORS_CT = 'application/vnd.ms-powerpoint.authors+xml'
export const deckGuid = () => {
  const u = globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = Math.floor(Math.random() * 16); return (ch === 'x' ? r : (r & 3) | 8).toString(16) })
  return `{${u.toUpperCase()}}`
}
const local = (n) => String(n || '').slice(String(n || '').indexOf(':') + 1)
const byLocal = (el, name) => (el?.kids || []).filter((k) => k.name && local(k.name) === name)
const deepLocal = (el, name, out = []) => { for (const k of el?.kids || []) { if (k.name && local(k.name) === name) out.push(k); if (k.kids) deepLocal(k, name, out) } return out }
const wordsOfBody = (tx) => byLocal(tx, 'p').map((p) => deepLocal(p, 't').map(textIn).join('')).join('\n')
const initialsOf = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
// Its time as PowerPoint writes it: UTC to the millisecond, no zone; read back as ISO.
const cmDate = (d) => { const x = new Date(d || Date.now()); return (Number.isNaN(x.getTime()) ? new Date() : x).toISOString().replace(/Z$/, '') }
const cmIso = (s) => { if (!s) return null; const x = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`); return Number.isNaN(x.getTime()) ? null : x.toISOString() }
// The presentation's authors: { path, xml, list: [{ id, name, initials }] }.
function authorsOf(doc) {
  const r = Object.values(doc.presRels).find((x) => x.typeUri === AUTHORS_REL)
  const xml = r ? doc.text(r.target) : null
  return { path: r?.target || null, rid: r?.id || null, xml, list: deepLocal(parseXml(xml || ''), 'author').map((a) => ({ id: String(a.attrs.id || '').toUpperCase(), name: a.attrs.name || '', initials: a.attrs.initials || '' })) }
}
// A slide's comments, as they are in its part.
function slideComments(doc, s) {
  const r = Object.values(s.rels).find((x) => x.typeUri === CM_REL)
  const xml = r ? doc.text(r.target) : null
  if (!xml) return { path: r?.target || null, rid: r?.id || null, list: [] }
  const who = new Map(doc.authors.list.map((a) => [a.id, a]))
  const list = []
  for (const cm of deepLocal(parseXml(xml), 'cm')) {
    const a = who.get(String(cm.attrs.authorId || '').toUpperCase())
    const sp = deepLocal(cm, 'spMk')[0]
    const id = String(cm.attrs.id || '').toUpperCase()
    list.push({ id, slide: s.key, shape: sp ? String(sp.attrs.id) : null, author: a?.name || '', initials: a?.initials || initialsOf(a?.name), date: cmIso(cm.attrs.created), text: wordsOfBody(byLocal(cm, 'txBody')[0]), parent: null, done: cm.attrs.status === 'resolved' || cm.attrs.status === 'closed', raw: raw(xml, cm) })
    for (const rp of deepLocal(byLocal(cm, 'replyLst')[0], 'reply')) {
      const b = who.get(String(rp.attrs.authorId || '').toUpperCase())
      list.push({ id: String(rp.attrs.id || '').toUpperCase(), slide: s.key, shape: null, author: b?.name || '', initials: b?.initials || initialsOf(b?.name), date: cmIso(rp.attrs.created), text: wordsOfBody(byLocal(rp, 'txBody')[0]), parent: id, done: cm.attrs.status === 'resolved' || cm.attrs.status === 'closed', raw: raw(xml, rp) })
    }
  }
  return { path: r.target, rid: r.id, xml, list }
}
// Every slide's comments, in order: what the editor's threads start from.
export const deckComments = (doc) => doc.slides.flatMap((s) => s.comments?.list || [])
const cmBody = (text) => `<p188:txBody><a:bodyPr/><a:lstStyle/>${String(text || '').split('\n').map((l) => `<a:p>${l ? `<a:r><a:rPr lang="en-US"/><a:t>${esc(l)}</a:t></a:r>` : '<a:endParaRPr lang="en-US"/>'}</a:p>`).join('')}</p188:txBody>`
// A slide's creation id (p14:creationId), which PowerPoint's comments name it by.
const creationIdOf = (xml) => /<p14:creationId\b[^>]*\bval="(\d+)"/.exec(xml || '')?.[1] || null
const shapeCreationOf = (objXml) => /<a16:creationId\b[^>]*\bid="(\{[^"]+\})"/.exec(objXml || '')?.[1] || null
// One the slide doesn't have yet, the same each time it's asked for this slide.
const stableId = (seed) => { let h = 2166136261; for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 } return String((h % 4000000000) + 100000000) }
function withCreationId(xml, cid) {
  const ext = `<p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="${cid}"/></p:ext>`
  const inCsld = /<p:extLst>((?:(?!<p:extLst>)[\s\S])*?)<\/p:extLst>(\s*)<\/p:cSld>/.exec(xml)
  if (inCsld) return xml.replace(inCsld[0], `<p:extLst>${inCsld[1]}${ext}</p:extLst>${inCsld[2]}</p:cSld>`)
  return xml.replace('</p:cSld>', `<p:extLst>${ext}</p:extLst></p:cSld>`)
}
const cmKey = (list) => JSON.stringify(list.map((x) => [x.id, x.text, x.parent || null, !!(!x.parent && x.done), x.shape || null]).sort((a, b) => (a[0] < b[0] ? -1 : 1)))

// The comments written into the file being put together (writePptx's): each slide whose comments
// changed gets its part (and its relationship, and a creation id if it had none), new authors go
// in the authors part. placed: [{ s, path, sldId }]; put: the parts written; gone: those taken out;
// ct: the content types, given back with what these need.
function writeDeckComments(doc, placed, put, gone, ct, threads) {
  const override = (path, type) => { if (!ct.includes(`PartName="/${path}"`)) ct = ct.replace('</Types>', `<Override PartName="/${path}" ContentType="${type}"/></Types>`) }
  const authors = doc.authors.list.map((a) => ({ ...a }))
  const added = []
  const authorOf = (name) => {
    const n = String(name || '').trim() || 'Someone'
    const had = authors.find((a) => a.name === n)
    if (had) return had.id
    const a = { id: deckGuid(), name: n, initials: n === 'AI Assist' ? 'AI' : initialsOf(n) }
    authors.push(a); added.push(a)
    return a.id
  }
  for (const { s, path, sldId } of placed) {
    const mine = threads.filter((x) => x.slide === s.key)
    const was = s.isNew ? [] : (s.comments?.list || [])
    if (!s.isNew && cmKey(was) === cmKey(mine)) continue
    if (s.isNew && !mine.length) continue
    const slideXml = put.get(path) ?? doc.text(path) ?? ''
    let cid = creationIdOf(slideXml)
    if (!cid) { cid = stableId(`${sldId}:${path}`); put.set(path, withCreationId(slideXml, cid)) }
    const rels = relsOf(put.get(relsPath(path)) ?? doc.text(relsPath(path)), path)
    const old = Object.values(rels).find((r) => r.typeUri === CM_REL)
    const cmPath = (!s.isNew && s.comments?.path) || `ppt/comments/modernComment_${sldId}_${Number(cid).toString(16).toUpperCase()}.xml`
    if (!mine.length) {
      if (old) { delete rels[old.id]; put.set(relsPath(path), relsXml(rels, path)) }
      if (!s.isNew && s.comments?.path) { gone.add(cmPath); ct = ct.replace(new RegExp(`<Override PartName="/${cmPath.replace(/[.]/g, '\\.')}"[^>]*/>`), '') }
      continue
    }
    const sld = `<pc:sldMk cId="${cid}" sldId="${sldId}"/>`
    const byId = new Map(was.map((x) => [x.id, x]))
    const roots = mine.filter((x) => !x.parent)
    const cms = roots.map((x) => {
      const replies = mine.filter((y) => y.parent === x.id)
      const o = byId.get(x.id)
      const oReplies = was.filter((y) => y.parent === x.id)
      const replyXml = (y) => { const r0 = oReplies.find((z) => z.id === y.id && z.text === y.text); return r0?.raw || `<p188:reply id="${esc(y.id)}" authorId="${authorOf(y.author)}" created="${cmDate(y.date)}">${cmBody(y.text)}</p188:reply>` }
      // As it was in the file, but for whether it's resolved and its replies.
      if (o?.raw && o.text === x.text && (o.shape || null) === (x.shape || null)) {
        let out = !!o.done === !!x.done ? o.raw : withAttr(o.raw, 'status', x.done ? 'resolved' : null)
        if (cmKey(oReplies) !== cmKey(replies)) {
          const lst = /<(\w+:)?replyLst\b[^>]*>[\s\S]*?<\/\1replyLst>/.exec(out)
          const next = replies.length ? `<p188:replyLst>${replies.map(replyXml).join('')}</p188:replyLst>` : ''
          if (lst) out = out.replace(lst[0], next)
          else out = out.replace(/<(\w+:)?txBody\b/, (m) => `${next}${m}`)
        }
        return out
      }
      const shapeXml = x.shape != null ? s.objs.find((ob) => new RegExp(`<p:cNvPr\\b[^>]*\\bid="${x.shape}"`).test(ob)) : null
      const shapeCid = shapeCreationOf(shapeXml)
      const anchor = x.shape != null && shapeCid
        ? `<ac:deMkLst xmlns:ac="${AC}" xmlns:pc="${PC}"><pc:docMk/>${sld}<ac:spMk id="${x.shape}" creationId="${shapeCid}"/></ac:deMkLst>`
        : `<pc:sldMkLst xmlns:pc="${PC}"><pc:docMk/>${sld}</pc:sldMkLst>`
      const reps = replies.length ? `<p188:replyLst>${replies.map(replyXml).join('')}</p188:replyLst>` : ''
      return `<p188:cm id="${esc(x.id)}" authorId="${o?.raw ? /\bauthorId="([^"]+)"/.exec(o.raw)?.[1] || authorOf(x.author) : authorOf(x.author)}" created="${cmDate(x.date)}"${x.done ? ' status="resolved"' : ''}>${anchor}${reps}${cmBody(x.text)}</p188:cm>`
    }).join('')
    const had = !s.isNew && s.comments?.xml
    const xml = had
      ? (() => { const tree = parseXml(had); const root = tree.kids.find((k) => k.name); const items = (root?.kids || []).filter((k) => k.name); const firstCm = items.find((k) => local(k.name) === 'cm'); const lastCm = [...items].reverse().find((k) => local(k.name) === 'cm'); return firstCm ? had.slice(0, firstCm.s) + cms + had.slice(lastCm.e) : had.replace(/<\/p188:cmLst>\s*$/, `${cms}</p188:cmLst>`) })()
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p188:cmLst xmlns:a="${DML}" xmlns:r="${REL}" xmlns:p188="${P188}" xmlns:pc="${PC}">${cms}</p188:cmLst>`
    put.set(cmPath, xml)
    override(cmPath, CM_CT)
    if (!old || old.target !== cmPath) {
      if (old) delete rels[old.id]
      const id = freeRid(rels)
      rels[id] = { id, type: 'comments', typeUri: CM_REL, target: cmPath }
      put.set(relsPath(path), relsXml(rels, path))
    }
  }
  if (added.length) {
    const rows = added.map((a) => `<p188:author id="${a.id}" name="${esc(a.name)}" initials="${esc(a.initials)}" userId="${esc(a.name)}" providerId="None"/>`).join('')
    if (doc.authors.xml) put.set(doc.authors.path, doc.authors.xml.replace(/<\/p188:authorLst>\s*$/, `${rows}</p188:authorLst>`))
    else {
      const path = 'ppt/authors.xml'
      put.set(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p188:authorLst xmlns:a="${DML}" xmlns:r="${REL}" xmlns:p188="${P188}">${rows}</p188:authorLst>`)
      override(path, AUTHORS_CT)
      const presRels = relsOf(put.get(relsPath(doc.presPath)) ?? doc.text(relsPath(doc.presPath)), doc.presPath)
      const id = freeRid(presRels)
      presRels[id] = { id, type: 'authors', typeUri: AUTHORS_REL, target: path }
      put.set(relsPath(doc.presPath), relsXml(presRels, doc.presPath))
    }
  }
  return ct
}
