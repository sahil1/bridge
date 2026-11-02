// Laying a diagram out: left to right or top to bottom, with even spacing, shapes kept inside their
// containers. dagre (MIT, the layout Mermaid itself uses, via dagre-d3-es) ranks the shapes and
// places them; here they're given room for their names and moved on the board.
//   layoutGraph: an abstract graph (a model's diagram, spec.js) to positions.
//   layoutBoard: the shapes on a board, or the ones selected, tidied in place (Auto-layout).
import { layout as dagre } from 'dagre-d3-es/src/dagre/index.js'
import { Graph } from 'dagre-d3-es/src/graphlib/index.js'
import { holderOf, isContainer, contents, nodeAround, within, box } from './holders.js'

// Room around what a container holds, and above it for its name.
export const PAD = { side: 24, top: 40, bottom: 24 }
export const SPACING = { roomy: 1.4, normal: 1, tight: 0.7 }

// nodes: [{ id, w, h, group }], groups: [{ id, parent }], edges: [{ from, to, label }].
// { nodes: Map(id -> { x, y }) (top left), groups: Map(id -> { x, y, w, h }), w, h }
export function layoutGraph({ nodes, groups = [], edges = [] }, { dir = 'LR', spacing = 'normal' } = {}) {
  const f = SPACING[spacing] || 1
  const g = new Graph({ compound: true, multigraph: true })
  g.setGraph({ rankdir: dir === 'TB' ? 'TB' : 'LR', nodesep: Math.round(70 * f), ranksep: Math.round(110 * f), edgesep: 24, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  const gid = new Set(groups.map((x) => x.id))
  // A group with nothing in it would be laid out as nothing at all: it's a node of its own size.
  const used = new Set()
  for (const n of nodes) for (let p = n.group; p; p = groups.find((x) => x.id === p)?.parent) used.add(p)
  const real = groups.filter((x) => used.has(x.id))
  for (const x of real) g.setNode(x.id, {})
  for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h })
  for (const x of groups) if (!used.has(x.id)) g.setNode(x.id, { width: x.w || 240, height: x.h || 140 })
  for (const x of real) if (x.parent && used.has(x.parent)) g.setParent(x.id, x.parent)
  for (const n of nodes) if (n.group && gid.has(n.group) && used.has(n.group)) g.setParent(n.id, n.group)
  edges.forEach((e, i) => {
    if (e.from === e.to || !g.hasNode(e.from) || !g.hasNode(e.to) || real.some((x) => x.id === e.from || x.id === e.to)) return
    g.setEdge(e.from, e.to, { width: e.label ? Math.min(160, 12 + String(e.label).length * 7) : 0, height: e.label ? 20 : 0, labelpos: 'c' }, `e${i}`)
  })
  dagre(g)
  const out = { nodes: new Map(), groups: new Map() }
  for (const n of nodes) { const v = g.node(n.id); out.nodes.set(n.id, { x: v.x - n.w / 2, y: v.y - n.h / 2 }) }
  for (const x of groups) if (!used.has(x.id)) { const v = g.node(x.id); out.groups.set(x.id, { x: v.x - v.width / 2, y: v.y - v.height / 2, w: v.width, h: v.height }) }
  // Each group around what's in it, innermost first: its nodes and the groups inside it, with room
  // for its name.
  const depth = (x) => { let d = 0; for (let p = x.parent; p; p = groups.find((y) => y.id === p)?.parent) d++; return d }
  for (const x of [...real].sort((a, b) => depth(b) - depth(a))) {
    const inner = [
      ...nodes.filter((n) => n.group === x.id).map((n) => { const p = out.nodes.get(n.id); return { x1: p.x, y1: p.y, x2: p.x + n.w, y2: p.y + n.h } }),
      ...real.filter((y) => y.parent === x.id).map((y) => { const b = out.groups.get(y.id); return { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h } }),
    ]
    const x1 = Math.min(...inner.map((b) => b.x1)) - PAD.side, y1 = Math.min(...inner.map((b) => b.y1)) - PAD.top
    const x2 = Math.max(...inner.map((b) => b.x2)) + PAD.side, y2 = Math.max(...inner.map((b) => b.y2)) + PAD.bottom
    out.groups.set(x.id, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
  }
  // From 0, 0.
  const all = [...[...out.nodes].map(([id, p]) => { const n = nodes.find((m) => m.id === id); return { x1: p.x, y1: p.y, x2: p.x + n.w, y2: p.y + n.h } }), ...[...out.groups.values()].map((b) => ({ x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h }))]
  const mx = Math.min(...all.map((b) => b.x1)), my = Math.min(...all.map((b) => b.y1))
  for (const p of out.nodes.values()) { p.x -= mx; p.y -= my }
  for (const b of out.groups.values()) { b.x -= mx; b.y -= my }
  out.w = Math.max(...all.map((b) => b.x2)) - mx
  out.h = Math.max(...all.map((b) => b.y2)) - my
  return out
}

// Which sides of two shapes an elbow arrow joins, for the way the diagram reads: across for left
// to right, down for top to bottom, unless the shapes sit the other way round. As Excalidraw's
// fixed points (a fraction of the shape's width and height).
export function sides(a, b, dir = 'LR') {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  const across = Math.abs(cb.x - ca.x) - (a.width + b.width) / 2
  const down = Math.abs(cb.y - ca.y) - (a.height + b.height) / 2
  const horizontal = dir === 'TB' ? across > Math.max(down, 0) + 20 : across > down || across > 20
  if (horizontal) return cb.x >= ca.x ? [[1, 0.5], [0, 0.5]] : [[0, 0.5], [1, 0.5]]
  return cb.y >= ca.y ? [[0.5, 1], [0.5, 0]] : [[0.5, 0], [0.5, 1]]
}

// An orthogonal path from one side of a shape to another's, as a start: Excalidraw routes an elbow
// arrow round the shapes once it's on the board (reroute), and takes which way it leaves each
// shape from where its ends are, so they must already be on the sides it joins.
export function elbowPoints(a, b, [fa, fb]) {
  const p = { x: a.x + fa[0] * a.width, y: a.y + fa[1] * a.height }
  const q = { x: b.x + fb[0] * b.width, y: b.y + fb[1] * b.height }
  const across = fa[1] === 0.5
  const pts = across ? [[0, 0], [(q.x - p.x) / 2, 0], [(q.x - p.x) / 2, q.y - p.y], [q.x - p.x, q.y - p.y]] : [[0, 0], [0, (q.y - p.y) / 2], [q.x - p.x, (q.y - p.y) / 2], [q.x - p.x, q.y - p.y]]
  return { x: p.x, y: p.y, points: pts }
}

// Where a ray from the middle of a shape towards a point leaves it (for a straight arrow).
function edgePoint(e, toward) {
  const cx = e.x + e.width / 2, cy = e.y + e.height / 2
  const dx = toward.x - cx, dy = toward.y - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const s = Math.min(dx ? (e.width / 2) / Math.abs(dx) : Infinity, dy ? (e.height / 2) / Math.abs(dy) : Infinity)
  return { x: cx + dx * s, y: cy + dy * s }
}

// Elbow arrows routed again by Excalidraw itself, around the shapes where they now are. They must
// be on the board already (it routes from the board's own copy of each).
export function reroute(X, ex, ids) {
  const want = ids ? new Set(ids) : null
  for (const e of ex.getSceneElements()) if (e.type === 'arrow' && e.elbowed && (!want || want.has(e.id))) X.mutateElement(e, { points: e.points })
}

// Elements brought into view, as large as fits (never past 100%) in the part of the board that
// isn't covered: inset { top, right } is what a panel over the board takes, besides the toolbar at
// the top and the zoom buttons at the bottom.
export function fitInView(X, ex, elements, inset = {}) {
  const live = elements.filter((e) => !e.isDeleted)
  if (!live.length) return
  const [x1, y1, x2, y2] = X.getCommonBounds(live)
  const { width, height } = ex.getAppState()
  const top = Math.max(76, (inset.top || 0) + 16), bottom = 64, left = 16, right = (inset.right || 0) + 16
  const w = Math.max(80, width - left - right), h = Math.max(80, height - top - bottom)
  const zoom = Math.max(0.1, Math.min(1, w / Math.max(1, x2 - x1), h / Math.max(1, y2 - y1)))
  ex.updateScene({ appState: { zoom: { value: zoom }, scrollX: (left + w / 2) / zoom - (x1 + x2) / 2, scrollY: (top + h / 2) / zoom - (y1 + y2) / 2 } })
}

// Auto-layout: the board's shapes (or the selected ones, with what's in them) laid out again.
// Shapes keep their sizes; containers fit round what they hold; arrows follow. Returns the ids
// moved, or null when there was nothing to lay out.
export function layoutBoard(X, ex, { dir = 'LR', spacing = 'normal' } = {}) {
  const all = ex.getSceneElements()
  const byId = new Map(all.map((e) => [e.id, e]))
  const picked = new Set(Object.entries(ex.getAppState().selectedElementIds || {}).filter(([, on]) => on).map(([id]) => id))
  let scope = all
  if (picked.size) {
    const s = new Set()
    for (const id of picked) { const e = byId.get(id); if (!e) continue; s.add(e); if (holderOf(e)) contents(e, all).forEach((c) => s.add(c)) }
    scope = [...s]
  }
  const arrows = all.filter((e) => e.type === 'arrow' && !e.isDeleted)
  const bound = new Set(arrows.flatMap((a) => [a.startBinding?.elementId, a.endBinding?.elementId]).filter(Boolean))
  const SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'image', 'frame', 'embeddable', 'iframe'])
  const containers = scope.filter((e) => isContainer(e))
  const nodes = scope.filter((e) => !e.containerId && !isContainer(e) && (SHAPES.has(e.type) || (e.type === 'text' && bound.has(e.id))) && !nodeAround(e, all))
  if (nodes.length < 2) return null
  // Each shape's container: the smallest one around it.
  const around = (e) => { let best = null; for (const c of containers) if (c.id !== e.id && within(e, c) && (!best || c.width * c.height < best.width * best.height)) best = c; return best }
  const groups = containers.map((c) => ({ id: c.id, parent: around(c)?.id || null, w: c.width, h: c.height }))
  const nodeOf = (id) => { const e = byId.get(id); if (!e) return null; if (nodes.includes(e)) return e; const n = nodeAround(e, all); return n && nodes.includes(n) ? n : null }
  const edges = arrows.map((a) => ({ a, from: nodeOf(a.startBinding?.elementId), to: nodeOf(a.endBinding?.elementId) })).filter((x) => x.from && x.to)
  const res = layoutGraph({
    nodes: nodes.map((e) => ({ id: e.id, w: e.width, h: e.height, group: around(e)?.id || null })),
    groups,
    edges: edges.map((x) => ({ from: x.from.id, to: x.to.id, label: (x.a.boundElements || []).some((b) => b.type === 'text') ? 'label' : '' })),
  }, { dir, spacing })
  // Where it was, so it stays there.
  const was = [...nodes, ...containers].map(box)
  const ox = Math.min(...was.map((b) => b.x1)), oy = Math.min(...was.map((b) => b.y1))
  const next = new Map()
  const move = (e, dx, dy) => { if (e && !next.has(e.id)) next.set(e.id, X.newElementWith(e, { x: e.x + dx, y: e.y + dy })) }
  const words = (e) => all.filter((t) => t.containerId === e.id)
  for (const e of nodes) {
    const p = res.nodes.get(e.id)
    const dx = ox + p.x - e.x, dy = oy + p.y - e.y
    move(e, dx, dy)
    words(e).forEach((t) => move(t, dx, dy))
    if (holderOf(e) === 'node') contents(e, all).forEach((c) => { move(c, dx, dy); words(c).forEach((t) => move(t, dx, dy)) })
  }
  for (const c of containers) {
    const b = res.groups.get(c.id)
    if (!b) continue
    const dx = ox + b.x - c.x, dy = oy + b.y - c.y
    // Loose words and lines in a container go where it goes.
    for (const o of contents(c, all)) if (!next.has(o.id) && !nodes.includes(o) && !isContainer(o) && o.type !== 'arrow') { move(o, dx, dy); words(o).forEach((t) => move(t, dx, dy)) }
    next.set(c.id, X.newElementWith(c, { x: ox + b.x, y: oy + b.y, width: b.w, height: b.h }))
    words(c).forEach((t) => move(t, dx, dy))
  }
  const at = (e) => next.get(e.id) || e
  const elbows = []
  for (const { a, from, to } of edges) {
    const s = at(from), t = at(to)
    if (a.elbowed) {
      const [fs, ft] = sides(s, t, dir)
      next.set(a.id, X.newElementWith(a, { ...elbowPoints(s, t, [fs, ft]), fixedSegments: null, startBinding: { ...a.startBinding, fixedPoint: fs }, endBinding: { ...a.endBinding, fixedPoint: ft } }))
      elbows.push(a.id)
    } else {
      const p = edgePoint(s, { x: t.x + t.width / 2, y: t.y + t.height / 2 }), q = edgePoint(t, { x: s.x + s.width / 2, y: s.y + s.height / 2 })
      next.set(a.id, X.newElementWith(a, { x: p.x, y: p.y, points: [[0, 0], [q.x - p.x, q.y - p.y]], width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }))
    }
    // An arrow's words sit at its middle; Excalidraw places them again as it draws.
  }
  ex.updateScene({ elements: all.map((e) => next.get(e.id) || e), captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
  reroute(X, ex, elbows)
  return [...next.keys()]
}
