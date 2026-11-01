// Diagrams into whiteboard shapes, and back into words for a model. X is the Excalidraw module
// (excalidraw.js), handed in so nothing here loads it by itself.
//   Mermaid (a model's "Draw this", an agent's .mmd, a ```mermaid block): Excalidraw's own
//   mermaid-to-excalidraw lays it out (dagre) as boxes, arrows and words. Flowcharts, sequence and
//   class diagrams become shapes; other kinds come in as one picture.
//   draw.io (.drawio): its boxes, ellipses, diamonds, words and arrows, where they were, with their
//   colours; each page beside the last.
//   "Change it": what a model says to change (update, add, connect, remove), carried out on the
//   shapes already there, so the rest stays where you put it.
import { loadMermaid } from './excalidraw.js'

// ---------- Mermaid ----------
export async function fromMermaid(X, text) {
  const { parseMermaidToExcalidraw } = await loadMermaid()
  // Strict, as Mermaid is by default: no scripts, links or HTML from a diagram an agent wrote.
  const { elements, files } = await parseMermaidToExcalidraw(String(text).trim(), { securityLevel: 'strict', themeVariables: { fontSize: '20px' } })
  const out = X.convertToExcalidrawElements(elements, { regenerateIds: true })
  return { elements: out, files: files || {}, picture: out.length > 0 && out.every((e) => e.type === 'image') }
}

// ---------- draw.io ----------
// A page's diagram is either the XML itself or, by default in draw.io, deflated and base64'd (and
// URI-encoded before that).
async function inflate(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
  try { return decodeURIComponent(text) } catch { return text }
}
const xmlDoc = (s) => {
  const d = new DOMParser().parseFromString(s, 'text/xml')
  if (d.getElementsByTagName('parsererror').length) throw new Error('This draw.io file can\'t be read')
  return d
}
const styleOf = (s) => {
  const out = {}
  String(s || '').split(';').filter(Boolean).forEach((part, i) => {
    const [k, ...v] = part.split('=')
    if (v.length) out[k.trim()] = v.join('=').trim()
    else if (i === 0) out.shape0 = k.trim()
    else out[k.trim()] = '1'
  })
  return out
}
// Labels may be HTML (html=1): the words, with a line break for each <br> and block.
const wordsOf = (v) => {
  const s = String(v || '')
  if (!/[<&]/.test(s)) return s.trim()
  const html = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h\d)>/gi, '\n')
  return (new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent || '').replace(/\n{2,}/g, '\n').trim()
}
const color = (c, fallback) => (!c || c === 'none' || c === 'default' ? fallback : /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback)

export async function fromDrawio(X, xml) {
  const doc = xmlDoc(xml)
  const pages = []
  if (doc.documentElement.nodeName === 'mxGraphModel') pages.push({ name: '', model: doc.documentElement })
  for (const d of [...doc.getElementsByTagName('diagram')]) {
    let model = d.getElementsByTagName('mxGraphModel')[0]
    if (!model && d.textContent.trim()) model = xmlDoc(await inflate(d.textContent.trim())).documentElement
    if (model) pages.push({ name: d.getAttribute('name') || '', model })
  }
  if (!pages.length) throw new Error('No diagram in this draw.io file')
  const skeleton = []
  let offset = 0
  for (const [pi, page] of pages.entries()) {
    // Cells, and cells wrapped in <object>/<UserObject> (which then hold the label and id).
    const cells = []
    for (const el of [...page.model.getElementsByTagName('*')]) {
      if (el.nodeName === 'mxCell' && !['object', 'UserObject'].includes(el.parentNode?.nodeName)) cells.push({ id: el.getAttribute('id'), label: el.getAttribute('value'), cell: el })
      else if (el.nodeName === 'object' || el.nodeName === 'UserObject') {
        const c = el.getElementsByTagName('mxCell')[0]
        if (c) cells.push({ id: el.getAttribute('id'), label: el.getAttribute('label') ?? el.getAttribute('value'), cell: c })
      }
    }
    const byId = new Map(cells.map((c) => [c.id, c]))
    const geo = (c) => {
      const g = [...c.cell.children].find((x) => x.nodeName === 'mxGeometry')
      return { x: Number(g?.getAttribute('x') || 0), y: Number(g?.getAttribute('y') || 0), w: Number(g?.getAttribute('width') || 0), h: Number(g?.getAttribute('height') || 0), g }
    }
    // Where a cell is on the page: its geometry is inside its parent's, for a box in a group or lane.
    const at = new Map()
    const abs = (c) => {
      if (at.has(c.id)) return at.get(c.id)
      const p = byId.get(c.cell.getAttribute('parent'))
      const base = p && p.cell.getAttribute('vertex') === '1' ? abs(p) : { x: 0, y: 0 }
      const g = geo(c)
      const r = { x: base.x + g.x, y: base.y + g.y, w: g.w, h: g.h }
      at.set(c.id, r)
      return r
    }
    const ids = new Map() // draw.io id -> id on the board (unique across pages)
    const idOf = (id) => { if (!ids.has(id)) ids.set(id, `d${pi}-${id}`); return ids.get(id) }
    const verts = cells.filter((c) => c.cell.getAttribute('vertex') === '1')
    const edges = cells.filter((c) => c.cell.getAttribute('edge') === '1')
    const pageBox = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }
    const grow = (r) => { pageBox.x1 = Math.min(pageBox.x1, r.x); pageBox.y1 = Math.min(pageBox.y1, r.y); pageBox.x2 = Math.max(pageBox.x2, r.x + r.w); pageBox.y2 = Math.max(pageBox.y2, r.y + r.h) }
    verts.forEach((c) => grow(abs(c)))
    const dx = Number.isFinite(pageBox.x1) ? offset - pageBox.x1 : offset
    const dy = Number.isFinite(pageBox.y1) ? -pageBox.y1 + (pages.length > 1 ? 60 : 0) : 0
    if (pages.length > 1) skeleton.push({ type: 'text', x: offset, y: 0, text: page.name || `Page ${pi + 1}`, fontSize: 28 })
    // Labels of edges are cells of their own, inside the edge.
    const edgeLabels = new Map()
    for (const c of verts) {
      const parent = byId.get(c.cell.getAttribute('parent'))
      if (parent?.cell.getAttribute('edge') === '1' && wordsOf(c.label)) edgeLabels.set(parent.id, wordsOf(c.label))
    }
    for (const c of verts) {
      const parent = byId.get(c.cell.getAttribute('parent'))
      if (parent?.cell.getAttribute('edge') === '1') continue
      const st = styleOf(c.cell.getAttribute('style'))
      const r = abs(c)
      const text = wordsOf(c.label)
      const shape = st.shape || st.shape0
      const stroke = color(st.strokeColor, '#1e1e1e')
      const fill = color(st.fillColor, 'transparent')
      const ink = color(st.fontColor, '#1e1e1e')
      const x = r.x + dx, y = r.y + dy
      if (shape === 'text' || (st.strokeColor === 'none' && (!st.fillColor || st.fillColor === 'none') && text)) {
        if (text) skeleton.push({ type: 'text', x, y, text, strokeColor: ink, fontSize: Number(st.fontSize) > 0 ? Number(st.fontSize) * 1.25 : 20 })
        continue
      }
      const type = shape === 'ellipse' || shape === 'doubleEllipse' || st.ellipse ? 'ellipse' : shape === 'rhombus' ? 'diamond' : 'rectangle'
      const lane = shape === 'swimlane' || st.swimlane || st.container === '1'
      skeleton.push({
        type, id: idOf(c.id), x, y, width: Math.max(r.w, 20), height: Math.max(r.h, 20),
        strokeColor: stroke, backgroundColor: lane ? 'transparent' : fill, fillStyle: 'solid',
        ...(st.rounded === '1' && type === 'rectangle' ? { roundness: { type: 3 } } : {}),
        ...(text ? { label: { text, strokeColor: ink, ...(lane ? { verticalAlign: 'top' } : {}) } } : {}),
      })
    }
    for (const c of edges) {
      const st = styleOf(c.cell.getAttribute('style'))
      const s = byId.get(c.cell.getAttribute('source')), t = byId.get(c.cell.getAttribute('target'))
      const g = geo(c).g
      const pt = (as) => { const p = g ? [...g.children].find((x) => x.nodeName === 'mxPoint' && x.getAttribute('as') === as) : null; return p ? { x: Number(p.getAttribute('x') || 0) + dx, y: Number(p.getAttribute('y') || 0) + dy } : null }
      // From the edge of one box to the edge of the other, as draw.io draws it.
      const rect = (cell) => { const r = abs(cell); return { x: r.x + dx, y: r.y + dy, width: r.w, height: r.h } }
      const ends = [s ? rect(s) : null, t ? rect(t) : null]
      const toward = [ends[1] ? middle(ends[1]) : pt('targetPoint'), ends[0] ? middle(ends[0]) : pt('sourcePoint')]
      const a = ends[0] && toward[0] ? edge(ends[0], toward[0]) : pt('sourcePoint')
      const b = ends[1] && toward[1] ? edge(ends[1], toward[1]) : pt('targetPoint')
      if (!a || !b) continue
      const text = wordsOf(c.label) || edgeLabels.get(c.id) || ''
      const plain = st.endArrow === 'none' && (!st.startArrow || st.startArrow === 'none')
      skeleton.push({
        type: plain ? 'line' : 'arrow', x: a.x, y: a.y, points: [[0, 0], [b.x - a.x, b.y - a.y]],
        strokeColor: color(st.strokeColor, '#1e1e1e'), ...(st.dashed === '1' ? { strokeStyle: 'dashed' } : {}),
        ...(!plain && s ? { start: { id: idOf(s.id) } } : {}), ...(!plain && t ? { end: { id: idOf(t.id) } } : {}),
        ...(text && !plain ? { label: { text } } : {}),
      })
    }
    offset += (Number.isFinite(pageBox.x2) ? pageBox.x2 - pageBox.x1 : 0) + 240
  }
  return { elements: X.convertToExcalidrawElements(skeleton, { regenerateIds: true }), files: {}, pages: pages.length }
}

// ---------- A file or a hand-over, into what to draw ----------
// .excalidraw: as it is. Mermaid and draw.io: turned into shapes. { elements, files, appState? }
export async function fromText(X, text, kind) {
  if (kind === 'excalidraw') {
    let j
    try { j = JSON.parse(text) } catch { throw new Error('This isn\'t a drawing Bridge AI can open (not JSON)') }
    if (!Array.isArray(j?.elements)) throw new Error('This isn\'t a drawing Bridge AI can open')
    return { elements: j.elements, files: j.files || {}, appState: j.appState || {} }
  }
  if (kind === 'drawio') return fromDrawio(X, text)
  if (kind === 'mermaid') return fromMermaid(X, text)
  throw new Error('Not a diagram')
}
// What a file is, from its name: an Excalidraw drawing, Mermaid or draw.io.
export const kindOfFile = (name) => {
  const n = String(name || '').toLowerCase()
  return /\.excalidraw(\.json)?$/.test(n) ? 'excalidraw' : /\.(mmd|mermaid)$/.test(n) ? 'mermaid' : /\.(drawio|dio)(\.xml)?$/.test(n) ? 'drawio' : null
}
// What an agent or the chief of staff handed over (boards.js: bridge.pending).
export async function fromPending(X, p) {
  if (p.kind === 'excalidraw') return { elements: p.elements || [], files: p.files || {} }
  return fromText(X, p.text || '', p.kind)
}

// ---------- Placing new shapes ----------
const live = (els) => els.filter((e) => !e.isDeleted)
export function bounds(X, els) {
  const l = live(els)
  if (!l.length) return null
  const [x1, y1, x2, y2] = X.getCommonBounds(l)
  return { x1, y1, x2, y2 }
}
// Moved (as copies) to the right of what's on the board, or to where you're looking when it's empty.
export function placeBeside(X, fresh, existing, view) {
  const b = bounds(X, fresh)
  if (!b) return fresh
  const there = bounds(X, existing)
  const [tx, ty] = there ? [there.x2 + 160, there.y1] : view ? [view.x - (b.x2 - b.x1) / 2, view.y - (b.y2 - b.y1) / 2] : [b.x1, b.y1]
  const dx = tx - b.x1, dy = ty - b.y1
  return fresh.map((e) => X.newElementWith(e, { x: e.x + dx, y: e.y + dy }))
}

// ---------- The board in words, for "Change it" ----------
const SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'frame', 'image', 'embeddable', 'iframe'])
export function describe(elements, only = null) {
  const l = live(elements)
  const byId = new Map(l.map((e) => [e.id, e]))
  const textOf = (e) => String(((e.boundElements || []).map((b) => byId.get(b.id)).find((x) => x?.type === 'text')?.originalText) ?? e.name ?? '').trim()
  const pick = only?.size ? l.filter((e) => only.has(e.id) || (e.containerId && only.has(e.containerId))) : l
  const hex = (c) => (c && c !== 'transparent' ? c : undefined)
  return {
    shapes: pick.filter((e) => SHAPES.has(e.type)).map((e) => ({ id: e.id, shape: e.type, text: textOf(e), x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height), fill: hex(e.backgroundColor), stroke: e.strokeColor !== '#1e1e1e' ? e.strokeColor : undefined })),
    arrows: pick.filter((e) => e.type === 'arrow' || e.type === 'line').map((e) => ({ id: e.id, from: e.startBinding?.elementId || null, to: e.endBinding?.elementId || null, text: textOf(e) })),
    texts: pick.filter((e) => e.type === 'text' && !e.containerId).map((e) => ({ id: e.id, text: String(e.originalText ?? e.text ?? '').trim(), x: Math.round(e.x), y: Math.round(e.y) })),
  }
}

// ---------- "Change it" ----------
const HEX = /^#[0-9a-f]{6}$/i
const SIZE = { rectangle: [200, 80], ellipse: [200, 90], diamond: [200, 110] }
const overlaps = (a, b, pad = 30) => a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
// Where a ray from the middle of a box towards a point leaves the box.
function edge(e, toward) {
  const cx = e.x + e.width / 2, cy = e.y + e.height / 2
  const dx = toward.x - cx, dy = toward.y - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const s = Math.min(dx ? (e.width / 2) / Math.abs(dx) : Infinity, dy ? (e.height / 2) / Math.abs(dy) : Infinity)
  return { x: cx + dx * s, y: cy + dy * s }
}
const middle = (e) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 })

// The board's elements with the changes made: { elements, touched } (the ids to select after).
export function applyOps(X, elements, ops) {
  let els = [...elements]
  const index = () => new Map(els.map((e, i) => [e.id, i]))
  let at = index()
  const get = (id) => (at.has(id) ? els[at.get(id)] : null)
  const put = (e) => { if (at.has(e.id)) els[at.get(e.id)] = e; else { els.push(e); at.set(e.id, els.length - 1) } }
  const refs = new Map() // a model's ref for a new shape -> its element
  const find = (id) => refs.get(id) || (get(id) && !get(id).isDeleted ? get(id) : null)
  const touched = new Set()
  const textIn = (e) => (e.boundElements || []).map((b) => get(b.id)).find((x) => x?.type === 'text' && !x.isDeleted)

  // New words for a shape or an arrow: a new label (measured and placed by Excalidraw) in place of
  // the old one.
  const relabel = (e, text) => {
    const old = textIn(e)
    if (old) put(X.newElementWith(old, { isDeleted: true }))
    if (!text) { put(X.newElementWith(e, { boundElements: (e.boundElements || []).filter((b) => b.id !== old?.id) })); return }
    if (e.type === 'text') { put(X.newElementWith(e, { isDeleted: true })); const [t] = X.convertToExcalidrawElements([{ type: 'text', x: e.x, y: e.y, text, fontSize: e.fontSize, strokeColor: e.strokeColor }]); put(t); touched.add(t.id); return }
    const made = X.convertToExcalidrawElements([e.type === 'arrow' || e.type === 'line'
      ? { type: 'arrow', id: e.id, x: e.x, y: e.y, points: e.points, label: { text } }
      : { type: e.type, id: e.id, x: e.x, y: e.y, width: e.width, height: e.height, label: { text } }], { regenerateIds: false })
    const box = made.find((m) => m.id === e.id)
    const t = made.find((m) => m.type === 'text')
    if (!t) return
    put(t)
    put(X.newElementWith(e, { ...(box && e.type !== 'arrow' && e.type !== 'line' ? { width: Math.max(e.width, box.width), height: Math.max(e.height, box.height) } : {}), boundElements: [...(e.boundElements || []).filter((b) => b.id !== old?.id), { type: 'text', id: t.id }] }))
  }

  for (const id of ops.remove || []) {
    const e = get(id)
    if (!e || e.isDeleted) continue
    put(X.newElementWith(e, { isDeleted: true }))
    const t = textIn(e)
    if (t) put(X.newElementWith(t, { isDeleted: true }))
    // Arrows to and from it go with it.
    for (const a of els) if ((a.type === 'arrow') && !a.isDeleted && (a.startBinding?.elementId === id || a.endBinding?.elementId === id)) {
      put(X.newElementWith(a, { isDeleted: true }))
      const at2 = textIn(a)
      if (at2) put(X.newElementWith(at2, { isDeleted: true }))
    }
  }
  for (const u of ops.update || []) {
    const e = get(u?.id)
    if (!e || e.isDeleted) continue
    const style = {
      ...(HEX.test(u.fill || '') && e.type !== 'text' ? { backgroundColor: u.fill, fillStyle: 'solid' } : {}),
      ...(HEX.test(u.stroke || '') ? { strokeColor: u.stroke } : {}),
    }
    if (Object.keys(style).length) put(X.newElementWith(e, style))
    if (typeof u.text === 'string' && u.text.trim() !== (textIn(get(e.id))?.originalText ?? (e.type === 'text' ? e.originalText : ''))) relabel(get(e.id), u.text.trim())
    touched.add(e.id)
  }
  for (const a of ops.add || []) {
    const type = SIZE[a?.shape] ? a.shape : 'rectangle'
    const [w, h] = SIZE[type]
    const near = find(a.near)
    const all = live(els)
    const b = bounds(X, all)
    let x, y
    if (near) {
      const side = ['right', 'left', 'above', 'below'].includes(a.side) ? a.side : 'right'
      x = side === 'right' ? near.x + near.width + 120 : side === 'left' ? near.x - w - 120 : near.x + near.width / 2 - w / 2
      y = side === 'above' ? near.y - h - 100 : side === 'below' ? near.y + near.height + 100 : near.y + near.height / 2 - h / 2
    } else { x = b ? b.x2 + 120 : 0; y = b ? b.y1 : 0 }
    // Not on top of something already there: further along until there's room.
    for (let i = 0; i < 40 && all.some((o) => o.type !== 'arrow' && o.type !== 'line' && !o.containerId && overlaps({ x, y, width: w, height: h }, o)); i++) {
      if (near && (a.side === 'above' || a.side === 'below')) x += w + 40
      else y += h + 40
    }
    const made = X.convertToExcalidrawElements([{ type, x, y, width: w, height: h, ...(HEX.test(a.fill || '') ? { backgroundColor: a.fill, fillStyle: 'solid' } : {}), ...(a.text ? { label: { text: String(a.text) } } : {}) }])
    made.forEach(put)
    const box = made.find((m) => m.type === type)
    if (box) { if (a.ref) refs.set(String(a.ref), box); touched.add(box.id) }
  }
  for (const c of ops.connect || []) {
    const s = find(c?.from), t = find(c?.to)
    if (!s || !t || s.id === t.id) continue
    const p = edge(s, middle(t)), q = edge(t, middle(s))
    const made = X.convertToExcalidrawElements([{ type: 'arrow', x: p.x, y: p.y, points: [[0, 0], [q.x - p.x, q.y - p.y]], ...(c.text ? { label: { text: String(c.text) } } : {}) }])
    const arrow = made.find((m) => m.type === 'arrow')
    if (!arrow) continue
    made.filter((m) => m !== arrow).forEach(put)
    put(X.newElementWith(arrow, { startBinding: { elementId: s.id, focus: 0, gap: 6 }, endBinding: { elementId: t.id, focus: 0, gap: 6 } }))
    for (const end of [s, t]) { const now = get(end.id); put(X.newElementWith(now, { boundElements: [...(now.boundElements || []), { type: 'arrow', id: arrow.id }] })) }
    touched.add(arrow.id)
  }
  return { elements: els, touched: [...touched].filter((id) => get(id) && !get(id).isDeleted) }
}
