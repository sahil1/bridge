// A model's diagram (shared/whiteboard/spec.js) drawn on the board: laid out (layout.js), its
// containers behind, its shapes and icons from the catalog, and arrows joined to them that turn at
// right angles in the clean look. And the other way: what's on the board as a diagram again, for a
// model to look over and improve (Refine).
import { ITEMS } from '../../../shared/whiteboard/catalog.js'
import { skeletonOf, NODE, SIZE } from './shapes/make.js'
import { layoutGraph, sides, elbowPoints } from './layout.js'
import { lookOf } from './look.js'
import { holderOf, nodeAround } from './holders.js'

// About how wide words are at a size, without measuring (the board measures them again).
const wide = (s, size) => [...String(s || '')].reduce((w, c) => w + (/[⺀-鿿가-힯]/.test(c) ? 1 : /[A-Z@#%&MW]/.test(c) ? 0.68 : /[iljt.,:;'|! ]/.test(c) ? 0.3 : 0.52), 0) * size

export function sizeOf(n) {
  const it = ITEMS.get(n.shape)
  if (it?.kind === 'icon') {
    const lines = Math.max(1, Math.ceil(wide(n.label, 14) / (NODE.w - 12)))
    return [NODE.w, NODE.h + Math.max(0, lines - 2) * 18]
  }
  const kind = it?.shape || 'rectangle'
  const [w, h] = SIZE[kind] || SIZE.rectangle
  const tw = wide(n.label, 14) + (kind === 'diamond' ? 70 : 36)
  const W = Math.round(Math.min(kind === 'diamond' ? 300 : 260, Math.max(w, tw)))
  const lines = Math.max(1, Math.ceil(tw / W))
  return [W, h + (lines - 1) * 20]
}

// { elements, files, refs } with its top left at 0, 0. refs: spec id -> element id ("n:<id>" for
// a node, "g:<id>" for a group, "e:<n>" for the n-th edge).
export function fromSpec(X, spec, { look = 'clean', scheme = 'soft', spacing = 'normal', dir } = {}) {
  const l = lookOf(look)
  const direction = spec.direction || dir || 'LR'
  const sized = spec.nodes.map((n) => { const [w, h] = sizeOf(n); return { ...n, w, h } })
  const res = layoutGraph({ nodes: sized.map((n) => ({ id: n.id, w: n.w, h: n.h, group: n.group })), groups: spec.groups.map((g) => ({ id: g.id, parent: g.parent })), edges: spec.edges }, { dir: direction, spacing })
  const skeleton = []
  const files = {}
  const add = (s) => { skeleton.push(...s.skeleton); Object.assign(files, s.files) }
  // Containers outermost first, so each is behind what it holds.
  const depth = (g) => { let d = 0; for (let p = g.parent; p; p = spec.groups.find((x) => x.id === p)?.parent) d++; return d }
  for (const g of [...spec.groups].sort((a, b) => depth(a) - depth(b))) {
    const b = res.groups.get(g.id)
    if (b) add(skeletonOf(ITEMS.get(g.kind) || ITEMS.get('group'), { x: b.x, y: b.y, w: b.w, h: b.h, label: g.label, ref: `g:${g.id}`, look, scheme }))
  }
  const boxes = new Map()
  for (const n of sized) {
    const p = res.nodes.get(n.id)
    boxes.set(n.id, { x: p.x, y: p.y, width: n.w, height: n.h })
    add(skeletonOf(ITEMS.get(n.shape) || ITEMS.get('process'), { x: p.x, y: p.y, w: n.w, h: n.h, label: n.label, ref: `n:${n.id}`, look, scheme }))
  }
  const elbow = l.arrowType === 'elbow'
  spec.edges.forEach((e, i) => {
    const a = boxes.get(e.from), b = boxes.get(e.to)
    if (!a || !b || e.from === e.to) return
    const fixed = sides(a, b, direction)
    const path = elbow ? elbowPoints(a, b, fixed) : (() => { const p = { x: a.x + fixed[0][0] * a.width, y: a.y + fixed[0][1] * a.height }, q = { x: b.x + fixed[1][0] * b.width, y: b.y + fixed[1][1] * b.height }; return { x: p.x, y: p.y, points: [[0, 0], [q.x - p.x, q.y - p.y]] } })()
    skeleton.push({
      type: 'arrow', ...path, start: { id: `n:${e.from}` }, end: { id: `n:${e.to}` }, elbowed: elbow, roundness: elbow ? null : { type: 2 },
      roughness: l.roughness, strokeWidth: l.strokeWidth, strokeColor: '#475569', strokeStyle: e.style === 'dashed' ? 'dashed' : 'solid', endArrowhead: l.arrowhead,
      ...(e.label ? { label: { text: e.label, fontSize: 13, fontFamily: l.font, strokeColor: '#334155' } } : {}),
      customData: { bridge: { ref: `e:${i}`, fixed } },
    })
  })
  const els = X.convertToExcalidrawElements(skeleton)
  const refs = {}
  for (const e of els) { const r = e.customData?.bridge?.ref; if (r) refs[r] = e.id }
  // Elbow arrows join fixed points on their shapes' sides (Excalidraw's own kind of joining).
  const elements = els.map((e) => {
    if (e.type !== 'arrow' || !e.elbowed) return e
    const fixed = e.customData?.bridge?.fixed
    const { fixed: _, ...bridge } = e.customData.bridge
    return X.newElementWith(e, { startBinding: e.startBinding && { ...e.startBinding, fixedPoint: fixed[0] }, endBinding: e.endBinding && { ...e.endBinding, fixedPoint: fixed[1] }, customData: { bridge } })
  })
  return { elements, files, refs }
}

// What's on the board (or a part of it) as a diagram again: the shapes, icons and containers by
// their catalog ids, arrows by what they join. ids: the elements to take (all when null).
export function toSpec(elements, ids = null) {
  const live = elements.filter((e) => !e.isDeleted && (!ids || ids.has(e.id)))
  const byId = new Map(elements.map((e) => [e.id, e]))
  const textOf = (e) => String(((e.boundElements || []).map((b) => byId.get(b.id)).find((x) => x?.type === 'text' && !x.isDeleted)?.originalText) ?? '').trim()
  const containers = live.filter((e) => holderOf(e) && holderOf(e) !== 'node')
  const inside = (e, c) => e.x >= c.x - 1 && e.y >= c.y - 1 && e.x + e.width <= c.x + c.width + 1 && e.y + e.height <= c.y + c.height + 1
  const around = (e) => containers.filter((c) => c.id !== e.id && inside(e, c)).sort((a, b) => a.width * a.height - b.width * b.height)[0] || null
  const SH = { rectangle: 'process', diamond: 'decision', ellipse: 'circle' }
  const nodes = live.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type) && !containers.includes(e) && !nodeAround(e, live))
    .map((e) => ({ id: e.id, label: textOf(e), shape: e.customData?.bridge?.item && ITEMS.has(e.customData.bridge.item) ? e.customData.bridge.item : SH[e.type], group: around(e)?.id || null }))
  const nid = new Set(nodes.map((n) => n.id))
  const groups = containers.map((c) => ({ id: c.id, label: textOf(c), kind: ITEMS.get(c.customData?.bridge?.item)?.kind === 'container' ? c.customData.bridge.item : 'group', parent: around(c)?.id || null }))
  const edges = live.filter((e) => e.type === 'arrow' && nid.has(e.startBinding?.elementId) && nid.has(e.endBinding?.elementId))
    .map((e) => ({ from: e.startBinding.elementId, to: e.endBinding.elementId, label: textOf(e), style: e.strokeStyle === 'dashed' ? 'dashed' : 'solid' }))
  // Short ids for the model (n1, n2…), the same each time for the same board.
  const short = new Map()
  nodes.forEach((n, i) => short.set(n.id, `n${i + 1}`))
  groups.forEach((g, i) => short.set(g.id, `g${i + 1}`))
  const s = (id) => (id ? short.get(id) || null : null)
  return {
    spec: { nodes: nodes.map((n) => ({ ...n, id: s(n.id), group: s(n.group) })), groups: groups.map((g) => ({ ...g, id: s(g.id), parent: s(g.parent) })), edges: edges.map((e) => ({ ...e, from: s(e.from), to: s(e.to) })) },
    ids: Object.fromEntries([...short].map(([k, v]) => [v, k])),
  }
}
