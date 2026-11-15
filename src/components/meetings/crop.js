// A picture of a call's window, cropped to what's shared in it: the slide or page, without the
// faces beside it, the call's buttons and the window round it. Worked out from the picture alone, on
// this computer. A call shows what's shared on a stage of one colour (dark in Teams, Zoom and Meet),
// the people on tiles of one size in a row or a column beside it, and its title and buttons in bars
// at the top and bottom. Split the picture along the stage's colour (an XY-cut, as pages of a scan
// are split into columns): the biggest part is what's shared, tiles in a line beside it are people,
// thin parts at the edges are bars. What's left once tiles and bars are taken away is kept, with a
// margin of stage round it, so the crop never cuts into what's shared.
//
// It crops only when the picture plainly shows a call: tiles beside a picture of a screen (a solid
// rectangle, not a chart on a slide), on a dark stage or in a window named after a call app. Pictures
// of the same layout in one meeting back each other up (steady): two that agree are trusted more,
// and they're all cropped the same, so the crop doesn't jump about from slide to slide.
// cropping.jsx runs it on each picture of the screen as it's kept, and on the ones kept before.
export const VERSION = 1

const SIDE = 960 // the long side of the copy the layout is worked out on
const TOL = 10 // how far off the stage's colour a pixel can be and still be stage (JPEG's noise), on that copy
const TOL_FULL = 12 // and on the picture itself, where the noise isn't averaged away
const DARK = 80 // a stage this dark or darker: a call's
const BIG = 0.12 // what's shared is at least this much of the picture
const RING = 0.8 // and its edge is this solid: a picture of a screen, not a chart drawn on a slide
const BAR = 0.13 // a bar at the top or bottom is at most this tall
const RAIL = 0.07 // a rail of buttons at the side is at most this wide
const TILE = [1.2, 2.5] // a tile's width over its height (4:3 and 16:9 calls, a little either way; not a round avatar)
const TILE_AREA = [0.003, 0.2] // and its share of the picture
export const CALL_APP = /\b(teams|zoom|meet|webex|slack|huddle|facetime|whatsapp|discord|skype|goto ?meeting|bluejeans|chime|ringcentral|jitsi|whereby)\b/i
const EDITOR = /\b(powerpoint|keynote|slides|docs|sheets|word|excel|numbers|pages|figma|canva|acrobat|preview)\b/i

const luma = ([r, g, b]) => (r * 3 + g * 6 + b) / 10
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
const union = (a, b) => (!a ? { ...b } : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
const inside = (a, b) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1

// A smaller copy (RGB, a box average of what each pixel covers), for working out the layout.
function shrink({ width: W, height: H, data }, k) {
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k))
  const rgb = new Uint8ClampedArray(w * h * 3)
  const xs = Array.from({ length: w + 1 }, (_, i) => Math.min(W, Math.round(i * W / w)))
  const ys = Array.from({ length: h + 1 }, (_, i) => Math.min(H, Math.round(i * H / h)))
  const sum = new Float64Array(w * 3), n = new Float64Array(w)
  for (let y = 0; y < h; y++) {
    sum.fill(0); n.fill(0)
    for (let sy = ys[y]; sy < Math.max(ys[y] + 1, ys[y + 1]); sy++) {
      for (let x = 0; x < w; x++) {
        for (let sx = xs[x]; sx < Math.max(xs[x] + 1, xs[x + 1]); sx++) {
          const i = (sy * W + sx) * 4
          sum[x * 3] += data[i]; sum[x * 3 + 1] += data[i + 1]; sum[x * 3 + 2] += data[i + 2]; n[x]++
        }
      }
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = sum[x * 3 + c] / n[x]
  }
  return { w, h, rgb }
}

// The colours that cover the most of it, each a candidate for the stage.
function common({ w, h, rgb }, most = 6) {
  const bins = new Uint32Array(32768), sums = new Float64Array(32768 * 3)
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    bins[k]++; sums[k * 3] += r; sums[k * 3 + 1] += g; sums[k * 3 + 2] += b
  }
  const order = [...bins.keys()].filter((k) => bins[k] >= w * h * 0.015).sort((a, b) => bins[b] - bins[a])
  const out = []
  for (const k of order) {
    const c = [sums[k * 3] / bins[k], sums[k * 3 + 1] / bins[k], sums[k * 3 + 2] / bins[k]]
    // A colour split over two bins is one; a bar a shade off the stage is another.
    if (out.some((o) => Math.max(...o.map((v, j) => Math.abs(v - c[j]))) < 8)) continue
    out.push(c)
    if (out.length >= most) break
  }
  return out
}

// What isn't stage, as a sum over any rectangle (an integral image): n, any pixel off it; strong,
// one well off it. JPEG blurs a tile's edge into the gap beside it, a little: a row of stage may
// have a few pixels a little off, never many, nor any far off.
function sums({ w, h, rgb }, S) {
  const I = new Int32Array((w + 1) * (h + 1)), J = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0, far = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const d = Math.max(Math.abs(rgb[i] - S[0]), Math.abs(rgb[i + 1] - S[1]), Math.abs(rgb[i + 2] - S[2]))
      if (d > TOL) row++
      if (d > 3 * TOL) far++
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row
      J[(y + 1) * (w + 1) + x + 1] = J[y * (w + 1) + x + 1] + far
    }
  }
  const sum = (T) => (b) => T[b.y1 * (w + 1) + b.x1] - T[b.y0 * (w + 1) + b.x1] - T[b.y1 * (w + 1) + b.x0] + T[b.y0 * (w + 1) + b.x0]
  const n = sum(I), strong = sum(J)
  n.empty = (b) => { const len = (b.x1 - b.x0) * (b.y1 - b.y0); return n(b) <= len * 0.1 && strong(b) <= len * 0.01 }
  return n
}

// The picture split along the stage, into a tree: each part trimmed to what's in it, then split
// where a row (or a column) of stage runs right across it, the way with the wider gap first. Across
// the whole width, rows first: a call's bars run along its top and bottom, and a slide narrower
// than its stage leaves a column of stage that would otherwise split the bars in two.
function cut(n, b, depth = 0, W = b.x1) {
  let { x0, y0, x1, y1 } = b
  while (y0 < y1 && n.empty({ x0, y0, x1, y1: y0 + 1 })) y0++
  while (y1 > y0 && n.empty({ x0, y0: y1 - 1, x1, y1 })) y1--
  while (x0 < x1 && n.empty({ x0, y0, x1: x0 + 1, y1 })) x0++
  while (x1 > x0 && n.empty({ x0: x1 - 1, y0, x1, y1 })) x1--
  if (x1 - x0 < 2 || y1 - y0 < 2) return null
  const node = { x0, y0, x1, y1 }
  if (depth > 12) return node
  const gaps = (horiz) => {
    const out = []
    let start = -1, widest = 0
    const [a, z] = horiz ? [y0, y1] : [x0, x1]
    for (let v = a; v < z; v++) {
      const empty = n.empty(horiz ? { x0, y0: v, x1, y1: v + 1 } : { x0: v, y0, x1: v + 1, y1 })
      if (empty && start < 0) start = v
      if (!empty && start >= 0) { out.push([start, v]); widest = Math.max(widest, v - start); start = -1 }
    }
    return { out, widest }
  }
  const hs = gaps(true), vs = gaps(false)
  const horiz = hs.out.length && (!vs.out.length || hs.widest >= vs.widest || x1 - x0 >= W * 0.85)
  const g = horiz ? hs : vs
  if (!g.out.length) return node
  const kids = []
  let from = horiz ? y0 : x0
  for (const [s, e] of [...g.out, [horiz ? y1 : x1, horiz ? y1 : x1]]) {
    const k = cut(n, horiz ? { x0, y0: from, x1, y1: s } : { x0: from, y0, x1: s, y1 }, depth + 1, W)
    if (k) kids.push(k)
    from = e
  }
  if (kids.length > 1) { node.dir = horiz ? 'h' : 'v'; node.kids = kids }
  return node
}
const leaves = (node) => (node.kids ? node.kids.flatMap(leaves) : [node])

// The tiles a part is made of, when it's people: one tile, or tiles of about one size in a row, a
// column or a grid (with maybe a small button among them, "+3" or a page arrow). A tile is solid
// off the stage, a camera's picture or the grey of one that's off: initials and a name on stage
// are no tile. null when it isn't.
function tilesOf(z, A, n) {
  const r = (z.x1 - z.x0) / (z.y1 - z.y0)
  if (r >= TILE[0] && r <= TILE[1] && area(z) >= A * TILE_AREA[0] && area(z) <= A * TILE_AREA[1] && n(z) >= area(z) * 0.6) return [z]
  if (!z.kids) return null
  const each = z.kids.map((k) => tilesOf(k, A, n))
  const good = each.filter(Boolean).flat()
  if (!good.length) return null
  const mid = good.map(area).sort((a, b) => a - b)[Math.floor(good.length / 2)]
  if (z.kids.some((k, i) => !each[i] && area(k) > mid * 0.5)) return null
  const fit = good.filter((t) => area(t) >= mid / 2.5 && area(t) <= mid * 2.5)
  return fit.length === good.length ? good : null
}

// How light a part is, on average: a page is mostly paper, a camera's picture of someone isn't, nor
// is a camera that's off (initials on grey).
function lightness({ w, rgb }, b) {
  let sum = 0
  for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) { const i = (y * w + x) * 3; sum += (rgb[i] * 3 + rgb[i + 1] * 6 + rgb[i + 2]) / 10 }
  return sum / Math.max(1, area(b))
}
const PAPER = 200

// The layout on the copy, with S as the stage: what's shared, and what of the call is round it.
function layout(img, S) {
  const { w, h } = img
  const A = w * h
  const n = sums(img, S)
  const root = cut(n, { x0: 0, y0: 0, x1: w, y1: h })
  if (!root?.kids) return null
  const all = leaves(root)
  const main = all.reduce((a, b) => (area(b) > area(a) ? b : a))
  // A call has its bars, or some stage, above and below what's shared.
  if (area(main) < A * BIG || main.y0 === 0 || main.y1 === h) return null
  // Its edge, a pixel in all round: solid when it's a picture of a screen.
  const ring = (b) => {
    const edge = n({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y0 + 1 }) + n({ x0: b.x0, y0: b.y1 - 1, x1: b.x1, y1: b.y1 }) + n({ x0: b.x0, y0: b.y0 + 1, x1: b.x0 + 1, y1: b.y1 - 1 }) + n({ x0: b.x1 - 1, y0: b.y0 + 1, x1: b.x1, y1: b.y1 - 1 })
    return edge / Math.max(1, 2 * (b.x1 - b.x0) + 2 * (b.y1 - b.y0 - 2))
  }
  // From what's shared up to the whole picture: at each split, what's beside it.
  const path = []
  const find = (node) => { if (node === main) return true; for (const k of node.kids || []) if (find(k)) { path.push([node, k]); return true } return false }
  find(root)
  const furniture = []
  let tiles = 0
  for (const [parent, child] of path) {
    const i = parent.kids.indexOf(child)
    const wide = parent.x1 - parent.x0 >= w * 0.85, tall = parent.y1 - parent.y0 >= h * 0.6
    for (const side of [parent.kids.slice(0, i), parent.kids.slice(i + 1).reverse()]) {
      // From the picture's edge in: bars (and rails) only at the edge, people anywhere beside it.
      let edge = true
      for (const z of side) {
        const ts = tilesOf(z, A, n)
        const thin = parent.dir === 'h' ? (z.y1 - z.y0) <= h * 0.3 : (z.x1 - z.x0) <= w * 0.35
        // Tiles mostly of paper are pages (an editor's thumbnails), not people.
        const pages = ts && ts.filter((t) => lightness(img, t) > PAPER).length * 2 > ts.length
        if (ts && thin && !pages) { furniture.push({ ...z, kind: 'people', n: ts.length, tiles: ts }); tiles = Math.max(tiles, ts.length); continue }
        if (edge && parent.dir === 'h' && wide && (z.y1 - z.y0) <= h * BAR) { furniture.push({ ...z, kind: 'bar' }); continue }
        if (edge && parent.dir === 'v' && tall && (z.x1 - z.x0) <= w * RAIL) { furniture.push({ ...z, kind: 'rail' }); continue }
        // A panel at the side (the call's chat, or who's in it): tall, of a colour of its own.
        if (edge && parent.dir === 'v' && (z.y1 - z.y0) >= h * 0.55 && (z.x1 - z.x0) <= w * 0.4 && (z.y1 - z.y0) >= 1.4 * (z.x1 - z.x0) && !z.kids && ring(z) >= RING) { furniture.push({ ...z, kind: 'panel' }); continue }
        edge = false
      }
    }
  }
  // What's shared is far bigger than anyone's tile: a part the size of the tiles is one of them (a
  // gallery, nobody sharing), never to be cropped to.
  const biggest = Math.max(0, ...furniture.filter((f) => f.kind === 'people').flatMap((f) => f.tiles.map(area)))
  if (!tiles || area(main) < 3 * biggest) return null
  const kept = all.filter((l) => !furniture.some((f) => inside(l, f)))
  const content = kept.reduce((a, b) => union(a, b), null)
  // Room round it, up to the call's parts on each side (or the picture's edge).
  const room = { x0: 0, y0: 0, x1: w, y1: h }
  for (const f of furniture) {
    const overX = f.x0 < content.x1 && f.x1 > content.x0, overY = f.y0 < content.y1 && f.y1 > content.y0
    if (overY && f.x1 <= content.x0) room.x0 = Math.max(room.x0, f.x1)
    if (overY && f.x0 >= content.x1) room.x1 = Math.min(room.x1, f.x0)
    if (overX && f.y1 <= content.y0) room.y0 = Math.max(room.y0, f.y1)
    if (overX && f.y0 >= content.y1) room.y1 = Math.min(room.y1, f.y0)
  }
  const why = [tiles >= 2 ? `${tiles} tiles beside it` : 'a tile beside it']
  let score = tiles >= 2 ? 2 : 1
  const dark = luma(S) <= DARK
  if (dark) { score++; why.push('a dark stage') }
  return { S, score, why, dark, solid: ring(main) >= RING, main, content, room, furniture }
}

// Where what's shared starts and ends, to the pixel: from the copy's guess, the first row (or
// column) with enough off the stage, looking from outside in, but never past the room round it.
function exact({ width: W, height: H, data }, S, guess, room) {
  const off = (x, y) => { const i = (y * W + x) * 4; return Math.abs(data[i] - S[0]) > TOL_FULL || Math.abs(data[i + 1] - S[1]) > TOL_FULL || Math.abs(data[i + 2] - S[2]) > TOL_FULL }
  const count = (horiz, v, a, z) => { let c = 0; for (let u = a; u < z; u++) if (horiz ? off(u, v) : off(v, u)) c++; return c }
  const pad = Math.ceil(2 * W / SIDE) + 2
  const out = { ...guess }
  const enough = (len) => Math.max(2, Math.round(len * 0.003))
  // Each side: scan from just outside (within the room) to just inside.
  const left = () => { for (let x = Math.max(room.x0, guess.x0 - pad); x < Math.min(guess.x1, guess.x0 + pad); x++) if (count(false, x, out.y0, out.y1) >= enough(out.y1 - out.y0)) return x; return guess.x0 }
  const right = () => { for (let x = Math.min(room.x1, guess.x1 + pad) - 1; x >= Math.max(guess.x0, guess.x1 - pad); x--) if (count(false, x, out.y0, out.y1) >= enough(out.y1 - out.y0)) return x + 1; return guess.x1 }
  const top = () => { for (let y = Math.max(room.y0, guess.y0 - pad); y < Math.min(guess.y1, guess.y0 + pad); y++) if (count(true, y, out.x0, out.x1) >= enough(out.x1 - out.x0)) return y; return guess.y0 }
  const bottom = () => { for (let y = Math.min(room.y1, guess.y1 + pad) - 1; y >= Math.max(guess.y0, guess.y1 - pad); y--) if (count(true, y, out.x0, out.x1) >= enough(out.x1 - out.x0)) return y + 1; return guess.y1 }
  // Widen the span first, so each side is measured along all of it.
  out.x0 = Math.max(room.x0, guess.x0 - pad); out.x1 = Math.min(room.x1, guess.x1 + pad)
  out.y0 = top(); out.y1 = bottom()
  out.x0 = left(); out.x1 = right()
  return out
}

// One picture: img is { width, height, data } (RGBA, as a canvas gives it). source: the name of
// the window it's of. Says { w, h, crop, content, room, score, solid, why }: crop is where to cut,
// or null; the rest is for steady() and for saying why.
export function analyze(img, { source = '' } = {}) {
  const { width: W, height: H } = img
  const out = { v: VERSION, w: W, h: H, crop: null, score: 0, why: [] }
  if (!W || !H) return out
  const k = Math.min(1, SIDE / Math.max(W, H))
  const small = shrink(img, k)
  let best = null
  for (const S of common(small)) {
    const l = layout(small, S)
    if (l && (!best || l.score > best.score || (l.score === best.score && l.solid && !best.solid))) best = l
  }
  if (!best) { out.why.push('no call round it'); return out }
  const up = (b, slack = 0) => ({ x0: Math.max(0, Math.floor(b.x0 / k) - slack), y0: Math.max(0, Math.floor(b.y0 / k) - slack), x1: Math.min(W, Math.ceil(b.x1 / k) + slack), y1: Math.min(H, Math.ceil(b.y1 / k) + slack) })
  // The room's edges, a copy's pixel in from the call's parts, and never less than what's shared.
  const s = Math.ceil(1 / k) + 1
  const r = up(best.room)
  const room = { x0: best.room.x0 > 0 ? r.x0 + s : 0, y0: best.room.y0 > 0 ? r.y0 + s : 0, x1: best.room.x1 < small.w ? r.x1 - s : W, y1: best.room.y1 < small.h ? r.y1 - s : H }
  const content = exact(img, best.S, up(best.content), room)
  room.x0 = Math.min(room.x0, content.x0); room.y0 = Math.min(room.y0, content.y0); room.x1 = Math.max(room.x1, content.x1); room.y1 = Math.max(room.y1, content.y1)
  // A call's window by its name, or an editor's (a deck's thumbnails beside its slide aren't people).
  const named = CALL_APP.test(source), editor = !named && EDITOR.test(source)
  const score = best.score + (named ? 1 : 0)
  const why = [...best.why, ...(named ? [`a window named ${source.slice(0, 40)}`] : [])]
  // A light stage takes the window's name to be a call: thumbnails beside a slide, on light grey,
  // are more often an editor than a call.
  const call = (best.dark || named) && !editor
  const crop = margin(content, room, W, H)
  Object.assign(out, { S: best.S.map(Math.round), score, why, call, solid: best.solid, content, room, cut: crop, people: best.furniture.filter((f) => f.kind === 'people').map((f) => up(f)) })
  out.crop = call && score >= 3 && best.solid && worth(crop, W, H) ? crop : null
  if (!out.crop) out.why.push(editor ? `a window named ${source.slice(0, 40)}, not a call` : !best.solid ? 'what\'s shared has no clear edge' : score < 3 || !call ? 'not sure it\'s a call' : 'little to take away')
  return out
}
// What's shared and a margin of stage round it, inside the room.
function margin(c, room, W, H) {
  const m = Math.max(3, Math.round(Math.max(W, H) / 480))
  return { x0: Math.max(room.x0, c.x0 - m), y0: Math.max(room.y0, c.y0 - m), x1: Math.min(room.x1, c.x1 + m), y1: Math.min(room.y1, c.y1 + m) }
}
// A crop that takes away little isn't worth a second picture.
const worth = (c, W, H) => area(c) <= W * H * 0.97 && area(c) >= W * H * BIG

// A crop that fits a picture: all of what's shared in it, and its edge in the stage round it.
const fits = (c, a) => a.content && a.w === c.w && a.h === c.h && inside(a.content, c) && inside(c, a.room) && a.S && c.S.every((v, i) => Math.abs(v - a.S[i]) <= TOL * 2)

// The pictures of a meeting, as they're analysed (in the order they were kept): pictures of the
// same layout (one crop fits each) back each other up, a point each, and share one crop, the one
// the surest of them would have; a picture sure of a crop of its own that's plainly another (a 4:3
// page after a 16:9 deck) keeps its own. add(key, a) says, for every picture so far, its crop now.
export function steady() {
  const seen = [] // { key, a }
  return {
    add(key, a) {
      const i = seen.findIndex((s) => s.key === key)
      if (i >= 0) seen[i].a = a; else seen.push({ key, a })
      return decide(seen)
    },
    get size() { return seen.length },
  }
}
function decide(seen) {
  const groups = [] // { lead, crop, members }
  const sure = [...seen].filter((s) => s.a.cut).sort((x, y) => (y.a.solid - x.a.solid) || (y.a.score - x.a.score))
  for (const s of sure) {
    const c = { ...s.a.cut, w: s.a.w, h: s.a.h, S: s.a.S }
    const g = groups.find((g) => fits(g.crop, s.a))
    if (g) g.members.push(s); else groups.push({ lead: s, crop: c, members: [s] })
  }
  const out = new Map()
  for (const s of seen) {
    const g = groups.find((g) => g.members.includes(s))
    const backed = g && g.members.length >= 2 ? 1 : 0
    const ok = g && g.lead.a.solid && s.a.call && s.a.score + backed >= 3 && worth(g.crop, s.a.w, s.a.h)
    const own = s.a.cut, near = Math.max(s.a.w, s.a.h) * 0.01
    const mine = ok && s.a.solid && s.a.score >= 3 && ['x0', 'y0', 'x1', 'y1'].some((k) => Math.abs(own[k] - g.crop[k]) > near)
    const r = mine ? own : g?.crop
    out.set(s.key, ok ? { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 } : null)
  }
  return out
}
