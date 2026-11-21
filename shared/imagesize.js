// A picture's size from its first bytes: PNG, JPEG, GIF, BMP and WebP; null for any other. w and h
// in px as PowerPoint sizes one (its pixels at its own dots to the inch, 96 when it doesn't say),
// pw and ph its pixels, alpha whether it may be see-through (a PNG with an alpha channel or a
// transparent colour, a GIF, a WebP that says so). Read in the page (Studio's decks) and on the
// server (a big file's pictures, listed before they're sent: studioparts.js).
export function imageSize(b) {
  if (!b || b.length < 30) return null
  const u16 = (o, le) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
  const u32 = (o, le) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0)
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  let w = 0, h = 0, dx = 96, dy = 96, alpha = false
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    w = u32(16); h = u32(20)
    alpha = b[25] === 4 || b[25] === 6
    for (let i = 8; i + 12 <= b.length;) {
      const len = u32(i), type = tag(i + 4)
      if (type === 'pHYs' && b[i + 16] === 1 && u32(i + 8) && u32(i + 12)) { dx = Math.round(u32(i + 8) * 0.0254); dy = Math.round(u32(i + 12) * 0.0254) }
      if (type === 'tRNS') alpha = true
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
  } else if (tag(0) === 'GIF8') { w = u16(6, true); h = u16(8, true); alpha = true }
  else if (b[0] === 0x42 && b[1] === 0x4d) { w = u32(18, true); h = Math.abs(u32(22, true) | 0); const ppm = u32(38, true); if (ppm) dx = dy = Math.round(ppm * 0.0254) }
  else if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const kind = tag(12)
    if (kind === 'VP8X') { w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16)); h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16)); alpha = !!(b[20] & 0x10) }
    else if (kind === 'VP8 ') { w = u16(26, true) & 0x3fff; h = u16(28, true) & 0x3fff }
    else if (kind === 'VP8L') { const v = u32(21, true); w = (v & 0x3fff) + 1; h = ((v >> 14) & 0x3fff) + 1; alpha = true }
  }
  return w > 0 && h > 0 ? { w: (w * 96) / dx, h: (h * 96) / dy, pw: w, ph: h, alpha } : null
}
