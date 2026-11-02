// A look over a drawing without a model, for Refine: shapes on top of each other, arrows that cross,
// arrows with no words on them, shapes of one kind in different sizes, uneven gaps, too many
// colours, a shape half in and half out of a container. Each finding says what and which, for the
// model to fix (in English, as the prompt is) and for the panel to count.
import { holderOf, nodeAround, within, box } from './holders.js'

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'image'])
const hit = (a, b, pad = 0) => a.x1 < b.x2 + pad && b.x1 < a.x2 + pad && a.y1 < b.y2 + pad && b.y1 < a.y2 + pad
// Whether two segments cross (touching ends don't count).
function cross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}
const segs = (a) => { const pts = a.points.map((p) => [a.x + p[0], a.y + p[1]]); return pts.slice(1).map((p, i) => [pts[i], p]) }

export function review(elements, ids = null) {
  const live = elements.filter((e) => !e.isDeleted && (!ids || ids.has(e.id)))
  const byId = new Map(elements.map((e) => [e.id, e]))
  const textOf = (e) => String(((e.boundElements || []).map((b) => byId.get(b.id)).find((x) => x?.type === 'text' && !x.isDeleted)?.originalText) ?? '').trim()
  const name = (e) => textOf(e) || e.type
  const containers = live.filter((e) => holderOf(e) && holderOf(e) !== 'node')
  const nodes = live.filter((e) => SHAPES.has(e.type) && !containers.includes(e) && !nodeAround(e, live))
  const arrows = live.filter((e) => e.type === 'arrow' && e.points?.length > 1)
  const found = []

  const over = []
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]
    if (hit(box(a), box(b), -2) && !within(a, b) && !within(b, a)) over.push([a, b])
  }
  if (over.length) found.push({ kind: 'overlap', n: over.length, ids: [...new Set(over.flat().map((e) => e.id))], text: `Shapes on top of each other: ${over.slice(0, 6).map(([a, b]) => `"${name(a)}" and "${name(b)}"`).join(', ')}.` })

  const crossing = []
  for (let i = 0; i < arrows.length; i++) for (let j = i + 1; j < arrows.length; j++) {
    const a = arrows[i], b = arrows[j]
    const ends = new Set([a.startBinding?.elementId, a.endBinding?.elementId].filter(Boolean))
    if ([b.startBinding?.elementId, b.endBinding?.elementId].some((x) => x && ends.has(x))) continue
    if (segs(a).some(([p, q]) => segs(b).some(([r, s]) => cross(p, q, r, s)))) crossing.push([a, b])
  }
  const ends = (a) => `${name(byId.get(a.startBinding?.elementId) || a)} to ${name(byId.get(a.endBinding?.elementId) || a)}`
  if (crossing.length) found.push({ kind: 'crossing', n: crossing.length, ids: [...new Set(crossing.flat().map((e) => e.id))], text: `Arrows that cross: ${crossing.slice(0, 6).map(([a, b]) => `${ends(a)} crosses ${ends(b)}`).join('; ')}.` })

  const bare = arrows.filter((a) => !textOf(a) && a.startBinding && a.endBinding)
  if (bare.length) found.push({ kind: 'unlabeled', n: bare.length, ids: bare.map((a) => a.id), text: `Arrows with no label: ${bare.slice(0, 8).map(ends).join('; ')}.` })

  // Shapes of the same kind (the same catalog item, or the same Excalidraw shape) in sizes far apart.
  const kinds = new Map()
  for (const e of nodes) { const k = e.customData?.bridge?.item || e.type; if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(e) }
  const uneven = [...kinds.entries()].filter(([, l]) => l.length > 1 && Math.max(...l.map((e) => e.width * e.height)) / Math.max(1, Math.min(...l.map((e) => e.width * e.height))) > 2.2)
  if (uneven.length) found.push({ kind: 'sizes', n: uneven.length, ids: uneven.flatMap(([, l]) => l.map((e) => e.id)), text: `Shapes of the same kind in very different sizes: ${uneven.map(([k, l]) => `${l.length} ${k}`).join(', ')}.` })

  // Gaps: each shape's nearest neighbour, too close or far more uneven than a tidy layout's.
  if (nodes.length > 2) {
    const gap = (a, b) => { const p = box(a), q = box(b); return Math.hypot(Math.max(0, q.x1 - p.x2, p.x1 - q.x2), Math.max(0, q.y1 - p.y2, p.y1 - q.y2)) }
    const near = nodes.map((a) => Math.min(...nodes.filter((b) => b !== a).map((b) => gap(a, b))))
    const tight = nodes.filter((_, i) => near[i] > 0 && near[i] < 16)
    const mean = near.reduce((s, x) => s + x, 0) / near.length
    const sd = Math.sqrt(near.reduce((s, x) => s + (x - mean) ** 2, 0) / near.length)
    if (tight.length) found.push({ kind: 'cramped', n: tight.length, ids: tight.map((e) => e.id), text: `Shapes almost touching: ${tight.slice(0, 6).map(name).map((s) => `"${s}"`).join(', ')}.` })
    else if (mean > 0 && sd / mean > 0.75) found.push({ kind: 'spacing', n: 1, ids: [], text: 'The gaps between shapes are uneven.' })
  }

  const fills = new Set(nodes.map((e) => String(e.backgroundColor || '').toLowerCase()).filter((c) => c && c !== 'transparent' && c !== '#ffffff'))
  if (fills.size > 5) found.push({ kind: 'colours', n: fills.size, ids: [], text: `${fills.size} different fill colours: use fewer, each for a reason.` })

  const halfway = nodes.filter((e) => containers.some((c) => hit(box(e), box(c), -2) && !within(e, c) && !within(c, e)))
  if (halfway.length) found.push({ kind: 'straddle', n: halfway.length, ids: halfway.map((e) => e.id), text: `Half in and half out of a container: ${halfway.slice(0, 6).map(name).map((s) => `"${s}"`).join(', ')}.` })
  return found
}
