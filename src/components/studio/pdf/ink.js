// Ink for a signature, the same wherever it's drawn: the pad here (a mouse, a finger or a pen), the
// trackpad (native/bridgesign, its finger's place streamed in), and the phone's pad (Sign on Phone),
// whose strokes come back here to be drawn and kept. Points are smoothed as they come (a One Euro
// filter: steady when the hand is slow, quick to follow when it's fast, so a trackpad's jitter
// doesn't show and a quick flourish doesn't lag), and each stroke is drawn as ink is: thicker where
// the hand slows or a pen presses, thinner where it speeds, a little finer where it starts and ends,
// with curves through the points and the width changing smoothly along them (Preview's look).
export const MIN_W = 1.1, MAX_W = 3.6

// One axis's filter (Casiez, Roussel & Vogel, "1€ Filter", CHI 2012). t in seconds.
function oneEuro({ minCutoff = 1.6, beta = 0.02, dCutoff = 1 } = {}) {
  let last = null, dx = 0, lt = 0
  const alpha = (cutoff, dt) => { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1) }
  return (x, t) => {
    if (last === null) { last = x; lt = t; return x }
    const dt = Math.max(1 / 240, t - lt)
    lt = t
    const d = (x - last) / dt
    dx += alpha(dCutoff, dt) * (d - dx)
    const cutoff = minCutoff + beta * Math.abs(dx)
    last += alpha(cutoff, dt) * (x - last)
    return last
  }
}

// A stroke being drawn: add() each point as it comes ({ x, y, t (ms), p (pressure 0–1, or null) }),
// the stroke so far in .points. smooth: how steady to keep it (the trackpad's more).
export function stroke({ smooth = 'pen' } = {}) {
  const f = smooth === 'trackpad' ? { minCutoff: 1.1, beta: 0.012 } : smooth === 'none' ? null : { minCutoff: 2.2, beta: 0.03 }
  const fx = f && oneEuro(f), fy = f && oneEuro(f)
  const points = []
  return {
    points,
    add({ x, y, t, p = null }) {
      const s = t / 1000
      const sx = fx ? fx(x, s) : x, sy = fy ? fy(y, s) : y
      const last = points.at(-1)
      if (last && Math.hypot(sx - last.x, sy - last.y) < 0.5) return false
      let w
      if (p != null && p > 0) {
        // A pen's pressure (or a phone's touch that has one): pressed harder, thicker.
        const target = MIN_W + (MAX_W * 1.15 - MIN_W) * Math.pow(Math.min(1, p), 0.75)
        w = last ? last.w * 0.55 + target * 0.45 : target
      } else if (last) {
        // Slower is thicker, eased, so the width doesn't jump.
        const v = Math.hypot(sx - last.x, sy - last.y) / Math.max(1, t - last.t)
        const target = Math.max(MIN_W, Math.min(MAX_W, MAX_W - v * 1.35))
        w = last.w * 0.72 + target * 0.28
      } else w = (MIN_W + MAX_W) / 2
      points.push({ x: sx, y: sy, t, w })
      return true
    },
  }
}

// Where a stroke's curve is, between its points: the middle of each pair, with the point between as
// the control (quadratic), its width eased along it. Each step about a pixel long.
function* along(pts) {
  const n = pts.length
  if (n === 1) { yield { x: pts[0].x, y: pts[0].y, w: pts[0].w }; return }
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2 })
  const taper = (i) => Math.min(1, 0.55 + 0.15 * Math.min(i, n - 1 - i)) // finer at the ends
  let from = { ...pts[0], w: pts[0].w * taper(0) }
  yield from
  for (let i = 1; i < n; i++) {
    const c = { ...pts[i - 1], w: pts[i - 1].w * taper(i - 1) }
    const to = i === n - 1 ? { ...pts[i], w: pts[i].w * taper(i) } : mid(c, { ...pts[i], w: pts[i].w * taper(i) })
    const ctl = i === 1 ? mid(from, to) : c
    const len = Math.hypot(ctl.x - from.x, ctl.y - from.y) + Math.hypot(to.x - ctl.x, to.y - ctl.y)
    const steps = Math.max(1, Math.ceil(len))
    for (let k = 1; k <= steps; k++) {
      const s = k / steps, a = (1 - s) * (1 - s), b = 2 * s * (1 - s), d = s * s
      yield { x: a * from.x + b * ctl.x + d * to.x, y: a * from.y + b * ctl.y + d * to.y, w: from.w + (to.w - from.w) * s }
    }
    from = to
  }
}

export function drawStroke(ctx, pts, ink) {
  if (!pts?.length) return
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  let prev = null
  for (const q of along(pts)) {
    if (!prev) { ctx.beginPath(); ctx.arc(q.x, q.y, q.w / 2, 0, Math.PI * 2); ctx.fill() } else {
      ctx.beginPath()
      ctx.lineWidth = (prev.w + q.w) / 2
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }
    prev = q
  }
}

// The strokes as a PNG, cropped to them: { png, width, height }, or null with nothing drawn. Kept
// at three times the size drawn, so it stays sharp on a page.
export function strokesToPng(strokes, ink, scale = 3) {
  const all = strokes.flat()
  if (!all.length) return null
  const pad = MAX_W * 2
  const x0 = Math.min(...all.map((p) => p.x)) - pad, y0 = Math.min(...all.map((p) => p.y)) - pad
  const x1 = Math.max(...all.map((p) => p.x)) + pad, y1 = Math.max(...all.map((p) => p.y)) + pad
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil((x1 - x0) * scale))
  c.height = Math.max(1, Math.ceil((y1 - y0) * scale))
  const ctx = c.getContext('2d')
  ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale)
  for (const s of strokes) drawStroke(ctx, s, ink)
  return { png: c.toDataURL('image/png'), width: c.width, height: c.height }
}

// Strokes to send or keep apart from the pad they were drawn on: each point [x, y, w], x and y as
// a share of the pad's size, w in its pixels. { w, h, strokes }.
export function packStrokes(strokes, w, h) {
  const r = (v) => Math.round(v * 10000) / 10000
  return { w: Math.round(w), h: Math.round(h), strokes: strokes.map((s) => s.map((p) => [r(p.x / w), r(p.y / h), Math.round(p.w * 100) / 100])) }
}
// ...and back, the signature itself (its strokes' bounds, not the pad it was drawn on, which on a
// phone held upright is tall) fitted into a pad of W by H, centred, its shape kept. null if it
// isn't strokes.
export function unpackStrokes(o, W, H) {
  if (!o || !Array.isArray(o.strokes) || !(o.w > 0) || !(o.h > 0)) return null
  const ok = (v) => Number.isFinite(v) && v >= -0.05 && v <= 1.05
  const raw = []
  for (const s of o.strokes.slice(0, 200)) {
    if (!Array.isArray(s)) continue
    const pts = s.slice(0, 5000).filter((p) => Array.isArray(p) && ok(p[0]) && ok(p[1])).map(([x, y, w]) => ({ x: x * o.w, y: y * o.h, w: Math.max(MIN_W * 0.6, Math.min(MAX_W * 1.3, Number(w) || 2)) }))
    if (pts.length) raw.push(pts)
  }
  if (!raw.length) return null
  const all = raw.flat()
  const x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x))
  const y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y))
  const m = Math.min(W, H) * 0.12
  // As large as fits with a margin, never more than twice as drawn, and no smaller than it fits.
  const k = Math.min(2, (W - m * 2) / Math.max(1, x1 - x0), (H - m * 2) / Math.max(1, y1 - y0))
  const dx = (W - (x1 - x0) * k) / 2 - x0 * k, dy = (H - (y1 - y0) * k) / 2 - y0 * k
  const wk = Math.max(0.7, Math.min(1.4, k))
  return raw.map((s) => s.map((p) => ({ x: dx + p.x * k, y: dy + p.y * k, t: 0, w: p.w * wk })))
}
